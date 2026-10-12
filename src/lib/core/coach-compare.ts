import type { Plan } from "@/lib/strength/model"
import { assembleCoachBrief, deriveCoachBrief, guardCoachResponse, type CoachBrief, type CoachTurn } from "./coach-brief.ts"
import { loadEvents } from "./events.ts"
import { listTrainingOccurrences } from "./occurrence.ts"
import { occurrenceVoided } from "./training-correction.ts"
import { getRunningPlanSnapshot } from "./running-plan.ts"
import { calendarDay, PRODUCT_CALENDAR_TIME_ZONE } from "./coach-calendar.ts"

export { calendarDay, PRODUCT_CALENDAR_TIME_ZONE } from "./coach-calendar.ts"

export type RunningKind = "INTERVAL" | "OTHER" | "UNAVAILABLE"

export type BoundTraining = {
  trainingOccurrenceId: string
  startedAt: string
  sessionId: string
  running: RunningKind
}

export type IntervalPair =
  | { status: "READY"; newerId: string; olderId: string }
  | { status: "SAME_DAY"; ids: string[] }
  | { status: "INSUFFICIENT"; count: number }

export function sameCalendarDay(left: string, right: string, timeZone = PRODUCT_CALENDAR_TIME_ZONE): boolean {
  const leftDay = calendarDay(left, timeZone)
  const rightDay = calendarDay(right, timeZone)
  return leftDay != null && leftDay === rightDay
}

export function formatTrainingWhen(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return "未记录时间"
  return new Intl.DateTimeFormat("sv-SE", { timeZone: PRODUCT_CALENDAR_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(time))
}

function runningKind(trainingOccurrenceId: string): RunningKind {
  const snapshot = getRunningPlanSnapshot(trainingOccurrenceId)
  if (!snapshot) return "UNAVAILABLE"
  const running = snapshot.components.filter((item) => item.modality === "RUNNING")
  if (running.length === 0) return "UNAVAILABLE"
  const interval = running.some((item) => item.modality === "RUNNING" && item.structure.kind === "REPEATED" && (item.purpose === "INTERVAL" || item.purpose === "REPETITION_SPEED"))
  return interval ? "INTERVAL" : "OTHER"
}

export function listBoundTrainings(): BoundTraining[] {
  const events = loadEvents()
  return listTrainingOccurrences()
    .flatMap((item) => {
      if (occurrenceVoided(item.trainingOccurrenceId) || !item.startedAt || !events.some((event) => event.event_id === item.startEventId && event.event_type === "TRAINING_STARTED")) return []
      return [{ trainingOccurrenceId: item.trainingOccurrenceId, startedAt: item.startedAt, sessionId: item.sessionId, running: runningKind(item.trainingOccurrenceId) }]
    })
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.trainingOccurrenceId.localeCompare(left.trainingOccurrenceId))
}

export function resolveRecentIntervalPair(items: BoundTraining[] = listBoundTrainings()): IntervalPair {
  const intervals = items.filter((item) => item.running === "INTERVAL")
  if (intervals.length < 2) return { status: "INSUFFICIENT", count: intervals.length }
  const newer = intervals[0]
  const older = intervals[1]
  if (!newer || !older) return { status: "INSUFFICIENT", count: intervals.length }
  if (sameCalendarDay(newer.startedAt, older.startedAt)) return { status: "SAME_DAY", ids: intervals.filter((item) => sameCalendarDay(item.startedAt, newer.startedAt)).map((item) => item.trainingOccurrenceId) }
  return { status: "READY", newerId: newer.trainingOccurrenceId, olderId: older.trainingOccurrenceId }
}

export function orientPair(leftId: string, rightId: string, leftStartedAt: string, rightStartedAt: string): { newerId: string; olderId: string; newerStartedAt: string; olderStartedAt: string } | null {
  if (!calendarDay(leftStartedAt) || !calendarDay(rightStartedAt)) return null
  return orderOccurrenceIds(leftId, rightId, [
    { trainingOccurrenceId: leftId, startedAt: leftStartedAt, sessionId: "", running: "OTHER" },
    { trainingOccurrenceId: rightId, startedAt: rightStartedAt, sessionId: "", running: "OTHER" },
  ])
}

export function orderOccurrenceIds(first: string, second: string, items: BoundTraining[]): { newerId: string; olderId: string; newerStartedAt: string; olderStartedAt: string } | null {
  const left = items.find((item) => item.trainingOccurrenceId === first)
  const right = items.find((item) => item.trainingOccurrenceId === second)
  if (!left || !right || left.trainingOccurrenceId === right.trainingOccurrenceId) return null
  const leftLater = left.startedAt > right.startedAt || (left.startedAt === right.startedAt && left.trainingOccurrenceId > right.trainingOccurrenceId)
  return leftLater
    ? { newerId: left.trainingOccurrenceId, olderId: right.trainingOccurrenceId, newerStartedAt: left.startedAt, olderStartedAt: right.startedAt }
    : { newerId: right.trainingOccurrenceId, olderId: left.trainingOccurrenceId, newerStartedAt: right.startedAt, olderStartedAt: left.startedAt }
}

