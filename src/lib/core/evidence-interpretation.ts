import { getTrainingEvidenceProfile } from "./evidence-profile.ts"
import type { EvidenceGroup, EvidenceRecord } from "./evidence.ts"
import type { PerformanceRecord } from "./performance-evidence.ts"

export type EvidenceObservation = {
  type: string
  value: number | string | null
  source: "EVIDENCE" | "FACT" | "PROFILE"
  sourceEvidenceIds: string[]
  timestamp: string | null
  confidence: "DIRECT"
  location: string[] | null
  moveId: string | null
  setIndex: number | null
  actualWeightKg: number | null
  actualReps: number | null
  actualDurationSec: number | null
  distanceKm: number | null
  durationSec: number | null
}

export type TrainingEvidenceInterpretation = {
  trainingOccurrenceId: string
  observations: EvidenceObservation[]
}

function blank(type: string, source: EvidenceObservation["source"], value: number | string | null, ids: string[], timestamp: string | null): EvidenceObservation {
  return { type, value, source, sourceEvidenceIds: ids, timestamp, confidence: "DIRECT", location: null, moveId: null, setIndex: null, actualWeightKg: null, actualReps: null, actualDurationSec: null, distanceKm: null, durationSec: null }
}

function rpeBand(value: number): string {
  if (value <= 3) return "SESSION_RPE_LOW"
  if (value <= 6) return "SESSION_RPE_MODERATE"
  if (value <= 8) return "SESSION_RPE_HIGH"
  return "SESSION_RPE_VERY_HIGH"
}

function recoveryBand(value: number): string {
  if (value <= 3) return "RECOVERY_LOW"
  if (value <= 6) return "RECOVERY_MID"
  if (value <= 8) return "RECOVERY_HIGH"
  return "RECOVERY_VERY_HIGH"
}

function sleepBand(hours: number): string {
  if (hours < 6) return "SLEEP_SHORT"
  if (hours <= 8) return "SLEEP_MID"
  return "SLEEP_LONG"
}

function bodyBand(prefix: string, value: number): string {
  if (value <= 3) return `${prefix}_LIGHT`
  if (value <= 6) return `${prefix}_MODERATE`
  return `${prefix}_HIGH`
}

function single(group: EvidenceGroup, absent: string, recorded: string, multiple: string, band: (value: number) => string): EvidenceObservation {
  if (group.status === "ABSENT" || group.records.length === 0) return blank(absent, "PROFILE", null, [], null)
  if (group.status === "MULTIPLE") return blank(multiple, "EVIDENCE", null, group.records.map((record) => record.evidenceId), null)
  const record = group.records[0] as EvidenceRecord
  const observation = blank(record.value == null ? recorded : band(record.value), "EVIDENCE", record.value, [record.evidenceId], record.timestamp)
  observation.location = record.location
  return observation
}

function strength(record: PerformanceRecord): EvidenceObservation {
  const observation = blank("STRENGTH_SET_RECORDED", "EVIDENCE", null, [record.evidenceId], record.timestamp)
  observation.moveId = record.moveId
  observation.setIndex = record.setIndex
  observation.actualWeightKg = record.actualWeightKg
  observation.actualReps = record.actualReps
  observation.actualDurationSec = record.actualDurationSec
  return observation
}

function run(record: PerformanceRecord): EvidenceObservation {
  const observation = blank("RUN_RECORDED", "EVIDENCE", null, [record.evidenceId], record.timestamp)
  observation.distanceKm = record.distanceKm
  observation.durationSec = record.durationSec
  return observation
}

export function interpretTrainingEvidence(trainingOccurrenceId: string): TrainingEvidenceInterpretation | null {
  const profile = getTrainingEvidenceProfile(trainingOccurrenceId)
  if (!profile) return null
  const observations = [
    single(profile.evidence.sessionRpe, "NO_SESSION_RPE_EVIDENCE", "SESSION_RPE_RECORDED", "SESSION_RPE_MULTIPLE", rpeBand),
    single(profile.evidence.sleep, "NO_SLEEP_EVIDENCE", "SLEEP_RECORDED", "SLEEP_MULTIPLE", sleepBand),
    single(profile.evidence.subjectiveRecovery, "NO_RECOVERY_EVIDENCE", "RECOVERY_RECORDED", "RECOVERY_MULTIPLE", recoveryBand),
    single(profile.evidence.soreness, "NO_SORENESS_EVIDENCE", "SORENESS_RECORDED", "SORENESS_MULTIPLE", (value) => bodyBand("SORENESS", value)),
    single(profile.evidence.pain, "NO_PAIN_EVIDENCE", "PAIN_RECORDED", "PAIN_MULTIPLE", (value) => bodyBand("PAIN", value)),
    ...profile.evidence.strength.map(strength),
    ...profile.evidence.running.map(run),
  ]
  if (profile.fact.lifecycle === "COMPLETED") observations.push(blank("FACT_COMPLETED", "FACT", profile.fact.lifecycle, [profile.fact.startEventId], profile.fact.startedAt))
  else if (profile.fact.lifecycle === "IN_PROGRESS") observations.push(blank("FACT_IN_PROGRESS", "FACT", profile.fact.lifecycle, [profile.fact.startEventId], profile.fact.startedAt))
  else if (profile.fact.lifecycle) observations.push(blank("FACT_LIFECYCLE", "FACT", profile.fact.lifecycle, [profile.fact.startEventId], profile.fact.startedAt))
  if (profile.fact.duration != null) observations.push(blank("FACT_DURATION", "FACT", profile.fact.duration, [profile.fact.startEventId], null))
  return { trainingOccurrenceId, observations }
}
