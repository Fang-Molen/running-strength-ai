import { projectActualSets, type OriginalPlanSnapshot } from "./canonical.ts"
import { getTrainingOccurrence, getTrainingPlanSnapshot, listTrainingOccurrences, type TrainingOccurrence } from "./occurrence.ts"

export type FactEvent = { event_id?: string; event_type: string; timestamp?: string; payload?: Record<string, unknown> }

export type TrainingFact = {
  trainingOccurrenceId: string
  planSlotId: string
  sessionId: string
  startEventId: string
  trainingPlanSnapshotId: string | null
  startedAt: string | null
  endedAt: string | null
  /** Elapsed milliseconds between the recorded start and end. */
  duration: number | null
  lifecycle: TrainingOccurrence["lifecycle"]
  outcome: TrainingOccurrence["outcome"]
  reason: "UNKNOWN"
  planKnowledge: TrainingOccurrence["planKnowledge"]
  plannedSetCount: number | null
  attemptCount: number | null
  completedSetCount: number | null
  skippedSetCount: number | null
  notRecordedSetCount: number | null
  duplicateSetCount: number | null
  extraSetCount: number | null
  completionRatio: number | null
}

const unknownCounts = {
  attemptCount: null,
  completedSetCount: null,
  skippedSetCount: null,
  notRecordedSetCount: null,
  duplicateSetCount: null,
  extraSetCount: null,
  completionRatio: null,
}

export function factDuration(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null
  const start = Date.parse(startedAt)
  const end = Date.parse(endedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return end - start
}

export function projectTrainingFact(input: { occurrence: TrainingOccurrence; snapshot: OriginalPlanSnapshot | null; events: FactEvent[]; siblingStartEventIds: string[] }): TrainingFact {
  const { occurrence, events } = input
  const snapshot = occurrence.planKnowledge === "KNOWN" ? input.snapshot : null
  const plannedSetCount = snapshot ? snapshot.sets.length : null
  const base = {
    trainingOccurrenceId: occurrence.trainingOccurrenceId,
    planSlotId: occurrence.planSlotId,
    sessionId: occurrence.sessionId,
    startEventId: occurrence.startEventId,
    trainingPlanSnapshotId: snapshot ? occurrence.trainingPlanSnapshotId : null,
    startedAt: occurrence.startedAt,
    endedAt: occurrence.endedAt,
    duration: factDuration(occurrence.startedAt, occurrence.endedAt),
    lifecycle: occurrence.lifecycle,
    outcome: occurrence.outcome,
    reason: "UNKNOWN" as const,
    planKnowledge: occurrence.planKnowledge,
    plannedSetCount,
  }
  const startAt = events.findIndex((event) => event.event_id === occurrence.startEventId)
  const siblingsKnown = input.siblingStartEventIds.every((id) => events.some((event) => event.event_id === id))
  const closeNeeded = occurrence.lifecycle !== "IN_PROGRESS"
  const closeAt = closeNeeded ? events.findIndex((event) => event.event_id === occurrence.closeEventId) : -1
  if (startAt < 0 || !siblingsKnown || (closeNeeded && closeAt < startAt)) return { ...base, ...unknownCounts }
  const nextStart = input.siblingStartEventIds
    .map((id) => events.findIndex((event) => event.event_id === id))
    .filter((index) => index > startAt)
    .sort((left, right) => left - right)[0]
  const endAt = closeNeeded ? closeAt : nextStart ?? events.length
  const boundedEnd = nextStart != null && nextStart < endAt ? nextStart : endAt
  const attempts = events.slice(startAt + 1, boundedEnd).filter((event) => event.event_type === "TRAINING_SET_COMPLETED" && event.payload?.sessionId === occurrence.sessionId)
  if (!snapshot) return { ...base, ...unknownCounts, attemptCount: attempts.length }
  const projected = projectActualSets(snapshot, attempts)
  const completedSetCount = projected.plannedSets.filter((item) => item.status === "COMPLETED").length
  return {
    ...base,
    attemptCount: projected.attempts.length,
    completedSetCount,
    skippedSetCount: projected.plannedSets.filter((item) => item.status === "SKIPPED").length,
    notRecordedSetCount: projected.plannedSets.filter((item) => item.status === "NOT_RECORDED").length,
    duplicateSetCount: projected.plannedSets.filter((item) => item.status === "DUPLICATE_UNRESOLVED").length,
    extraSetCount: projected.attempts.filter((item) => item.placement === "EXTRA").length,
    completionRatio: plannedSetCount != null && plannedSetCount > 0 ? completedSetCount / plannedSetCount : null,
  }
}

export function loadTrainingFact(trainingOccurrenceId: string, events: FactEvent[]): TrainingFact | null {
  const occurrence = getTrainingOccurrence(trainingOccurrenceId)
  if (!occurrence) return null
  const snapshot = occurrence.trainingPlanSnapshotId ? getTrainingPlanSnapshot(occurrence.trainingPlanSnapshotId) : null
  const siblingStartEventIds = listTrainingOccurrences()
    .filter((item) => item.sessionId === occurrence.sessionId && item.trainingOccurrenceId !== occurrence.trainingOccurrenceId)
    .map((item) => item.startEventId)
  return projectTrainingFact({ occurrence, snapshot, events, siblingStartEventIds })
}
