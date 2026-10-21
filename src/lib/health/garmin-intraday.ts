/**
 * v88.3 佳明日内样本（只读）：全天心率 + 身体电量。
 * 接口与字段依据 python-garminconnect（api/base.py、api/health.py）与 garmin-grafana（garmin_fetch.py）：
 *  - 心率：GET wellness-service/wellness/dailyHeartRate/{displayName}?date=YYYY-MM-DD → heartRateValues [[ms, bpm|null]]，restingHeartRate
 *  - 身体电量：GET wellness-service/wellness/dailyStress/{date} → bodyBatteryValuesArray [[ms, status, level, version]]（level 在下标 2；有描述表时按描述表）
 *  - 睡眠时段：dailySleepData 的 dailySleepDTO.sleepStartTimestampGMT / sleepEndTimestampGMT（毫秒）
 * 日期归属与现有健康单一来源规则一致：响应 calendarDate 必须等于请求日，否则整天不收。
 * 身体电量只是设备读数，不是训练许可。
 */
export type Sample = [number, number] // [UTC ms, value]
export type Span = [number, number]   // [UTC ms start, end]
export type IntradayDay = {
  schemaVersion: 1; day: string; source: 'garmin'; fetchedAt: string; offsetMin: number | null
  eventTimingVersion?: 2
  /** Failed metric requests must not erase previously cached samples on event-only syncs. */
  failedReadings?: ('hr' | 'bb' | 'st')[]
  hr: Sample[]; bb: Sample[]; /** v89：压力（dailyStress.stressValuesArray，负值=无读数；字段名待核） */ st?: Sample[]; restingHr: number | null; sleep: Span | null; training: { start: number; end: number; label: string; id?: string }[]
}
type Reply = { status: number; body: any }
const MAX_POINTS = 720
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

function claimedDay(body: any): string | null { const d = body?.calendarDate; return typeof d === 'string' ? d.slice(0, 10) : null }
function offsetOf(body: any): number | null {
  const g = body?.startTimestampGMT, l = body?.startTimestampLocal
  if (typeof g !== 'string' || typeof l !== 'string') return null
  const t = (s: string) => Date.parse(s.replace(' ', 'T').replace(/\.\d+$/, '') + 'Z'), m = (t(l) - t(g)) / 60000
  return Number.isFinite(m) && Math.abs(m) <= 14 * 60 ? Math.round(m) : null
}
function indexFrom(list: unknown, want: RegExp, fallback: number): number {
  if (!Array.isArray(list)) return fallback
  for (const d of list) {
    if (!d || typeof d !== 'object') continue
    const o = d as Record<string, unknown>
    const key = Object.entries(o).find(([k, v]) => /key/i.test(k) && typeof v === 'string')?.[1] as string | undefined
    const idx = Object.entries(o).find(([k, v]) => /index/i.test(k) && finite(v))?.[1] as number | undefined
    if (key && want.test(key) && idx !== undefined) return idx
  }
  return fallback
}
/** 去重、排序、按时间桶抽稀（取桶内最后一个），保持有界。 */
export function tidy(rows: Sample[], max = MAX_POINTS): Sample[] {
  const m = new Map<number, number>(); for (const [t, v] of rows) m.set(t, v)
  const s = [...m.entries()].sort((a, b) => a[0] - b[0]) as Sample[]
  if (s.length <= max) return s
  const span = s[s.length - 1][0] - s[0][0], bucket = span / Math.max(1, max - 1), out: Sample[] = []
  for (const p of s) { const b = Math.floor((p[0] - s[0][0]) / bucket); if (out.length && Math.floor((out[out.length - 1][0] - s[0][0]) / bucket) === b) out[out.length - 1] = p; else out.push(p) }
  return out
}
function usable(day: string, r: Reply | undefined, label: string, failures: string[]): boolean {
  if (!r || r.status === 204) return false
  const b = r.body
  if (r.status !== 200 || !b || typeof b !== 'object' || Array.isArray(b)) { failures.push(`${day} ${label} HTTP ${r?.status}`); return false }
  if (!Object.keys(b).length) return false
  if (claimedDay(b) !== day) { failures.push(`${day} ${label} 返回日期缺失或不一致`); return false }
  return true
}
export function parseHeartRate(day: string, r: Reply | undefined, failures: string[] = []) {
  if (!usable(day, r, '全天心率', failures)) return null
  const b = r!.body, vi = indexFrom(b.heartRateValueDescriptors, /heart/i, 1), ti = indexFrom(b.heartRateValueDescriptors, /time/i, 0)
  const rows: Sample[] = Array.isArray(b.heartRateValues) ? b.heartRateValues.flatMap((e: unknown) => Array.isArray(e) && finite(e[ti]) && finite(e[vi]) && e[vi] >= 25 && e[vi] <= 240 ? [[e[ti], Math.round(e[vi])] as Sample] : []) : []
  const rest = finite(b.restingHeartRate) && b.restingHeartRate >= 25 && b.restingHeartRate <= 150 ? Math.round(b.restingHeartRate) : null
  return { hr: tidy(rows), restingHr: rest, offsetMin: offsetOf(b) }
}
export function parseBodyBattery(day: string, r: Reply | undefined, failures: string[] = []) {
  if (!usable(day, r, '身体电量', failures)) return null
  const b = r!.body, desc = b.bodyBatteryValueDescriptorsDTOList ?? b.bodyBatteryValueDescriptorDTOList
  const rows: Sample[] = Array.isArray(b.bodyBatteryValuesArray) ? b.bodyBatteryValuesArray.flatMap((e: unknown) => {
    if (!Array.isArray(e)) return []
    const li = indexFrom(desc, /level/i, e.length >= 3 ? 2 : 1), v = e[li]
    return finite(e[0]) && finite(v) && v >= 0 && v <= 100 ? [[e[0], Math.round(v)] as Sample] : []
  }) : []
  // v89：同一响应里的压力样本 [[ms, level]]；-1/-2 等负值表示无读数/活动中，不收。字段名依据 python-garminconnect，待核真实账号。
  const sd = b.stressValueDescriptorsDTOList, si = indexFrom(sd, /stress/i, 1), sti = indexFrom(sd, /time/i, 0)
  const st: Sample[] = Array.isArray(b.stressValuesArray) ? b.stressValuesArray.flatMap((e: unknown) => Array.isArray(e) && finite(e[sti]) && finite(e[si]) && e[si] >= 0 && e[si] <= 100 ? [[e[sti], Math.round(e[si])] as Sample] : []) : []
  return { bb: tidy(rows), st: tidy(st), offsetMin: offsetOf(b) }
}
export function sleepSpan(sleepBody: any): Span | null {
  const d = sleepBody?.dailySleepDTO, s = d?.sleepStartTimestampGMT, e = d?.sleepEndTimestampGMT
  return finite(s) && finite(e) && e > s && e - s < 20 * 3600e3 ? [s, e] : null
}
export function buildIntradayDay(input: { day: string; now: string; hr: Reply | undefined; stress: Reply | undefined; sleep?: Reply; activities?: { key?: string; startIso: string | null; durationSec: number | null; sportLabel: string }[] }): { day: IntradayDay | null; failures: string[] } {
  const failures: string[] = []
  const h = parseHeartRate(input.day, input.hr, failures), bb = parseBodyBattery(input.day, input.stress, failures)
  const sl = input.sleep?.status === 200 && input.sleep.body?.dailySleepDTO?.calendarDate === input.day ? sleepSpan(input.sleep.body) : null
  const offsetMin = h?.offsetMin ?? bb?.offsetMin ?? null
  // Events belong to the calendar window, not the first/last heart-rate sample.
  const lo = offsetMin == null ? new Date(input.day + 'T00:00:00').getTime() : Date.parse(input.day + 'T00:00:00Z') - offsetMin * 60000
  const next = new Date(lo); next.setDate(next.getDate() + 1)
  const hi = offsetMin == null ? next.getTime() : lo + 864e5
  const training = (input.activities ?? []).flatMap(a => {
    const s = a.startIso ? Date.parse(a.startIso) : NaN, e = s + (a.durationSec ?? 0) * 1000
    return Number.isFinite(s) && Number.isFinite(e) && e > s && e <= Date.parse(input.now) && e > lo && s < hi ? [{ start: s, end: e, label: a.sportLabel, ...(a.key ? { id: a.key } : {}) }] : []
  })
  if (!h?.hr.length && !bb?.bb.length && !bb?.st.length && h?.restingHr == null && !sl && !training.length) return { day: null, failures }
  const failed = (r: Reply | undefined, parsed: unknown) => !r || ![200,204].includes(r.status) || r.status === 200 && !parsed && !!r.body && Object.keys(r.body).length > 0
  const failedReadings: ('hr'|'bb'|'st')[] = [...(failed(input.hr,h) ? ['hr' as const] : []), ...(failed(input.stress,bb) ? ['bb' as const,'st' as const] : [])]
  return { day: { schemaVersion: 1, eventTimingVersion: 2, failedReadings, day: input.day, source: 'garmin', fetchedAt: input.now, offsetMin,
    hr: h?.hr ?? [], bb: bb?.bb ?? [], st: bb?.st ?? [], restingHr: h?.restingHr ?? null, sleep: sl, training }, failures }
}

