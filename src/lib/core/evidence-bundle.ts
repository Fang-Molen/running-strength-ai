import { fatigueEvidence, type FatigueEvidence } from "./evidence-fatigue.ts"
import { musculoskeletalEvidence, type MusculoskeletalEvidence } from "./evidence-musculoskeletal.ts"
import { recoveryEvidence, type RecoveryEvidence } from "./evidence-recovery.ts"

export type EvidenceBundle = {
  trainingOccurrenceId: string
  fatigue: FatigueEvidence
  recovery: RecoveryEvidence
  musculoskeletal: MusculoskeletalEvidence
}

export function readEvidenceBundle(trainingOccurrenceId: string): EvidenceBundle | null {
  const fatigue = fatigueEvidence(trainingOccurrenceId)
  const recovery = recoveryEvidence(trainingOccurrenceId)
  const musculoskeletal = musculoskeletalEvidence(trainingOccurrenceId)
  if (!fatigue || !recovery || !musculoskeletal) return null
  if (fatigue.trainingOccurrenceId !== trainingOccurrenceId || recovery.trainingOccurrenceId !== trainingOccurrenceId || musculoskeletal.trainingOccurrenceId !== trainingOccurrenceId) return null
  return { trainingOccurrenceId, fatigue, recovery, musculoskeletal }
}
