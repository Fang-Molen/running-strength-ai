import test from "node:test"
import assert from "node:assert/strict"
import { recoveryVerdict } from "./recovery-verdict.ts"
const none = { readiness: null, bodyBattery: null, sleepH: null, sleepBase: null, hrv: null, hrvBase: null, rhr: null, rhrBase: null, subjective: null, stress: null }
test("verdicts with state-not-ability wording", () => {
  assert.equal(recoveryVerdict(none).level, "unknown")
  const go = recoveryVerdict({ ...none, readiness: 72, hrv: 48, hrvBase: 47 }); assert.equal(go.title, "目前未见明显不利信号")
  const red = recoveryVerdict({ ...none, readiness: 35 }); assert.equal(red.title, "建议降强度"); assert.match(red.note, /不代表能力/)
  assert.equal(recoveryVerdict({ ...none, sleepH: 5.5, sleepBase: 7.5 }).level, "watch")
  assert.equal(recoveryVerdict({ ...none, sleepH: 5.5, sleepBase: 7.5, rhr: 60, rhrBase: 52 }).level, "reduce")
  assert.equal(recoveryVerdict({ ...none, hrv: 38, hrvBase: 50 }).level, "reduce")
})

test("单一正常静息心率、身体电量或训练准备度不能单独宣称适合训练", () => {
  for (const patch of [{rhr:50,rhrBase:52},{bodyBattery:75},{readiness:72}]) {
    const result=recoveryVerdict({...none,...patch})
    assert.equal(result.level,'unknown')
    assert.doesNotMatch(result.title,/适合正常训练/)
  }
  const multi=recoveryVerdict({...none,readiness:72,hrv:48,hrvBase:47})
  assert.equal(multi.level,'go')
  assert.doesNotMatch(multi.title,/适合正常训练/)
})
