import test from "node:test";
import assert from "node:assert/strict";
import { numericReasoningIssues } from "./coach-reasoning.ts";
import { interpretCoachModelOutput, buildCoachModelRequest } from "../strength/coach-pipeline";
import { request, row } from "../../../evaluation/r6/fixtures.ts";
import { fullRows } from "../../../evaluation/r7/fixtures.ts";

test("R8 explicit week/date binding resolves only the selected execution date", () => {
  for (const question of ["第三周就是2026-03-01这次训练，如何分析？", "第 3 周（2026-03-01）这次训练如何分析？"]) {
    const d = request(fullRows(), undefined, undefined, question);
    assert.equal(d.v4!.reasoning.stage, "EXPLAIN_EVIDENCE");
    assert.match(buildCoachModelRequest(d).packet, /USER_DATE_ANCHOR/);
  }
  for (const question of ["第三周那次怎么看？", "第 3 周那次怎么看？", "第三周就是2026-03-02这次训练", "第三周比2026-03-01这次快吗？", "第三周就是2026-03-01，第四周怎么样？"]) {
    assert.equal(request(fullRows(), undefined, undefined, question).v4!.reasoning.stage, "RESOLVE_TIME_REFERENCE", question);
  }
  const voided = fullRows().map(r => ({ ...r, status: "VOIDED" as const }));
  assert.equal(request(voided, undefined, undefined, "第三周就是2026-03-01这次训练").v4!.reasoning.stage, "RESOLVE_TIME_REFERENCE");
});

test("R8 average pace must be the computed average, not merely a valid individual pace", () => {
  const frame = request(fullRows()).v4!.reasoning;
  assert.deepEqual(numericReasoningIssues(frame, `平均配速${frame.computed.groups[0].averagePace}/km。`), []);
  assert.ok(numericReasoningIssues(frame, "平均配速3:17/km。").includes("UNVERIFIED_AVERAGE_PACE"));
  const single = request([row("only", "SPLIT_SECONDS", 60)]).v4!.reasoning;
  assert.deepEqual(numericReasoningIssues(single, "缺少可比多段记录，不能计算平均配速。"), []);
  assert.ok(numericReasoningIssues(single, "平均配速2:30/km。").includes("UNCOMPUTED_AVERAGE_PACE"));
});

test("R8 negated pace and recovery clocks do not become claimed pace values", () => {
  const frame = request(fullRows()).v4!.reasoning;
  for (const text of ["配速不是4:00/km，而是3:17/km。", "不能把配速写成4:00/km。", "配速3:17/km，组间恢复3:30。"])
    assert.deepEqual(numericReasoningIssues(frame, text), [], text);
  for (const text of ["配速不是4:00/km，而是4:30/km。", "不能否认配速4:00/km。", "配速4:00/km并不能证明进步。"])
    assert.ok(numericReasoningIssues(frame, text).includes("UNVERIFIED_PACE_VALUE"), text);
});

test("R8 historical or current RPE gaps do not deny the selected recorded rating", () => {
  const frame = request(fullRows()).v4!.reasoning;
  for (const text of ["缺少长期RPE趋势。", "历史RPE未记录。", "当前RPE未记录，不能用所选训练当时的评分代替。", "并非缺少本次RPE。"])
    assert.deepEqual(numericReasoningIssues(frame, text), [], text);
  for (const text of ["缺少本次RPE。", "整课RPE未记录。", "缺少历史记录，但本次RPE未记录。"])
    assert.ok(numericReasoningIssues(frame, text).includes("RECORDED_RPE_MISSTATED_AS_MISSING"), text);
  const d = request(fullRows());
  const result = interpretCoachModelOutput(d, JSON.stringify({ mode: "answer", text: "缺少长期RPE趋势，不能判断长期变化。", citations: ["ev:s1:rpe"], nextStep: null, medicalReferral: false }));
  assert.equal(result.v4.status, "PASSED_STRUCTURAL_GUARD");
  assert.match(result.turn.text, /缺少长期RPE趋势/);
});
