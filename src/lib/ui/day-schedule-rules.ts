/**
 * 方坤排期冲突规则（纯函数，可测试）。阈值来源见每条规则的 basis：
 * 手册 3.2 L-05、第 240–244 行（同时训练）、S-01/S-05；未在手册给出精确数值的都标为【经验规则】。
 */
export type Intensity = "EASY" | "MODERATE" | "HARD"
export type EntryKind = "run" | "strength" | "coach"
export type ScheduleEntry = {
  id: string; date: string; kind: EntryKind; modality: "run" | "strength" | "rest"
  title: string; focus: string[]; minutes: number; intensity: Intensity
  lowerHeavy: boolean; source: "fangkun" | "custom"; refId: string | null
  status: "proposed" | "planned" | "done" | "skipped" | "rejected"; reduced?: boolean; movedFrom?: string
  edited?: boolean; swapReason?: string
  slot?: "am" | "pm"; overrideNote?: string; unplanned?: boolean
  actual?: Actual
}
export type DeviationReason = "tired" | "short" | "pain" | "weather" | "other"
export const REASON_LABELS: Record<DeviationReason, string> = { tired: "状态差", short: "时间不够", pain: "有疼痛", weather: "天气", other: "其他" }
/** 实际执行与计划分开存：计划字段不改，actual 只记真实发生的。 */
export type Actual = { outcome: "as_planned" | "different" | "missed"; minutes: number | null; intensity: Intensity | null; note: string; reasons: DeviationReason[]; at: string }
export type Recovery = { readiness: number | null; sleepRecent: number[]; sleepBaseline: number | null; hrvToday: number | null; hrvBaseline: number | null }
export type ConflictAction = "postpone" | "reduce" | "keepOne" | "ack"
export type Conflict = { id: string; date: string; level: "warn" | "info"; text: string; basis: string; entryIds: string[]; target: string | null; actions: ConflictAction[] }

/** 【经验规则】阈值集中在这里，界面和测试都引用它。 */
export const RULES = {
  maxHardPerWeek: 2,            // L-05【经验规则】Seiler 2010 外推
  hardRunGapHours: 48,          // 手册范例⑤：两次强度课间隔 ≥48h【经验规则】
  heavyLowerBeforeIntervalHours: 24, // 第 243 行：大重量下肢后 24h 内不安排间歇课【经验规则】
  sameDayGapHours: 3,           // 第 240 行：跑+力量间隔 ≥3h【证据·Meta 分析】Schumann 2022
  maxDayMinutes: 150,           // 本应用【经验规则】单日计划总时长提示线
  lowReadiness: 40,             // 本应用【经验规则】训练准备度 <40 视为偏低
  hrvDropPct: 15,               // 本应用【经验规则】HRV 低于本人 7 日均值 15% 以上
  sleepWorseNights: 2,          // S-01【经验规则】睡眠明显差于平常 ≥2 晚
  sleepWorseHours: 1,           // 本应用【经验规则】“明显差”= 比本人基线少 ≥1 小时
} as const

const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5
export const addDays = (d: string, n: number) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0, 10)
export function weekOf(d: string): string[] {
  const dow = (new Date(dayNum(d) * 864e5).getUTCDay() + 6) % 7
  return Array.from({ length: 7 }, (_, i) => addDays(d, i - dow))
}
const active = (e: ScheduleEntry) => (e.status === "planned" || e.status === "done" || e.status === "proposed") && e.modality !== "rest"
const hardRun = (e: ScheduleEntry) => active(e) && e.modality === "run" && e.intensity === "HARD"

