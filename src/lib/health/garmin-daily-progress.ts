import { shiftDay, validDay } from './observation'

/** A checked date is a completed read, including explicit no-data responses. It
 * does not assert that a measurement exists or that an activity import succeeded.
 * The host stores this receipt under both the Garmin account and athlete. */
export type GarminDailyProgress = {
  checkedDays: string[]
  pendingDays: string[]
  lastSyncAt: string | null
  intradayCheckedDays?: string[]
}
export type GarminProgressPlan = {
  mode: 'INITIAL' | 'RECENT' | 'BACKFILL' | 'FULL'
  offsets: number[]
  pendingDays: string[]
}
const localDayOf = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const offsetOf = (today: string, day: string) => Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 864e5)
export const validProgressDays = (days: readonly string[] | undefined, today: string) =>
  [...new Set((Array.isArray(days) ? days : []).filter(d => validDay(d) && d <= today))].sort().reverse()

/** New receipt-based scheduling. The legacy planner remains unchanged for callers
 * without a dailyProgress adapter. Ordinary resumptions read at most 14 older
 * dates, even when a failed date or a long pause leaves many outstanding dates. */
export function planGarminProgressSync(input: {
  today: string; now: string; reason?: 'AUTO' | 'MANUAL'; progress: GarminDailyProgress | null; backfillThrough: number
}): GarminProgressPlan {
  const { today, now, progress } = input
  if (!validDay(today) || !Number.isFinite(Date.parse(now))) throw Error('INVALID_TIME')
  const cursor = Math.min(90, Math.max(14, Number.isFinite(input.backfillThrough) ? input.backfillThrough : 14))
  const pending = new Set(validProgressDays(progress?.pendingDays, today))
  // Old versions had only a cursor. Resume that known unfinished range without
  // pretending previously saved metrics are complete per-date receipts.
  if (!progress && cursor < 90) for (let i = cursor; i < 90; i++) pending.add(shiftDay(today, -i))
  if (input.reason === 'MANUAL') {
    const offsets = Array.from({ length: 14 }, (_, i) => i)
    for (const i of offsets) pending.add(shiftDay(today, -i))
    return { mode: 'FULL', offsets, pendingDays: validProgressDays([...pending], today) }
  }
  if (!progress && cursor === 14) {
    const offsets = Array.from({ length: 90 }, (_, i) => i)
    return { mode: 'INITIAL', offsets, pendingDays: offsets.map(i => shiftDay(today, -i)) }
  }
  const recent = [0, 1, 2], priorPending = [...pending]
  const lastSync = progress?.lastSyncAt
  if (lastSync && Number.isFinite(Date.parse(lastSync)) && Date.parse(lastSync) <= Date.parse(now)) {
    // Refresh the previous read day too: it may have been read before that day
    // finished. Newly discovered gaps use the existing 90-day history target;
    // explicit pending dates are retained even after they age beyond that window.
    const missed = Math.min(89, Math.max(0, offsetOf(today, localDayOf(lastSync))))
    for (let i = 0; i <= missed; i++) pending.add(shiftDay(today, -i))
  }
  for (const i of recent) pending.add(shiftDay(today, -i))
  const older = [...new Set([...priorPending, ...validProgressDays([...pending], today)])]
    .map(d => offsetOf(today, d)).filter(i => i >= 3).slice(0, 14)
  return { mode: older.length ? 'BACKFILL' : 'RECENT', offsets: [...recent, ...older], pendingDays: validProgressDays([...pending], today) }
}
