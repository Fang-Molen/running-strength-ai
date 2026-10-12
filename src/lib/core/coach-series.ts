import type { Plan } from "@/lib/strength/model"
import { assembleCoachBrief, deriveCoachBrief, guardCoachResponse, type CoachBrief, type CoachTurn } from "./coach-brief.ts"
import { listBoundTrainings, sameCalendarDay } from "./coach-compare.ts"
import { calendarDay } from "./coach-calendar.ts"

export type CoachSeriesPoint = { occurrenceId: string; startedAt: string; brief: CoachBrief }
export type CoachSeriesObservation = {
  kind: "REPETITION" | "CONTINUOUS" | "RECOVERY"
  position: string
  planned: string
  points: { occurrenceId: string; startedAt: string; actual: string; sourceEventIds: string[] }[]
}
export type CoachSeries = { points: CoachSeriesPoint[]; observations: CoachSeriesObservation[] }

export function compactCoachSeriesPacket(series: CoachSeries, history: { role: "user" | "coach"; text: string }[]) {
  const eventIds = new Set(series.observations.flatMap((observation) => observation.points.flatMap((point) => point.sourceEventIds)))
  return {
    question: series.points.at(-1)?.brief.question ?? "纵向观察",
    history,
    points: series.points.map((point) => {
      const sources = (point.brief.sources ?? []).filter((source) => source.id === point.occurrenceId || eventIds.has(source.id) || /^(?:SESSION_RPE|SUBJECTIVE_RECOVERY|SLEEP|PAIN|SORENESS)\b/.test(source.detail) || source.id.endsWith(":fatigue") || source.id.endsWith(":recovery") || source.id.endsWith(":musculoskeletal")).slice(0, 20)
      return { occurrenceId: point.occurrenceId, startedAt: point.startedAt, sessionRpe: point.brief.sessionRpe, sleepHours: point.brief.sleepHours, subjectiveRecovery: point.brief.subjectiveRecovery, pain: point.brief.pain, soreness: point.brief.soreness, recoveryState: point.brief.recoveryState, fatigueState: point.brief.fatigueState, duplicateCount: point.brief.duplicateCount, returnToTraining: point.brief.returnToTraining, nextSession: point.brief.nextSession, sourceIds: sources.map((source) => source.id), sources }
    }),
    observations: series.observations,
  }
}

function completed(slot: NonNullable<CoachBrief["running"]>[number]): boolean {
  return (slot.status === "COMPLETED" || slot.kind === "RECOVERY" && slot.status === "RECORDED") &&
    slot.sourceEventIds.length > 0 && !slot.actual.includes("未记录")
}

export function projectCoachSeries(points: CoachSeriesPoint[]): CoachSeries | null {
  if (points.length < 3 || points.length > 6) return null
  const ids = new Set(points.map((point) => point.occurrenceId))
  if (ids.size !== points.length || points.some((point) => point.brief.occurrenceId !== point.occurrenceId)) return null
  const ordered = [...points].sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.occurrenceId.localeCompare(right.occurrenceId))
  if (ordered.some((point, index) => index > 0 && sameCalendarDay(point.startedAt, ordered[index - 1]!.startedAt))) return null
  const first = ordered[0]!
  const observations: CoachSeriesObservation[] = []
  for (const slot of (first.brief.running ?? []).filter(completed)) {
    const matched = ordered.map((point) => {
      const slots = (point.brief.running ?? []).filter((candidate) => completed(candidate) && candidate.kind === slot.kind && candidate.position === slot.position && candidate.planned === slot.planned)
      if (slots.length !== 1) return null
      const candidate = slots[0]!
      if (!candidate.sourceEventIds.some((id) => point.brief.sourceIds.includes(id))) return null
      return { occurrenceId: point.occurrenceId, startedAt: point.startedAt, actual: candidate.actual, sourceEventIds: candidate.sourceEventIds }
    })
    if (matched.every((point): point is NonNullable<typeof point> => point != null)) {
      observations.push({ kind: slot.kind, position: slot.position, planned: slot.planned, points: matched })
    }
  }
  return { points: ordered, observations: observations.slice(0, 16) }
}

