/** v89：把 v88.3 手表日内存储（fk-garmin-intraday-v1，唯一数据源）接到 U10 日内恢复投影（唯一算法）。
 *  只做格式转换和时段标注：样本落在设备睡眠时段=SLEEP，落在设备记录的训练时段=TRAINING，其余=AWAKE。
 *  不造样本、不补时间；个人参考区间来自同一来源近 14 天同时段四分位（≥7 个可比日才出）。不是训练许可。 */
import { buildIntradayRecovery, type Sample as U10Sample, type Sleep, type Training, type View } from './intraday-recovery-u10'
import type { IntradayDay } from './garmin-intraday'
const SOURCE = 'garmin:intraday'
function context(t: number, d: IntradayDay): U10Sample['context'] {
  if (d.sleep && t >= d.sleep[0] && t <= d.sleep[1]) return 'SLEEP'
  if (d.training.some(x => t >= x.start && t <= x.end)) return 'TRAINING'
  return 'AWAKE'
}
export function intradayInput(days: Record<string, IntradayDay>, athleteId: string, day: string, now: string, minReferenceDays = 7) {
  const samples: U10Sample[] = [], sleepEvents: Sleep[] = [], trainingEvents: Training[] = []
  const target = days[day]
  const offset = target?.offsetMin ?? -new Date(day + 'T12:00:00').getTimezoneOffset()
  for (const d of Object.values(days)) {
    const knownAt = d.fetchedAt
    const push = (metric: U10Sample['metric'], rows: [number, number][] | undefined) => { for (const [t, v] of rows ?? []) samples.push({ athleteId, metric, value: v, measuredAt: new Date(t).toISOString(), knownAt: new Date(Math.max(t, Date.parse(knownAt) || t)).toISOString(), sourceId: SOURCE, protocol: metric, statistic: 'INSTANT', quality: 'CONFIRMED', context: context(t, d) }) }
    push('HEART_RATE', d.hr); push('BODY_BATTERY', d.bb); push('STRESS', d.st)
    if (d.sleep) sleepEvents.push({ athleteId, eventId: `garmin-sleep:${d.day}`, startAt: new Date(d.sleep[0]).toISOString(), endAt: new Date(d.sleep[1]).toISOString(), knownAt: new Date(Math.max(d.sleep[1], Date.parse(knownAt) || d.sleep[1])).toISOString(), sourceId: SOURCE, kind: 'MAIN', evidence: 'DEVICE_SLEEP' })
    d.training.forEach(x => trainingEvents.push({ athleteId, eventId: x.id ?? `garmin-act:${x.start}:${x.end}:${x.label}`, startAt: new Date(x.start).toISOString(), endAt: new Date(x.end).toISOString(), knownAt, label: x.label, endEstimated: true, sourceId: SOURCE, kind: /跑|run/i.test(x.label) ? 'RUN' : /力量|strength|weight/i.test(x.label) ? 'STRENGTH' : 'OTHER' }))
  }
  // 同一次主睡眠会出现在相邻两天的记录里：按事件 id 去重。
  const known = <T extends { knownAt?: string }>(xs: T[]) => xs.filter(x => x.knownAt && Date.parse(x.knownAt) <= Date.parse(now)).sort((a,b) => Date.parse(a.knownAt!) - Date.parse(b.knownAt!))
  const uniq = <T>(xs: T[], key: (x:T)=>string) => [...new Map(xs.map(x => [key(x), x])).values()]
  const sleepDedup = uniq(known(sleepEvents), e => `${e.startAt}|${e.endAt}`)
  return { athleteId, day, utcOffsetMinutes: Math.round(offset), now, samples, sleepEvents: sleepDedup, trainingEvents: uniq(known(trainingEvents), e => e.eventId), minReferenceDays }
}
export function intradayRecoveryFromStore(days: Record<string, IntradayDay>, athleteId: string, day: string, now: string): View | null {
  try {
    const view = buildIntradayRecovery(intradayInput(days, athleteId, day, now))
    return days[day] || view.events.length ? view : null
  } catch { return null }
}

/** v89.1 方坤估算·个人常态曲线：用这一天之前（≤28 天）同一来源的手表样本，按当地钟点算“每天该小时的中位数”，
 *  再取各天的中位数与四分位。某小时可比天数 <minDays 就不出该小时。只描述你自己的历史常态，不是预测、不是训练许可。 */
export type TypicalHour = { hour: number; median: number; p25: number; p75: number; days: number }
export function typicalDay(days: Record<string, IntradayDay>, day: string, kind: 'hr' | 'bb' | 'st', minDays = 7, window = 28): { hours: TypicalHour[]; historyDays: number } {
  const start = new Date(Date.parse(day + 'T12:00:00Z') - window * 864e5).toISOString().slice(0, 10)
  const prior = Object.values(days).filter(d => d.day < day && d.day >= start)
  const byHour = new Map<number, number[]>()
  let historyDays = 0
  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y), n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2 }
  const q = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x - y), k = (a.length - 1) * p, i = Math.floor(k), j = Math.ceil(k); return a[i] + (a[j] - a[i]) * (k - i) }
  for (const d of prior) {
    const rows = (kind === 'hr' ? d.hr : kind === 'bb' ? d.bb : d.st) ?? []
    if (!rows.length) continue
    historyDays++
    const offset = d.offsetMin ?? -new Date(rows[0][0]).getTimezoneOffset(), base = Date.parse(d.day + 'T00:00:00Z') - offset * 60e3
    const hours = new Map<number, number[]>()
    for (const [t, v] of rows) { const h = Math.floor((t - base) / 3600e3); if (h >= 0 && h < 24) hours.set(h, [...(hours.get(h) ?? []), v]) }
    for (const [h, vs] of hours) byHour.set(h, [...(byHour.get(h) ?? []), med(vs)])
  }
  const hours = [...byHour].filter(([, vs]) => vs.length >= minDays).sort((a, b) => a[0] - b[0]).map(([hour, vs]) => ({ hour, median: med(vs), p25: q(vs, .25), p75: q(vs, .75), days: vs.length }))
  return { hours, historyDays }
}
