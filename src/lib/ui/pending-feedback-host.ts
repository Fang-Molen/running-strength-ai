/** The same existing V4 projection supplies every feedback entrance. No writes,
 * scoring, watch relinking or new reminder database. */
import { planDays } from '../plan/active-plan'
import { currentAthleteId } from '../core/events'
import { ownedBy } from '../core/ownership'
import { loadOwnedComponents } from './plan400-components-store'
import { loadRunMatch } from './training-read-model'
import { loadSchedule } from './day-schedule'
import { v4MovedOut } from './v4-effective-move'
import { pendingFeedback } from './pending-feedback'
import type { DayParts, V4Day, V4Log } from './plan400-view'

export function readPendingFeedback(today: string) {
  const doc = loadOwnedComponents(), match = loadRunMatch()
  const parts: Record<string, DayParts> = { ...match.v4Parts }
  for (const [day, row] of Object.entries(doc.days)) parts[day] = { ...parts[day], parts: row }
  const raw = typeof localStorage === 'undefined' ? '{}' : localStorage.getItem('fk-plan400-v4-log') ?? '{}'
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('V4_LOG_UNREADABLE')
  const logs = Object.fromEntries(Object.entries(parsed).filter(([, row]) =>
    row && typeof row === 'object' && ownedBy(row, currentAthleteId()))) as Record<string,V4Log>
  const days = planDays(), schedule = loadSchedule().entries
  const moved = new Set(days.filter(day => !!v4MovedOut(day.date, schedule)).map(day => day.date))
  return pendingFeedback(days, parts, logs, today, doc.prompted ?? [], 14, moved)
}
