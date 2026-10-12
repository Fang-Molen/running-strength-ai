import { loadEvents } from "./events.ts"
import { occurrenceVoided } from "./training-correction.ts"
import { loadTrainingFact, type TrainingFact } from "./training-fact.ts"

export function readTrainingFact(trainingOccurrenceId: string): TrainingFact | null {
  if (occurrenceVoided(trainingOccurrenceId)) return null
  const events = loadEvents()
  const fact = loadTrainingFact(trainingOccurrenceId, events)
  if (!fact) return null
  if (!events.some((event) => event.event_id === fact.startEventId)) return null
  return fact
}
