import test from "node:test"
import assert from "node:assert/strict"
import { loadBrand, trainingDetail, loadWatch, saveWatch, manualKinds, freshness, saveCheckin, loadCheckins, fatigueScore } from "./watch-mode.ts"
import { recoveryVerdict } from "./recovery-verdict.ts"
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }
test("watch choice persists and can change; unknown value ignored", () => {
  const s = mem(); assert.equal(loadWatch(s), null)
  saveWatch("pro", s, "garmin"); assert.equal(loadWatch(s), "pro"); assert.equal(loadBrand(s), "garmin"); saveWatch("basic", s, "garmin"); assert.equal(loadBrand(s), null); saveWatch("none", s); assert.equal(loadWatch(s), "none")
  s.setItem("fk-watch-v1", '{"watch":"x"}'); assert.equal(loadWatch(s), null)
})
test("watch mode blocks manual watch metrics; no-watch allows sleep", () => {
  assert.deepEqual(manualKinds("pro"), ["RECOVERY"]); assert.ok(!manualKinds("basic").includes("HRV"))
  assert.deepEqual(manualKinds("none"), ["SLEEP", "RECOVERY"]); assert.equal(trainingDetail("pro"), "full"); assert.equal(trainingDetail("basic"), "basic")
})
test("stale reminder after 24h", () => {
  const now = new Date("2026-10-13T12:00:00")
  assert.equal(freshness("2026-10-13T07:00:00", now).stale, false)
  assert.equal(freshness("2026-10-12T10:00:00", now).stale, true)
  assert.equal(freshness(null, now).stale, true)
})
test("one-tap checkin merges per day; sharp pain lowers verdict", () => {
  const s = mem(); saveCheckin("2026-10-13", { fatigue: "ok" }, s); saveCheckin("2026-10-13", { pain: "sharp" }, s)
  const c = loadCheckins(s); assert.equal(c.length, 1); assert.equal(c[0].fatigue, "ok"); assert.equal(fatigueScore(c[0].fatigue), 6)
  const base = { readiness: 70, bodyBattery: null, sleepH: null, sleepBase: null, hrv: null, hrvBase: null, rhr: null, rhrBase: null, subjective: 6, stress: null }
  assert.equal(recoveryVerdict(base).level, "go")
  assert.equal(recoveryVerdict({ ...base, pain: "sharp" }).level, "reduce")
  assert.equal(recoveryVerdict({ ...base, pain: "mild" }).level, "watch")
})

import { sameActivity } from "./device-parse.ts"
test("cross-source dedupe by start time + distance", () => {
  const a = { startIso: "2026-10-13T07:00:00Z", distanceM: 10000 }
  assert.ok(sameActivity(a, { startIso: "2026-10-13T07:01:10Z", distanceM: 10150 }))
  assert.ok(!sameActivity(a, { startIso: "2026-10-13T07:05:00Z", distanceM: 10000 }))
  assert.ok(!sameActivity(a, { startIso: "2026-10-13T07:00:00Z", distanceM: 8000 }))
  assert.ok(!sameActivity(a, { startIso: null, distanceM: 10000 }))
})

import { loadTier, saveTier, canShow, gateRecovery, TIERS } from "./watch-mode.ts"
test("tier follows group by default and can be switched manually", () => {
  const s = mem(); assert.equal(loadTier(s), "basic")
  saveWatch("pro", s, "garmin"); assert.equal(loadTier(s), "pro")
  saveTier("plus", s); assert.equal(loadTier(s), "plus"); assert.equal(loadWatch(s), "pro"); assert.equal(loadBrand(s), "garmin")
  saveWatch("none", s); assert.equal(loadTier(s), "basic")
})
test("tier gating: analyses, tiles and verdict inputs", () => {
  assert.ok(!canShow("basic", "recoveryVerdict")); assert.ok(canShow("plus", "recoveryVerdict")); assert.ok(!canShow("plus", "trainingLoad")); assert.ok(canShow("pro", "runDynamics"))
  assert.ok(!TIERS.plus.tiles.includes("HRV")); assert.ok(TIERS.pro.tiles.includes("HRV"))
  const i = { readiness: 30, bodyBattery: 20, sleepH: 7, sleepBase: 7.5, hrv: 30, hrvBase: 50, rhr: 55, rhrBase: 52, subjective: 7, stress: 90 }
  const plus = gateRecovery("plus", i); assert.equal(plus.hrv, null); assert.equal(plus.readiness, null); assert.equal(plus.rhr, 55); assert.equal(plus.sleepBase, 7.5)
  assert.equal(recoveryVerdict(plus).level, "go"); assert.equal(recoveryVerdict(gateRecovery("pro", i)).level, "reduce")
  const basic = gateRecovery("basic", i); assert.equal(basic.rhr, null); assert.equal(basic.sleepBase, null)
})
