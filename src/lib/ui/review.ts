/** 复盘：日 / 周 / 单课。结构化：结论、计划vs实际色带、亮点、问题（区分“状态”与“能力”）、下周调整（一键接受）、反馈。按版本给不同深度。 */
import { adaptation, addDays, weekOf, REASON_LABELS, type Adaptation, type ScheduleEntry } from "./day-schedule-rules.ts"
import { planBand, type Band } from "./day-override.ts"
import { TIERS, type Tier } from "./watch-mode.ts"
import type { FeedbackReason } from "./coach-assessment.ts"
export const REVIEWS_KEY = "fk-reviews-v1"
export type ReviewKind = "day" | "week" | "session"
export type Issue = { text: string; type: "state" | "ability" | "data" }
export type Review = {
  id: string; kind: ReviewKind; range: [string, string]; createdAt: string; tier: Tier
  verdict: string; bands: { id: string; title: string; band: Band }[]; highlights: string[]; issues: Issue[]
  adjustment: (Adaptation & { id: string }) | null; evidence: string[]
  /** v76：训练日期与复盘生成时间分开显示；linked = 每节对应的真实记录（可打开） */
  trainingDates?: string[]; linked?: { entryId: string; date: string; title: string; recordIds: string[]; recordLabels: string[]; quality: boolean }[]
  feedback?: { vote: "up" | "down"; reasons: FeedbackReason[]; text: string; at: string }; accepted?: boolean
}
const lab = (e: ScheduleEntry) => `${e.date.slice(5)} ${e.title}`
export type RecordRef = { id: string; date: string; sport: 'RUNNING' | 'STRENGTH' | 'MIXED' | 'UNKNOWN'; label: string }
export function buildReview(kind: ReviewKind, entries: ScheduleEntry[], today: string, tier: Tier, sessionId?: string, now = new Date().toISOString(), records: RecordRef[] = []): Review {
  const range: [string, string] = kind === "week" ? [weekOf(today)[0], today] : [today, today]
  const scope = kind === "session" ? entries.filter((e) => e.id === sessionId) : entries.filter((e) => e.date >= range[0] && e.date <= range[1] && e.status !== "rejected" && e.status !== "proposed")
  const logged = scope.filter((e) => e.actual)
  const bands = logged.map((e) => ({ id: e.id, title: lab(e), band: planBand(e) }))
  const asPlanned = logged.filter((e) => e.actual!.outcome === "as_planned").length
  const missed = logged.filter((e) => e.actual!.outcome === "missed").length
  const open = scope.filter((e) => !e.actual && e.date <= today).length
  // 只有“按计划完成”标记、没有实际数值也没有对应记录 → 不能评价质量。对应记录只按明确绑定或同一天同类型的真实记录列出（列出≠认定是同一节）。
  const sportOf = (e: ScheduleEntry) => e.modality === 'run' ? 'RUNNING' : e.modality === 'strength' ? 'STRENGTH' : 'UNKNOWN'
  const linked = logged.map((e) => { const a = e.actual!, bound = a.occurrenceIds ?? [], refs = records.filter((r) => bound.includes(r.id) || (r.date === e.date && (r.sport === sportOf(e) || r.sport === 'MIXED')))
    return { entryId: e.id, date: e.date, title: e.title, recordIds: refs.map((r) => r.id), recordLabels: refs.map((r) => r.label), quality: bound.length > 0 || a.minutes != null || a.km != null || a.rpe != null || refs.length > 0 } })
  const flagOnly = linked.filter((l) => !l.quality).length
  const highlights: string[] = [], issues: Issue[] = [], evidence: string[] = []
  if (asPlanned) highlights.push(`${asPlanned} 节标记为按计划完成`)
  const unplanned = logged.filter((e) => e.unplanned).length; if (unplanned) highlights.push(`主动加练 ${unplanned} 次`)
  const greens = bands.filter((b) => b.band === "green").length; if (bands.length >= 2 && greens === bands.length) highlights.push("完成度全部在计划 ±20% 内")
  const reasons = logged.flatMap((e) => e.actual!.reasons)
  for (const r of ["tired", "short", "weather"] as const) { const n = reasons.filter((x) => x === r).length; if (n) issues.push({ text: `${REASON_LABELS[r]} ${n} 次：这是当天状态/安排，不代表能力下降`, type: "state" }) }
  if (reasons.includes("pain")) issues.push({ text: "记录到疼痛：先处理疼痛，停止诱发疼痛的动作；持续或加重请找专业人员（手册 P-03/P-07）", type: "state" })
  // 能力类结论需要至少 2 次同方向、且没有状态类原因（单次不下结论）
  const under = logged.filter((e) => e.actual!.outcome === "different" && !e.actual!.reasons.length && (planBand(e) === "orange" || planBand(e) === "yellow") && e.actual!.minutes != null && e.actual!.minutes < e.minutes)
  if (under.length >= 2) issues.push({ text: `${under.length} 节在未达到计划量且原因未填写：先核对目的、实际记录和当日条件`, type: "data" })
  else if (under.length === 1) evidence.push("有 1 节完成量偏低但没写原因：一次不下结论")
  if (open) issues.push({ text: `${open} 节还没记录实际情况`, type: "data" })
  const a = adaptation(entries, today)
  const adjustment = kind === "session" || a.mode === "none" ? null : { ...a, id: `adj-${range[0]}-${a.mode}` }
  const verdict = !scope.length ? "这段时间没有安排或记录。" : !logged.length ? "尚无实际反馈，不能评价完成质量。" : missed > asPlanned ? "这段完成得不多，先找出能坚持的节奏。" : asPlanned === logged.length && logged.length ? (flagOnly === logged.length ? "已标记按计划完成，训练质量依据不足。" : flagOnly ? `已标记按计划完成；${logged.length - flagOnly} 节有实际记录可核对，${flagOnly} 节只有完成标记，质量依据不足。` : "按计划完成，每节都有实际记录可核对（质量看下方记录）。") : "已有部分反馈，具体偏差需要结合原计划目的核对。"
  const depth = TIERS[tier].depth
  if (flagOnly) evidence.push(`${flagOnly} 节只有“按计划完成”标记，没有实际用时/距离/RPE，也没有对应的训练记录`)
  evidence.push(`计划 ${scope.length} 节 · 已记录 ${logged.length} · 按计划 ${asPlanned} · 没练 ${missed}`)
  if (depth >= 2) evidence.push("色带阈值：绿 ±20%，黄 50–79%/121–150%，橙更偏，红没练（TrainingPeaks）")
  if (depth >= 3) { const mins = logged.reduce((s, e) => s + (e.actual!.outcome === "missed" ? 0 : e.actual!.minutes ?? 0), 0); evidence.push(`已知实际时长 ${mins} 分钟；缺失时长不补计划值`) }
  return { id: `${kind}-${range[0]}-${sessionId ?? ""}-${now}`, kind, range, createdAt: now, tier, verdict, bands: depth >= 2 ? bands : [], highlights: highlights.slice(0, depth >= 2 ? 3 : 1), issues: issues.slice(0, depth >= 2 ? 3 : 2), adjustment, evidence, trainingDates: [...new Set(logged.map((e) => e.date))].sort(), linked }
}
/** v77：最近一课 = 最近一次真实记录（佳明/手机）。比日程里最近一次反馈更新时，直接复盘这条记录（数值来自同一读模型）。 */
export function buildRecordReview(rec: { id: string; date: string; label: string; rpe: number | null; incomplete: boolean; running: boolean }, tier: Tier, now = new Date().toISOString()): Review {
  const issues: Issue[] = []
  if (rec.incomplete) issues.push({ text: "这节已记录但没点完成：回到当天卡片点完成，或在记录里补实际用时", type: "data" })
  if (rec.rpe == null) issues.push({ text: "没有主观强度（RPE）：手表结束训练时给 RPE，或在记录里补，下次才能判断强度是否合适", type: "data" })
  return { id: `session-${rec.date}-${rec.id}-${now}`, kind: "session", range: [rec.date, rec.date], createdAt: now, tier,
    verdict: `${rec.label}。这是实际记录，没有对应的计划课可对照完成度；${rec.running ? "配速、心率、分段的具体分析点“让方坤复盘这次”。" : "动作和组数的具体分析点“让方坤复盘这次”。"}`,
    bands: [], highlights: [], issues, adjustment: null, evidence: [rec.label], trainingDates: [rec.date],
    linked: [{ entryId: rec.id, date: rec.date, title: rec.label, recordIds: [rec.id], recordLabels: [rec.label], quality: true }] }
}
type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void }
const st = (): KV | null => (typeof localStorage === "undefined" ? null : localStorage)
export function loadReviews(s: KV | null = st()): Review[] { try { const v = JSON.parse(s?.getItem(REVIEWS_KEY) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
export function upsertReview(r: Review, s: KV | null = st()): Review[] { const list = [r, ...loadReviews(s).filter((x) => x.id !== r.id)].slice(0, 60); s?.setItem(REVIEWS_KEY, JSON.stringify(list)); return list }
/** 已接受的“下周调整”：在接下来 7 天内覆盖自动适应，方坤新排的课按它来。 */
export function acceptedAdaptation(today: string, s: KV | null = st()): Adaptation | null {
  const r = loadReviews(s).find((x) => x.accepted && x.adjustment && x.range[1] >= addDays(today, -7))
  return r?.adjustment ? { mode: r.adjustment.mode, factor: r.adjustment.factor, note: `已接受的复盘调整：${r.adjustment.note}` } : null
}
