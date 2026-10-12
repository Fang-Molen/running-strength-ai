import { interpretTrainingEvidence, type EvidenceObservation } from "./evidence-interpretation.ts"

export type InferenceStatus = "SUPPORTED" | "NOT_SUPPORTED" | "UNKNOWN"

export type TrainingInference = {
  type: string
  status: InferenceStatus
  observationTypes: string[]
  evidenceIds: string[]
  factIds: string[]
  reasonCode: string
  confidence: "RULE_BASED"
}

export type TrainingInferenceResult = {
  trainingOccurrenceId: string
  inferences: TrainingInference[]
}

function find(observations: EvidenceObservation[], type: string): EvidenceObservation | undefined {
  return observations.find((item) => item.type === type)
}

function inference(type: string, status: InferenceStatus, observation: EvidenceObservation | undefined, reasonCode: string, useFact: boolean): TrainingInference {
  const ids = observation?.sourceEvidenceIds ?? []
  return {
    type,
    status,
    observationTypes: observation ? [observation.type] : [],
    evidenceIds: useFact ? [] : ids,
    factIds: useFact ? ids : [],
    reasonCode,
    confidence: "RULE_BASED",
  }
}

function threshold(observations: EvidenceObservation[], supported: string[], unsupported: string[], multiple: string, absent: string, type: string, supportedReason: string, unsupportedReason: string, multipleReason: string, absentReason: string): TrainingInference {
  const hit = observations.find((item) => supported.includes(item.type) || unsupported.includes(item.type) || item.type === multiple || item.type === absent)
  if (!hit || hit.type === absent) return inference(type, "UNKNOWN", hit, absentReason, false)
  if (hit.type === multiple) return inference(type, "UNKNOWN", hit, multipleReason, false)
  if (supported.includes(hit.type)) return inference(type, "SUPPORTED", hit, supportedReason, false)
  return inference(type, "NOT_SUPPORTED", hit, unsupportedReason, false)
}

function recorded(observations: EvidenceObservation[], present: string[], absent: string, type: string): TrainingInference {
  const hit = observations.find((item) => present.includes(item.type) || item.type === absent)
  if (!hit || hit.type === absent) return inference(type, "UNKNOWN", hit, "NO_BOUND_RECORD", false)
  return inference(type, "SUPPORTED", hit, "BOUND_RECORD_PRESENT", false)
}

export function inferTrainingEvidence(trainingOccurrenceId: string): TrainingInferenceResult | null {
  const interpretation = interpretTrainingEvidence(trainingOccurrenceId)
  if (!interpretation) return null
  const observations = interpretation.observations
  const completed = find(observations, "FACT_COMPLETED")
  const progress = find(observations, "FACT_IN_PROGRESS")
  const completion = completed
    ? inference("TRAINING_COMPLETED", "SUPPORTED", completed, "LIFECYCLE_COMPLETED", true)
    : progress
      ? inference("TRAINING_COMPLETED", "NOT_SUPPORTED", progress, "LIFECYCLE_IN_PROGRESS", true)
      : inference("TRAINING_COMPLETED", "UNKNOWN", find(observations, "FACT_LIFECYCLE"), "LIFECYCLE_NOT_DECISIVE", true)
  return {
    trainingOccurrenceId,
    inferences: [
      threshold(observations, ["SESSION_RPE_HIGH", "SESSION_RPE_VERY_HIGH"], ["SESSION_RPE_LOW", "SESSION_RPE_MODERATE"], "SESSION_RPE_MULTIPLE", "NO_SESSION_RPE_EVIDENCE", "HIGH_SUBJECTIVE_INTENSITY", "UNIQUE_RPE_AT_LEAST_7", "UNIQUE_RPE_AT_MOST_6", "MULTIPLE_RPE", "NO_UNIQUE_RPE"),
      threshold(observations, ["SLEEP_SHORT"], ["SLEEP_MID", "SLEEP_LONG"], "SLEEP_MULTIPLE", "NO_SLEEP_EVIDENCE", "SHORT_SLEEP_RECORDED", "UNIQUE_SLEEP_UNDER_6H", "UNIQUE_SLEEP_AT_LEAST_6H", "MULTIPLE_SLEEP", "NO_UNIQUE_SLEEP"),
      threshold(observations, ["RECOVERY_LOW"], ["RECOVERY_MID", "RECOVERY_HIGH", "RECOVERY_VERY_HIGH"], "RECOVERY_MULTIPLE", "NO_RECOVERY_EVIDENCE", "LOW_SUBJECTIVE_RECOVERY_RECORDED", "UNIQUE_RECOVERY_AT_MOST_3", "UNIQUE_RECOVERY_AT_LEAST_4", "MULTIPLE_RECOVERY", "NO_UNIQUE_RECOVERY"),
      recorded(observations, ["PAIN_RECORDED", "PAIN_LIGHT", "PAIN_MODERATE", "PAIN_HIGH", "PAIN_MULTIPLE"], "NO_PAIN_EVIDENCE", "PAIN_RECORDED"),
      recorded(observations, ["SORENESS_RECORDED", "SORENESS_LIGHT", "SORENESS_MODERATE", "SORENESS_HIGH", "SORENESS_MULTIPLE"], "NO_SORENESS_EVIDENCE", "SORENESS_RECORDED"),
      completion,
    ],
  }
}
