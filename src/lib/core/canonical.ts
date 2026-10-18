import { displayName, type Move, type Session } from "@/lib/strength/model"
import { readEnvelope, writeEnvelope } from "./storage.ts"

export const CANONICAL_TRAINING_KEY = "fr255-canonical-training-v1"

export const SET_RESOLUTIONS = ["NOT_RECORDED", "COMPLETED", "SKIPPED", "FAILED", "DUPLICATE_UNRESOLVED", "UNKNOWN"] as const

export type SetResolution = (typeof SET_RESOLUTIONS)[number]

export const TRAINING_LIFECYCLES = [
  "SUBJECTIVE_ONLY",
  "SKIPPED_BEFORE_START",
  "IN_PROGRESS",
  "COMPLETED",
  "INTERRUPTED",
  "UNCLASSIFIED_CLOSE",
  "DUPLICATE_CLOSE",
] as const

export type TrainingLifecycle = (typeof TRAINING_LIFECYCLES)[number]

export type PlannedExercise = {
  moveId: string
  catalogId: string | null
  name: string
  order: number
  mode: "reps" | "seconds"
  amount: number
  weightKg: number
  restSec: number
  sets: number
  executionNote?: string
  perSide?: boolean
  sideRestSec?: number | null
  betweenRestSec?: number | null
}

export type PlannedSetSnapshot = {
  plannedSetId: string
  moveId: string
  setIndex: number
  mode: "reps" | "seconds"
  amount: number
  weightKg: number
  restSec: number
}

export type OriginalPlanSnapshot = {
  snapshotId: string
  capturedAt: string
  planSlotId: string
  sessionName: string
  exercises: PlannedExercise[]
  sets: PlannedSetSnapshot[]
}

export type ActualAttempt = {
  actualSetId: string
  eventId: string
  plannedSetId: string | null
  moveId: string | null
  setIndex: number | null
  completed: boolean | null
  skipped: boolean | null
  actualWeight: number | null
  actualAmount: number | null
  recordedAt: string | null
}

export type CanonicalLinks = {
  strengthRpeEventId: string | null
  painEventIds: string[]
  injuryEventId: string | null
}

export type CanonicalOutcome = {
  status: TrainingLifecycle
  reason: "UNKNOWN"
}

export type CanonicalTrainingRecord = {
  canonicalTrainingId: string
  planSlotId: string
  originalPlan: OriginalPlanSnapshot
  attempts: ActualAttempt[]
  lifecycle: TrainingLifecycle | null
  outcome: CanonicalOutcome | null
  links: CanonicalLinks
  startedAt: string | null
  endedAt: string | null
}

type CanonicalStore = {
  records: CanonicalTrainingRecord[]
}

function emptyStore(): CanonicalStore {
  return { records: [] }
}

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function plannedSetIdentity(snapshotId: string, moveId: string, setIndex: number): string {
  return `${snapshotId}:${moveId}:${setIndex}`
}

export function buildOriginalPlanSnapshot(session: Pick<Session, "id" | "name" | "moves">, capturedAt: string): OriginalPlanSnapshot {
  const snapshotId = newId("snap")
  const exercises: PlannedExercise[] = session.moves.map((move: Move, order) => ({
    moveId: move.id,
    catalogId: move.catalogId,
    name: displayName(move),
    order,
    mode: move.mode,
    amount: move.amount,
    weightKg: move.weightKg,
    restSec: move.restSec,
    sets: move.sets,
    ...(move.executionNote ? {executionNote:move.executionNote} : {}),
    ...(move.perSide ? {perSide:true, sideRestSec:move.sideRestSec ?? null} : {}),
    ...(move.betweenRestSec != null ? {betweenRestSec:move.betweenRestSec} : {}),
  }))
  const sets = exercises.flatMap((exercise) =>
    Array.from({ length: Math.max(0, exercise.sets) }, (_, index) => {
      const setIndex = index + 1
      return {
        plannedSetId: plannedSetIdentity(snapshotId, exercise.moveId, setIndex),
        moveId: exercise.moveId,
        setIndex,
        mode: exercise.mode,
        amount: exercise.amount,
        weightKg: exercise.weightKg,
        restSec: exercise.restSec,
      }
    }),
  )
  return {
    snapshotId,
    capturedAt,
    planSlotId: session.id,
    sessionName: session.name,
    exercises,
    sets,
  }
}