export function findConflicts(entries: ScheduleEntry[], week: string[], today: string, rec: Recovery | null, acks: string[] = []): Conflict[] {
  const out: Conflict[] = []
  const live = entries.filter(active)
  for (const d of week) {
    const day = live.filter((e) => e.date === d)
    const hr = day.filter(hardRun), lower = day.filter((e) => e.modality === "strength" && e.lowerHeavy)
    // 同日：强度跑 + 下肢力量 → 只提示顺序与间隔（手册推荐硬日更硬，不算冲突）
    if (hr.length && lower.length) out.push({ id: `same:${d}:${hr[0].id}:${lower[0].id}`, date: d, level: "info", text: `同一天有强度跑和下肢力量：先跑后练，间隔 ≥${RULES.sameDayGapHours} 小时。`, basis: "手册·同时训练【证据·Meta】Schumann 2022", entryIds: [hr[0].id, lower[0].id], target: null, actions: ["ack"] })
    // 大重量下肢后 24h 内的间歇/强度跑
    const next = live.filter((e) => e.date === addDays(d, 1) && hardRun(e))
    if (lower.length && next.length) out.push({ id: `lower24:${lower[0].id}:${next[0].id}`, date: next[0].date, level: "warn", text: `${d.slice(5)} 有大重量下肢，次日的强度跑腿可能没恢复。`, basis: `手册：大重量下肢后 ${RULES.heavyLowerBeforeIntervalHours}h 内不安排间歇课【经验规则】`, entryIds: [lower[0].id, next[0].id], target: next[0].id, actions: ["postpone", "reduce", "keepOne", "ack"] })
    // 两次强度跑间隔 <48h
    const nextHard = live.find((e) => e.date === addDays(d, 1) && hardRun(e))
    if (hr.length && nextHard) out.push({ id: `hard48:${hr[0].id}:${nextHard.id}`, date: nextHard.date, level: "warn", text: "连续两天强度跑，间隔不足 48 小时。", basis: `手册范例：两次强度课间隔 ≥${RULES.hardRunGapHours}h【经验规则】`, entryIds: [hr[0].id, nextHard.id], target: nextHard.id, actions: ["postpone", "reduce", "keepOne", "ack"] })
    const mins = day.reduce((s, e) => s + e.minutes, 0)
    if (mins > RULES.maxDayMinutes) { const t = [...day].sort((a, b) => a.minutes - b.minutes)[0]; out.push({ id: `mins:${d}:${mins}`, date: d, level: "warn", text: `当天计划共 ${mins} 分钟，总量偏大。`, basis: `本应用提示线 ${RULES.maxDayMinutes} 分钟【经验规则】`, entryIds: day.map((e) => e.id), target: t.id, actions: ["postpone", "keepOne", "ack"] }) }
  }
  const hard = live.filter((e) => week.includes(e.date) && e.intensity === "HARD")
  if (hard.length > RULES.maxHardPerWeek) { const last = hard.sort((a, b) => a.date.localeCompare(b.date)).at(-1)!; out.push({ id: `week:${week[0]}:${hard.length}`, date: last.date, level: "warn", text: `本周高强度课 ${hard.length} 次，建议 ≤${RULES.maxHardPerWeek} 次。`, basis: "手册 L-05【经验规则】Seiler 2010", entryIds: hard.map((e) => e.id), target: last.id, actions: ["postpone", "reduce", "ack"] }) }
  // 今天的恢复数据
  const todayHard = live.filter((e) => e.date === today && (e.intensity === "HARD" || e.lowerHeavy))
  if (rec && todayHard.length) {
    const reasons: string[] = []
    if (rec.readiness != null && rec.readiness < RULES.lowReadiness) reasons.push(`训练准备度 ${rec.readiness}`)
    if (rec.hrvToday != null && rec.hrvBaseline && rec.hrvToday < rec.hrvBaseline * (1 - RULES.hrvDropPct / 100)) reasons.push(`HRV ${rec.hrvToday}（本人均值 ${Math.round(rec.hrvBaseline)}）`)
    if (rec.sleepBaseline != null && rec.sleepRecent.length >= RULES.sleepWorseNights && rec.sleepRecent.slice(-RULES.sleepWorseNights).every((h) => h <= rec.sleepBaseline! - RULES.sleepWorseHours)) reasons.push(`连续 ${RULES.sleepWorseNights} 晚睡眠偏少`)
    if (reasons.length) out.push({ id: `rec:${today}:${todayHard[0].id}`, date: today, level: "warn", text: `今天${reasons.join("、")}，强度课建议降强度。这是状态信号，不代表能力下降。`, basis: "手册 S-01 与原则：一次状态差不判定能力【经验规则】", entryIds: todayHard.map((e) => e.id), target: todayHard[0].id, actions: ["reduce", "postpone", "ack"] })
  }
  return out.filter((c) => !acks.includes(c.id))
}

