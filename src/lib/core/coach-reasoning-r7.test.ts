import test from "node:test";
import assert from "node:assert/strict";
import { buildCoachModelRequest, interpretCoachModelOutput } from "../strength/coach-pipeline";
import { answerLocally } from "./coach-local-first.ts";
import {
  nextStepReasoningIssues,
  formatReasoningCandidate,
  reasoningForModel,
} from "./coach-reasoning.ts";
import { row, request, baseRows, AFTER } from "../../../evaluation/r6/fixtures.ts";
import { fullRows } from "../../../evaluation/r7/fixtures.ts";
const out = (
  d: ReturnType<typeof request>,
  text = "这次工作段逐组加快，原因仍待核对。",
  citations = ["work1"],
  nextStep: string | null = null,
) =>
  interpretCoachModelOutput(
    d,
    JSON.stringify({ mode: "answer", text, citations, nextStep, medicalReferral: false }),
  );
const local = (d: ReturnType<typeof request>) =>
  answerLocally(d.brief, { frame: d.v4!.reasoning, snapshot: d.v4!.review.audit.snapshot });
test("R7 real request and local answer carry four actual paces even when model is vague", () => {
  const d = request(fullRows()),
    c = d.v4!.reasoning.computed;
  assert.deepEqual(
    c.points.map((p) => p.pace),
    ["3:17", "3:15", "3:13", "3:05"],
  );
  const result = out(d);
  assert.equal(result.v4.status, "PASSED_STRUCTURAL_GUARD");
  for (const p of c.points) {
    assert.ok(result.turn.text.includes(p.pace!));
    assert.ok(local(d).text.includes(p.pace!));
  }
  assert.equal(
    JSON.parse(buildCoachModelRequest(d).packet).personalEvidenceV4.computed.facts.find(
      (f: any) => f.kind === "REP_PACE",
    ).cites.length,
    4,
  );
  assert.match(buildCoachModelRequest(d).system, /已经选择本次训练时必须写/);
});
test("R7 recovery ratio uses formal AFTER_REPEAT slot rather than time proximity", () => {
  const c = request(fullRows()).v4!.reasoning.computed;
  assert.deepEqual(
    c.rests.map((r) => r.workSourceId),
    ["work1", "work2", "work3"],
  );
  assert.equal(c.rests[0].recoveryToWorkRatio, 1.075);
  const d = request(
    fullRows().map((r) =>
      r.recordId === "rest1" ? { ...r, protocol: "running:c:rest:b:AFTER_ROUND:-:1:-" } : r,
    ),
  );
  assert.equal(d.v4!.reasoning.computed.rests[0].workSourceId, null);
});
test("R7 planned distance and null/missing actual distance never create a pace", () => {
  const rows = [
    row("unknown", "SPLIT_SECONDS", 200, { protocol: "running:c:rep:b:step:1:1" }),
    row("goal", "GOAL_SECONDS", 60, { status: "PLANNED", source: "PLAN" }),
  ];
  const d = request(rows);
  assert.equal(d.v4!.reasoning.computed.points[0].pace, null);
  assert.match(local(d).text, /不能计算配速/);
});
test("R7 same distance but different rounds, sessions and methods are not one trend", () => {
  const rows = fullRows()
    .filter((r) => r.metric === "SPLIT_SECONDS")
    .map((r, i) =>
      i === 1
        ? { ...r, protocol: "running:c:rep:b:step:2:2:990m" }
        : i === 2
          ? { ...r, source: "DEVICE" as const, verifiedByFormalProjection: false }
          : i === 3
            ? { ...r, trainingOccurrenceId: "s2" }
            : r,
    );
  const c = request(rows).v4!.reasoning.computed;
  assert.equal(c.groups.length, 0);
  assert.equal(c.points.length, 3);
});
test("R7 invented model pace rejected while deterministic facts remain explicitly separate", () => {
  const result = out(request(fullRows()), "本次配速4:00/km。");
  assert.equal(result.v4.status, "SAFE_FALLBACK_REQUIRES_REVIEW");
  assert.ok(result.v4.flags.includes("UNVERIFIED_PACE_VALUE"));
  assert.doesNotMatch(result.turn.text, /4:00/);
  assert.match(result.turn.text, /3:17/);
});
test("R7 invalid nextStep citation removes suggestion without replacing valid body", () => {
  const d = request(fullRows(), undefined, undefined, "下一课怎么调整？");
  d.brief.nextSession!.requiredSourceIds = ["ev:s1:rpe"];
  const result = out(d, "分段有加快，但不能据此定位原因。", ["work1"], "建议下一课保持。");
  assert.ok(result.v4.flags.includes("NEXT_STEP_REMOVED"));
  assert.match(result.turn.text, /分段有加快/);
  assert.equal(result.turn.nextStep, null);
});
test("R7 rest density increase is isolated, not silently authorized by KEEP", () => {
  const result = out(
    request(fullRows()),
    "逐组加快不能证明专项能力提升。",
    ["work1"],
    "建议下一课组间休息从3:30缩短到2:30。",
  );
  assert.ok(result.v4.flags.includes("REST_DENSITY_INCREASE_NOT_SUPPORTED"));
  assert.ok(result.v4.flags.includes("NEXT_STEP_REMOVED"));
  assert.match(result.turn.text, /不能证明专项能力/);
  assert.doesNotMatch(result.turn.text, /2:30/);
});
test("R7 body medical overclaim cannot be rescued by deleting nextStep", () => {
  const result = out(request(fullRows()), "已经痊愈，完全安全回归。", ["work1"], "建议保持。");
  assert.ok(["SAFE_FALLBACK_REQUIRES_REVIEW", "BASE_GUARD_REJECTED"].includes(result.v4.status));
  assert.doesNotMatch(result.turn.text, /已经痊愈/);
  assert.ok(!result.v4.flags.includes("NEXT_STEP_REMOVED"));
});
test("R7 expired/voided week citation rejected even if old brief still contains it", () => {
  const d = request([
    ...fullRows(),
    row("void-week", "SPLIT_SECONDS", 220, { status: "VOIDED", trainingOccurrenceId: "s2" }),
  ]);
  d.brief.sourceIds.push("void-week");
  const result = out(d, "根据上周记录可以判断。", ["void-week"]);
  assert.ok(result.v4.flags.includes("UNKNOWN_OR_REVOKED_SOURCE"));
  assert.equal(result.turn.nextStep, null);
  assert.doesNotMatch(local(d).text, /220秒/);
});
test("R7 valid other week facts cannot be cited as the selected session", () => {
  const d = request([
    ...fullRows(),
    row("old-week", "SPLIT_SECONDS", 230, { trainingOccurrenceId: "s2" }),
  ]);
  d.brief.sourceIds.push("old-week");
  const result = out(d, "所选训练表现很好。", ["old-week"]);
  assert.ok(["SAFE_FALLBACK_REQUIRES_REVIEW", "BASE_GUARD_REJECTED"].includes(result.v4.status));
  assert.ok(!buildCoachModelRequest(d).packet.includes("old-week:SPLIT_SECONDS"));
});
test("R7 RPE disagreement at different recording times shows both scores and scope question", () => {
  const d = request([
    ...fullRows(),
    row("rpe-other", "SESSION_RPE", 9, { occurredAt: "2026-03-01T10:40:00Z" }),
  ]);
  assert.equal(d.v4!.reasoning.stage, "RESOLVE_CONFLICT");
  const result = out(d);
  assert.match(result.turn.text, /RPE 6\/10/);
  assert.match(result.turn.text, /RPE 9\/10/);
  assert.match(result.turn.text, /同一整课、单组/);
  assert.doesNotMatch(result.turn.text, /RPE是多少/);
  assert.equal(result.turn.nextStep, null);
});
test("R7 spoken RPE conflicts preserved without overwriting bound score", () => {
  const d = request(fullRows(), undefined, undefined, "整课RPE是9，下一课怎么调整？");
  assert.equal(d.v4!.reasoning.stage, "RESOLVE_CONFLICT");
  assert.match(local(d).text, /自报RPE 9/);
  assert.ok(
    d.v4!.review.audit.snapshot.active.some((e) => e.metric === "SESSION_RPE" && e.value === 6),
  );
});
test("R7 concrete repeat candidate gives count, actual distance, before/after rest and stop criteria", () => {
  const frame = request(fullRows()).v4!.reasoning,
    text = formatReasoningCandidate(frame);
  assert.match(text, /4组×990米/);
  assert.match(text, /3:30 → 3:30/);
  assert.match(text, /次日反馈/);
  assert.match(text, /停止并重新评估/);
  assert.equal(frame.decision.planWrite, false);
});
test("R7 candidate does not invent dose with unknown symptoms or missing RPE", () => {
  for (const removed of ["pain", "ev:s1:rpe"]) {
    const text = formatReasoningCandidate(
      request(fullRows().filter((r) => r.recordId !== removed)).v4!.reasoning,
    );
    assert.match(text, /待核实/);
    assert.doesNotMatch(text, /4组×990米/);
  }
});
test("R7 duplicate recoveries and unverified devices never justify an executable repeat candidate", () => {
  const rows = [
    ...fullRows(),
    row("duplicate-rest", "REST_SECONDS", 210, {
      protocol: "running:c:rest:b:AFTER_REPEAT:step:1:1",
    }),
  ];
  assert.match(formatReasoningCandidate(request(rows).v4!.reasoning), /尚不能定剂量/);
  const device = fullRows().map((r) =>
    r.metric === "SPLIT_SECONDS"
      ? { ...r, source: "DEVICE" as const, verifiedByFormalProjection: false }
      : r,
  );
  assert.doesNotMatch(formatReasoningCandidate(request(device).v4!.reasoning), /4组×990米/);
});
test("R7 future or corrected split is absent at the wrong analysis time", () => {
  const rows = [
    ...fullRows(),
    row("correction", "SPLIT_SECONDS", 198, {
      protocol: "running:c:rep:b:step:1:4:990m",
      supersedesRecordId: "work4",
      knownAt: "2026-03-05T12:00:00Z",
    }),
  ];
  assert.equal(request(rows).v4!.reasoning.computed.points.at(-1)!.pace, "3:05");
  assert.equal(request(rows, AFTER).v4!.reasoning.computed.points.at(-1)!.pace, "3:20");
});
test("R7 bounded model frame is declared truncated at 1200 chars and contains no signature receipt", () => {
  const frame = request(fullRows()).v4!.reasoning;
  for (const bound of [1200, 2000, 3000]) {
    const packet = reasoningForModel(frame, bound);
    assert.ok(JSON.stringify(packet).length <= bound);
    assert.equal((packet as any).basis, undefined);
  }
});
test("R7 heart rate remains explicitly unavailable; no fake HR trend", () => {
  assert.equal(request(fullRows()).v4!.reasoning.computed.heartRateStatus, "NOT_A_FORMAL_FIELD");
  assert.doesNotMatch(local(request(fullRows())).text, /心率正常|心率下降/);
});
test("R7 emergency overrides numeric analysis and hypothetical plan", () => {
  const d = request(fullRows(), undefined, undefined, "刚跑完晕倒了，下一课怎么练？"),
    result = out(d);
  assert.equal(result.turn.medicalReferral, true);
  assert.match(result.turn.text, /急救|急诊/);
  assert.equal(result.turn.nextStep, null);
  assert.doesNotMatch(result.turn.text, /4组×990米/);
});
test("R7 safe negated shortening is not treated as a load increase", () => {
  const frame = request(fullRows()).v4!.reasoning;
  assert.deepEqual(nextStepReasoningIssues(frame, "下一课不缩短休息，先核对。", ["rest1"]), []);
});

