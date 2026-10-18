import test from "node:test"
import assert from "node:assert/strict"
import { RULES, applyAction, findConflicts, weekOf, type ScheduleEntry } from "./day-schedule-rules.ts"
const e = (p: Partial<ScheduleEntry>): ScheduleEntry => ({ id: Math.random().toString(36).slice(2), date: "2026-10-13", kind: "run", modality: "run", title: "t", focus: [], minutes: 45, intensity: "EASY", lowerHeavy: false, source: "custom", refId: null, status: "planned", ...p })
const W = weekOf("2026-10-13")
test("week starts Monday", () => { assert.equal(W[0], "2026-10-12"); assert.equal(W.length, 7) })
test("heavy lower-body then hard run next day → warn with 4 options (经验规则 24h)", () => {
  const lower = e({ id: "L", kind: "strength", modality: "strength", lowerHeavy: true, intensity: "HARD", date: "2026-10-13" })
  const run = e({ id: "R", intensity: "HARD", date: "2026-10-14" })
  const c = findConflicts([lower, run], W, "2026-10-13", null).find((x) => x.id.startsWith("lower24"))!
  assert.ok(c); assert.equal(c.target, "R"); assert.deepEqual(c.actions, ["postpone", "reduce", "keepOne", "ack"]); assert.match(c.basis, /经验规则/)
  const moved = applyAction([lower, run], c, "postpone"); assert.equal(moved[1].date, "2026-10-15")
  const reduced = applyAction([lower, run], c, "reduce"); assert.equal(reduced[1].intensity, "MODERATE")
  const kept = applyAction([lower, run], c, "keepOne"); assert.equal(kept[1].status, "skipped")
})
test("same day hard run + lower strength is info only (run first, ≥3h)", () => {
  const c = findConflicts([e({ intensity: "HARD" }), e({ kind: "strength", modality: "strength", lowerHeavy: true })], W, "2026-10-13", null)
  assert.equal(c.length, 1); assert.equal(c[0].level, "info"); assert.match(c[0].text, new RegExp(`${RULES.sameDayGapHours}`))
})
test("core + upper strength with easy run: no conflict", () => {
  assert.equal(findConflicts([e({}), e({ kind: "strength", modality: "strength", focus: ["核心"] })], W, "2026-10-13", null).length, 0)
})
test(`>${RULES.maxHardPerWeek} hard per week (L-05) and two hard runs <48h`, () => {
  const c = findConflicts([e({ intensity: "HARD", date: "2026-10-12" }), e({ intensity: "HARD", date: "2026-10-13" }), e({ intensity: "HARD", date: "2026-10-16" })], W, "2026-10-12", null)
  assert.ok(c.some((x) => x.id.startsWith("week:"))); assert.ok(c.some((x) => x.id.startsWith("hard48")))
})
test("day total minutes over threshold", () => {
  assert.ok(findConflicts([e({ minutes: 90 }), e({ kind: "strength", modality: "strength", minutes: 70 })], W, "2026-10-13", null).some((x) => x.id.startsWith("mins")))
})
test("recovery: low readiness / HRV drop / 2 short nights → reduce; missing data → nothing (S-05)", () => {
  const hard = [e({ id: "H", intensity: "HARD" })]
  assert.equal(findConflicts(hard, W, "2026-10-13", { readiness: 35, sleepRecent: [], sleepBaseline: null, hrvToday: null, hrvBaseline: null })[0].actions[0], "reduce")
  assert.ok(findConflicts(hard, W, "2026-10-13", { readiness: null, sleepRecent: [], sleepBaseline: null, hrvToday: 38, hrvBaseline: 50 }).length)
  assert.ok(findConflicts(hard, W, "2026-10-13", { readiness: null, sleepRecent: [6, 6], sleepBaseline: 7.5, hrvToday: null, hrvBaseline: null }).length)
  assert.equal(findConflicts(hard, W, "2026-10-13", { readiness: null, sleepRecent: [6], sleepBaseline: 7.5, hrvToday: null, hrvBaseline: null }).length, 0)
  assert.equal(findConflicts(hard, W, "2026-10-13", null).length, 0)
})
test("acknowledged conflicts are hidden", () => {
  const list = [e({ intensity: "HARD" }), e({ kind: "strength", modality: "strength", lowerHeavy: true })]
  const c = findConflicts(list, W, "2026-10-13", null)
  assert.equal(findConflicts(list, W, "2026-10-13", null, [c[0].id]).length, 0)
})