export function assembleCoachSeries(plan: Plan | null, question: string, ids: string[]): CoachSeries | null {
  const bound = listBoundTrainings()
  const points = ids.flatMap((id) => {
    const item = bound.find((candidate) => candidate.trainingOccurrenceId === id)
    if (!item) return []
    const brief = assembleCoachBrief(plan, question, id)
    return brief.occurrenceId === id ? [{ occurrenceId: id, startedAt: item.startedAt, brief }] : []
  })
  return projectCoachSeries(points)
}

export function readSeriesIds(raw: string, allowed: string[]): string[] | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as { seriesIds?: unknown }
    if (!Array.isArray(parsed.seriesIds)) return null
    const ids = parsed.seriesIds.filter((id): id is string => typeof id === "string" && allowed.includes(id))
    return ids.length >= 3 && ids.length <= 6 && new Set(ids).size === ids.length ? ids : null
  } catch {
    return null
  }
}

export function toggleSeriesId(current: string[], id: string, limit = 6): string[] {
  if (!id) return current
  if (current.includes(id)) return current.filter((item) => item !== id)
  return current.length >= limit ? current : [...current, id]
}

function citesEveryPoint(series: CoachSeries, citations: string[]): boolean {
  return series.points.every((point) => point.brief.sourceIds.some((id) => citations.includes(id) && !id.startsWith("context:")))
}

function unsupportedSeriesConclusion(text: string, hasObservation: boolean): boolean {
  return text.split(/[。；，\n]/).some((clause) => {
    if (/(?:不能|无法|不足以|不可|尚不能|未能|不代表|不能证明)/.test(clause)) return false
    if (/(?:能力|耐力|水平).{0,10}(?:提升|提高|下降|退步|变强|变差|不足)/.test(clause)) return true
    return !hasObservation && /(?:趋势|越来越|持续|连续).{0,8}(?:更快|更慢|变快|变慢|改善|下降|提高|变差)/.test(clause)
  })
}

function unsupportedRecoveryTrend(series: CoachSeries, text: string, citations: string[]): boolean {
  const asserted = text.split(/[。；，\n]/).some((clause) =>
    !/(?:不能|无法|不足以|不可|尚不能|未能|不代表|不能证明|数据不足)/.test(clause) &&
    /恢复.{0,10}(?:越来越|持续|逐次|逐渐|趋势|改善|变好|变差|下降|提高)/.test(clause),
  )
  if (!asserted) return false
  return series.points.some((point) => point.brief.subjectiveRecovery == null || !(point.brief.sources ?? []).some((source) =>
    citations.includes(source.id) && source.kind === "FACT" && source.detail.startsWith("SUBJECTIVE_RECOVERY "),
  ))
}

