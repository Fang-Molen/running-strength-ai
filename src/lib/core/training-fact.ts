import { projectActualSets, type OriginalPlanSnapshot } from "./canonical.ts"
import { getTrainingOccurrence, getTrainingPlanSnapshot, listTrainingOccurrences, type TrainingOccurrence } from "./occurrence.ts"

export type FactEvent = { event_id?: string; athlete_id?: string; event_type: string; timestamp?: string; payload?: Record<string, unknown> }

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
  lifecycle: TrainingOccurrence["lifecycle"] | "UNKNOWN"
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

type FactInput = { occurrence: TrainingOccurrence; snapshot: OriginalPlanSnapshot | null; events: FactEvent[]; siblingStartEventIds: string[]; siblingOccurrences?: TrainingOccurrence[] }
const ownsField = (event: FactEvent) => Object.prototype.hasOwnProperty.call(event.payload ?? {}, 'trainingOccurrenceId')
const sameOwner = (event: FactEvent, athlete: string, session: string) => (event.athlete_id ?? 'local') === athlete && event.payload?.sessionId === session
/** Legacy sets are attributable only while one verified start is active. Explicit foreign IDs never become legacy sets. */
function occurrenceAttempts(input: FactInput, startAt: number, endAt: number, athlete: string): { attempts: FactEvent[]; ambiguous: boolean } {
  const { occurrence, events } = input, occurrences = [occurrence, ...(input.siblingOccurrences ?? [])]
  const aliases = new Map<string, string>(), closes = new Map<string, string>(), active = new Set<string>(), attempts: FactEvent[] = []
  for (const item of occurrences) {
    aliases.set(item.startEventId, item.trainingOccurrenceId)
    for (const id of item.duplicateStartEventIds ?? []) aliases.set(id, item.trainingOccurrenceId)
    if (item.closeEventId) closes.set(item.closeEventId, item.trainingOccurrenceId)
    for (const id of item.duplicateCloseEventIds ?? []) closes.set(id, item.trainingOccurrenceId)
  }
  let ambiguous = false
  for (let index = 0; index < endAt; index++) {
    const event = events[index]
    if (!sameOwner(event, athlete, occurrence.sessionId)) continue
    if (event.event_type === 'TRAINING_STARTED') {
      active.add(event.event_id ? aliases.get(event.event_id) ?? event.event_id : `unidentified-start:${index}`)
    } else if (event.event_type === 'TRAINING_COMPLETED' || event.event_type === 'TRAINING_INTERRUPTED') {
      if (event.event_type === 'TRAINING_COMPLETED' && typeof event.payload?.feel === 'string') continue
      if (event.event_type === 'TRAINING_INTERRUPTED' && typeof event.payload?.decisionId !== 'string' && !closes.has(event.event_id ?? '')) continue
      const explicit = event.payload?.trainingOccurrenceId
      const id = event.event_id ? closes.get(event.event_id) : undefined
      if (id) active.delete(id)
      else if (ownsField(event)) { if (typeof explicit === 'string' && explicit) active.delete(explicit) }
      else if (active.size === 1) active.clear()
    } else if (index > startAt && event.event_type === 'TRAINING_SET_COMPLETED') {
      if (ownsField(event)) {
        const id = event.payload?.trainingOccurrenceId
        if (id === occurrence.trainingOccurrenceId) attempts.push(event)
        else if (typeof id !== 'string' || !id.trim()) ambiguous = true
      } else if (active.size === 1 && active.has(occurrence.trainingOccurrenceId)) attempts.push(event)
      else if (active.has(occurrence.trainingOccurrenceId)) ambiguous = true
    }
  }
  return { attempts, ambiguous }
}

