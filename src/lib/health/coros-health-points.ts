import { currentAthleteId } from '../core/events'
import { currentStore } from '../core/storage'
import { shortHash, validDay } from './observation'
import type { HealthPoint } from './snapshot'

/** Read-only bridge: COROS's own cache feeds the same UI/coach snapshot.
 * Receipt time is not measurement time; recovery percent is NOT Body Battery.
 * No cache copies are written into the manual-vitals or unified evidence journal. */
export function loadCorosHealthPoints(): { points: HealthPoint[]; unreadable: boolean } {
  const athlete = currentAthleteId(), points: HealthPoint[] = []
  let unreadable = false
  try {
    const raw = currentStore()?.getItem(`fk-coros-mcp-health-v1:${athlete}`)
    if (!raw) return { points, unreadable }
    const cache = JSON.parse(raw)
    if (!cache || (cache.athleteId && cache.athleteId !== athlete) || !Array.isArray(cache.days) || !Number.isFinite(Date.parse(cache.fetchedAt))) return { points, unreadable: true }
    const hasAccount = typeof cache.accountRef === 'string' && /^[\w-]{1,160}$/.test(cache.accountRef)
    const sourceId = `coros:${hasAccount ? cache.accountRef : 'legacy-' + shortHash(athlete)}${cache.sessionScope ? ':' + shortHash(cache.sessionScope) : ''}`
    const fields = [
      ['hrvMs', 'HRV', 1, 300, 1, '昨夜平均；算法未提供'],
      ['restingHr', 'RHR', 25, 200, 1, '日静息心率'],
      ['sleepMinutes', 'SLEEP', 0, 1440, 1 / 60, '夜间睡眠总时长'],
      ['steps', 'STEPS', 0, 250000, 1, '当日累计'],
      ['activeKcal', 'ACTIVE_KCAL', 0, 100000, 1, '活动热量'],
    ] as const
    for (const d of cache.days) {
      if (!d || !validDay(d.date)) { unreadable = true; continue }
      for (const [field, metric, min, max, scale, label] of fields) {
        const v = d[field]
        if (v == null) continue
        const received = cache.dayUpdatedAt?.[d.date]?.[field] ?? cache.fetchedAt
        if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max ||
          !Number.isFinite(Date.parse(received)) || Date.parse(received) > Date.parse(cache.fetchedAt)) { unreadable = true; continue }
        const statistic = label + (hasAccount ? '' : '；账号标识未提供'), method = metric === 'HRV' ? 'UNSPECIFIED' : ''
        points.push({ id: `${sourceId}:${field}:${d.date}`, metric, day: d.date,
          value: v * scale, source: '高驰账号同步', sourceId, stream: `${sourceId}|${statistic}|${method}`,
          statistic, method, updatedAt: received, measuredAt: null, legacy: false })
      }
    }
    return { points, unreadable }
  } catch { return { points: [], unreadable: true } }
}