const sharedContext = new Set(["context:competition", "context:cycle", "context:pain"])

function withoutFuel(brief: CoachBrief): CoachBrief {
  return deriveCoachBrief({
    ...brief,
    fuel: null,
    sources: brief.sources?.filter((source) => !source.id.startsWith("nutrition:") && !source.id.startsWith("context:fuel-target:")),
    sourceIds: brief.sourceIds.filter((id) => !id.startsWith("nutrition:") && !id.startsWith("context:fuel-target:")),
  })
}

export function citesSide(brief: CoachBrief, citations: string[]): boolean {
  return citations.some((id) => brief.sourceIds.includes(id) && !sharedContext.has(id))
}

export type PairedRunningObservation = {
  kind: "REPETITION" | "CONTINUOUS" | "RECOVERY"
  position: string
  planned: string
  newer: { actual: string; sourceEventIds: string[] }
  older: { actual: string; sourceEventIds: string[] }
}

// Match only recorded slots with the same planned structure on both sides.
// A missing, conflicting, or legacy slot cannot become a performance trend.
export function pairedRunningObservations(newer: CoachBrief, older: CoachBrief): PairedRunningObservation[] {
  const recorded = (brief: CoachBrief) => (brief.running ?? []).filter((slot) =>
    (slot.status === "COMPLETED" || slot.kind === "RECOVERY" && slot.status === "RECORDED") && slot.sourceEventIds.length > 0 &&
    slot.sourceEventIds.some((id) => brief.sourceIds.includes(id)) &&
    !slot.actual.includes("未记录"),
  )
  const olderSlots = recorded(older)
  return recorded(newer).flatMap((slot) => {
    const matching = olderSlots.filter((other) => other.kind === slot.kind && other.position === slot.position && other.planned === slot.planned)
    if (matching.length !== 1) return []
    const other = matching[0]!
    return [{ kind: slot.kind, position: slot.position, planned: slot.planned,
      newer: { actual: slot.actual, sourceEventIds: slot.sourceEventIds },
      older: { actual: other.actual, sourceEventIds: other.sourceEventIds } }]
  }).slice(0, 24)
}

function ungroundedTimeClaim(newer: CoachBrief, older: CoachBrief, answer: string, citations: string[]): boolean {
  const pairs = pairedRunningObservations(newer, older)
  for (const match of answer.matchAll(/\b(\d+(?:\.\d+)?)\s*秒/g)) {
    const seconds = match[1]
    const before = answer.slice(Math.max(0, (match.index ?? 0) - 40), match.index)
    const clause = before.slice(Math.max(before.lastIndexOf("。"), before.lastIndexOf("；"), before.lastIndexOf("，"), before.lastIndexOf("\n")) + 1)
    const labels = [...clause.matchAll(/较新(?:一节|一次|的)?|较旧(?:一节|一次|的)?|新(?:一节|一次|课)|旧(?:一节|一次|课)|本次|这次|上次|前次/g)]
    const label = labels.at(-1)?.[0] ?? ""
    const side = /^(?:较新|新|本次|这次)/.test(label) ? newer : /^(?:较旧|旧|上次|前次)/.test(label) ? older : null
    const relativeDifference = /(?:相差|差距|快了?|慢了?|少了?|多了?)\s*$/.test(clause)
    const eligible = side && !relativeDifference ? [side] : [newer, older]
    const plannedClaim = /(?:计划|目标)(?:用时|恢复|时间|为|是|约|\s)*$/.test(before)
    const planned = plannedClaim && eligible.some((brief) => (brief.running ?? []).some((slot) =>
      slot.planned.includes(`${seconds}秒`) &&
      (Boolean(brief.occurrenceId && citations.includes(brief.occurrenceId)) || slot.sourceEventIds.some((id) => citations.includes(id))),
    ))
    const actual = eligible.some((brief) => (brief.running ?? []).some((slot) =>
      (slot.status === "COMPLETED" || slot.kind === "RECOVERY" && slot.status === "RECORDED") &&
      slot.actual.match(/(?:^|\/)(\d+(?:\.\d+)?)秒$/)?.[1] === seconds &&
      slot.sourceEventIds.some((id) => citations.includes(id) && brief.sourceIds.includes(id)),
    ))
    const difference = (!side || relativeDifference) && pairs.some((pair) => {
      const left = Number(pair.newer.actual.match(/(?:^|\/)(\d+(?:\.\d+)?)秒$/)?.[1])
      const right = Number(pair.older.actual.match(/(?:^|\/)(\d+(?:\.\d+)?)秒$/)?.[1])
      return Number.isFinite(left) && Number.isFinite(right) && Math.abs(Math.abs(left - right) - Number(seconds)) < 0.000001 &&
        pair.newer.sourceEventIds.some((id) => citations.includes(id)) && pair.older.sourceEventIds.some((id) => citations.includes(id))
    })
    if (!planned && !actual && !difference) return true
  }
  return false
}

