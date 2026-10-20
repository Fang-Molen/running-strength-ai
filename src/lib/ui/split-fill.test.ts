import test from "node:test"
import assert from "node:assert/strict"
import { fillFromTarget, lastSplitTarget, splitsFromText, splitsToText, targetSecFromText } from "./split-fill.ts"
const plan = { distanceM: 200, reps: 3 }
test("target seconds from plan text; rest seconds are not a target", () => {
  assert.deepEqual(targetSecFromText("200m×3，组间8—10分钟；起始参考30—32秒，但以动作稳定"), { sec: 31, source: "课表参考 30–32 秒" })
  assert.equal(targetSecFromText("150m×5，约70—78%主观最快速度，组间90—120秒"), null)
})
test("one tap fills every empty rep, edit only the deviating one, same text format as lap match", () => {
  let v = fillFromTarget(splitsFromText("", plan), 31)
  assert.deepEqual(v, ["31.0", "31.0", "31.0"])
  v[2] = "32.4"
  assert.equal(splitsToText(v, plan), "200m: 31.0/31.0/32.4")
  assert.deepEqual(fillFromTarget(["30.2", "", ""], 31), ["30.2", "31.0", "31.0"], "already typed reps are kept")
})
test("round trip and rounds keep their structure", () => {
  const p = { distanceM: 200, reps: 2, rounds: 2 }
  assert.equal(splitsToText(["30", "31", "", "32"], p), "200m: 30/31 ｜ —/32")
  assert.deepEqual(splitsFromText("200m: 30/31 ｜ —/32", p), ["30", "31", "—", "32"])
  assert.equal(splitsToText(["", "", ""], plan), "", "nothing typed → nothing written (not 0)")
})
test("fallback target = latest same-distance record before this day", () => {
  const logs = { "2026-10-21": { reps: "200m: 31.0/31.4/31.8" }, "2026-10-24": { reps: "150m: 22/22/22" }, "2026-11-30": { reps: "200m: 29/29/29" } }
  assert.deepEqual(lastSplitTarget(logs, plan, "2026-11-18"), { sec: 31.4, source: "10-21 同距离平均" })
  assert.equal(lastSplitTarget(logs, { distanceM: 300, reps: 3 }, "2026-11-18"), null)
})
