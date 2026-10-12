import { evidenceAvailability, type EvidenceAvailability } from "./evidence-availability.ts"
import { queryHistoricalOccurrences, type HistoricalWindow, type OccurrencePresence } from "./historical-occurrences.ts"

export type HistoricalDomainReading = "NO_CITED_EVIDENCE" | "EVIDENCE_PRESENT" | "EVIDENCE_UNRESOLVED" | "EVIDENCE_CONFLICTING" | "AVAILABILITY_UNAVAILABLE"

export type HistoricalAvailabilityItem = {
  trainingOccurrenceId: string
  startedAt: string
  availability: EvidenceAvailability | null
  fatigue: HistoricalDomainReading
  recovery: HistoricalDomainReading
  musculoskeletal: HistoricalDomainReading
}

export type HistoricalAvailabilityProjection = {
  window: HistoricalWindow
  occurrencePresence: OccurrencePresence
  occurrences: HistoricalAvailabilityItem[]
}

function reading(availability: EvidenceAvailability | null, domain: "fatigue" | "recovery" | "musculoskeletal"): HistoricalDomainReading {
  if (!availability) return "AVAILABILITY_UNAVAILABLE"
  const state = availability[domain].state
  if (state === "NO_RELEVANT_EVIDENCE") return "NO_CITED_EVIDENCE"
  if (state === "SIGNAL_PRESENT") return "EVIDENCE_PRESENT"
  if (state === "CONFLICTING_EVIDENCE") return "EVIDENCE_CONFLICTING"
  return "EVIDENCE_UNRESOLVED"
}

export function projectHistoricalAvailability(input: { from: string; to: string }): HistoricalAvailabilityProjection {
  const query = queryHistoricalOccurrences(input)
  return {
    window: query.window,
    occurrencePresence: query.occurrencePresence,
    occurrences: query.occurrences.map((item) => {
      const availability = evidenceAvailability(item.trainingOccurrenceId)
      return {
        trainingOccurrenceId: item.trainingOccurrenceId,
        startedAt: item.startedAt,
        availability,
        fatigue: reading(availability, "fatigue"),
        recovery: reading(availability, "recovery"),
        musculoskeletal: reading(availability, "musculoskeletal"),
      }
    }),
  }
}
