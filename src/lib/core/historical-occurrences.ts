import { listTrainingOccurrences } from "./occurrence.ts"
import { occurrenceVoided } from "./training-correction.ts"

export type HistoricalWindow = {
  from: string
  to: string
  fromInclusive: true
  toExclusive: true
  order: "STARTED_AT_ASCENDING"
}

export type OccurrencePresence = "NO_TRAINING_OCCURRENCES" | "TRAINING_OCCURRENCES_PRESENT" | "INVALID_WINDOW"

export type HistoricalOccurrenceRef = {
  trainingOccurrenceId: string
  startedAt: string
  planSlotId: string
  sessionId: string
}

export type HistoricalOccurrenceQuery = {
  window: HistoricalWindow
  occurrencePresence: OccurrencePresence
  occurrences: HistoricalOccurrenceRef[]
}

function parsed(value: string): number | null {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

export function queryHistoricalOccurrences(input: { from: string; to: string }): HistoricalOccurrenceQuery {
  const from = parsed(input.from)
  const to = parsed(input.to)
  const window: HistoricalWindow = { from: input.from, to: input.to, fromInclusive: true, toExclusive: true, order: "STARTED_AT_ASCENDING" }
  if (from == null || to == null || from > to) return { window, occurrencePresence: "INVALID_WINDOW", occurrences: [] }
  const occurrences = listTrainingOccurrences()
    .flatMap((item) => {
      const started = parsed(item.startedAt ?? "")
      if (item.startedAt == null || started == null || started < from || started >= to || occurrenceVoided(item.trainingOccurrenceId)) return []
      return [{ trainingOccurrenceId: item.trainingOccurrenceId, startedAt: item.startedAt, planSlotId: item.planSlotId, sessionId: item.sessionId }]
    })
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.trainingOccurrenceId.localeCompare(right.trainingOccurrenceId))
  return { window, occurrencePresence: occurrences.length === 0 ? "NO_TRAINING_OCCURRENCES" : "TRAINING_OCCURRENCES_PRESENT", occurrences }
}
