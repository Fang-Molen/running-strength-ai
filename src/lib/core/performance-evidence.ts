import { loadEvents } from "./events.ts"
import { excludeVoidedTrainingEvents, effectiveStrengthFields } from "./training-correction.ts"
import type { EvidenceEvent } from "./evidence.ts"

export type PerformanceKind = "STRENGTH_SET" | "RUN"
export type PerformanceBinding = "BOUND" | "UNBOUND"

export type PerformanceRecord = {
  evidenceId: string
  kind: PerformanceKind
  binding: PerformanceBinding
  trainingOccurrenceId: string | null
  timestamp: string | null
  source: string | null
  eventType: string
  moveId: string | null
  setIndex: number | null
  actualWeightKg: number | null
  actualReps: number | null
  actualDurationSec: number | null
  distanceKm: number | null
  durationSec: number | null
  runningRpe: number | null
}

export type PerformanceProjection = {
  valid: PerformanceRecord[]
  rejected: string[]
}

function payloadOf(event: EvidenceEvent): Record<string, unknown> {
  return event.payload ?? {}
}

function startsOf(events: EvidenceEvent[]): Set<string> {
  return new Set(events.filter((event) => event.event_type === "TRAINING_STARTED" && typeof event.event_id === "string").map((event) => event.event_id as string))
}

function bind(payload: Record<string, unknown>, starts: Set<string>): { binding: PerformanceBinding; trainingOccurrenceId: string | null } {
  const claimed = payload.trainingOccurrenceId
  if (typeof claimed !== "string" || !starts.has(claimed)) return { binding: "UNBOUND", trainingOccurrenceId: null }
  return { binding: "BOUND", trainingOccurrenceId: claimed }
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function scale(value: unknown): number | null {
  const number = finite(value)
  return number != null && number >= 1 && number <= 10 ? number : null
}

function base(event: EvidenceEvent, kind: PerformanceKind, starts: Set<string>): Omit<PerformanceRecord, "moveId" | "setIndex" | "actualWeightKg" | "actualReps" | "actualDurationSec" | "distanceKm" | "durationSec" | "runningRpe"> | null {
  if (!event.event_id) return null
  const payload = payloadOf(event)
  return {
    evidenceId: event.event_id,
    kind,
    eventType: event.event_type,
    timestamp: typeof event.timestamp === "string" ? event.timestamp : null,
    source: typeof event.source === "string" ? event.source : typeof payload.source === "string" ? payload.source : null,
    ...bind(payload, starts),
  }
}

function strength(event: EvidenceEvent, starts: Set<string>): PerformanceRecord | null {
  const payload = payloadOf(event)
  const header = base(event, "STRENGTH_SET", starts)
  if (!header || typeof payload.moveId !== "string" || typeof payload.setIndex !== "number") return null
  const weightPresent = "actualWeight" in payload && payload.actualWeight != null
  const amountPresent = "actualAmount" in payload && payload.actualAmount != null
  if (!weightPresent && !amountPresent) return null
  const weight = weightPresent ? finite(payload.actualWeight) : null
  const amount = amountPresent ? finite(payload.actualAmount) : null
  if (weightPresent && (weight == null || weight < 0)) return null
  if (amountPresent && (amount == null || amount < 0)) return null
  const seconds = payload.mode === "seconds"
  const overlay = effectiveStrengthFields(payload)
  const weightKg = overlay.binding === "BOUND" && overlay.weight.status !== "ORIGINAL" ? overlay.weight.value : weight
  const reps = seconds ? null : overlay.binding === "BOUND" && overlay.reps.status !== "ORIGINAL" ? overlay.reps.value : amount
  return {
    ...header,
    moveId: payload.moveId,
    setIndex: payload.setIndex,
    actualWeightKg: weightKg,
    actualReps: reps,
    actualDurationSec: seconds ? amount : null,
    distanceKm: null,
    durationSec: null,
    runningRpe: null,
  }
}

function run(event: EvidenceEvent, starts: Set<string>): PerformanceRecord | null {
  const payload = payloadOf(event)
  if (payload.evidenceType === "SESSION_RPE") return null
  const header = base(event, "RUN", starts)
  if (!header) return null
  const distancePresent = "km" in payload && payload.km != null
  const durationPresent = "seconds" in payload && payload.seconds != null
  const rpePresent = "rpe" in payload && payload.rpe != null
  if (!distancePresent && !durationPresent) return null
  const distance = distancePresent ? finite(payload.km) : null
  const duration = durationPresent ? finite(payload.seconds) : null
  if (distancePresent && (distance == null || distance <= 0)) return null
  if (durationPresent && (duration == null || duration <= 0)) return null
  if (rpePresent && scale(payload.rpe) == null) return null
  return {
    ...header,
    moveId: null,
    setIndex: null,
    actualWeightKg: null,
    actualReps: null,
    actualDurationSec: null,
    distanceKm: distance,
    durationSec: duration,
    runningRpe: rpePresent ? scale(payload.rpe) : null,
  }
}

export function projectPerformance(events: EvidenceEvent[]): PerformanceProjection {
  const starts = startsOf(events)
  const valid: PerformanceRecord[] = []
  const rejected: string[] = []
  for (const event of events) {
    const performance = event.event_type === "TRAINING_SET_COMPLETED" ? strength(event, starts) : event.event_type === "RUN_COMPLETED" || event.event_type === "RPE_RECORDED" ? run(event, starts) : null
    if (event.event_type !== "TRAINING_SET_COMPLETED" && event.event_type !== "RUN_COMPLETED" && event.event_type !== "RPE_RECORDED") continue
    if (!performance) {
      if (event.event_id && hasPerformancePayload(event)) rejected.push(event.event_id)
      continue
    }
    valid.push(performance)
  }
  return { valid, rejected }
}

function hasPerformancePayload(event: EvidenceEvent): boolean {
  const payload = payloadOf(event)
  if (event.event_type === "TRAINING_SET_COMPLETED") return ("actualWeight" in payload && payload.actualWeight != null) || ("actualAmount" in payload && payload.actualAmount != null)
  return ("km" in payload && payload.km != null) || ("seconds" in payload && payload.seconds != null)
}

export function projectOccurrencePerformance(trainingOccurrenceId: string, events: EvidenceEvent[]): PerformanceRecord[] {
  return projectPerformance(events).valid.filter((record) => record.binding === "BOUND" && record.trainingOccurrenceId === trainingOccurrenceId)
}

export function readPerformanceEvidence(): PerformanceProjection {
  return projectPerformance(excludeVoidedTrainingEvents(loadEvents()))
}