export type IntradaySummary = { day: string; hr: { min: number; max: number; latest: Sample } | null; restingHr: number | null; bb: { min: number; max: number; latest: Sample } | null; st?: { min: number; max: number; latest: Sample } | null; authorizedToTrain: false }
export function summarizeDay(d: IntradayDay | null | undefined): IntradaySummary | null {
  if (!d) return null
  const st = (s: Sample[]) => s.length ? { min: Math.min(...s.map(p => p[1])), max: Math.max(...s.map(p => p[1])), latest: s[s.length - 1] } : null
  return { day: d.day, hr: st(d.hr), restingHr: d.restingHr, bb: st(d.bb), st: st(d.st ?? []), authorizedToTrain: false }
}
/** 设备当地时间 HH:MM（有偏移用偏移，否则用浏览器时区）。 */
export function clock(ms: number, offsetMin: number | null): string {
  const d = offsetMin == null ? new Date(ms) : new Date(ms + offsetMin * 60000)
  const h = offsetMin == null ? d.getHours() : d.getUTCHours(), m = offsetMin == null ? d.getMinutes() : d.getUTCMinutes()
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
/** 距设备当地当天 0 点的分钟数（图表横轴）。 */
export function minuteOfDay(ms: number, day: string, offsetMin: number | null): number {
  const off = offsetMin ?? -new Date(ms).getTimezoneOffset()
  return (ms + off * 60000 - Date.parse(day + 'T00:00:00Z')) / 60000
}
/** 本地教练上下文：仅作背景，不是训练许可。 */
export function intradayContextLine(s: IntradaySummary | null): string | null {
  if (!s || (!s.bb && s.restingHr == null && !s.hr)) return null
  const parts: string[] = []
  if (s.bb) parts.push(`身体电量 最低${s.bb.min} 最高${s.bb.max} 最新${s.bb.latest[1]}`)
  if (s.restingHr != null) parts.push(`静息心率 ${s.restingHr}`)
  else if (s.hr) parts.push(`全天心率 ${s.hr.min}–${s.hr.max}`)
  return `${s.day} 手表日内（佳明）：${parts.join('，')}。仅作背景，不是训练许可。`
}
