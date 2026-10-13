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
  feedback?: { vote: "up" | "down"; reasons: FeedbackReason[]; text: string; at: string }; accepted?: boolean
}
const lab = (e: ScheduleEntry) => `${e.date.slice(5)} ${e.title}`
export function buildReview(kind: ReviewKind, entries: ScheduleEntry[], today: string, tier: Tier, sessionId?: string, now = new Date().toISOString()): Review {
  const range: [string, string] = kind === "week" ? [weekOf(today)[0], today] : [today, today]
  const scope = kind === "session" ? entries.filter((e) => e.id === sessionId) : entries.filter((e) => e.date >= range[0] && e.date <= range[1] && e.status !== "rejected" && e.status !== "proposed")
  const logged = scope.filter((e) => e.actual)
  const bands = logged.map((e) => ({ id: e.id, title: lab(e), band: planBand(e) }))
  const asPlanned = logged.filter((e) => e.actual!.outcome === "as_planned").length
  const missed = logged.filter((e) => e.actual!.outcome === "missed").length
  const open = scope.filter((e) => !e.actual && e.date <= today).length
  const highlights: string[] = [], issues: Issue[] = [], evidence: string[] = []
  if (asPlanned) highlights.push(`${asPlanned} 节按计划完成`)
  const unplanned = logged.filter((e) => e.unplanned).length; if (unplanned) highlights.push(`主动加练 ${unplanned} 次`)
  const greens = bands.filter((b) => b.band === "green").length; if (bands.length >= 2 && greens === bands.length) highlights.push("完成度全部在计划 ±20% 内")
  const reasons = logged.flatMap((e) => e.actual!.reasons)
  for (const r of ["tired", "short", "weather"] as const) { const n = reasons.filter((x) => x === r).length; if (n) issues.push({ text: `${REASON_LABELS[r]} ${n} 次：这是当天状态/安排，不代表能力下降`, type: "state" }) }
  if (reasons.includes("pain")) issues.push({ text: "记录到疼痛：先处理疼痛，相关动作降强度；持续或加重请找专业人员（手册 P-03/P-07）", type: "state" })
  // 能力类结论需要至少 2 次同方向、且没有状态类原因（单次不下结论）
  const under = logged.filter((e) => e.actual!.outcome === "different" && !e.actual!.reasons.length && (planBand(e) === "orange" || planBand(e) === "yellow") && (e.actual!.minutes ?? 0) < e.minutes)
  if (under.length >= 2) issues.push({ text: `${under.length} 节在无特殊原因下都没完成到计划量：目标可能偏高，可考虑小步下调`, type: "ability" })
  else if (under.length === 1) evidence.push("有 1 节完成量偏低但没写原因：一次不下结论")
  if (open) issues.push({ text: `${open} 节还没记录实际情况`, type: "data" })
  const a = adaptation(entries, today)
  const adjustment = kind === "session" || a.mode === "none" ? null : { ...a, id: `adj-${range[0]}-${a.mode}` }
  const verdict = !scope.length ? "这段时间没有安排或记录。" : missed > asPlanned ? "这段完成得不多，先找出能坚持的节奏。" : asPlanned === logged.length && logged.length ? "按计划完成，节奏不错。" : "大体完成，有些偏差，属正常范围。"
  const depth = TIERS[tier].depth
  evidence.push(`计划 ${scope.length} 节 · 已记录 ${logged.length} · 按计划 ${asPlanned} · 没练 ${missed}`)
  if (depth >= 2) evidence.push("色带阈值：绿 ±20%，黄 50–79%/121–150%，橙更偏，红没练（TrainingPeaks）")
  if (depth >= 3) { const mins = logged.reduce((s, e) => s + (e.actual!.outcome === "missed" ? 0 : e.actual!.minutes ?? e.minutes), 0); evidence.push(`实际总时长 ${mins} 分钟`) }
  return { id: `${kind}-${range[0]}-${sessionId ?? ""}-${now}`, kind, range, createdAt: now, tier, verdict, bands: depth >= 2 ? bands : [], highlights: highlights.slice(0, depth >= 2 ? 3 : 1), issues: issues.slice(0, depth >= 2 ? 3 : 2), adjustment, evidence }
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
