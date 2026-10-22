import { getTrainingOccurrence, listTrainingOccurrences } from "./occurrence.ts"
import { readEnvelope, writeEnvelope } from "./storage.ts"
import {captureCorrectionSources,auditSavedClaimsForCorrection} from './coach-p7-runtime.ts'
import {strictIso} from './coach-v4-c11-adapter.ts'

export const TRAINING_CORRECTION_KEY = "fr255-training-correction-v1"

export type CorrectionField = "weight" | "reps" | "distance" | "duration" | "feedback"
export type CorrectionKind = "FIELD" | "VOID" | "RESTORE"

export type TrainingCorrection = {
  correctionId: string
  schemaVersion: 1
  trainingOccurrenceId: string
  kind: CorrectionKind
  field: CorrectionField | null
  setKey: string | null
  originalValue: string
  newValue: string
  reason: string
  at: string
  /** Commit time (ported additively from K20). Never inferred from `at`; absent on legacy rows = unknown. */
  recordedAt?: string
}

type CorrectionEvent = { event_id?: string; event_type: string; payload?: Record<string, unknown> }

const empty: TrainingCorrection[] = []

function loadAll(): TrainingCorrection[] {
  const data = readEnvelope<TrainingCorrection[]>(TRAINING_CORRECTION_KEY, empty).data
  return Array.isArray(data) ? data.filter(isCorrection) : []
}

function isCorrection(value: unknown): value is TrainingCorrection {
  if (!value || typeof value !== "object") return false
  const row = value as Partial<TrainingCorrection>
  return row.schemaVersion === 1 && typeof row.correctionId === "string" && typeof row.trainingOccurrenceId === "string" && (row.kind === "FIELD" || row.kind === "VOID" || row.kind === "RESTORE") && typeof row.reason === "string" && typeof row.at === "string"
}

