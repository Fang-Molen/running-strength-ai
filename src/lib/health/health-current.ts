import type { HealthMetricView, HealthPoint } from './snapshot'
import type { IntradayDay, Sample } from './garmin-intraday'

export type CurrentHealthReading = {
  value: number | null
  measuredAt: string | null
  syncedAt: string | null
  sourceId: string | null
  statistic: string
  basis: 'INTRADAY' | 'DAILY_RECENT' | 'DAILY_SUMMARY' | 'CONFLICT' | 'UNAVAILABLE'
}
const time = (s: string | null | undefined) => typeof s === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(s) ? Date.parse(s) : NaN
const recent = (p: HealthPoint) => /同步时最近值|MOST_RECENT|LATEST|INSTANT/.test(p.statistic) && !/最高|MAX/.test(p.statistic)
const empty = (conflict = false): CurrentHealthReading => ({ value: null, measuredAt: null, syncedAt: null, sourceId: null,
  statistic: conflict ? '来源待核对' : '暂无当日读数', basis: conflict ? 'CONFLICT' : 'UNAVAILABLE' })

/** Pure read model shared by the health tile, trend heading and outgoing coach facts.
 * A daily most-recent snapshot can be newer than an incomplete intraday response.
 * Its receipt time never becomes a fabricated sample/measurement timestamp. */
export function resolveBodyBattery(view: HealthMetricView | undefined, data: IntradayDay | null | undefined,
  day: string, asOf = new Date().toISOString()): CurrentHealthReading {
  const cutoff = time(asOf)
  if (!Number.isFinite(cutoff)) return empty()
  const rows = [ ...(view?.series ?? []), ...(view?.candidates ?? []), ...(view?.current ? [view.current] : []) ]
    .filter(p => p.day === day && (!view?.selectedSource || p.stream === view.selectedSource) &&
      Number.isFinite(p.value) && p.value >= 0 && p.value <= 100 && time(p.updatedAt) <= cutoff &&
      (p.measuredAt == null || time(p.measuredAt) <= cutoff && time(p.measuredAt) <= time(p.updatedAt)))
  // Resolve only evidence already known at the request cutoff; future conflicts cannot hide older facts.
  const revisions = new Map<string, HealthPoint>()
  for (const row of rows.sort((a, b) => time(a.updatedAt) - time(b.updatedAt))) revisions.set(row.id, row)
  const known = [...revisions.values()]
  if (new Set(known.map(p => JSON.stringify([p.stream, p.statistic, p.method, p.value]))).size > 1) return empty(true)
  const p = known.at(-1)
  const sourceId = p?.sourceId ?? p?.stream.split('|')[0] ?? null
  const fromDaily = (): CurrentHealthReading => p ? {value: p.value, measuredAt: p.measuredAt,
    syncedAt: p.updatedAt, sourceId, statistic: p.statistic, basis: recent(p) ? 'DAILY_RECENT' : 'DAILY_SUMMARY'} : empty()
  if (view?.selectedSource && (!p || !recent(p))) return fromDaily()
  const samples = data?.day === day && time(data.fetchedAt) <= cutoff ? data.bb.filter(([t, v]) =>
    Number.isFinite(t) && Number.isFinite(v) && v >= 0 && v <= 100 && t <= cutoff &&
    t <= time(data.fetchedAt) && (() => { const date = new Date(t); return data.offsetMin == null
      ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` === day
      : new Date(t+data.offsetMin*60000).toISOString().slice(0,10) === day })()) : []
  const last: Sample | undefined = samples.reduce<Sample | undefined>((best, point) => !best || point[0] > best[0] ? point : best, undefined)
  if (!last || !data) return fromDaily()
  const differentSource = sourceId && (data.sourceId ? sourceId !== data.sourceId : !sourceId.startsWith('garmin:'))
  if (differentSource) return view?.selectedSource ? fromDaily() : empty(true)
  const received = data.readingFetchedAt?.bb ?? data.fetchedAt
  if (p && recent(p)) {
    // Compare actual timestamps when provided; otherwise only the source snapshot's receipt.
    if (p.measuredAt != null ? time(p.measuredAt) > last[0] : (time(p.updatedAt) >= time(received) && time(p.updatedAt) > last[0])) return fromDaily()
  }
  return { value: last[1], measuredAt: new Date(last[0]).toISOString(), syncedAt: received,
    sourceId: data.sourceId ?? 'garmin:intraday', statistic: '设备逐时读数', basis: 'INTRADAY' }
}
