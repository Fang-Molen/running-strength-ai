import test from "node:test"
import assert from "node:assert/strict"
import { abilityComparison, computeAbilities, shiftDay, type AbilityInput } from "./ability-radar.ts"
import type { ScheduleEntry } from "./day-schedule-rules.ts"
import type { VitalRecord } from "../nutrition/vitals.ts"

const T = "2026-10-13"
const e = (i: number, o: Partial<ScheduleEntry> & { modality: "run" | "strength" }, act: Partial<NonNullable<ScheduleEntry["actual"]>> = {}): ScheduleEntry => ({ id: "e" + i + o.modality, date: shiftDay(T, -i), kind: o.modality as never, title: "x", focus: [], minutes: 40, intensity: "MODERATE", lowerHeavy: false, source: "fangkun", refId: null, status: "done", ...o, actual: o.status === "skipped" ? undefined : { outcome: "as_planned", minutes: 40, intensity: "MODERATE", note: "", reasons: [], at: "", ...act } })
const base = (p: Partial<AbilityInput> = {}): AbilityInput => ({ entries: [], vitals: [], extras: [], checkins: [], tier: "pro", asOf: T, ...p })
const vit = (kind: VitalRecord["kind"], days: number, val: (i: number) => number): VitalRecord[] => Array.from({ length: days }, (_, i) => ({ id: kind + i, kind, value: val(i), unit: "ms", observedOn: shiftDay(T, -i), observedAt: null, source: "DEVICE_CONFIRMED", note: "", hrvMethod: "RMSSD", createdAt: "" }))
const by = (xs: ReturnType<typeof computeAbilities>, k: string) => xs.find((x) => x.key === k)!

test("empty data → all six 待评估, no invented numbers", () => {
  const r = computeAbilities(base())
  assert.equal(r.length, 6); assert.ok(r.every((x) => x.status === "pending" && x.score === null && x.confidence === null))
})
test("single session never produces a score", () => {
  const r = computeAbilities(base({ entries: [e(1, { modality: "run", km: 10 }, { km: 10, minutes: 50 }), e(2, { modality: "strength" })] }))
  for (const k of ["strength", "endurance", "speed", "stability", "adherence"]) assert.equal(by(r, k).status, "pending", k)
})
test("strength formula: 10 sessions / 4 weeks, all hard → 60 + 40 = 100; 3 easy → low confidence", () => {
  const ten = Array.from({ length: 10 }, (_, i) => e(i * 2 + 1, { modality: "strength" }, { rpe: 8 }))
  const s = by(computeAbilities(base({ entries: ten })), "strength"); assert.equal(s.score, 100); assert.equal(s.confidence, "高")
  const three = [1, 5, 9].map((d) => e(d, { modality: "strength", intensity: "EASY" }, { intensity: "EASY", rpe: 4 }))
  const t = by(computeAbilities(base({ entries: three })), "strength"); assert.equal(t.score, Math.round(60 * (3 / 4 / 2.5))); assert.equal(t.confidence, "低")
})
test("endurance + speed from km/minutes; pace 5:00/km maps to ~71", () => {
  const runs = [1, 3, 5, 8].map((d) => e(d, { modality: "run", km: 10 }, { km: 10, minutes: 50 }))
  const r = computeAbilities(base({ entries: runs }))
  assert.equal(by(r, "endurance").score, Math.round(60 * (40 / 4 / 30) + 40 * (10 / 15)))
  assert.equal(by(r, "speed").score, Math.round((150 / 210) * 100))
})
test("speed needs ≥3 runs with distance ≥3km", () => {
  const runs = [1, 3, 5].map((d) => e(d, { modality: "run" }, { minutes: 30 }))
  const r = computeAbilities(base({ entries: runs })); assert.equal(by(r, "speed").status, "pending"); assert.equal(by(r, "endurance").status, "scored")
})
test("recovery: pro uses HRV/RHR/sleep/body battery; basic ignores device data and caps confidence at 低", () => {
  const vitals = [...vit("HRV", 21, () => 50), ...vit("RHR", 21, () => 52), ...vit("SLEEP", 21, () => 8)]
  const extras = Array.from({ length: 21 }, (_, i) => ({ metric: "BODY_BATTERY" as const, day: shiftDay(T, -i), value: 80, source: "t" }))
  const pro = by(computeAbilities(base({ vitals, extras })), "recovery")
  assert.equal(pro.status, "scored"); assert.equal(pro.score, Math.round((100 + 50 + 50 + 80) / 4)); assert.equal(pro.confidence, "高")
  const basicNo = by(computeAbilities(base({ vitals, extras, tier: "basic" })), "recovery"); assert.equal(basicNo.status, "pending")
  const checkins = Array.from({ length: 8 }, (_, i) => ({ date: shiftDay(T, -i), fatigue: "ok" as const, at: "" }))
  const basic = by(computeAbilities(base({ tier: "basic", checkins })), "recovery"); assert.equal(basic.score, 60); assert.equal(basic.confidence, "低")
})
test("stability and adherence formulas", () => {
  const xs = [
    ...[1, 2, 8, 9].map((d) => e(d, { modality: "run" })),
    e(15, { modality: "run" }, { outcome: "different", reasons: ["pain"] }),
    e(16, { modality: "strength", status: "skipped" }),
    e(22, { modality: "strength" }), e(23, { modality: "strength" }),
  ]
  const r = computeAbilities(base({ entries: xs }))
  assert.equal(by(r, "stability").score, Math.round(80 * (6.5 / 8) + 20 * (1 - 1 / 8)))
  // weeks with ≥2 done: [0-7):2, [7-14):2, [14-21):1, [21-28):2 → 3 weeks; 7 sessions
  assert.equal(by(r, "adherence").score, Math.round(60 * 0.75 + 40 * (7 / 12)))
})
test("30-day-ago comparison uses the same formulas on the earlier window", () => {
  const old = [31, 33, 35, 38].map((d) => e(d, { modality: "run", km: 5 }, { km: 5, minutes: 35 }))
  const now = [1, 3, 5, 8].map((d) => e(d, { modality: "run", km: 10 }, { km: 10, minutes: 50 }))
  const { now: n, before: b } = abilityComparison(base({ entries: [...old, ...now] }))
  assert.ok(by(n, "endurance").score! > by(b, "endurance").score!)
  assert.equal(by(abilityComparison(base({ entries: now })).before, "endurance").status, "pending")
})
