import test from "node:test";
import assert from "node:assert/strict";
import { auditDeviceConflict } from "./coach-device-conflict.ts";
import { answerLocally } from "./coach-local-first.ts";
import { assembleCoachBrief } from "./coach-brief.ts";
import { setStoreBackend } from "./storage.ts";
import { firstWeekMemory } from "./coach-first-week.fixtures.ts";
const q =
  "Garmin睡眠8小时，Apple健康6小时15分，HRV72，静息心率比7天均值高7，主观感觉正常，RPE没记录，今天能做400米高强度吗？";
test("T23 keeps both device sources, raw values and uncertainty; never infers normal from missing RPE", () => {
  setStoreBackend(firstWeekMemory());
  const r = answerLocally(assembleCoachBrief(null, q, null));
  assert.ok(r.deviceAudit);
  assert.equal(r.deviceAudit.raw, q);
  assert.equal(r.deviceAudit.source, "USER_REPORT");
  assert.match(r.text, /8小时/);
  assert.match(r.text, /6小时15分/);
  assert.match(r.text, /HRV72/);
  assert.match(r.text, /不平均/);
  assert.match(r.text, /个人.*基线/);
  assert.match(r.text, /本课RPE/);
  assert.match(r.text, /不能.*确认恢复正常/);
  assert.match(r.text, /不据此确认高强度/);
});
test("reordered devices retain all raw reports without selecting preferred source", () => {
  const raw = "Apple健康6小时15分，佳明睡眠8小时，HRV72，静息心率高7；恢复正常吗？";
  const r = auditDeviceConflict(raw)!;
  assert.equal(r.raw, raw);
  assert.match(r.text, /不因品牌/);
  assert.match(r.text, /统计口径/);
});
test("single-device HRV has no inferred personal baseline or diagnosis", () => {
  const r = auditDeviceConflict("手表HRV72，正常吗？")!;
  assert.ok(r);
  assert.match(r.text, /算法、单位/);
  assert.match(r.text, /不能单独诊断/);
  assert.doesNotMatch(r.text, /已恢复|确诊|RPE 0/);
});
test("current emergency retains priority over device audit", () => {
  setStoreBackend(firstWeekMemory());
  const r = answerLocally(assembleCoachBrief(null, q + "现在胸痛呼吸困难", null));
  assert.match(r.text, /急诊/);
  assert.equal(r.deviceAudit, undefined);
});
test("device audit never mutates personal storage or claims imported measurements", () => {
  const m = firstWeekMemory();
  setStoreBackend(m);
  const before = new Map(m.data);
  answerLocally(assembleCoachBrief(null, q, null));
  assert.deepEqual(m.data, before);
});
test('absence and personal sleep are not device measurements',()=>{
 for(const q of ['没有HRV，今天跑步高强度能做吗？','HRV未测，跑步照常吗？','我睡眠4小时，今天训练要调整吗？','没有手表，睡眠4小时，跑步照常吗？'])assert.equal(auditDeviceConflict(q),null,q);
 assert.ok(auditDeviceConflict('HRV未测，但手表睡眠8小时、健康睡眠4小时，两者不一致'));
});
