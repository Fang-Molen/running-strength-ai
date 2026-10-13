/**
 * 方坤评估：基于实际记录（不是计划）、计划vs实际、偏差原因和恢复数据，给出简短结论。
 * 手册原则：区分状态与能力；一次表现不好不下结论（负面趋势至少 2 次同向）；缺数据不推断。
 * 用户反馈会影响下一次评估和方坤建议：排除特殊日、调整激进程度。
 */
import { addDays, adaptation, weekOf, type ScheduleEntry, type Intensity } from "./day-schedule-rules.ts"
import type { Verdict } from "./recovery-verdict.ts"

export type LoggedSession = { id: string; date: string; sport: "RUNNING" | "STRENGTH" | "MIXED" | "UNKNOWN"; distanceM: number | null; durationSec: number | null; strengthVolumeKg: number; sets: number; rpe: number | null }
export type FeedbackReason = "special" | "wrongData" | "tooConservative" | "tooAggressive" | "other"
export const FEEDBACK_LABELS: Record<FeedbackReason, string> = { special: "那天状态特殊", wrongData: "数据不对", tooConservative: "太保守", tooAggressive: "太激进", other: "其他" }
export type Feedback = { targetId: string; vote: "up" | "down"; reasons: FeedbackReason[]; text: string; at: string; excludeIds: string[] }
export type Suggestion = { id: string; text: string }
export type Assessment = { id: string; createdAt: string; verdict: string; records: string[]; suggestions: Suggestion[]; evidence: string[]; adjustments: string[]; sessionIds: string[]; worstIds: string[] }

/** 激进程度：-2（更保守）… +2（更积极）。只看最近 6 条反馈，避免一次反馈长期锁死。 */
export function aggressiveness(fb: Feedback[]): number {
  let a = 0
  for (const f of fb.slice(-6)) { if (f.reasons.includes("tooConservative")) a++; if (f.reasons.includes("tooAggressive")) a-- }
  return Math.max(-2, Math.min(2, a))
}
export function excludedIds(fb: Feedback[]): Set<string> { return new Set(fb.flatMap((f) => f.vote === "down" && (f.reasons.includes("special") || f.reasons.includes("wrongData")) ? f.excludeIds : [])) }

const pace = (s: LoggedSession) => s.distanceM && s.durationSec && s.distanceM >= 1000 ? s.durationSec / (s.distanceM / 1000) : null
const fmtPace = (sec: number) => `${Math.floor(sec / 60)}'${String(Math.round(sec % 60)).padStart(2, "0")}"`

