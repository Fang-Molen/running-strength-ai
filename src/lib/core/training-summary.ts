import { readTrainingFact } from "./fact-read.ts"
import { occurrenceVoided } from "./training-correction.ts"
import type { TrainingFact } from "./training-fact.ts"

export type TrainingSummaryItem = {
  trainingOccurrenceId: string
  fact: TrainingFact | null
}

export type TrainingSummary = {
  items: TrainingSummaryItem[]
  plannedSetCount: number | null
  completedSetCount: number | null
  completionRatio: number | null
}

function canAggregate(fact: TrainingFact | null): fact is TrainingFact & { plannedSetCount: number; completedSetCount: number; completionRatio: number } {
  return fact != null && fact.plannedSetCount != null && fact.completedSetCount != null && fact.completionRatio != null
}

export function trainingSummary(trainingOccurrenceIds: string[]): TrainingSummary {
  const items = trainingOccurrenceIds.map((trainingOccurrenceId) => ({ trainingOccurrenceId, fact: occurrenceVoided(trainingOccurrenceId) ? null : readTrainingFact(trainingOccurrenceId) }))
  const active = items.filter((item) => !occurrenceVoided(item.trainingOccurrenceId))
  if (active.length === 0) return { items, plannedSetCount: null, completedSetCount: null, completionRatio: null }
  let plannedSetCount = 0
  let completedSetCount = 0
  for (const item of active) {
    if (!canAggregate(item.fact)) return { items, plannedSetCount: null, completedSetCount: null, completionRatio: null }
    plannedSetCount += item.fact.plannedSetCount
    completedSetCount += item.fact.completedSetCount
  }
  return { items, plannedSetCount, completedSetCount, completionRatio: plannedSetCount > 0 ? completedSetCount / plannedSetCount : null }
}
