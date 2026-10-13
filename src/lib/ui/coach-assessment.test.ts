import test from "node:test"
import assert from "node:assert/strict"
import { aggressiveness, applyFeedbackToProposal, assess, excludedIds, type Feedback, type LoggedSession } from "./coach-assessment.ts"
import type { ScheduleEntry } from "./day-schedule-rules.ts"
const T = "2026-10-15"
const log = (id: string, date: string, km: number, min: number): LoggedSession => ({ id, date, sport: "RUNNING", distanceM: km * 1000, durationSec: min * 60, strengthVolumeKg: 0, sets: 0, rpe: null })
const ent = (p: Partial<ScheduleEntry>): ScheduleEntry => ({ id: "e", date: T, kind: "run", modality: "run", title: "跑", focus: [], minutes: 40, intensity: "EASY", lowerHeavy: false, source: "custom", refId: null, status: "planned", ...p })
const fb = (p: Partial<Feedback>): Feedback => ({ targetId: "x", vote: "down", reasons: [], text: "", at: "", excludeIds: [], ...p })
test("records: volume, pace PR, consistency; one bad session is not a conclusion", () => {
  const logs = [log("a", "2026-09-25", 5, 30), log("b", "2026-10-02", 5, 29), log("c", "2026-10-13", 5, 26), log("d", "2026-10-14", 8, 50)]
  const bad = ent({ id: "x1", date: "2026-10-13", status: "done", actual: { outcome: "different", minutes: 20, intensity: "EASY", note: "", reasons: ["tired"], at: "" } })
  const a = assess({ today: T, entries: [bad], logs, recovery: null, feedback: [] })
  assert.ok(a.records.some((r) => r.includes("本周跑量 13 km"))); assert.ok(a.records.some((r) => r.includes("最快配速 5'12\"")))
  assert.doesNotMatch(a.verdict, /能力下降|退步/); assert.ok(a.suggestions.length >= 1 && a.suggestions.length <= 3)
})
test("two state deviations → state wording, hold", () => {
  const d = (id: string, date: string) => ent({ id, date, status: "done", actual: { outcome: "different", minutes: 20, intensity: "EASY", note: "", reasons: ["tired"], at: "" } })
  const a = assess({ today: T, entries: [d("1", "2026-10-13"), d("2", "2026-10-14")], logs: [log("a", "2026-10-13", 3, 20)], recovery: null, feedback: [] })
  assert.match(a.verdict, /不代表能力下降/); assert.ok(a.suggestions.some((s) => s.id.endsWith(":hold")))
})
test("feedback: special day excluded next time, with visible adjustment", () => {
  const logs = [log("a", "2026-10-13", 5, 40), log("b", "2026-10-14", 5, 26)]
  const f = [fb({ reasons: ["special"], excludeIds: ["a"] })]
  assert.ok(excludedIds(f).has("a"))
  const a = assess({ today: T, entries: [], logs, recovery: null, feedback: f })
  assert.ok(a.records.some((r) => r.includes("本周跑量 5 km"))); assert.ok(a.adjustments[0].includes("排除 1 次"))
  assert.equal(excludedIds([fb({ vote: "up", reasons: ["special"], excludeIds: ["a"] })]).size, 0)
})
test("feedback: aggressiveness clamps, changes suggestions and proposals", () => {
  assert.equal(aggressiveness([fb({ reasons: ["tooConservative"] }), fb({ reasons: ["tooConservative"] }), fb({ reasons: ["tooConservative"] })]), 2)
  const aggr = [fb({ reasons: ["tooAggressive"] })]
  const p = applyFeedbackToProposal(ent({ status: "proposed", intensity: "HARD" }), aggr); assert.equal(p.intensity, "MODERATE"); assert.match(p.swapReason!, /反馈/)
  assert.equal(applyFeedbackToProposal(ent({ status: "planned", intensity: "HARD" }), aggr).intensity, "HARD")
  assert.equal(applyFeedbackToProposal(ent({ status: "proposed", minutes: 30 }), [fb({ reasons: ["tooConservative"] })]).minutes, 40)
  const a = assess({ today: T, entries: [], logs: [log("a", "2026-10-13", 5, 30)], recovery: null, feedback: aggr })
  assert.ok(a.adjustments.some((x) => x.includes("更保守")))
})
test("no data → no conclusion", () => { assert.match(assess({ today: T, entries: [], logs: [], recovery: null, feedback: [] }).verdict, /暂不下结论/) })
