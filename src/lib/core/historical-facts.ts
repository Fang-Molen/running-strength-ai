import { readTrainingFact } from "./fact-read.ts"
import { queryHistoricalOccurrences, type HistoricalOccurrenceQuery, type HistoricalWindow, type OccurrencePresence } from "./historical-occurrences.ts"
import type { TrainingFact } from "./training-fact.ts"

export type HistoricalFactItem = {
  trainingOccurrenceId: string
  startedAt: string
  fact: TrainingFact | null
}

export type HistoricalFactProjection = {
  window: HistoricalWindow
  occurrencePresence: OccurrencePresence
  occurrences: HistoricalFactItem[]
}

export function projectHistoricalFacts(input: { from: string; to: string }): HistoricalFactProjection {
  const query: HistoricalOccurrenceQuery = queryHistoricalOccurrences(input)
  return {
    window: query.window,
    occurrencePresence: query.occurrencePresence,
    occurrences: query.occurrences.map((item) => ({ trainingOccurrenceId: item.trainingOccurrenceId, startedAt: item.startedAt, fact: readTrainingFact(item.trainingOccurrenceId) })),
  }
}
