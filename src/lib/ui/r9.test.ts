import test from "node:test"
import assert from "node:assert/strict"
import { injuryAdvice, loadInjury, saveInjury, needsInjuryAsk } from "./injury.ts"
import { LAYOUT_DEFAULT, loadLayout, move, normalize, saveLayout, setQuick, toggleCard, visibleCards } from "./home-layout.ts"
import { bandBasisOf, planBand } from "./day-override.ts"
import { pendingLocal, sentToday, support } from "./notify.ts"
import { parseHealthParam, readLaunchParams } from "./shortcut-link.ts"
import type { ScheduleEntry } from "./day-schedule-rules.ts"
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }

test("injury: asked once at first strength; current pain avoids loaded moves, old injury cautions; P-03/P-07 red", () => {
  const s = mem(); assert.ok(needsInjuryAsk(loadInjury(s), true)); assert.ok(!needsInjuryAsk(loadInjury(s), false))
  saveInjury({ asked: true, items: [] }, s); assert.ok(!needsInjuryAsk(loadInjury(s), true))
  const moves = ["杠铃深蹲", "卧推", "硬拉", "平板支撑"]
  const a = injuryAdvice(moves, [{ part: "膝", kind: "current", score: 5, since: "2026-09-20" }, { part: "肩", kind: "old" }], "2026-10-13")
  assert.deepEqual(a.avoid, ["杠铃深蹲"]); assert.deepEqual(a.caution, ["卧推"])
  assert.ok(a.safety.some((x) => x.rule === "P-03" && x.red)); assert.ok(a.safety.some((x) => x.rule === "P-07"))
  const mild = injuryAdvice(moves, [{ part: "下背", kind: "current", score: 2 }], "2026-10-13")
  assert.deepEqual(mild.avoid, ["杠铃深蹲", "硬拉"]); assert.ok(mild.safety.every((x) => !x.red))
  assert.ok(!injuryAdvice(moves, [], "2026-10-13").safety.length)
})
test("home layout: reorder, hide (week locked), 4 quick slots + swap, normalize unknown", () => {
  let l = LAYOUT_DEFAULT
  l = move(l, "recovery", -1); assert.equal(l.order[0], "recovery")
  l = toggleCard(l, "override"); assert.ok(!visibleCards(l).includes("override"))
  assert.equal(toggleCard(l, "week"), l)
  l = setQuick(l, 0, "diet"); assert.equal(l.quick[0], "diet"); assert.equal(l.quick.length, 4)
  l = setQuick(l, 1, "diet"); assert.equal(l.quick[1], "diet"); assert.equal(l.quick[0], "import")
  const n = normalize({ order: ["x" as never, "week"], quick: ["log", "log"] as never }); assert.equal(n.order[0], "week"); assert.equal(n.order.length, 6); assert.equal(new Set(n.quick).size, 4)
  const s = mem(); saveLayout(l, s); assert.deepEqual(loadLayout(s), l)
})
test("band uses distance when the plan is by distance", () => {
  const e = (km: number | undefined, aKm: number | null, aMin: number): ScheduleEntry => ({ id: "r", date: "2026-10-13", kind: "run", modality: "run", title: "跑", focus: [], minutes: 40, intensity: "EASY", lowerHeavy: false, source: "fangkun", refId: null, status: "done", km, actual: { outcome: "different", minutes: aMin, km: aKm, intensity: null, note: "", reasons: [], at: "" } })
  assert.equal(bandBasisOf(e(10, 10, 20)), "distance"); assert.equal(planBand(e(10, 10, 20)), "green") // 时长只有一半，但距离达标
  assert.equal(planBand(e(10, 4, 40)), "orange"); assert.equal(planBand(e(undefined, 4, 40)), "green")
  assert.equal(planBand(e(10, 10, 20), "time"), "yellow")
})
test("local reminders respect 2/day and support notes iOS limits", () => {
  const prefs = { master: true, training: true, pending: true, stale: true, evening: true }, now = new Date("2026-10-13T08:00:00")
  assert.equal(sentToday(JSON.stringify({ date: "2026-10-13", count: 2 }), "2026-10-13"), 2); assert.equal(sentToday(JSON.stringify({ date: "2026-10-12", count: 2 }), "2026-10-13"), 0)
  assert.equal(pendingLocal("2026-10-12T18:00:00", now, false, prefs, 2).length, 0)
  const p = pendingLocal("2026-10-12T18:00:00", now, false, prefs, 0); assert.equal(p.length, 2); assert.ok(p[0].delayMs > 0)
  const ios = support({ Notification: function () {}, navigator: { userAgent: "iPhone OS 17", serviceWorker: {} } }); assert.equal(ios.standaloneIOS, false); assert.match(ios.note, /添加到主屏幕/)
  assert.equal(support(undefined).api, false)
})
test("shortcut URL params: log text and Apple Health rows (validated, deduped)", () => {
  assert.deepEqual(readLaunchParams("?log=%E6%B7%B1%E8%B9%B2%203%C3%978%2060kg"), { log: "深蹲 3×8 60kg", health: null })
  const r = parseHealthParam("SLEEP,2026-10-12,7.25\nRHR,2026-10-12,52\nHRV,2026-10-12,45\nRHR,2026-10-12,53\nweight,2026-10-12,65.4\nBAD,x,1\nRHR,2026-10-12,400")
  assert.equal(r.rows.length, 4); assert.equal(r.rows[0].value, 7.3); assert.equal(r.errors.length, 2); assert.ok(r.rows.every((x) => x.source.includes("快捷指令")))
})
import { buildReview, upsertReview, loadReviews, acceptedAdaptation } from "./review.ts"
test("review: structure, state vs ability, tier depth, accepted adjustment persists", () => {
  const mk = (id: string, date: string, outcome: "as_planned" | "different" | "missed", minutes: number | null, reasons: any[] = []): ScheduleEntry => ({ id, date, kind: "run", modality: "run", title: "跑", focus: [], minutes: 40, intensity: "EASY", lowerHeavy: false, source: "fangkun", refId: null, status: "done", actual: { outcome, minutes, intensity: null, note: "", reasons, at: "" } })
  const es = [mk("a", "2026-10-12", "as_planned", null), mk("b", "2026-10-13", "different", 20, ["short"]), mk("c", "2026-10-13", "missed", 0, ["short"])]
  const r = buildReview("week", es, "2026-10-13", "pro")
  assert.equal(r.bands.length, 3); assert.ok(r.issues.some((i) => i.type === "state")); assert.ok(!r.issues.some((i) => i.type === "ability"))
  assert.equal(r.adjustment?.mode, "shorten")
  const basic = buildReview("week", es, "2026-10-13", "basic"); assert.equal(basic.bands.length, 0); assert.ok(basic.evidence.length < r.evidence.length)
  // 能力问题需 ≥2 次无原因的未达标
  const ab = buildReview("week", [mk("x", "2026-10-12", "different", 15), mk("y", "2026-10-13", "different", 15)], "2026-10-13", "plus"); assert.ok(ab.issues.some((i) => i.type === "data")); assert.ok(!ab.issues.some(i=>i.type==="ability")) // Missing reasons are not evidence of an ability deficit.
  const one = buildReview("week", [mk("x", "2026-10-12", "different", 15)], "2026-10-13", "plus"); assert.ok(!one.issues.some((i) => i.type === "ability"))
  assert.equal(buildReview("session", es, "2026-10-13", "pro", "b").bands.length, 1)
  const s = mem(); assert.equal(acceptedAdaptation("2026-10-13", s), null)
  upsertReview({ ...r, accepted: true, feedback: { vote: "up", reasons: [], text: "", at: "" } }, s)
  assert.equal(loadReviews(s).length, 1); assert.equal(acceptedAdaptation("2026-10-13", s)?.mode, "shorten"); assert.equal(acceptedAdaptation("2026-11-30", s), null)
})
import { replyActions } from "./coach-bubble.ts"
test("chat inline actions from reply content; none for safety replies", () => {
  assert.deepEqual(replyActions("今天练轻松跑 30 分钟，加入计划即可。HRV 正常。"), ["plan", "data"])
  assert.deepEqual(replyActions("建议下周缩短到 3/4 时长"), ["adjust"])
  assert.deepEqual(replyActions("胸痛请立即停止并就医，调整计划以后再说"), [])
})
import { rpeColor, rpeKey, rpeLabel, snapRpe } from "./rpe.ts"
test("energy gauge: snapping, RIR / talk-test labels, keyboard, colors", () => {
  assert.equal(snapRpe(6.4), 6); assert.equal(snapRpe(6.4, true), 6.5); assert.equal(snapRpe(12), 10); assert.equal(snapRpe(-1), 0)
  assert.equal(rpeLabel(7, "strength"), "还能再做约 3 次"); assert.equal(rpeLabel(8.5, "strength"), "还能再做约 1.5 次"); assert.match(rpeLabel(10, "strength"), /力竭/)
  assert.match(rpeLabel(7, "run"), /几个词/); assert.match(rpeLabel(3, "run"), /完整说话/)
  assert.equal(rpeKey(5, "ArrowRight"), 6); assert.equal(rpeKey(10, "ArrowUp"), 10); assert.equal(rpeKey(5, "Home"), 0); assert.equal(rpeKey(5, "PageDown"), 3); assert.equal(rpeKey(5, "a"), null); assert.equal(rpeKey(5, "ArrowLeft", true), 4.5)
  assert.match(rpeColor(0), /hsl\(215/); assert.match(rpeColor(10), /hsl\(0 /)
})
