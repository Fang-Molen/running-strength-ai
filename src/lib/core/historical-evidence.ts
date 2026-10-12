import { evidenceAvailability, type EvidenceAvailability } from "./evidence-availability.ts"
import { readEvidenceBundle, type EvidenceBundle } from "./evidence-bundle.ts"
import { projectHistoricalAvailability, type HistoricalDomainReading } from "./historical-availability.ts"
import { projectHistoricalFacts, type HistoricalFactItem } from "./historical-facts.ts"
import { type HistoricalWindow, type OccurrencePresence } from "./historical-occurrences.ts"
import type { TrainingFact } from "./training-fact.ts"

export type HistoricalEvidenceItem = {
  trainingOccurrenceId: string
  startedAt: string
  fact: TrainingFact | null
  evidenceBundle: EvidenceBundle | null
  evidenceAvailability: EvidenceAvailability | null
  fatigue: HistoricalDomainReading
  recovery: HistoricalDomainReading
  musculoskeletal: HistoricalDomainReading
}

export type HistoricalEvidenceWindow = {
  window: HistoricalWindow
  occurrencePresence: OccurrencePresence
  occurrences: HistoricalEvidenceItem[]
}

export function projectHistoricalEvidence(input: { from: string; to: string }): HistoricalEvidenceWindow {
  const facts = projectHistoricalFacts(input)
  const availability = projectHistoricalAvailability(input)
  const byId = new Map(availability.occurrences.map((item) => [item.trainingOccurrenceId, item]))
  return {
    window: facts.window,
    occurrencePresence: facts.occurrencePresence,
    occurrences: facts.occurrences.map((item: HistoricalFactItem) => {
      const domain = byId.get(item.trainingOccurrenceId)
      return {
        trainingOccurrenceId: item.trainingOccurrenceId,
        startedAt: item.startedAt,
        fact: item.fact,
        evidenceBundle: readEvidenceBundle(item.trainingOccurrenceId),
        evidenceAvailability: evidenceAvailability(item.trainingOccurrenceId),
        fatigue: domain?.fatigue ?? "AVAILABILITY_UNAVAILABLE",
        recovery: domain?.recovery ?? "AVAILABILITY_UNAVAILABLE",
        musculoskeletal: domain?.musculoskeletal ?? "AVAILABILITY_UNAVAILABLE",
      }
    }),
  }
}