test("R7 arbitrary numbered week does not become the currently selected session", () => {
  const d = request(fullRows(), undefined, undefined, "第四周那次训练怎么看？");
  assert.equal(d.v4!.reasoning.stage, "RESOLVE_TIME_REFERENCE");
  const result = out(d, "第四周表现稳定。", ["work1"]);
  assert.doesNotMatch(result.turn.text, /第四周表现稳定/);
  assert.match(result.turn.text, /哪天或哪条/);
  assert.equal(result.turn.nextStep, null);
});

test("R7 divergent repeated RPE record key keeps both values for reconciliation", () => {
  const d = request([
    ...fullRows(),
    row("ev:s1:rpe", "SESSION_RPE", 9, { sourceEventId: "other-rpe-event" }),
  ]);
  assert.equal(d.v4!.reasoning.stage, "RESOLVE_CONFLICT");
  const result = out(d);
  assert.match(result.turn.text, /RPE 6\/10/);
  assert.match(result.turn.text, /RPE 9\/10/);
});
test("R7 model cannot replace live RPE with an invented value or call it missing", () => {
  for (const body of ["本次RPE为9。", "本次未记录RPE。"]) {
    const result = out(request(fullRows()), body, ["ev:s1:rpe"]);
    assert.ok(["SAFE_FALLBACK_REQUIRES_REVIEW", "BASE_GUARD_REJECTED"].includes(result.v4.status));
    assert.match(result.turn.text, /整课RPE：6/);
  }
});
