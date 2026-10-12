import { getTrainingEvidenceProfile } from "./evidence-profile.ts"
import { inferTrainingEvidence, type TrainingInference } from "./evidence-inference.ts"
import type { EvidenceRecord } from "./evidence.ts"

export type MusculoskeletalEvidenceState = "NO_RELEVANT_EVIDENCE" | "SIGNAL_PRESENT" | "INSUFFICIENT_EVIDENCE" | "CONFLICTING_EVIDENCE"

export type MusculoskeletalRecord = {
  evidenceId: string
  observationType: "PAIN" | "SORENESS"
  reasonCode: string
  location: string[] | null
  severity: number | null
  timestamp: string | null
  source: string | null
}

export type MusculoskeletalEvidence = {
  trainingOccurrenceId: string
  state: MusculoskeletalEvidenceState
  musculoskeletalConclusion: "UNKNOWN"
  pain: MusculoskeletalRecord[]
  soreness: MusculoskeletalRecord[]
  evidenceIds: string[]
  rule: "MUSCULOSKELETAL_EVIDENCE_V1"
  confidence: "RULE_BASED"
}

function rows(records: EvidenceRecord[], observationType: MusculoskeletalRecord["observationType"], inference: TrainingInference | undefined): MusculoskeletalRecord[] {
  if (inference?.status !== "SUPPORTED") return []
  return records.map((record) => ({
    evidenceId: record.evidenceId,
    observationType,
    reasonCode: inference.reasonCode,
    location: record.location ? [...record.location] : null,
    severity: record.value,
    timestamp: record.timestamp,
    source: record.source,
  }))
}

function samePlace(left: string[] | null, right: string[] | null): boolean {
  if (left == null || right == null) return left == null && right == null
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function incompatible(records: MusculoskeletalRecord[]): boolean {
  return records.some((record, index) => records.slice(index + 1).some((other) => record.evidenceId === other.evidenceId && (record.severity !== other.severity || !samePlace(record.location, other.location))))
}

export function musculoskeletalEvidence(trainingOccurrenceId: string): MusculoskeletalEvidence | null {
  const inferred = inferTrainingEvidence(trainingOccurrenceId)
  if (!inferred) return null
  const profile = getTrainingEvidenceProfile(trainingOccurrenceId)
  if (!profile) return null
  const painInference = inferred.inferences.find((item) => item.type === "PAIN_RECORDED")
  const sorenessInference = inferred.inferences.find((item) => item.type === "SORENESS_RECORDED")
  const pain = rows(profile.evidence.pain.records, "PAIN", painInference)
  const soreness = rows(profile.evidence.soreness.records, "SORENESS", sorenessInference)
  const listed = pain.length + soreness.length > 0
  const missingRows = (painInference?.status === "SUPPORTED" && pain.length === 0) || (sorenessInference?.status === "SUPPORTED" && soreness.length === 0)
  const state: MusculoskeletalEvidenceState = incompatible([...pain, ...soreness])
    ? "CONFLICTING_EVIDENCE"
    : listed
      ? "SIGNAL_PRESENT"
      : missingRows
        ? "INSUFFICIENT_EVIDENCE"
        : "NO_RELEVANT_EVIDENCE"
  return {
    trainingOccurrenceId,
    state,
    musculoskeletalConclusion: "UNKNOWN",
    pain,
    soreness,
    evidenceIds: [...pain, ...soreness].map((record) => record.evidenceId),
    rule: "MUSCULOSKELETAL_EVIDENCE_V1",
    confidence: "RULE_BASED",
  }
}
