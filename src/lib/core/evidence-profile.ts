import { loadEvents } from "./events.ts"
import { projectOccurrenceEvidence, type EvidenceGroup } from "./evidence.ts"
import { projectOccurrencePerformance, type PerformanceRecord } from "./performance-evidence.ts"
import { readTrainingFact } from "./fact-read.ts"
import type { TrainingFact } from "./training-fact.ts"

export type TrainingEvidenceProfile = {
  trainingOccurrenceId: string
  fact: TrainingFact
  evidence: {
    strength: PerformanceRecord[]
    running: PerformanceRecord[]
    sessionRpe: EvidenceGroup
    sleep: EvidenceGroup
    subjectiveRecovery: EvidenceGroup
    soreness: EvidenceGroup
    pain: EvidenceGroup
  }
}

export function getTrainingEvidenceProfile(trainingOccurrenceId: string): TrainingEvidenceProfile | null {
  const fact = readTrainingFact(trainingOccurrenceId)
  if (!fact) return null
  const events = loadEvents()
  const subjective = projectOccurrenceEvidence(trainingOccurrenceId, events)
  const performance = projectOccurrencePerformance(trainingOccurrenceId, events)
  return {
    trainingOccurrenceId,
    fact,
    evidence: {
      strength: performance.filter((record) => record.kind === "STRENGTH_SET"),
      running: performance.filter((record) => record.kind === "RUN"),
      sessionRpe: subjective.sessionRpe,
      sleep: subjective.sleep,
      subjectiveRecovery: subjective.subjectiveRecovery,
      soreness: subjective.soreness,
      pain: subjective.pain,
    },
  }
}
