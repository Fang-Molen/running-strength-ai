import { inferTrainingEvidence, type TrainingInference } from "./evidence-inference.ts"

export type RecoveryEvidenceState = "NO_RELEVANT_EVIDENCE" | "SIGNAL_PRESENT" | "INSUFFICIENT_EVIDENCE" | "CONFLICTING_EVIDENCE"

export type RecoveryEvidence = {
  trainingOccurrenceId: string
  state: RecoveryEvidenceState
  recoveryConclusion: "UNKNOWN"
  signals: TrainingInference[]
  contextSignals: TrainingInference[]
  opposingSignals: TrainingInference[]
  unresolvedSignals: TrainingInference[]
  evidenceIds: string[]
  observationTypes: string[]
  rule: "RECOVERY_EVIDENCE_V1"
  confidence: "RULE_BASED"
}

const RECOVERY_SIGNAL_TYPES = ["SHORT_SLEEP_RECORDED", "LOW_SUBJECTIVE_RECOVERY_RECORDED"]

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export function recoveryEvidence(trainingOccurrenceId: string): RecoveryEvidence | null {
  const inferred = inferTrainingEvidence(trainingOccurrenceId)
  if (!inferred) return null
  const relevant = inferred.inferences.filter((item) => RECOVERY_SIGNAL_TYPES.includes(item.type) || item.type === "HIGH_SUBJECTIVE_INTENSITY")
  const signals = relevant.filter((item) => RECOVERY_SIGNAL_TYPES.includes(item.type) && item.status === "SUPPORTED")
  const contextSignals = relevant.filter((item) => item.type === "HIGH_SUBJECTIVE_INTENSITY" && item.status === "SUPPORTED")
  const opposingSignals = relevant.filter((item) => RECOVERY_SIGNAL_TYPES.includes(item.type) && item.status === "NOT_SUPPORTED")
  const unresolvedSignals = relevant.filter((item) => item.status === "UNKNOWN" && item.reasonCode.startsWith("MULTIPLE_"))
  const knownIntensity = relevant.some((item) => item.type === "HIGH_SUBJECTIVE_INTENSITY" && item.status === "NOT_SUPPORTED")
  const state: RecoveryEvidenceState = signals.length > 0 && opposingSignals.length > 0
    ? "CONFLICTING_EVIDENCE"
    : signals.length > 0
      ? "SIGNAL_PRESENT"
      : opposingSignals.length > 0 || unresolvedSignals.length > 0 || contextSignals.length > 0 || knownIntensity
        ? "INSUFFICIENT_EVIDENCE"
        : "NO_RELEVANT_EVIDENCE"
  const cited = [...signals, ...contextSignals, ...opposingSignals, ...unresolvedSignals]
  return {
    trainingOccurrenceId,
    state,
    recoveryConclusion: "UNKNOWN",
    signals,
    contextSignals,
    opposingSignals,
    unresolvedSignals,
    evidenceIds: unique(cited.flatMap((item) => item.evidenceIds)),
    observationTypes: unique(cited.flatMap((item) => item.observationTypes)),
    rule: "RECOVERY_EVIDENCE_V1",
    confidence: "RULE_BASED",
  }
}