import { review, logActual, weekSummary, adaptation, adaptProposal, swapProposal } from "./day-schedule-rules.ts"
test("review: accept / edit / reject; only planned count in summary", () => {
  let l = [e({ id: "p1", status: "proposed", source: "fangkun", intensity: "HARD" }), e({ id: "p2", status: "proposed", source: "fangkun" })]
  l = review(l, "p1", "accept", { minutes: 30, intensity: "MODERATE" }); l = review(l, "p2", "reject")
  assert.equal(l[0].status, "planned"); assert.equal(l[0].edited, true); assert.equal(l[0].minutes, 30); assert.equal(l[1].status, "rejected")
  assert.equal(weekSummary(l, W, "2026-10-13").planned, 1)
  assert.equal(findConflicts([l[1], e({ intensity: "HARD", date: "2026-10-14" })], W, "2026-10-13", null).length, 0)
})
test("actual stored separately from plan; summary counts deviations and reasons", () => {
  let l = [e({ id: "a", status: "planned", date: "2026-10-12", minutes: 50 }), e({ id: "b", status: "planned", date: "2026-10-13", minutes: 40 }), e({ id: "c", status: "planned", date: "2026-10-12" })]
  l = logActual(l, "a", { outcome: "as_planned", minutes: null, intensity: null, note: "", reasons: [] })
  l = logActual(l, "b", { outcome: "different", minutes: 25, intensity: "EASY", note: "只跑了一半", reasons: ["short"] })
  assert.equal(l[1].minutes, 40); assert.equal(l[1].actual!.minutes, 25); assert.equal(l[0].actual!.minutes, 50)
  const s = weekSummary(l, W, "2026-10-13")
  assert.deepEqual([s.planned, s.asPlanned, s.different, s.missed, s.actualMin], [3, 1, 1, 0, 75]); assert.deepEqual(s.reasons, [["short", 1]])
})
test("adaptation: state ≠ ability; time → shorten; pain → reduce; clean → progress", () => {
  const mk = (r: ("tired" | "short" | "pain")[], i: number) => ({ ...e({ id: "x" + i, date: `2026-10-${10 + i}`, status: "done" }), actual: { outcome: "different" as const, minutes: 20, intensity: null, note: "", reasons: r, at: "" } })
  const tired = adaptation([mk(["tired"], 0), mk(["tired"], 1)], "2026-10-13"); assert.equal(tired.mode, "hold"); assert.match(tired.note, /不代表能力下降/)
  assert.equal(adaptation([mk(["tired"], 0)], "2026-10-13").mode, "hold")
  const short = adaptation([mk(["short"], 0), mk(["short"], 1)], "2026-10-13"); assert.equal(short.mode, "shorten")
  assert.equal(adaptProposal(e({ status: "proposed", minutes: 60 }), short).minutes, 45)
  const pain = adaptation([mk(["pain"], 0)], "2026-10-13"); assert.equal(adaptProposal(e({ status: "proposed", intensity: "HARD" }), pain).intensity, "EASY")
  const ok = (i: number) => ({ ...e({ id: "o" + i, date: `2026-10-${10 + i}` }), actual: { outcome: "as_planned" as const, minutes: 40, intensity: null, note: "", reasons: [], at: "" } })
  assert.equal(adaptation([ok(0), ok(1), ok(2)], "2026-10-13").mode, "progress")
  assert.equal(adaptProposal(e({ status: "planned", minutes: 60 }), short).minutes, 60)
})
test("swap: never raises intensity, keeps day", () => {
  const base = e({ id: "s", status: "proposed", intensity: "HARD", minutes: 60, source: "fangkun" })
  for (const w of ["tired", "short", "noRun", "other"] as const) { const n = swapProposal(base, w); assert.equal(n.date, base.date); assert.notEqual(n.intensity, "HARD"); assert.equal(n.status, "proposed") }
  assert.equal(swapProposal(base, "noRun").modality, "strength")
})

import { clearActual as _clear, dedupeEntries as _dedupe, logActual as _log } from "./day-schedule-rules.ts"
test("状态可清除回待做；重复条目去重保留最后一次", () => {
  const base = { date: "2026-10-16", kind: "strength", modality: "strength", title: "力量 · 核心+下肢", focus: [], minutes: 40, intensity: "MODERATE", lowerHeavy: true, source: "custom", refId: "s1", status: "planned" } as const
  let es = [{ ...base, id: "a" }, { ...base, id: "b" }] as any[]
  es = _log(es, "a", { outcome: "missed", minutes: 0, intensity: null, note: "", reasons: [] }, "2026-10-16T01:00:00Z")
  es = _log(es, "b", { outcome: "missed", minutes: 0, intensity: null, note: "", reasons: [] }, "2026-10-16T02:00:00Z")
  const d = _dedupe(es); assert.equal(d.removed, 1); assert.equal(d.entries[0].id, "b")
  const c = _clear(d.entries, "b"); assert.equal(c[0].actual, undefined); assert.equal(c[0].status, "planned")
})