export function assess(input: { today: string; entries: ScheduleEntry[]; logs: LoggedSession[]; recovery: Verdict | null; feedback: Feedback[]; now?: string }): Assessment {
  const { today, feedback } = input
  const ex = excludedIds(feedback), aggr = aggressiveness(feedback)
  const week = weekOf(today), from = addDays(today, -13), prevFrom = addDays(today, -27)
  const logs = input.logs.filter((l) => !ex.has(l.id))
  const entries = input.entries.filter((e) => !ex.has(e.id))
  const cur = logs.filter((l) => l.date >= addDays(today, -6) && l.date <= today), prev = logs.filter((l) => l.date >= from && l.date < addDays(today, -6))
  const sum = (xs: LoggedSession[], f: (l: LoggedSession) => number) => xs.reduce((a, l) => a + f(l), 0)
  const km = (xs: LoggedSession[]) => Math.round(sum(xs, (l) => l.distanceM ?? 0) / 100) / 10
  const records: string[] = [], evidence: string[] = [], suggestions: Suggestion[] = [], adjustments: string[] = []
  const trainedDays = new Set(logs.filter((l) => l.date >= from && l.date <= today).map((l) => l.date)).size
  records.push(`近 14 天练了 ${trainedDays} 天`)
  if (cur.some((l) => l.distanceM)) records.push(`本周跑量 ${km(cur)} km${prev.some((l) => l.distanceM) ? `（上周 ${km(prev)} km）` : ""}`)
  const vol = sum(cur, (l) => l.strengthVolumeKg), pvol = sum(prev, (l) => l.strengthVolumeKg)
  if (vol) records.push(`本周力量总量 ${Math.round(vol)} kg${pvol ? `（上周 ${Math.round(pvol)}）` : ""}`)
  const paced = logs.filter((l) => pace(l) != null && l.date >= prevFrom)
  const best = [...paced].sort((a, b) => pace(a)! - pace(b)!)[0]
  if (best && best.date >= addDays(today, -6) && paced.length >= 3) records.push(`本周有近 4 周最快配速 ${fmtPace(pace(best)!)}/km（${best.date.slice(5)}）`)
  const longest = [...logs.filter((l) => l.date >= from)].sort((a, b) => (b.distanceM ?? 0) - (a.distanceM ?? 0))[0]
  if (longest?.distanceM) records.push(`近 14 天最长 ${(longest.distanceM / 1000).toFixed(1)} km`)
  // 计划 vs 实际
  const planned = entries.filter((e) => week.includes(e.date) && (e.status === "planned" || e.status === "done") && e.date <= today)
  const did = planned.filter((e) => e.actual && e.actual.outcome !== "missed")
  const reasons = planned.flatMap((e) => e.actual?.reasons ?? [])
  const stateCount = reasons.filter((r) => r === "tired" || r === "short").length, pain = reasons.includes("pain")
  if (planned.length) evidence.push(`本周到今天计划 ${planned.length} 节，完成 ${did.length} 节`)
  if (reasons.length) evidence.push(`偏差原因：${reasons.join("、")}`)
  if (input.recovery) evidence.push(`今日恢复：${input.recovery.title}（${input.recovery.reasons.join("，")}）`)
  if (ex.size) adjustments.push(`已按你的反馈排除 ${ex.size} 次特殊/数据有误的记录`)
  if (aggr > 0) adjustments.push("你说过偏保守：建议会更积极一点（仍一次只改一个变量）")
  if (aggr < 0) adjustments.push("你说过偏激进：建议会更保守一点")
  // 结论（不因单次下结论）
  const missed = planned.filter((e) => !e.actual || e.actual.outcome === "missed").length
  let verdict: string
  if (!logs.filter((l) => l.date >= from).length && !did.length) verdict = "最近记录太少，暂不下结论。先坚持记录几次。"
  else if (pain) verdict = "最近记录到疼痛，先处理疼痛，再谈进阶。"
  else if (stateCount >= 2) verdict = `本周 ${stateCount} 次因状态/时间调整，这是状态问题，不代表能力下降。`
  else if (missed >= 2 && planned.length >= 3) verdict = "本周有几节没完成，计划可能偏满，先把节奏调到能稳定完成。"
  else verdict = did.length >= 2 || trainedDays >= 4 ? "整体稳定，按计划推进。" : "有在练，单次波动不说明问题。"
  const worst = planned.filter((e) => e.actual && e.actual.outcome !== "as_planned").map((e) => e.id)
  // 建议 1–3
  const ad = adaptation(entries, today)
  if (pain) suggestions.push({ id: "pain", text: "下次先降强度，把疼痛部位告诉方坤；>3/10 或改变跑姿就停（手册 P-03）。" })
  else if (ad.mode === "shorten") suggestions.push({ id: "shorten", text: "下周课时缩短到约 3/4，强度不变，先保证能完成。" })
  else if (ad.mode === "hold" || stateCount >= 2) suggestions.push({ id: "hold", text: aggr > 0 ? "维持本周量，若状态恢复可在一节课里小加一点。" : "下周先维持，不进阶。" })
  else if (ad.mode === "progress" || (aggr > 0 && did.length >= 2)) suggestions.push({ id: "progress", text: aggr < 0 ? "可以考虑进阶，但先等再稳定完成一周。" : "可以小步进阶：只改一个变量（如间歇少休 15 秒或多 1 组）。" })
  if (input.recovery?.level === "reduce") suggestions.push({ id: "recovery", text: "今天恢复信号偏弱，今天的强度课改轻松或顺延。" })
  if (!suggestions.length) suggestions.push({ id: "keep", text: "按当前计划继续，坚持记录实际情况。" })
  const id = `wk-${week[0]}`
  return { id, createdAt: input.now ?? new Date().toISOString(), verdict, records: records.slice(0, 4), suggestions: suggestions.slice(0, 3).map((s) => ({ ...s, id: `${id}:${s.id}` })), evidence, adjustments, sessionIds: [...cur.map((l) => l.id), ...planned.map((e) => e.id)], worstIds: worst }
}

/** 反馈对方坤后续建议的影响：激进度为负时，待确认的高强度建议降一档。 */
export function applyFeedbackToProposal(e: ScheduleEntry, fb: Feedback[]): ScheduleEntry {
  if (e.status !== "proposed") return e
  const a = aggressiveness(fb)
  if (a < 0 && e.intensity === "HARD") return { ...e, intensity: "MODERATE" as Intensity, lowerHeavy: false, reduced: true, swapReason: "已根据你的反馈（太激进）降了一档" }
  if (a > 0 && e.intensity === "EASY" && e.minutes < 60) return { ...e, minutes: e.minutes + 10, swapReason: "已根据你的反馈（太保守）多加 10 分钟" }
  return e
}