export function projectTrainingFact(input: FactInput): TrainingFact {
  const { occurrence, events } = input
  const snapshot = occurrence.planKnowledge === "KNOWN" ? input.snapshot : null
  const plannedSetCount = snapshot ? snapshot.sets.length : null
  const starts = events.map((event, index) => ({ event, index })).filter(({ event }) => event.event_id === occurrence.startEventId)
  const start = starts.length === 1 && starts[0].event.event_type === 'TRAINING_STARTED' && starts[0].event.payload?.sessionId === occurrence.sessionId && (!ownsField(starts[0].event) || starts[0].event.payload?.trainingOccurrenceId === occurrence.trainingOccurrenceId) ? starts[0] : null
  const startAt = start?.index ?? -1, athlete = start?.event.athlete_id ?? 'local'
  const closeAt = occurrence.closeEventId ? events.findIndex(event => event.event_id === occurrence.closeEventId && sameOwner(event, athlete, occurrence.sessionId) && (event.event_type === 'TRAINING_COMPLETED' || event.event_type === 'TRAINING_INTERRUPTED') && (!ownsField(event) || event.payload?.trainingOccurrenceId === occurrence.trainingOccurrenceId)) : -1
  const closeVisible = startAt >= 0 && closeAt > startAt
  const duplicateVisible = occurrence.duplicateCloseEventIds.some(id => events.some(event => event.event_id === id && sameOwner(event, athlete, occurrence.sessionId) && (event.event_type === 'TRAINING_COMPLETED' || event.event_type === 'TRAINING_INTERRUPTED')))
  const visibleLifecycle: TrainingFact['lifecycle'] = !start ? 'UNKNOWN' : !closeVisible ? 'IN_PROGRESS' : occurrence.lifecycle === 'DUPLICATE_CLOSE' && !duplicateVisible
    ? events[closeAt].event_type === 'TRAINING_INTERRUPTED' ? 'INTERRUPTED' : ('actual' in (events[closeAt].payload ?? {}) || 'setsCompleted' in (events[closeAt].payload ?? {})) ? 'COMPLETED' : 'UNCLASSIFIED_CLOSE'
    : occurrence.lifecycle
  const endedAt = closeVisible && visibleLifecycle !== 'DUPLICATE_CLOSE' && visibleLifecycle !== 'UNCLASSIFIED_CLOSE' ? occurrence.endedAt ?? (occurrence.lifecycle === 'DUPLICATE_CLOSE' && !duplicateVisible ? events[closeAt].timestamp ?? null : null) : null
  const base = {
    trainingOccurrenceId: occurrence.trainingOccurrenceId,
    planSlotId: occurrence.planSlotId,
    sessionId: occurrence.sessionId,
    startEventId: occurrence.startEventId,
    trainingPlanSnapshotId: snapshot ? occurrence.trainingPlanSnapshotId : null,
    startedAt: start ? occurrence.startedAt : null,
    endedAt,
    duration: factDuration(start ? occurrence.startedAt : null, endedAt),
    lifecycle: visibleLifecycle,
    outcome: visibleLifecycle === 'COMPLETED' || visibleLifecycle === 'INTERRUPTED' ? visibleLifecycle : 'UNKNOWN' as const,
    reason: "UNKNOWN" as const,
    planKnowledge: occurrence.planKnowledge,
    plannedSetCount,
  }
  const siblingsKnown = input.siblingStartEventIds.every(id => events.some(event => event.event_id === id) || (closeVisible && input.siblingOccurrences?.some(sibling => sibling.startEventId === id && sibling.startedAt != null && endedAt != null && Date.parse(sibling.startedAt) > Date.parse(endedAt))))
  const closeNeeded = occurrence.lifecycle !== "IN_PROGRESS"
  if (startAt < 0 || !siblingsKnown || (closeNeeded && !closeVisible)) return { ...base, ...unknownCounts }
  const { attempts, ambiguous } = occurrenceAttempts(input, startAt, closeNeeded ? closeAt : events.length, athlete)
  if (ambiguous) return { ...base, ...unknownCounts }
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
  const siblingOccurrences = listTrainingOccurrences()
    .filter((item) => item.sessionId === occurrence.sessionId && item.trainingOccurrenceId !== occurrence.trainingOccurrenceId)
  const siblingStartEventIds = siblingOccurrences.map(item => item.startEventId)
  return projectTrainingFact({ occurrence, snapshot, events, siblingStartEventIds, siblingOccurrences })
}