function unsupportedComparisonConclusion(newer: CoachBrief, older: CoachBrief, answer: string): boolean {
  const sameDistance = pairedRunningObservations(newer, older).some((pair) => {
    if (pair.kind === "RECOVERY") return false
    const left = pair.newer.actual.match(/^(\d+(?:\.\d+)?)米\/(\d+(?:\.\d+)?)秒$/)
    const right = pair.older.actual.match(/^(\d+(?:\.\d+)?)米\/(\d+(?:\.\d+)?)秒$/)
    return left && right && Number(left[1]) > 0 && left[1] === right[1]
  })
  return answer.split(/[。；，\n]/).some((clause) => {
    if (/(?:不能|无法|不足以|不可|尚不能|未能|不代表|不能证明)/.test(clause)) return false
    if (/(?:能力|耐力|水平).{0,8}(?:提升|提高|下降|退步|变强|变差|不足)/.test(clause)) return true
    return !sameDistance && /(?:更快|更慢|掉速|提速|配速改善|配速变慢|成绩提高|成绩下降)/.test(clause)
  })
}
export function readCompareIds(raw: string, allowed: string[]): [string, string] | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as { compareIds?: unknown }
    if (!Array.isArray(parsed.compareIds)) return null
    const ids = parsed.compareIds.filter((id): id is string => typeof id === "string" && allowed.includes(id))
    if (ids.length !== 2 || ids[0] === ids[1]) return null
    return [ids[0], ids[1]]
  } catch {
    return null
  }
}

function nearer(left: number | null, right: number | null): number | null {
  if (left == null) return right
  if (right == null) return left
  return Math.min(left, right)
}

function needsRecovery(brief: CoachBrief): boolean {
  return brief.sessionRpe == null || (brief.sessionRpe >= 7 && brief.sleepHours == null && brief.subjectiveRecovery == null)
}

export function guardComparison(left: CoachBrief, right: CoachBrief, raw: string): CoachTurn {
  const gap = needsRecovery(left) || needsRecovery(right)
  const shell = deriveCoachBrief({
    question: left.question,
    occurrenceId: left.occurrenceId,
    runningStructure: left.runningStructure === "UNAVAILABLE" && right.runningStructure === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE",
    sessionRpe: gap ? 8 : 5,
    sleepHours: gap ? null : 8,
    subjectiveRecovery: gap ? null : 6,
    recoveryState: null,
    fatigueState: null,
    duplicateCount: left.duplicateCount + right.duplicateCount,
    repetitionSlots: 0,
    continuousCount: 0,
    plannedSetCount: null,
    completedSetCount: null,
    durationSec: null,
    pain: left.pain || right.pain,
    daysToCompetition: nearer(left.daysToCompetition, right.daysToCompetition),
    week: left.week === 4 || right.week === 4 ? 4 : left.week,
    bias: left.bias === "deload" || right.bias === "deload" ? "deload" : left.bias,
    sourceIds: [...new Set([...left.sourceIds, ...right.sourceIds])],
    sources: [...(left.sources ?? []), ...(right.sources ?? [])],
    running: [],
  })
  const turn = guardCoachResponse(shell, raw)
  if (turn.mode === "answer" && (!citesSide(left, turn.citations) || !citesSide(right, turn.citations))) {
    return { mode: "unavailable", text: "比较回答没有同时引用两节课各自的来源，无法采用。", nextStep: null, citations: [], medicalReferral: shell.constraints.medicalReferral, planChanged: false }
  }
  if (turn.mode === "answer" && ungroundedTimeClaim(left, right, `${turn.text} ${turn.nextStep ?? ""}`, turn.citations)) {
    return { mode: "unavailable", text: "比较回答中的实际用时缺少对应训练的完成事件来源，无法采用。", nextStep: null, citations: [], medicalReferral: shell.constraints.medicalReferral, planChanged: false }
  }
  if (turn.mode === "answer" && unsupportedComparisonConclusion(left, right, `${turn.text} ${turn.nextStep ?? ""}`)) {
    return { mode: "unavailable", text: "两节课缺少同距离、同槽位的实际记录，或回答把局部差异说成能力变化，无法采用。", nextStep: null, citations: [], medicalReferral: shell.constraints.medicalReferral, planChanged: false }
  }
  return turn
}

export function separateBriefs(plan: Plan | null, question: string, newerId: string, olderId: string): { newer: CoachBrief; older: CoachBrief } | null {
  if (newerId === olderId) return null
  const newer = withoutFuel(assembleCoachBrief(plan, question, newerId))
  const older = withoutFuel(assembleCoachBrief(plan, question, olderId))
  if (newer.occurrenceId !== newerId || older.occurrenceId !== olderId) return null
  const newerIds = new Set(newer.sourceIds)
  const sharedContext = new Set(["context:competition", "context:cycle", "context:pain"])
  const mixed = older.sourceIds.some((id) => newerIds.has(id) && !sharedContext.has(id))
  if (mixed) return null
  return { newer, older }
}