function asRecord(value: unknown): CanonicalTrainingRecord | null {
  if (!value || typeof value !== "object") return null
  const record = value as Partial<CanonicalTrainingRecord>
  if (typeof record.canonicalTrainingId !== "string" || typeof record.planSlotId !== "string") return null
  if (!record.originalPlan || typeof record.originalPlan !== "object") return null
  if (!Array.isArray(record.attempts)) return null
  if (record.lifecycle != null && !TRAINING_LIFECYCLES.includes(record.lifecycle as TrainingLifecycle)) return null
  return record as CanonicalTrainingRecord
}

export function listCanonicalRecords(): CanonicalTrainingRecord[] {
  const data = readEnvelope<CanonicalStore>(CANONICAL_TRAINING_KEY, emptyStore()).data
  if (!data || !Array.isArray(data.records)) return []
  return data.records.filter((item): item is CanonicalTrainingRecord => asRecord(item) != null)
}

export function loadCanonicalRecords(): CanonicalTrainingRecord[] {
  return listCanonicalRecords()
}

export function getCanonicalRecord(canonicalTrainingId: string): CanonicalTrainingRecord | null {
  return listCanonicalRecords().find((record) => record.canonicalTrainingId === canonicalTrainingId) ?? null
}

export function canonicalRecordById(canonicalTrainingId: string): CanonicalTrainingRecord | null {
  return getCanonicalRecord(canonicalTrainingId)
}

export function hasCanonicalRecord(canonicalTrainingId: string): boolean {
  return getCanonicalRecord(canonicalTrainingId) != null
}

export function createCanonicalRecord(input: {
  planSlotId: string
  originalPlan: OriginalPlanSnapshot
  lifecycle: TrainingLifecycle | null
  startedAt?: string | null
  endedAt?: string | null
  attempts?: ActualAttempt[]
  links?: CanonicalLinks
  outcome?: CanonicalOutcome | null
}): CanonicalTrainingRecord | null {
  const record: CanonicalTrainingRecord = {
    canonicalTrainingId: newId("ctr"),
    planSlotId: input.planSlotId,
    originalPlan: input.originalPlan,
    attempts: (input.attempts ?? []).map((attempt) => ({ ...attempt })),
    lifecycle: input.lifecycle,
    outcome: input.outcome !== undefined ? input.outcome : input.lifecycle == null ? null : { status: input.lifecycle, reason: "UNKNOWN" },
    links: input.links
      ? {
          strengthRpeEventId: input.links.strengthRpeEventId,
          painEventIds: [...input.links.painEventIds],
          injuryEventId: input.links.injuryEventId,
        }
      : { strengthRpeEventId: null, painEventIds: [], injuryEventId: null },
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
  }
  const saved = writeEnvelope(CANONICAL_TRAINING_KEY, { records: [...listCanonicalRecords(), record] })
  if (!saved) return null
  return record
}

export function captureOriginalPlan(
  session: Pick<Session, "id" | "name" | "moves">,
  capturedAt = new Date().toISOString(),
): CanonicalTrainingRecord | null {
  return createCanonicalRecord({
    planSlotId: session.id,
    originalPlan: buildOriginalPlanSnapshot(session, capturedAt),
    lifecycle: null,
    startedAt: null,
  })
}