function ungroundedSeriesTime(series: CoachSeries, text: string, citations: string[]): boolean {
  for (const match of text.matchAll(/\b(\d+(?:\.\d+)?)\s*秒/g)) {
    const value = match[1]
    const before = text.slice(Math.max(0, (match.index ?? 0) - 48), match.index)
    const clause = before.slice(Math.max(before.lastIndexOf("。"), before.lastIndexOf("；"), before.lastIndexOf("，"), before.lastIndexOf("\n")) + 1)
    const ordinal = [...clause.matchAll(/第\s*([1-6一二三四五六])\s*次|最早一次|最近一次|最新一次|最后一次/g)].at(-1)?.[0] ?? ""
    const ordinalMap: Record<string, number> = { "1": 0, 一: 0, "2": 1, 二: 1, "3": 2, 三: 2, "4": 3, 四: 3, "5": 4, 五: 4, "6": 5, 六: 5 }
    const ordinalValue = ordinal.match(/[1-6一二三四五六]/)?.[0]
    const ordinalIndex = /最早/.test(ordinal) ? 0 : /最近|最新|最后/.test(ordinal) ? series.points.length - 1 : ordinalValue ? ordinalMap[ordinalValue] : null
    const date = clause.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
    const eligibleIds = ordinalIndex != null && series.points[ordinalIndex]
      ? new Set([series.points[ordinalIndex]!.occurrenceId])
      : date
        ? new Set(series.points.filter((point) => calendarDay(point.startedAt) === date).map((point) => point.occurrenceId))
        : null
    const grounded = series.observations.some((observation) => observation.points.some((point) =>
      (!eligibleIds || eligibleIds.has(point.occurrenceId)) &&
      point.actual.match(/(?:^|\/)(\d+(?:\.\d+)?)秒$/)?.[1] === value && point.sourceEventIds.some((id) => citations.includes(id)),
    ))
    if (!grounded) return true
  }
  return false
}

function misorderedSeriesTimeList(series: CoachSeries, text: string): boolean {
  const phrase = text.match(/(?:分别|依次)(?:是|为)?([^。；\n]+)/)?.[1]
  if (!phrase) return false
  const values = [...phrase.matchAll(/\b(\d+(?:\.\d+)?)\s*秒/g)].map((match) => match[1])
  if (values.length !== series.points.length) return false
  const sequences = series.observations.map((observation) => observation.points.map((point) => point.actual.match(/(?:^|\/)(\d+(?:\.\d+)?)秒$/)?.[1] ?? ""))
  return sequences.length > 0 && !sequences.some((sequence) => sequence.every((value, index) => value === values[index]))
}

function uniquelyGroundedTimeSources(series: CoachSeries, text: string): string[] {
  const ids: string[] = []
  for (const match of text.matchAll(/\b(\d+(?:\.\d+)?)\s*秒/g)) {
    const value = match[1]
    const candidates = series.observations.flatMap((observation) => observation.points.filter((point) =>
      point.actual.match(/(?:^|\/)(\d+(?:\.\d+)?)秒$/)?.[1] === value,
    ))
    const occurrenceIds = new Set(candidates.map((point) => point.occurrenceId))
    if (occurrenceIds.size === 1) ids.push(...candidates.flatMap((point) => point.sourceEventIds))
  }
  return [...new Set(ids)]
}

function groundedMissingRecoverySources(series: CoachSeries, text: string): string[] {
  if (!/恢复/.test(text) || !/(?:未记录|缺失|数据不足|不能判断|无法判断|不足以判断)/.test(text)) return []
  return series.points.filter((point) => point.brief.subjectiveRecovery == null).map((point) => point.occurrenceId)
}

export function groundSeriesResponseSources(series: CoachSeries, raw: string): string {
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return raw
    const parsed = JSON.parse(match[0]) as { text?: unknown; nextStep?: unknown; citations?: unknown }
    const text = `${typeof parsed.text === "string" ? parsed.text : ""} ${typeof parsed.nextStep === "string" ? parsed.nextStep : ""}`
    const supplied = Array.isArray(parsed.citations) ? parsed.citations.filter((id): id is string => typeof id === "string") : []
    parsed.citations = [...new Set([...supplied, ...uniquelyGroundedTimeSources(series, text), ...groundedMissingRecoverySources(series, text)])]
    return JSON.stringify(parsed)
  } catch {
    return raw
  }
}

