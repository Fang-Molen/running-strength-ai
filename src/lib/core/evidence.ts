import { loadEvents } from "./events.ts"
import { excludeVoidedTrainingEvents } from "./training-correction.ts"

export type EvidenceType = "SESSION_RPE" | "PAIN" | "SLEEP" | "SUBJECTIVE_RECOVERY" | "SORENESS"
export type EvidenceBinding = "BOUND" | "UNBOUND"

export type EvidenceEvent = {
  event_id?: string
  event_type: string
  timestamp?: string
  source?: string
  payload?: Record<string, unknown>
}

export type EvidenceRecord = {
  evidenceId: string
  evidenceType: EvidenceType
  binding: EvidenceBinding
  trainingOccurrenceId: string | null
  timestamp: string | null
  source: string | null
  value: number | null
  location: string[] | null
}

export type EvidenceProjection = {
  valid: EvidenceRecord[]
  rejected: string[]
}

const TYPES = new Set<EvidenceType>(["SESSION_RPE", "PAIN", "SLEEP", "SUBJECTIVE_RECOVERY", "SORENESS"])

function payloadOf(event: EvidenceEvent): Record<string, unknown> {
  return event.payload ?? {}
}

function namedType(event: EvidenceEvent): EvidenceType | null {
  const named = payloadOf(event).evidenceType
  if (typeof named === "string" && TYPES.has(named as EvidenceType)) return named as EvidenceType
  if (event.event_type === "PAIN_RECORDED") return "PAIN"
  if (event.event_type === "SLEEP_RECORDED") return "SLEEP"
  return null
}

function scale(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 10 ? value : null
}

function present(payload: Record<string, unknown>, key: string): boolean {
  return key in payload && payload[key] != null
}

function locations(payload: Record<string, unknown>): string[] | null {
  if (typeof payload.location === "string" && payload.location.trim()) return [payload.location]
  for (const key of ["locations", "moveIds"]) {
    if (!Array.isArray(payload[key])) continue
    const items = payload[key].filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    if (items.length > 0) return items
  }
  return null
}

function startIds(events: EvidenceEvent[]): Set<string> {
  return new Set(events.filter((event) => event.event_type === "TRAINING_STARTED" && typeof event.event_id === "string").map((event) => event.event_id as string))
}

function bind(payload: Record<string, unknown>, starts: Set<string>): { binding: EvidenceBinding; trainingOccurrenceId: string | null } {
  const claimed = payload.trainingOccurrenceId
  if (typeof claimed !== "string" || !starts.has(claimed)) return { binding: "UNBOUND", trainingOccurrenceId: null }
  return { binding: "BOUND", trainingOccurrenceId: claimed }
}

function accept(event: EvidenceEvent, type: EvidenceType, starts: Set<string>): EvidenceRecord | null {
  if (!event.event_id) return null
  const payload = payloadOf(event)
  const bound = bind(payload, starts)
  const base = { evidenceId: event.event_id, evidenceType: type, timestamp: typeof event.timestamp === "string" ? event.timestamp : null, source: typeof event.source === "string" ? event.source : typeof payload.source === "string" ? payload.source : null, ...bound }
  if (type === "SESSION_RPE") {
    const value = scale(payload.value ?? payload.rpe)
    if (value == null) return null
    return { ...base, value, location: null }
  }
  if (type === "SUBJECTIVE_RECOVERY") {
    const value = scale(payload.value)
    if (value == null) return null
    return { ...base, value, location: null }
  }
  if (type === "SLEEP") {
    const raw = payload.hours ?? payload.value
    const value = typeof raw === "number" && Number.isFinite(raw) && raw > 0 && raw <= 24 ? raw : null
    if (value == null) return null
    return { ...base, value, location: null }
  }
  if (type === "PAIN") {
    if (present(payload, "intensity") && scale(payload.intensity) == null) return null
    return { ...base, value: present(payload, "intensity") ? scale(payload.intensity) : null, location: locations(payload) }
  }
  if (present(payload, "level") && present(payload, "intensity") && payload.level !== payload.intensity) return null
  const levelSource = present(payload, "level") ? payload.level : present(payload, "intensity") ? payload.intensity : null
  if ((present(payload, "level") || present(payload, "intensity")) && scale(levelSource) == null) return null
  const location = locations(payload)
  const level = scale(levelSource)
  if (!location && level == null) return null
  return { ...base, value: level, location }
}

export function projectEvidence(events: EvidenceEvent[]): EvidenceProjection {
  const starts = startIds(events)
  const valid: EvidenceRecord[] = []
  const rejected: string[] = []
  for (const event of events) {
    const type = namedType(event)
    if (!type) continue
    const record = accept(event, type, starts)
    if (!record) rejected.push(event.event_id ?? "")
    else valid.push(record)
  }
  return { valid, rejected }
}

export type EvidenceGroup = {
  status: "ABSENT" | "RECORDED" | "MULTIPLE"
  value: number | null
  records: EvidenceRecord[]
}

function group(records: EvidenceRecord[], type: EvidenceType): EvidenceGroup {
  const matched = records.filter((record) => record.evidenceType === type)
  if (matched.length === 0) return { status: "ABSENT", value: null, records: [] }
  if (matched.length > 1) return { status: "MULTIPLE", value: null, records: matched }
  return { status: "RECORDED", value: matched[0]?.value ?? null, records: matched }
}

export function projectOccurrenceEvidence(trainingOccurrenceId: string, events: EvidenceEvent[]): {
  trainingOccurrenceId: string
  sessionRpe: EvidenceGroup
  pain: EvidenceGroup
  sleep: EvidenceGroup
  subjectiveRecovery: EvidenceGroup
  soreness: EvidenceGroup
} {
  const records = projectEvidence(events).valid.filter((record) => record.binding === "BOUND" && record.trainingOccurrenceId === trainingOccurrenceId)
  return {
    trainingOccurrenceId,
    sessionRpe: group(records, "SESSION_RPE"),
    pain: group(records, "PAIN"),
    sleep: group(records, "SLEEP"),
    subjectiveRecovery: group(records, "SUBJECTIVE_RECOVERY"),
    soreness: group(records, "SORENESS"),
  }
}

export function readEvidence(): EvidenceProjection {
  return projectEvidence(excludeVoidedTrainingEvents(loadEvents()))
}
