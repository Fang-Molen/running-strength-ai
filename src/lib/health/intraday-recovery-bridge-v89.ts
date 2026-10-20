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
  const offset = target?.offsetMin ?? -new Date(now).getTimezoneOffset()
  for (const d of Object.values(days)) {
    const knownAt = d.fetchedAt
    const push = (metric: U10Sample['metric'], rows: [number, number][] | undefined) => { for (const [t, v] of rows ?? []) samples.push({ athleteId, metric, value: v, measuredAt: new Date(t).toISOString(), knownAt: new Date(Math.max(t, Date.parse(knownAt) || t)).toISOString(), sourceId: SOURCE, protocol: metric, statistic: 'INSTANT', quality: 'CONFIRMED', context: context(t, d) }) }
    push('HEART_RATE', d.hr); push('BODY_BATTERY', d.bb); push('STRESS', d.st)
    if (d.sleep) sleepEvents.push({ athleteId, eventId: `garmin-sleep:${d.day}`, startAt: new Date(d.sleep[0]).toISOString(), endAt: new Date(d.sleep[1]).toISOString(), knownAt: new Date(Math.max(d.sleep[1], Date.parse(knownAt) || d.sleep[1])).toISOString(), sourceId: SOURCE, kind: 'MAIN', evidence: 'DEVICE_SLEEP' })
    d.training.forEach((x, i) => trainingEvents.push({ athleteId, eventId: `garmin-act:${d.day}:${i}:${x.start}`, startAt: new Date(x.start).toISOString(), endAt: new Date(x.end).toISOString(), sourceId: SOURCE, kind: /跑|run/i.test(x.label) ? 'RUN' : /力量|strength|weight/i.test(x.label) ? 'STRENGTH' : 'OTHER' }))
  }
  // 同一次主睡眠会出现在相邻两天的记录里：按事件 id 去重。
  const uniq = <T extends { eventId: string }>(xs: T[]) => [...new Map(xs.map(x => [x.eventId, x])).values()]
  const sleepDedup = [...new Map(sleepEvents.map(e => [`${e.startAt}|${e.endAt}`, e])).values()]
  return { athleteId, day, utcOffsetMinutes: Math.round(offset), now, samples, sleepEvents: sleepDedup, trainingEvents: uniq(trainingEvents), minReferenceDays }
}
export function intradayRecoveryFromStore(days: Record<string, IntradayDay>, athleteId: string, day: string, now: string): View | null {
  if (!days[day]) return null
  try { return buildIntradayRecovery(intradayInput(days, athleteId, day, now)) } catch { return null }
}