export function guardSeriesResponse(series: CoachSeries, raw: string): CoachTurn {
  const allSources = series.points.flatMap((point) => point.brief.sources ?? [])
  const allIds = [...new Set(series.points.flatMap((point) => point.brief.sourceIds))]
  const gap = series.points.some((point) => point.brief.sessionRpe == null || point.brief.sessionRpe >= 7 && point.brief.sleepHours == null && point.brief.subjectiveRecovery == null)
  const constrained = series.points.some((point) => point.brief.constraints.increaseBlocked)
  const shell = deriveCoachBrief({
    question: series.points.at(-1)?.brief.question ?? "纵向比较",
    occurrenceId: series.points.at(-1)?.occurrenceId ?? null,
    runningStructure: series.observations.length ? "AVAILABLE" : "UNAVAILABLE",
    sessionRpe: gap ? 8 : 5,
    sleepHours: gap ? null : 8,
    subjectiveRecovery: gap ? null : 6,
    recoveryState: null,
    fatigueState: null,
    duplicateCount: series.points.reduce((sum, point) => sum + point.brief.duplicateCount, 0),
    repetitionSlots: 0,
    continuousCount: 0,
    plannedSetCount: null,
    completedSetCount: null,
    durationSec: null,
    pain: series.points.some((point) => point.brief.pain),
    soreness: series.points.some((point) => point.brief.soreness),
    daysToCompetition: series.points.map((point) => point.brief.daysToCompetition).filter((value): value is number => value != null).sort((a, b) => a - b)[0] ?? null,
    week: series.points.some((point) => point.brief.week === 4) ? 4 : series.points.at(-1)?.brief.week ?? null,
    bias: series.points.some((point) => point.brief.bias === "deload") ? "deload" : series.points.at(-1)?.brief.bias ?? null,
    sourceIds: allIds,
    sources: allSources,
    running: [],
  })
  if (constrained) shell.constraints.increaseBlocked = true
  const turn = guardCoachResponse(shell, groundSeriesResponseSources(series, raw))
  if (turn.mode !== "answer") return turn
  if (!citesEveryPoint(series, turn.citations)) return { mode: "unavailable", text: "纵向回答没有覆盖每次训练各自的来源，无法采用。", nextStep: null, citations: [], medicalReferral: shell.constraints.medicalReferral, planChanged: false }
  const runningClaim = /(?:更快|更慢|变快|变慢|用时|配速|成绩|掉速)/.test(`${turn.text} ${turn.nextStep ?? ""}`)
  if (runningClaim && !series.observations.some((observation) => observation.points.every((point) => point.sourceEventIds.some((id) => turn.citations.includes(id))))) {
    return { mode: "unavailable", text: "纵向跑步结论没有覆盖同一槽位每次训练的完成事件，无法采用。", nextStep: null, citations: [], medicalReferral: shell.constraints.medicalReferral, planChanged: false }
  }
  if (misorderedSeriesTimeList(series, `${turn.text} ${turn.nextStep ?? ""}`)) return { mode: "unavailable", text: "纵向回答把各次训练的实际用时顺序写反了，无法采用。", nextStep: null, citations: [], medicalReferral: shell.constraints.medicalReferral, planChanged: false }
  if (ungroundedSeriesTime(series, `${turn.text} ${turn.nextStep ?? ""}`, turn.citations)) return { mode: "unavailable", text: "纵向回答中的实际用时没有对应训练的完成事件来源，无法采用。", nextStep: null, citations: [], medicalReferral: shell.constraints.medicalReferral, planChanged: false }
  if (unsupportedRecoveryTrend(series, `${turn.text} ${turn.nextStep ?? ""}`, turn.citations)) return { mode: "unavailable", text: "纵向恢复结论缺少每次训练各自的恢复评分来源，无法采用。", nextStep: null, citations: [], medicalReferral: shell.constraints.medicalReferral, planChanged: false }
  if (unsupportedSeriesConclusion(`${turn.text} ${turn.nextStep ?? ""}`, series.observations.length > 0)) return { mode: "unavailable", text: "纵向回答把不完整观察说成了训练趋势或能力变化，无法采用。", nextStep: null, citations: [], medicalReferral: shell.constraints.medicalReferral, planChanged: false }
  return turn
}
