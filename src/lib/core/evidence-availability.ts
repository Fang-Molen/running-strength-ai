import { readEvidenceBundle } from "./evidence-bundle.ts"
import type { FatigueEvidenceState } from "./evidence-fatigue.ts"
import type { MusculoskeletalEvidenceState } from "./evidence-musculoskeletal.ts"
import type { RecoveryEvidenceState } from "./evidence-recovery.ts"

export type CitedEvidence = "CITED_EVIDENCE_PRESENT" | "NO_CITED_EVIDENCE"

export type DomainAvailability<State extends string> = {
  evaluated: true
  state: State
  conclusion: "UNKNOWN"
  citedEvidence: CitedEvidence
}

export type EvidenceAvailability = {
  trainingOccurrenceId: string
  fatigue: DomainAvailability<FatigueEvidenceState>
  recovery: DomainAvailability<RecoveryEvidenceState>
  musculoskeletal: DomainAvailability<MusculoskeletalEvidenceState>
}

function cited(ids: string[]): CitedEvidence {
  return ids.length > 0 ? "CITED_EVIDENCE_PRESENT" : "NO_CITED_EVIDENCE"
}

export function evidenceAvailability(trainingOccurrenceId: string): EvidenceAvailability | null {
  const bundle = readEvidenceBundle(trainingOccurrenceId)
  if (!bundle) return null
  return {
    trainingOccurrenceId,
    fatigue: { evaluated: true, state: bundle.fatigue.state, conclusion: bundle.fatigue.fatigueConclusion, citedEvidence: cited(bundle.fatigue.evidenceIds) },
    recovery: { evaluated: true, state: bundle.recovery.state, conclusion: bundle.recovery.recoveryConclusion, citedEvidence: cited(bundle.recovery.evidenceIds) },
    musculoskeletal: { evaluated: true, state: bundle.musculoskeletal.state, conclusion: bundle.musculoskeletal.musculoskeletalConclusion, citedEvidence: cited(bundle.musculoskeletal.evidenceIds) },
  }
}