export function applyAction(entries: ScheduleEntry[], c: Conflict, action: ConflictAction): ScheduleEntry[] {
  if (action === "ack" || !c.target) return entries
  return entries.map((e) => {
    if (action === "postpone" && e.id === c.target) return { ...e, date: addDays(e.date, 1), movedFrom: e.movedFrom ?? e.date }
    if (action === "reduce" && e.id === c.target) return { ...e, intensity: e.intensity === "HARD" ? "MODERATE" : "EASY", lowerHeavy: false, reduced: true }
    if (action === "keepOne" && c.entryIds.includes(e.id) && e.id !== c.entryIds[0]) return { ...e, status: "skipped" }
    return e
  })
}

/* ---------------- 审核 / 实际 / 偏差 ---------------- */
export function review(entries: ScheduleEntry[], id: string, decision: "accept" | "reject", patch?: Partial<Pick<ScheduleEntry, "title" | "minutes" | "intensity" | "date">>): ScheduleEntry[] {
  return entries.map((e) => e.id !== id ? e : decision === "reject" ? { ...e, status: "rejected" } : { ...e, ...(patch ?? {}), edited: patch ? true : e.edited, status: "planned", lowerHeavy: patch?.intensity && patch.intensity !== "HARD" ? false : e.lowerHeavy })
}
export function logActual(entries: ScheduleEntry[], id: string, actual: Omit<Actual, "at">, at = new Date().toISOString()): ScheduleEntry[] {
  return entries.map((e) => {
    if (e.id !== id) return e
    const full: Actual = actual.outcome === "as_planned" ? { ...actual, minutes: e.minutes, intensity: e.intensity, reasons: [], at } : { ...actual, at }
    return { ...e, actual: full, status: actual.outcome === "missed" ? "planned" : "done" }
  })
}
export type WeekSummary = { planned: number; plannedMin: number; asPlanned: number; different: number; missed: number; open: number; actualMin: number; reasons: [DeviationReason, number][]; note: string }
export function weekSummary(entries: ScheduleEntry[], week: string[], today: string): WeekSummary {
  const plan = entries.filter((e) => week.includes(e.date) && (e.status === "planned" || e.status === "done"))
  const r: WeekSummary = { planned: plan.length, plannedMin: plan.reduce((s, e) => s + e.minutes, 0), asPlanned: 0, different: 0, missed: 0, open: 0, actualMin: 0, reasons: [], note: "" }
  const count: Partial<Record<DeviationReason, number>> = {}
  for (const e of plan) {
    if (!e.actual) { if (e.date < today) r.missed++; else r.open++; continue }
    r[e.actual.outcome === "as_planned" ? "asPlanned" : e.actual.outcome === "different" ? "different" : "missed"]++
    r.actualMin += e.actual.minutes ?? 0
    for (const x of e.actual.reasons) count[x] = (count[x] ?? 0) + 1
  }
  r.reasons = (Object.entries(count) as [DeviationReason, number][]).sort((a, b) => b[1] - a[1])
  r.note = adaptation(entries, today).note
  return r
}
/**
 * 根据最近 14 天实际与偏差原因决定下一批建议怎么调。
 * 原则：状态/时间类原因只说明当天状态，不下调能力判断（手册：区分状态与能力，一次不判定）；
 * 疼痛优先降强度；≥2 次时间不够 → 缩短时长【经验规则】；无偏差且完成 ≥3 次 → 可维持或小步进阶（只改 1 个变量，L-06）。
 */
