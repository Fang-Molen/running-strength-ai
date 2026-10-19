import { completedPlanIds, type ActivityRow } from './training-read-model'
import { normalizePlanSessionId } from './training-component-facts'
import { dayKind, type V4Day } from './plan400-view'
import type { ScheduleEntry } from './day-schedule-rules'
import { currentAthleteId } from '../core/events'

/** A dated plan is the denominator; only the shared actual read model supplies completion. */
export function deriveCoordinationCounts(input: {
  date: string
  entries: readonly (ScheduleEntry & { athleteId?: string })[]
  rows: readonly ActivityRow[]
  v4Day?: V4Day | null
}): { planned: number; completed: number; plannedIds: string[]; completedIds: string[] } {
  const athleteId = currentAthleteId()
  const ids = new Set(input.entries.filter(e => (e.athleteId ?? 'local') === athleteId && e.date === input.date && !e.unplanned && e.modality !== 'rest' && e.status !== 'proposed' && e.status !== 'rejected').map(e => normalizePlanSessionId(e.id)))
  if (athleteId === 'local' && input.v4Day?.date === input.date && dayKind(input.v4Day) !== 'rest') ids.add(`plan400:${input.date}`)
  const completed = completedPlanIds(input.rows, input.date).filter(id => ids.has(id))
  return { planned: ids.size, completed: completed.length, plannedIds: [...ids].sort(), completedIds: [...completed].sort() }
}
