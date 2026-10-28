import test from "node:test";
import assert from "node:assert/strict";
import { cycleRequestFromText } from "./request";
import { buildCycleDraft } from "./planner";
import { monthFixture, followup } from "../../../../evaluation/adaptive/fixture";
import type { TrainingFact } from "../../health/analysis-contract";

for (const [text, weeks] of [
  ["未来八周的训练计划", 8],
  ["12周周期", 12],
  ["12周计划", 12],
  ["24周", 24],
  ["接下来二十四周怎么安排", 24],
  ["规划未来五十二周", 52],
  ["未来1周", 1],
  ["未来两周的计划", 2],
] as const) {
  test(`explicit future window is preserved: ${text}`, () => {
    assert.deepEqual(cycleRequestFromText(text), { request: { historyDays: 28, horizonWeeks: weeks } });
  });
}

test("review window and future horizon are independent", () => {
  assert.deepEqual(cycleRequestFromText("近两周做后面四周"), { request: { historyDays: 14, horizonWeeks: 4 } });
  assert.deepEqual(cycleRequestFromText("根据最近42天的训练，生成未来十二周计划"), { request: { historyDays: 42, horizonWeeks: 12 } });
  assert.deepEqual(cycleRequestFromText("近四周复盘，再做未来8周的计划"), { request: { historyDays: 28, horizonWeeks: 8 } });
  assert.equal(cycleRequestFromText("复盘过去两周的训练"), null);
});

test("calendar months require clarification instead of silently becoming four weeks", () => {
  for (const text of ["后面一个月的训练计划", "未来三个月的周期", "未来1个月怎么安排", "一个月训练计划", "下个月训练计划"]) {
    const parsed = cycleRequestFromText(text) as { request?: unknown; clarification?: string } | null;
    assert.ok(parsed?.clarification, text);
    assert.equal(parsed.request, undefined, text);
  }
});

test("conflicting or invalid explicit windows cannot reuse a saved horizon", () => {
  for (const text of ["未来8周或12周的计划", "未来0周计划", "未来53周计划", "未来-1周计划", "未来1.5周计划", "根据近三周训练生成未来八周计划"]) {
    const parsed = cycleRequestFromText(text) as { request?: unknown; clarification?: string } | null;
    assert.ok(parsed?.clarification, text);
    assert.equal(parsed.request, undefined, text);
  }
});

test("read-only, third-person and negated requests cannot implicitly create cycle drafts", () => {
  for (const text of ["举例给朋友安排八周训练计划", "不要生成12周计划", "不生成未来八周计划", "解释八周周期是什么意思"]) {
    assert.equal(cycleRequestFromText(text), null, text);
  }
  assert.deepEqual(cycleRequestFromText("不用保存，只生成未来八周草案"), { request: { historyDays: 28, horizonWeeks: 8 } });
});

test("ordinary single-session arrangements are not rerouted into a saved cycle", () => {
  for (const text of ["今天如何安排力量训练", "明天安排轻松跑", "第4周练什么"]) {
    assert.equal(cycleRequestFromText(text), null, text);
  }
});

for (const weeks of [8, 12, 24, 52]) {
  test(`${weeks}-week request preserves the saved goal and first-week confirmation boundary`, () => {
    const input = monthFixture(), goal = structuredClone(input.goal);
    input.request = cycleRequestFromText(`未来${weeks}周计划`)?.request;
    const draft = buildCycleDraft(input);
    assert.equal(draft.weeks.length, weeks);
    assert.deepEqual(input.goal, goal);
    assert.ok(draft.weeks[0].canConfirm);
    assert.ok(draft.weeks.slice(1).every(week => !week.canConfirm && week.conditional));
  });
}

test("fourth-week review alone maintains the familiar strength dose", () => {
  const input = monthFixture(), before = structuredClone(input);
  const draft = buildCycleDraft(input);
  const sessions = draft.weeks[3].sessions.filter(session => session.candidate?.modality === "strength");
  assert.ok(sessions.length > 0);
  assert.ok(sessions.every(session => session.changedVariable === "NONE"));
  assert.ok(sessions.every(session => session.candidate!.exercises!.every(exercise => exercise.sets === "3")));
  assert.match(draft.weeks[3].strengthFocus, /复核/);
  assert.match(sessions[0].reason, /维持|保持/);
  assert.deepEqual(input, before);
});

test("comparable repeated feedback can still propose a fourth-week reduction", () => {
  const input = monthFixture();
  const sessions = input.snapshot.facts.filter((fact): fact is TrainingFact => fact.kind === "TRAINING" && ["strength-1", "strength-3"].includes(fact.id));
  input.snapshot.facts.push(...sessions.map(session => followup(session, "SORENESS", 4)));
  const draft = buildCycleDraft(input);
  const strength = draft.weeks[3].sessions.filter(session => session.candidate?.modality === "strength");
  assert.ok(strength.length > 0);
  assert.ok(strength.every(session => session.changedVariable === "SETS"));
  assert.ok(strength.every(session => session.candidate!.exercises!.every(exercise => exercise.sets === "2")));
  assert.ok(strength.every(session => /同协议.*反馈/.test(session.reason)));
  assert.equal(draft.weeks[3].canConfirm, false);
});

test("a taper reduction cannot claim repeated feedback that was never recorded", () => {
  const input = monthFixture();
  input.goal.raceDate = "2026-11-01";
  const draft = buildCycleDraft(input);
  assert.equal(draft.weeks[0].phase, "TAPER");
  assert.ok(draft.weeks[0].sessions.some(session => session.candidate?.modality === "strength" && session.changedVariable === "SETS"));
  assert.ok(draft.portrait.adaptive.groups.every(group => group.state !== "REVIEW_DOSE"));
  assert.doesNotMatch(draft.weeks[0].strengthFocus, /依据同协议重复反馈/);
});