export type Adaptation = { mode: "hold" | "shorten" | "reduce" | "progress" | "none"; factor: number; note: string }
export function adaptation(entries: ScheduleEntry[], today: string): Adaptation {
  const recent = entries.filter((e) => e.actual && e.date <= today && e.date >= addDays(today, -13))
  if (!recent.length) return { mode: "none", factor: 1, note: "还没有实际记录，方坤先按原计划建议。" }
  const n = (r: DeviationReason) => recent.filter((e) => e.actual!.reasons.includes(r)).length
  if (n("pain") >= 1) return { mode: "reduce", factor: 1, note: "最近记录到疼痛：下一批先降强度，疼痛部位请告诉方坤。" }
  if (n("short") >= 2) return { mode: "shorten", factor: 0.75, note: `最近 ${n("short")} 次时间不够：下一批缩短到约 3/4 时长，强度不变。` }
  if (n("tired") >= 2) return { mode: "hold", factor: 1, note: `最近 ${n("tired")} 次状态差：先不进阶，这是状态问题，不代表能力下降。` }
  const clean = recent.filter((e) => e.actual!.outcome === "as_planned").length
  if (clean >= 3 && recent.every((e) => e.actual!.outcome !== "missed")) return { mode: "progress", factor: 1, note: `最近 ${clean} 次按计划完成：可以小步进阶，一次只改一个变量。` }
  return { mode: "hold", factor: 1, note: "偶尔偏差属正常，一次没做好不改计划。" }
}
export function adaptProposal(e: ScheduleEntry, a: Adaptation): ScheduleEntry {
  if (e.status !== "proposed") return e
  if (a.mode === "shorten") return { ...e, minutes: Math.max(15, Math.round((e.minutes * a.factor) / 5) * 5), swapReason: a.note }
  if (a.mode === "reduce" && (e.intensity === "HARD" || e.lowerHeavy)) return { ...e, intensity: "EASY", lowerHeavy: false, reduced: true, swapReason: a.note }
  return e
}
export type SwapReason = "tired" | "short" | "noRun" | "other"
export const SWAP_LABELS: Record<SwapReason, string> = { tired: "太累", short: "没时间", noRun: "不想跑", other: "换个别的" }
/** “让方坤换一个”：本地规则替换，保持同一天，不增加强度。 */
export function swapProposal(e: ScheduleEntry, why: SwapReason): ScheduleEntry {
  const base = { ...e, id: `${e.id}~${why}`, status: "proposed" as const, swapReason: SWAP_LABELS[why], edited: false }
  if (why === "short") return { ...base, intensity: e.intensity === "HARD" ? "MODERATE" : e.intensity, lowerHeavy: false, minutes: Math.max(15, Math.round((e.minutes * 0.6) / 5) * 5), title: `${e.title}（短版）` }
  if (why === "tired") return { ...base, intensity: "EASY", lowerHeavy: false, minutes: Math.min(e.minutes, 30), title: e.modality === "run" ? "方坤安排 · 恢复慢跑" : "方坤安排 · 核心与灵活性", focus: e.modality === "run" ? ["轻松"] : ["核心"] }
  if (why === "noRun" && e.modality === "run") return { ...base, modality: "strength", kind: "coach", intensity: "MODERATE", lowerHeavy: false, title: "方坤安排 · 核心+上肢力量", focus: ["核心", "上肢"], minutes: Math.min(e.minutes, 40), refId: null }
  return { ...base, modality: e.modality === "run" ? "strength" : "run", intensity: "EASY", lowerHeavy: false, title: e.modality === "run" ? "方坤安排 · 核心力量" : "方坤安排 · 轻松跑", focus: [e.modality === "run" ? "核心" : "轻松"], refId: null }
}