export function markCanonicalStarted(planSlotId: string, startedAt = new Date().toISOString()): CanonicalTrainingRecord | null {
  const records = listCanonicalRecords()
  let index = -1
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (records[i]?.planSlotId === planSlotId && records[i]?.lifecycle == null) {
      index = i
      break
    }
  }
  const current = index >= 0 ? records[index] : null
  if (!current) return null
  const next: CanonicalTrainingRecord = { ...current, lifecycle: "IN_PROGRESS", startedAt }
  const copy = records.slice()
  copy[index] = next
  const saved = writeEnvelope(CANONICAL_TRAINING_KEY, { records: copy })
  if (!saved) return null
  return next
}

type LifecycleEvent = { event_type: string; payload?: Record<string, unknown> }

function payloadOf(event: LifecycleEvent): Record<string, unknown> {
  return event.payload ?? {}
}

function isStart(event: LifecycleEvent): boolean {
  return event.event_type === "TRAINING_STARTED"
}

function isClose(event: LifecycleEvent): boolean {
  return event.event_type === "TRAINING_COMPLETED" || event.event_type === "TRAINING_INTERRUPTED"
}

function completionKind(payload: Record<string, unknown>): "execution" | "prelog" | "unknown" {
  if (typeof payload.feel === "string") return "prelog"
  if ("setsCompleted" in payload || "interruptions" in payload || "actual" in payload) return "execution"
  return "unknown"
}

export function projectTrainingLifecycle(events: LifecycleEvent[]): TrainingLifecycle | null {
  const relevant = events.filter((event) => isStart(event) || isClose(event))
  if (relevant.length === 0) return null
  const startedAt = relevant.findIndex(isStart)
  if (startedAt < 0) {
    const closes = relevant.filter(isClose)
    if (closes.length > 1) return "DUPLICATE_CLOSE"
    const close = closes[0]
    if (!close) return null
    if (close.event_type === "TRAINING_INTERRUPTED") return "SKIPPED_BEFORE_START"
    if (completionKind(payloadOf(close)) === "prelog") return "SUBJECTIVE_ONLY"
    return "UNCLASSIFIED_CLOSE"
  }
  const after = relevant.slice(startedAt + 1)
  const nextStart = after.findIndex(isStart)
  const window = nextStart >= 0 ? after.slice(0, nextStart) : after
  const closes = window.filter(isClose)
  if (closes.length === 0) return "IN_PROGRESS"
  if (closes.length > 1) return "DUPLICATE_CLOSE"
  const close = closes[0]
  if (!close) return "IN_PROGRESS"
  if (close.event_type === "TRAINING_INTERRUPTED") {
    return typeof payloadOf(close).decisionId === "string" ? "INTERRUPTED" : "UNCLASSIFIED_CLOSE"
  }
  return completionKind(payloadOf(close)) === "execution" ? "COMPLETED" : "UNCLASSIFIED_CLOSE"
}

export function projectLegacyTraining(events: LifecycleEvent[]): { lifecycle: TrainingLifecycle; originalPlan: null } | null {
  const lifecycle = projectTrainingLifecycle(events)
  if (!lifecycle) return null
  return { lifecycle, originalPlan: null }
}

export type AttemptPlacement = "MATCHED" | "EXTRA" | "UNLINKED"

export type ProjectedSetStatus = "NOT_RECORDED" | "COMPLETED" | "SKIPPED" | "DUPLICATE_UNRESOLVED" | "UNKNOWN"

export type ProjectedAttempt = ActualAttempt & {
  placement: AttemptPlacement
  movementChanged: boolean
  weightDelta: number | null
  amountDelta: number | null
  reason: "UNKNOWN"
}

export type PlannedSetView = {
  plannedSetId: string
  moveId: string
  setIndex: number
  status: ProjectedSetStatus
  attemptIds: string[]
  weightDelta: number | null
  amountDelta: number | null
  reason: "UNKNOWN"
}

export type ActualSetProjection = {
  originalPlan: OriginalPlanSnapshot | null
  attempts: ProjectedAttempt[]
  plannedSets: PlannedSetView[]
}

type SetEvent = { event_id?: string; event_type: string; timestamp?: string; payload?: Record<string, unknown> }

function eventNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function projectActualSets(originalPlan: OriginalPlanSnapshot | null, events: SetEvent[]): ActualSetProjection {
  const sets = events.filter((event) => event.event_type === "TRAINING_SET_COMPLETED")
  const attempts: ProjectedAttempt[] = sets.map((event) => {
    const payload = event.payload ?? {}
    const moveId = typeof payload.moveId === "string" ? payload.moveId : null
    const setIndex = eventNumber(payload, "setIndex")
    const planned = originalPlan && moveId != null && setIndex != null ? originalPlan.sets.find((item) => item.moveId === moveId && item.setIndex === setIndex) ?? null : null
    const exercise = originalPlan && moveId != null ? originalPlan.exercises.find((item) => item.moveId === moveId) ?? null : null
    const eventId = typeof event.event_id === "string" ? event.event_id : ""
    const actualWeight = eventNumber(payload, "actualWeight")
    const actualAmount = eventNumber(payload, "actualAmount")
    const name = typeof payload.name === "string" ? payload.name : null
    const catalogId = typeof payload.catalogId === "string" ? payload.catalogId : null
    const placement: AttemptPlacement = originalPlan == null ? "UNLINKED" : planned ? "MATCHED" : "EXTRA"
    const movementChanged = placement === "EXTRA" ? exercise == null : exercise != null && ((catalogId != null && catalogId !== exercise.catalogId) || (name != null && name !== exercise.name))
    return {
      actualSetId: eventId,
      eventId,
      plannedSetId: planned?.plannedSetId ?? null,
      moveId,
      setIndex,
      completed: typeof payload.completed === "boolean" ? payload.completed : null,
      skipped: typeof payload.skipped === "boolean" ? payload.skipped : null,
      actualWeight,
      actualAmount,
      recordedAt: typeof event.timestamp === "string" ? event.timestamp : null,
      placement,
      movementChanged,
      weightDelta: planned != null && actualWeight != null ? actualWeight - planned.weightKg : null,
      amountDelta: planned != null && actualAmount != null ? actualAmount - planned.amount : null,
      reason: "UNKNOWN",
    }
  })
  const plannedSets: PlannedSetView[] = (originalPlan?.sets ?? []).map((planned) => {
    const matched = attempts.filter((attempt) => attempt.plannedSetId === planned.plannedSetId)
    let status: ProjectedSetStatus = "UNKNOWN"
    if (matched.length === 0) status = "NOT_RECORDED"
    else if (matched.length > 1) status = "DUPLICATE_UNRESOLVED"
    else if (matched[0]?.skipped === true) status = "SKIPPED"
    else if (matched[0]?.completed === true) status = "COMPLETED"
    const single = matched.length === 1 ? matched[0] : null
    return {
      plannedSetId: planned.plannedSetId,
      moveId: planned.moveId,
      setIndex: planned.setIndex,
      status,
      attemptIds: matched.map((attempt) => attempt.actualSetId),
      weightDelta: single?.weightDelta ?? null,
      amountDelta: single?.amountDelta ?? null,
      reason: "UNKNOWN",
    }
  })
  return { originalPlan, attempts, plannedSets }
}

export function legacyPlannedSetCount(events: SetEvent[]): number | null {
  const sets = events.filter((event) => event.event_type === "TRAINING_SET_COMPLETED")
  if (sets.length === 0) return null
  const sessionId = sets.at(-1)?.payload?.sessionId
  const mine = typeof sessionId === "string" ? sets.filter((event) => event.payload?.sessionId === sessionId) : sets
  return mine.length
}

export function projectAlongsideLegacy(originalPlan: OriginalPlanSnapshot | null, events: SetEvent[]): {
  legacyPlannedSets: number | null
  canonical: ActualSetProjection
} {
  return { legacyPlannedSets: legacyPlannedSetCount(events), canonical: projectActualSets(originalPlan, events) }
}
