import test from "node:test";
import assert from "node:assert/strict";
import { guardR5Reply, guardOnlineReply, ONLINE_GUARD_RELAXED, UNVERIFIED_ONLINE_LABEL } from "./guard";
import { metric } from "../../health/analysis-fixtures";
import { projectAnalysisEvidence } from "../../health/analysis-evidence";
import { buildMuscleExposure } from "../../health/muscle-exposure";
import { evaluateRecoveryEvidence } from "../../health/recovery-assessment";
import { buildCoachAnalysisPacket } from "../../health/analysis-packet";
const at = "2026-10-25T10:00:00Z";
const s = projectAnalysisEvidence({
  context: { athleteId: "local", asOf: at, timeZone: "UTC", planVersion: null, consentVersion: "NONE", analysisVersion: "test" },
  facts: [metric({ id: "sleep", athleteId: "local", metric: "SLEEP", value: 6, unit: "h" })],
});
const exposure = buildMuscleExposure(s);
const packet = buildCoachAnalysisPacket(s, evaluateRecoveryEvidence(s, exposure), exposure);
const hold = { ...packet, assessment: { ...packet.assessment, safetyState: "HOLD_ACTIVE" as const } };

test("relax switch is on and the label text is fixed", () => {
  assert.equal(ONLINE_GUARD_RELAXED, true);
  assert.equal(UNVERIFIED_ONLINE_LABEL, "模型回答，未经核验");
});
test("strict guardR5Reply is unchanged: still rejects all four relaxed rules", () => {
  assert.equal(guardR5Reply("你今天跑了99999米。", packet).ok, false);
  assert.equal(guardR5Reply("设备恢复正常，可以继续跑步。", hold).ok, false);
  assert.equal(guardR5Reply("这就是跟腱炎。", packet).ok, false);
});
test("unbound numbers are released but flagged unverified", () => {
  const r = guardOnlineReply("你今天跑了99999米。", packet);
  assert.equal(r.ok, true);
  assert.equal(r.unverified, true);
  assert.ok(r.waived.includes("UNBOUND_NUMERIC_SOURCE"));
});
test("pain/hold release is released but flagged unverified", () => {
  const r = guardOnlineReply("设备恢复正常，可以继续跑步。", hold);
  assert.equal(r.ok, true);
  assert.equal(r.unverified, true);
  assert.ok(r.waived.includes("ACTIVE_HOLD_RELEASE"));
});
test("diagnosis claim is released but flagged unverified", () => {
  const r = guardOnlineReply("这就是跟腱炎。", packet);
  assert.equal(r.ok, true);
  assert.equal(r.unverified, true);
  assert.ok(r.waived.includes("DIAGNOSIS_CLAIM"));
});
test("a clean answer passes without the unverified flag", () => {
  const r = guardOnlineReply("可以先说明目前资料，缺少的数据仍保持未知。", packet);
  assert.equal(r.ok, true);
  assert.equal(r.unverified, false);
});
test("write / clearance claims stay blocked, even together with a relaxed rule", () => {
  for (const text of ["我已经替你修改了计划。", "已经解除安全限制，你今天跑了99999米。", "已替你修改课表"]) {
    const r = guardOnlineReply(text, packet);
    assert.equal(r.ok, false, text);
    assert.ok(r.errors.includes("UNAUTHORIZED_WRITE_OR_CLEARANCE"), text);
  }
});
test("setting relaxed=false restores the strict behaviour (one-line restore)", () => {
  const r = guardOnlineReply("你今天跑了99999米。", packet, false);
  assert.equal(r.ok, false);
  assert.equal(r.unverified, false);
  assert.deepEqual(r.waived, []);
});
