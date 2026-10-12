import { inferTrainingEvidence, type TrainingInference } from "./evidence-inference.ts"

export type FatigueEvidenceState = "NO_RELEVANT_EVIDENCE" | "SIGNAL_PRESENT" | "INSUFFICIENT_EVIDENCE" | "CONFLICTING_EVIDENCE"

export type FatigueEvidence = {
  trainingOccurrenceId: string
  state: FatigueEvidenceState
  fatigueConclusion: "UNKNOWN"
  signals: TrainingInference[]
  opposingSignals: TrainingInference[]
  unresolvedSignals: TrainingInference[]
  evidenceIds: string[]
  observationTypes: string[]
  rule: "FATIGUE_EVIDENCE_V1"
  confidence: "RULE_BASED"
}

const SIGNAL_TYPES = ["HIGH_SUBJECTIVE_INTENSITY", "SHORT_SLEEP_RECORDED", "LOW_SUBJECTIVE_RECOVERY_RECORDED"]

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export function fatigueEvidence(trainingOccurrenceId: string): FatigueEvidence | null {
  const inferred = inferTrainingEvidence(trainingOccurrenceId)
  if (!inferred) return null
  const relevant = inferred.inferences.filter((item) => SIGNAL_TYPES.includes(item.type))
  const signals = relevant.filter((item) => item.status === "SUPPORTED")
  const opposingSignals = relevant.filter((item) => item.status === "NOT_SUPPORTED")
  const unresolvedSignals = relevant.filter((item) => item.status === "UNKNOWN" && item.reasonCode.startsWith("MULTIPLE_"))
  const state: FatigueEvidenceState = signals.length > 0 && opposingSignals.length > 0
    ? "CONFLICTING_EVIDENCE"
    : signals.length > 0
      ? "SIGNAL_PRESENT"
      : opposingSignals.length > 0 || unresolvedSignals.length > 0
        ? "INSUFFICIENT_EVIDENCE"
        : "NO_RELEVANT_EVIDENCE"
  const cited = [...signals, ...opposingSignals, ...unresolvedSignals]
  return {
    trainingOccurrenceId,
    state,
    fatigueConclusion: "UNKNOWN",
    signals,
    opposingSignals,
    unresolvedSignals,
    evidenceIds: unique(cited.flatMap((item) => item.evidenceIds)),
    observationTypes: unique(cited.flatMap((item) => item.observationTypes)),
    rule: "FATIGUE_EVIDENCE_V1",
    confidence: "RULE_BASED",
  }
}
