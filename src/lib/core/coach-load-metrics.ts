/** Descriptive load trend only. No injury probability, thresholds or training prescription. */
export type SavedSessionLoad = {
  id: string
  athleteId: string
  day: string
  sessionRpe: number | null
  minutes: number | null
  sourceIds: string[]
  /** Includes source revisions so changes invalidate a prior completeness assertion. */
  revision: string
}

export type LoadDayConfirmation = {
  athleteId: string
  day: string
  fingerprint: string
}

export type LoadTrend = {
  status: 'AVAILABLE' | 'INSUFFICIENT' | 'ZERO_BASELINE' | 'INVALID'
  startDay: string | null
  endDay: string
  knownDays: number
  missingDays: string[]
  incompleteSessionIds: string[]
  duplicateIds: string[]
  days: { day: string; au: number | null; sessionCount: number; confirmed: boolean }[]
  acute: number | null
  chronic: number | null
  ratio: number | null
  sourceIds: string[]
}

export const LOAD_WINDOW_DAYS = 28
export const ACUTE_ALPHA = 2 / (7 + 1)
export const CHRONIC_ALPHA = 2 / (28 + 1)
const DAY_MS = 86_400_000

/** Pure recurrence shared by the 7/28 and 7/42 descriptive adapters.
 * Callers must establish complete consecutive days; unknown days are never zero padded.
 */
export function calculateEwmaSeries(values: readonly number[], period: number): number[] | null {
  if (!values.length || !Number.isInteger(period) || period < 1 ||
      values.some(value => !Number.isFinite(value) || value < 0)) return null
  const alpha = 2 / (period + 1), result = [values[0]]
  for (const value of values.slice(1)) result.push(alpha * value + (1 - alpha) * result[result.length - 1])
  return result.every(Number.isFinite) ? result : null
}

export function validLoadDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day + 'T00:00:00Z')) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day
}

export function shiftLoadDay(day: string, offset: number): string | null {
  if (!validLoadDay(day) || !Number.isInteger(offset) || Math.abs(offset) > 3660) return null
  return new Date(Date.parse(day + 'T00:00:00Z') + offset * DAY_MS).toISOString().slice(0, 10)
}

export function savedSessionAu(session: SavedSessionLoad): number | null {
  const { sessionRpe: rpe, minutes } = session
  return typeof rpe === 'number' && Number.isFinite(rpe) && rpe >= 0 && rpe <= 10 &&
    typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 && minutes <= 1440
    ? rpe * minutes : null
}

/** Canonical full snapshot, not a lossy hash. Identical retransmissions do not change it. */
export function loadDayFingerprint(sessions: readonly SavedSessionLoad[], athleteId: string, day: string): string {
  return JSON.stringify([...new Set(sessions.filter(s => s.athleteId === athleteId && s.day === day).map(s => JSON.stringify({
    id: s.id, rpe: s.sessionRpe, minutes: s.minutes, revision: s.revision,
    sourceIds: [...new Set(s.sourceIds)].sort(),
  })))].sort())
}

/** Daily EWMA, seeded with the first actual known day, after 28 consecutive complete days.
 * The 7/28 periods use alpha=2/(N+1). No zero padding before this window or on unknown days.
 * Both averages include the current selected day (coupled descriptive ratio).
 */
export function calculateLoadTrend(input: {
  athleteId: string
  endDay: string
  sessions: readonly SavedSessionLoad[]
  confirmations: readonly LoadDayConfirmation[]
}): LoadTrend {
  const { athleteId, endDay, sessions, confirmations } = input
  const startDay = shiftLoadDay(endDay, -(LOAD_WINDOW_DAYS - 1))
  const base: LoadTrend = { status: 'INVALID', startDay, endDay, knownDays: 0, missingDays: [], incompleteSessionIds: [], duplicateIds: [], days: [], acute: null, chronic: null, ratio: null, sourceIds: [] }
  if (!athleteId || !startDay) return base
  const owned = sessions.filter(s => s.athleteId === athleteId && s.day >= startDay && s.day <= endDay)
  const byId = new Map<string, SavedSessionLoad>()
  const conflicting = new Set<string>()
  for (const session of owned) {
    const prior = byId.get(session.id)
    if (prior && (prior.day !== session.day || loadDayFingerprint([prior], athleteId, prior.day) !== loadDayFingerprint([session], athleteId, session.day))) conflicting.add(session.id)
    else if (!prior) byId.set(session.id, session)
  }
  const unique = [...byId.values()]
  const days: LoadTrend['days'] = []
  const incomplete = new Set<string>()
  for (let i = 0; i < LOAD_WINDOW_DAYS; i++) {
    const day = shiftLoadDay(startDay, i)!
    const rows = unique.filter(s => s.day === day)
    const fingerprint = loadDayFingerprint(sessions, athleteId, day)
    const confirmed = confirmations.some(c => c.athleteId === athleteId && c.day === day && c.fingerprint === fingerprint)
    for (const row of rows) if (!row.id || !row.sourceIds.length || savedSessionAu(row) === null || conflicting.has(row.id)) incomplete.add(row.id)
    const complete = confirmed && !owned.some(row => row.day === day && conflicting.has(row.id)) && rows.every(row => !incomplete.has(row.id))
    days.push({ day, au: complete ? rows.reduce((sum, row) => sum + savedSessionAu(row)!, 0) : null, sessionCount: rows.length, confirmed })
  }
  const result: LoadTrend = { ...base, status: 'INSUFFICIENT', days, knownDays: days.filter(d => d.au !== null).length,
    missingDays: days.filter(d => d.au === null).map(d => d.day), incompleteSessionIds: [...incomplete], duplicateIds: [...conflicting],
    sourceIds: [...new Set(unique.flatMap(s => s.sourceIds))], }
  if (result.knownDays !== LOAD_WINDOW_DAYS) return result
  const values = days.map(day => day.au!)
  const acute = calculateEwmaSeries(values, 7)!.at(-1)!
  const chronic = calculateEwmaSeries(values, 28)!.at(-1)!
  return { ...result, status: chronic === 0 ? 'ZERO_BASELINE' : 'AVAILABLE', acute, chronic, ratio: chronic === 0 ? null : acute / chronic }
}

export function formatLoadTrend(trend: LoadTrend): string {
  if (trend.status === 'INVALID') return '负荷变化提示：日期无效，暂不能计算。'
  if (trend.status === 'INSUFFICIENT') return `负荷变化提示：资料不足，最近 28 天有 ${trend.knownDays} 天记录完整。${trend.incompleteSessionIds.length ? `其中 ${trend.incompleteSessionIds.length} 节训练的整课评分、时长或来源仍需核对。` : '请先核对每天全部训练；空白日期不会自动当作休息日。'}`
  if (trend.status === 'ZERO_BASELINE') return '负荷变化提示：已确认的 28 天均无训练负荷，长期均值为 0，暂不计算比值。'
  return `负荷变化提示：短期 EWMA ${trend.acute!.toFixed(1)} AU，长期 EWMA ${trend.chronic!.toFixed(1)} AU，比值 ${trend.ratio!.toFixed(2)}。仅描述已记录负荷的相对变化，不用于医疗判断、恢复结论或自动安排加量。`
}