function nextId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `corr-${crypto.randomUUID()}`
  return `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function listCorrections(trainingOccurrenceId?: string): TrainingCorrection[] {
  const rows = loadAll()
  return trainingOccurrenceId ? rows.filter((row) => row.trainingOccurrenceId === trainingOccurrenceId) : rows
}

/** Read-only historical view. `at` is never substituted for the actual commit timestamp. */
export function readTrainingCorrectionsAsOf(trainingOccurrenceId: string, asOf: string): {
  rows: TrainingCorrection[]; unknownCommitTime: TrainingCorrection[]; voided: boolean
} {
  if (!strictIso(asOf)) throw Error('INVALID_CORRECTION_AS_OF')
  const all = listCorrections(trainingOccurrenceId), cutoff = Date.parse(asOf)
  const committed = (row: TrainingCorrection) => typeof row.recordedAt === 'string' && strictIso(row.recordedAt)
  const rows = all.filter(row => committed(row) && Date.parse(row.recordedAt!) <= cutoff)
    .sort((a, b) => Date.parse(a.recordedAt!) - Date.parse(b.recordedAt!))
  return {rows, unknownCommitTime: all.filter(row => !committed(row)),
    voided: rows.filter(row => row.kind === 'VOID' || row.kind === 'RESTORE').at(-1)?.kind === 'VOID'}
}

export function appendCorrection(input: {
  trainingOccurrenceId: string
  kind: CorrectionKind
  field?: CorrectionField | null
  setKey?: string | null
  originalValue?: string
  newValue?: string
  reason: string
  at?: string
}): TrainingCorrection | null {
  const reason = input.reason.trim()
  if (!input.trainingOccurrenceId || !reason) return null
  if (input.kind === "FIELD" && !input.field) return null
  const row: TrainingCorrection = {
    correctionId: nextId(),
    schemaVersion: 1,
    trainingOccurrenceId: input.trainingOccurrenceId,
    kind: input.kind,
    field: input.kind === "FIELD" ? input.field ?? null : null,
    setKey: input.setKey ?? null,
    originalValue: input.originalValue ?? "",
    newValue: input.newValue ?? "",
    reason,
    at: input.at ?? new Date().toISOString(),
    recordedAt: new Date().toISOString(),
  }
  let before:ReturnType<typeof captureCorrectionSources>|null=null
  try{before=captureCorrectionSources(input.trainingOccurrenceId)}catch{/* Fact saving remains available; unverified links cannot withdraw claims. */}
  const saved = writeEnvelope(TRAINING_CORRECTION_KEY, [...loadAll(), row])
  if(saved&&before)try{auditSavedClaimsForCorrection(row,before)}catch{/* No source or plan is rewritten if a review cannot be projected. */}
  if(saved&&typeof window!=='undefined')try{window.dispatchEvent(new Event('fk-training-corrected'))}catch{/* Post-save review cannot block the saved correction. */}
  return saved ? row : null
}

export function occurrenceVoided(trainingOccurrenceId: string): boolean {
  let voided = false
  for (const row of listCorrections(trainingOccurrenceId)) {
    if (row.kind === "VOID") voided = true
    if (row.kind === "RESTORE") voided = false
  }
  return voided
}

export function voidedOccurrenceIds(): string[] {
  return listTrainingOccurrences().map((item) => item.trainingOccurrenceId).filter(occurrenceVoided)
}

export function effectiveField(trainingOccurrenceId: string, field: CorrectionField, setKey: string | null, original: string | null): { value: string | null; corrected: boolean } {
  const hits = listCorrections(trainingOccurrenceId).filter((row) => row.kind === "FIELD" && row.field === field && (row.setKey ?? null) === setKey)
  const last = hits.at(-1)
  if (!last) return { value: original, corrected: false }
  return { value: last.newValue, corrected: true }
}

export function strengthSetKey(moveId: string, setIndex: number): string {
  return `${moveId}:${setIndex}`
}

export type StrengthIdentity = { trainingOccurrenceId: string; moveId: string; setIndex: number }

export type EffectiveNumberStatus = "ORIGINAL" | "CORRECTED" | "UNKNOWN"

export type EffectiveNumber = { value: number | null; status: EffectiveNumberStatus }

/** Distance, duration and feedback stay stored, but current events do not carry a reliable set binding. */
export const UNWIRED_CORRECTION_FIELDS = ["distance", "duration", "feedback"] as const

export function reliableStrengthIdentity(payload: Record<string, unknown> | undefined): StrengthIdentity | null {
  if (!payload) return null
  const trainingOccurrenceId = payload.trainingOccurrenceId
  const moveId = payload.moveId
  const setIndex = payload.setIndex
  if (typeof trainingOccurrenceId !== "string" || trainingOccurrenceId.trim() === "") return null
  if (typeof moveId !== "string" || moveId.trim() === "") return null
  if (typeof setIndex !== "number" || !Number.isInteger(setIndex) || setIndex < 1) return null
  return { trainingOccurrenceId, moveId, setIndex }
}

function parseCorrectionNumber(value: string): number | null {
  const text = value.trim()
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null
  const number = Number(text)
  return Number.isFinite(number) && number >= 0 ? number : null
}

type StrengthCorrectionOptions = { corrections: readonly TrainingCorrection[] }

export function effectiveStrengthNumber(trainingOccurrenceId: string, field: "weight" | "reps", setKey: string, original: number | null, options?: StrengthCorrectionOptions): EffectiveNumber {
  const hits = (options?.corrections ?? listCorrections(trainingOccurrenceId)).filter((row) => row.trainingOccurrenceId === trainingOccurrenceId && row.kind === "FIELD" && row.field === field && (row.setKey ?? null) === setKey)
  const last = hits.at(-1)
  if (!last) return { value: original, status: "ORIGINAL" }
  const parsed = parseCorrectionNumber(last.newValue)
  if (parsed == null) return { value: null, status: "UNKNOWN" }
  return { value: parsed, status: "CORRECTED" }
}

export function effectiveStrengthFields(payload: Record<string, unknown> | undefined, options?: StrengthCorrectionOptions): {
  binding: "BOUND" | "UNBOUND"
  identity: StrengthIdentity | null
  weight: EffectiveNumber
  reps: EffectiveNumber
} {
  const originalWeight = typeof payload?.actualWeight === "number" && Number.isFinite(payload.actualWeight) ? payload.actualWeight : null
  const timed = payload?.mode === "seconds"
  const originalReps = !timed && typeof payload?.actualAmount === "number" && Number.isFinite(payload.actualAmount) ? payload.actualAmount : null
  const identity = reliableStrengthIdentity(payload)
  if (!identity) return { binding: "UNBOUND", identity: null, weight: { value: originalWeight, status: "ORIGINAL" }, reps: { value: originalReps, status: "ORIGINAL" } }
  const setKey = strengthSetKey(identity.moveId, identity.setIndex)
  return {
    binding: "BOUND",
    identity,
    weight: effectiveStrengthNumber(identity.trainingOccurrenceId, "weight", setKey, originalWeight, options),
    reps: timed ? { value: null, status: "ORIGINAL" } : effectiveStrengthNumber(identity.trainingOccurrenceId, "reps", setKey, originalReps, options),
  }
}

export function compensationDraft(trainingOccurrenceId: string): { kind: CorrectionKind; field: CorrectionField | null; setKey: string | null; originalValue: string; newValue: string } | null {
  const last = listCorrections(trainingOccurrenceId).at(-1)
  if (!last) return null
  if (last.kind === "FIELD" && last.field) return { kind: "FIELD", field: last.field, setKey: last.setKey, originalValue: last.newValue, newValue: last.originalValue }
  if (last.kind === "VOID") return { kind: "RESTORE", field: null, setKey: null, originalValue: "", newValue: "" }
  return { kind: "VOID", field: null, setKey: null, originalValue: "", newValue: "" }
}

export function excludeVoidedTrainingEvents<T extends CorrectionEvent>(events: T[]): T[] {
  const voided = new Set(voidedOccurrenceIds())
  if (voided.size === 0) return events
  const blocked = new Set<string>()
  for (const event of events) {
    const bound = typeof event.payload?.trainingOccurrenceId === "string" ? event.payload.trainingOccurrenceId : ""
    if (event.event_id && bound && voided.has(bound)) blocked.add(event.event_id)
  }
  for (const id of voided) {
    const occurrence = getTrainingOccurrence(id)
    if (!occurrence) continue
    if (occurrence.startEventId) blocked.add(occurrence.startEventId)
    if (occurrence.closeEventId) blocked.add(occurrence.closeEventId)
    for (const extra of [...(occurrence.duplicateStartEventIds ?? []), ...(occurrence.duplicateCloseEventIds ?? [])]) if (extra) blocked.add(extra)
    const startAt = events.findIndex((event) => event.event_id === occurrence.startEventId)
    if (startAt < 0) continue
    const closeAt = occurrence.closeEventId ? events.findIndex((event) => event.event_id === occurrence.closeEventId) : -1
    const nextStart = listTrainingOccurrences()
      .filter((item) => item.sessionId === occurrence.sessionId && item.trainingOccurrenceId !== occurrence.trainingOccurrenceId)
      .map((item) => events.findIndex((event) => event.event_id === item.startEventId))
      .filter((index) => index > startAt)
      .sort((left, right) => left - right)[0]
    const end = closeAt >= startAt ? closeAt : nextStart != null ? nextStart - 1 : events.length - 1
    if (end < startAt) continue
    for (const event of events.slice(startAt, end + 1)) {
      const sessionId = typeof event.payload?.sessionId === "string" ? event.payload.sessionId : ""
      if (event.event_id && sessionId === occurrence.sessionId) blocked.add(event.event_id)
    }
  }
  return events.filter((event) => !event.event_id || !blocked.has(event.event_id))
}
