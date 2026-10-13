import test from "node:test"
import assert from "node:assert/strict"
import { parseQuickLog } from "./quick-log.ts"
import { computeStreak, planReminders } from "./streak.ts"
import { applyOverride, planBand } from "./day-override.ts"
import { DEFAULTS, previewWeek, toggleGoal, tierFor, PRESET } from "./first-run.ts"
import { coachLines, effective, loadSettings, saveSettings, SETTINGS_DEFAULTS } from "./app-settings.ts"
import { canShow, TIERS } from "./watch-mode.ts"
import type { ScheduleEntry } from "./day-schedule-rules.ts"

const E = (p: Partial<ScheduleEntry>): ScheduleEntry => ({ id: Math.random().toString(36).slice(2), date: "2026-10-13", kind: "run", modality: "run", title: "轻松跑", focus: [], minutes: 40, intensity: "EASY", lowerHeavy: false, source: "fangkun", refId: null, status: "planned", ...p })
const done = (date: string, outcome: "as_planned" | "different" | "missed" = "as_planned", reasons: any[] = []) => E({ date, status: "done", actual: { outcome, minutes: 30, intensity: null, note: "", reasons, at: date + "T10:00:00Z" } })

test("parser: strength, run, weight, unknown", () => {
  assert.deepEqual(parseQuickLog("深蹲 3×8 60kg"), { kind: "strength", name: "深蹲", sets: 3, reps: 8, kg: 60 })
  assert.deepEqual(parseQuickLog("卧推 5x5"), { kind: "strength", name: "卧推", sets: 5, reps: 5, kg: null })
  const r = parseQuickLog("轻松跑 5公里 32分"); assert.equal(r.kind, "run"); if (r.kind === "run") { assert.equal(r.km, 5); assert.equal(r.minutes, 32); assert.equal(r.pace, "6:24"); assert.equal(r.title, "轻松跑") }
  const r2 = parseQuickLog("今晚跑了 5 公里 配速 5:40"); assert.equal(r2.kind, "run"); if (r2.kind === "run") { assert.equal(r2.minutes, 28); assert.equal(r2.when, "pm"); assert.equal(r2.pace, "5:40") }
  assert.deepEqual(parseQuickLog("体重 65.2"), { kind: "weight", kg: 65.2 })
  assert.equal(parseQuickLog("今天好累").kind, "unknown")
})
test("streak: done or logged deviation counts; up to 2 freezes per week; missed without reason does not count", () => {
  assert.equal(computeStreak([done("2026-10-12"), done("2026-10-13")], "2026-10-13").days, 2)
  assert.equal(computeStreak([done("2026-10-12"), done("2026-10-13", "missed", ["tired"])], "2026-10-13").days, 2)
  assert.equal(computeStreak([done("2026-10-12"), done("2026-10-13", "missed")], "2026-10-13").todayDone, false)
  // 周一(12)练，周二(13)空 → 未结束的今天不扣分
  assert.equal(computeStreak([done("2026-10-12")], "2026-10-13").days, 1)
  // 周三(14)空、周四(15)空 用掉 2 张冻结，周五(16)练
  const s = computeStreak([done("2026-10-13"), done("2026-10-16")], "2026-10-16"); assert.equal(s.days, 2); assert.deepEqual(s.frozen, ["2026-10-15", "2026-10-14"]); assert.equal(s.freezesLeft, 0)
  // 同周 3 天空 → 断签
  assert.equal(computeStreak([done("2026-10-12"), done("2026-10-16")], "2026-10-16").days, 1)
})
test("reminders: max 2/day, master off = none, logged = none", () => {
  const p = { ...SETTINGS_DEFAULTS.reminders, master: true }, now = new Date("2026-10-13T08:00:00")
  assert.equal(planReminders("2026-10-12T18:00:00", now, false, p).length, 2)
  assert.equal(planReminders("2026-10-12T18:00:00", now, false, p, 1).length, 1)
  assert.equal(planReminders("2026-10-12T18:00:00", now, false, { ...p, master: false }).length, 0)
  assert.equal(planReminders("2026-10-12T18:00:00", now, true, p).length, 0)
})
test("override: only that day, caps 20 min, home strength version; logged sessions untouched", () => {
  const es = [E({ id: "a", minutes: 60, intensity: "HARD" }), E({ id: "b", date: "2026-10-14", minutes: 60 }), E({ id: "c", modality: "strength", kind: "strength", title: "全身力量", lowerHeavy: true }), done("2026-10-13")]
  const o = applyOverride(es, { date: "2026-10-13", short: true, home: true })
  assert.equal(o[0].minutes, 20); assert.equal(o[0].intensity, "MODERATE"); assert.equal(o[1].minutes, 60)
  assert.equal(o[2].lowerHeavy, false); assert.match(o[2].title, /在家版/); assert.equal(o[3], es[3])
  assert.equal(es[0].minutes, 60) // 原数据不变
  assert.equal(applyOverride(es, null), es)
})
test("plan band thresholds", () => {
  const d = (m: number) => ({ ...E({ minutes: 40 }), actual: { outcome: "different" as const, minutes: m, intensity: null, note: "", reasons: [], at: "" } })
  assert.equal(planBand(d(40)), "green"); assert.equal(planBand(d(25)), "yellow"); assert.equal(planBand(d(10)), "orange"); assert.equal(planBand(d(70)), "orange")
  assert.equal(planBand(done("2026-10-13", "missed")), "red"); assert.equal(planBand(E({})), null)
})
test("onboarding: defaults, ≤2 goals, tier, equipment preset, preview only future days as proposals", () => {
  assert.deepEqual(toggleGoal(toggleGoal(toggleGoal([], "race"), "muscle"), "fat"), ["muscle", "fat"])
  assert.equal(tierFor({ ...DEFAULTS, source: "pro" }), "pro"); assert.equal(tierFor(DEFAULTS), "basic")
  assert.ok(PRESET.gym.includes("深蹲架")); assert.deepEqual(PRESET.bodyweight, [])
  const week = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]
  const p = previewWeek({ ...DEFAULTS, goals: ["race"], days: [0, 2, 4, 6], when: "evening" }, week, "2026-10-13")
  assert.ok(p.every((e) => e.date >= "2026-10-13" && e.status === "proposed" && e.slot === "pm" && e.why))
  assert.equal(p.length, 3); assert.ok(p.every((e) => e.intensity !== "HARD"))
})
test("settings: instant save, master greys children, brief coach keeps safety", () => {
  const m = new Map<string, string>(), kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  saveSettings({ ...loadSettings(kv), coachStyle: "detailed" }, kv); assert.equal(loadSettings(kv).coachStyle, "detailed")
  assert.equal(effective(SETTINGS_DEFAULTS.reminders, "training"), false)
  const lines = [{ text: "结论" }, { text: "1" }, { text: "2" }, { text: "3" }, { text: "4" }, { text: "胸痛立即停", safety: true }]
  const b = coachLines(lines, "brief"); assert.equal(b.length, 5); assert.equal(b[0].safety, true)
  assert.equal(coachLines(lines, "detailed").length, 6)
})
test("tier gating for training-log pro metrics", () => {
  for (const k of ["trainingLoad", "runDynamics", "zones"]) { assert.ok(canShow("pro", k)); assert.ok(!canShow("plus", k)); assert.ok(!canShow("basic", k)) }
  assert.ok(canShow("plus", "trainingTrend")); assert.ok(!canShow("basic", "trainingTrend"))
  assert.equal(TIERS.basic.depth, 1)
})
import { logMetrics } from "./log-metrics.ts"
test("training-log metrics gated by tier", () => {
  const es = [done("2026-10-13"), done("2026-10-06"), done("2026-09-29")]
  const b = logMetrics("basic", es, "2026-10-13"); assert.equal(b.trend, null); assert.equal(b.load, null); assert.equal(b.dynamics, false)
  const p = logMetrics("plus", es, "2026-10-13"); assert.equal(p.trend!.length, 4); assert.equal(p.trend!.at(-1)!.minutes, 40); assert.equal(p.load, null)
  const x = logMetrics("pro", es, "2026-10-13"); assert.ok(x.load); assert.equal(x.load!.acute, 40); assert.equal(x.dynamics, true)
})
