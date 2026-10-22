/** Pure mappings of official Polar AccessLink and Suunto Cloud schemas.
 * No rounding, sample-derived capabilities, local-account IDs, or null -> zero conversion.
 * Primary references and schema provenance: docs/integrations/WATCH-CLOUD-SETUP.md.
 */
import type { DeviceActivity, DeviceHealthRow } from '../ui/device-parse'
import type { CloudProvider } from './cloud-types'

export type ParsedCloudData = { activities: DeviceActivity[]; health: DeviceHealthRow[]; issues: string[] }
const empty = (): ParsedCloudData => ({ activities: [], health: [], issues: [] })
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const text = (v: unknown, max = 128) => typeof v === 'string' && v.length > 0 && v.length <= max ? v : null
const number = (v: unknown, min = 0, max = 1e9): number | null => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(v) ? v : null
function day(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const parsed = new Date(v + 'T00:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v ? v : null
}
/** A timezone must be in the source; only endpoints whose schema explicitly says UTC may set utcDefault. */
function iso(v: unknown, utcDefault = false): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/.test(v) || !day(v.slice(0, 10))) return null
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(v)) { if (!utcDefault) return null; v += 'Z' }
  const ms = Date.parse(v as string)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}
function polarStart(r: Record<string, unknown>): string | null {
  if (typeof r.start_time !== 'string') return null
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(r.start_time)) return iso(r.start_time)
  const offset = number(r.start_time_utc_offset, -14 * 60, 14 * 60)
  if (offset === null || !Number.isInteger(offset)) return null
  const absolute = Math.abs(offset)
  return iso(`${r.start_time}${offset < 0 ? '-' : '+'}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`)
}
function duration(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(v)
  if (!m || !m.slice(1).some(x => x !== undefined)) return null
  return number(Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0), 0, 7 * 86400)
}
function activity(provider: 'polar' | 'suunto', account: string, recordId: string, at: string, start: string | null): DeviceActivity {
  const identity = `${provider}:${account}:${recordId}`
  return { key: identity, sourceIdentity: identity, source: provider === 'polar' ? 'Polar 官方同步' : 'Suunto 官方同步',
    provenance: { provider: provider === 'polar' ? 'POLAR' : 'SUUNTO', accountRef: account, recordId, measuredAt: start, receivedAt: at },
    sport: 'UNKNOWN', sportLabel: '未知项目', startIso: start, durationSec: null, distanceM: null, avgHr: null, maxHr: null, calories: null, avgCadence: null, avgPower: null, verticalOscMm: null, groundContactMs: null, sets: [] }
}
function rows(v: unknown, result: ParsedCloudData, label: string): unknown[] {
  if (!Array.isArray(v)) { result.issues.push(`${label}返回格式无法核实，未作为空数据处理。`); return [] }
  if (v.length > 2000) result.issues.push(`${label}数量超出本次读取上限，保留前2000条。`)
  return v.slice(0, 2000)
}
function pushHealth(result: ParsedCloudData, provider: CloudProvider, account: string, metric: DeviceHealthRow['metric'], date: string, value: number, at: string, channel: string, record: string, statistic: string, measuredAt: string | null, rawValue = value, rawUnit?: string, hrvMethod?: DeviceHealthRow['hrvMethod']) {
  const sourceId = `${provider}:${account}:${channel}`, key = `${sourceId}:${metric}:${record}`
  if (sourceId.length > 120 || key.length > 160) { result.issues.push('来源标识过长，该健康记录未写入预览。'); return }
  result.health.push({ key, source: `${provider === 'polar' ? 'Polar' : 'Suunto'} · ${statistic}`, metric, day: date, value,
    ...(hrvMethod ? { hrvMethod } : {}), observation: { key, sourceId, statistic, syncedAt: at, measuredAt, rawValue, ...(rawUnit ? { rawUnit } : {}) } })
}

export function parsePolarExercises(value: unknown, account: string, at: string): ParsedCloudData {
  const result = empty(), seen = new Set<string>()
  for (const item of rows(value, result, 'Polar 训练')) {
    const r = object(item), recordId = id(r.id)
    if (!recordId) { result.issues.push('Polar 训练缺少可核实的原始ID，已跳过。'); continue }
    if (seen.has(recordId)) continue
    seen.add(recordId)
    const start = polarStart(r), a = activity('polar', account, recordId, at, start)
    if (r.start_time && !start) result.issues.push('部分 Polar 训练开始时间缺少可核实的时区，保留时间未知。')
    const sport = text(r.sport, 80), detailed = text(r.detailed_sport_info, 80)
    if (sport === 'RUNNING') { a.sport = 'RUNNING'; a.sportLabel = '跑步' }
    else if (sport === 'STRENGTH_TRAINING' || detailed === 'STRENGTH_TRAINING') { a.sport = 'STRENGTH'; a.sportLabel = '力量' }
    else if (sport === 'MULTISPORT') { a.sport = 'MIXED'; a.sportLabel = '多项目运动' }
    else a.sportLabel = detailed ?? sport ?? '未知项目'
    a.durationSec = duration(r.duration); a.distanceM = number(r.distance, 0, 2e6); a.calories = number(r.calories, 0, 100000)
    const hr = object(r.heart_rate)
    a.avgHr = number(hr.average, 25, 250); a.maxHr = number(hr.maximum, 25, 250)
    result.activities.push(a)
  }
  return result
}

export function parsePolarDaily(value: unknown, account: string, at: string): ParsedCloudData {
  const result = empty()
  for (const item of rows(value, result, 'Polar 每日活动')) {
    const r = object(item), start = iso(r.start_time, true), value = number(r.steps, 0, 100000)
    if (start && value !== null && Number.isInteger(value)) pushHealth(result, 'polar', account, 'STEPS', start.slice(0, 10), value, at, 'daily', start.slice(0, 10), '每日步数（UTC）', start, value, 'steps')
  }
  return result
}

export function parsePolarNights(value: unknown, account: string, at: string): ParsedCloudData {
  const result = empty()
  for (const item of rows(object(value).nights, result, 'Polar 睡眠')) {
    const r = object(item), date = day(r.date), parts = ['light_sleep', 'deep_sleep', 'rem_sleep', 'unrecognized_sleep_stage'].map(k => number(r[k], 0, 86400))
    if (!date || parts.some(x => x === null)) continue
    const seconds = (parts as number[]).reduce((sum, n) => sum + n, 0)
    if (seconds >= 1800 && seconds <= 16 * 3600) pushHealth(result, 'polar', account, 'SLEEP', date, seconds / 3600, at, 'sleep-stages', date, '睡眠阶段合计（不含清醒）', iso(r.sleep_start_time), seconds, 'seconds')
  }
  return result
}

export function parsePolarRecharge(value: unknown, account: string, at: string): ParsedCloudData {
  const result = empty()
  for (const item of rows(object(value).recharges, result, 'Polar Nightly Recharge')) {
    const r = object(item), date = day(r.date)
    if (!date) continue
    const hrv = number(r.heart_rate_variability_avg, 1, 300), resp = number(r.breathing_rate_avg, 4, 40)
    if (hrv !== null) pushHealth(result, 'polar', account, 'HRV', date, hrv, at, 'nightly-recharge', date, '入睡30分钟后4小时 RMSSD均值', null, hrv, 'ms', 'RMSSD')
    if (resp !== null) pushHealth(result, 'polar', account, 'RESP', date, resp, at, 'nightly-recharge', date, '入睡30分钟后4小时平均呼吸率', null, resp, 'breaths/min')
  }
  return result
}

// Suunto's published Activities.pdf, Suunto App ID column (not Garmin FIT IDs).
const SUUNTO_RUNNING = new Set([1, 22, 53, 59, 60, 103, 115])
const SUUNTO_STRENGTH = new Set([23, 63, 104])
const SUUNTO_MIXED = new Set([68, 74, 92, 93, 94, 111])
const SUUNTO_LABELS: Record<number, string> = { 0: '步行', 2: '骑行', 10: '山地骑行', 11: '徒步', 21: '游泳', 22: '越野跑', 23: '健身房力量', 51: '瑜伽/普拉提', 53: '跑步机', 54: 'CrossFit', 59: '田径', 60: '定向跑', 63: '壶铃', 74: '铁人三项', 103: '操场跑', 104: '徒手力量', 115: '垂直跑' }
export function parseSuuntoWorkouts(value: unknown, account: string, at: string): ParsedCloudData {
  const result = empty(), body = object(value), seen = new Set<string>()
  if (body.error != null) { result.issues.push('Suunto 训练接口报告错误，未将错误内容导入。'); return result }
  for (const item of rows(body.payload, result, 'Suunto 训练')) {
    const r = object(item), recordId = id(r.workoutKey) ?? id(r.key)
    if (!recordId) { result.issues.push('Suunto 训练缺少原始workoutKey，已跳过。'); continue }
    if (seen.has(recordId)) continue
    seen.add(recordId)
    const epoch = number(r.startTime, 1, 8640000000000000), start = epoch !== null ? new Date(epoch).toISOString() : null
    const a = activity('suunto', account, recordId, at, start), code = number(r.activityId, 0, 10000)
    if (code !== null && SUUNTO_RUNNING.has(code)) a.sport = 'RUNNING'
    else if (code !== null && SUUNTO_STRENGTH.has(code)) a.sport = 'STRENGTH'
    else if (code !== null && SUUNTO_MIXED.has(code)) a.sport = 'MIXED'
    a.sportLabel = code === null ? '未知项目' : SUUNTO_LABELS[code] ?? (a.sport === 'RUNNING' ? '跑步' : a.sport === 'MIXED' ? '多项目运动' : `Suunto 项目 ${code}`)
    a.durationSec = number(r.totalTime, 0, 7 * 86400); a.distanceM = number(r.totalDistance, 0, 2e6); a.calories = number(r.energyConsumption, 0, 100000)
    const hr = object(r.hrdata)
    a.avgHr = number(hr.workoutAvgHR, 25, 250); a.maxHr = number(hr.workoutMaxHR, 25, 250)
    // Cadence's step-pair protocol varies by sport and response version; it is not silently labelled steps/minute.
    result.activities.push(a)
  }
  return result
}

export function parseSuuntoSteps(value: unknown, account: string, at: string): ParsedCloudData {
  const result = empty(), seen = new Set<string>()
  for (const item of rows(value, result, 'Suunto 每日步数')) {
    const r = object(item)
    if (r.Name !== 'stepcount' || r.Aggregation !== 'sum') continue
    for (const source of rows(r.Sources, result, 'Suunto 步数来源')) {
      const s = object(source), sourceName = id(s.Name)
      if (!sourceName) { result.issues.push('Suunto 步数缺少设备来源，已跳过。'); continue }
      for (const sample of rows(s.Samples, result, 'Suunto 步数样本')) {
        const row = object(sample), measuredAt = iso(row.TimeISO8601, true)
        const raw = typeof row.Value === 'string' && /^\d+(?:\.\d+)?$/.test(row.Value) ? Number(row.Value) : row.Value
        const n = number(raw, 0, 100000)
        if (!measuredAt || n === null || !Number.isInteger(n)) continue
        const date = day(String(row.TimeISO8601).slice(0, 10))!, key = `${sourceName}:${date}`
        if (seen.has(key)) continue
        seen.add(key)
        pushHealth(result, 'suunto', account, 'STEPS', date, n, at, `daily:${sourceName}`, date, '设备每日步数', measuredAt, n, 'steps')
      }
    }
  }
  return result
}

export function parseSuuntoSleep(value: unknown, account: string, at: string): ParsedCloudData {
  const result = empty(), seen = new Set<string>()
  for (const item of rows(value, result, 'Suunto 睡眠')) {
    const r = object(item), data = object(r.entryData), start = iso(data.BedtimeStart), end = iso(data.BedtimeEnd)
    if (!start || !end || Date.parse(end) <= Date.parse(start)) { result.issues.push('Suunto 睡眠段缺少完整时间边界，本次未导入。'); continue }
    if (typeof data.SleepId === 'number' && !Number.isSafeInteger(data.SleepId)) { result.issues.push('Suunto 睡眠ID超出安全整数范围，未猜测该记录的标识。'); continue }
    const suppliedId = typeof data.SleepId === 'number' && data.SleepId > 0 ? String(data.SleepId) : id(data.SleepId)
    const segment = suppliedId ?? `${start}/${end}`
    if (seen.has(segment)) continue
    seen.add(segment)
    const date = day(String(data.BedtimeEnd).slice(0, 10))!, seconds = number(data.Duration, 0, 16 * 3600), hrv = number(data.AvgHRV, 1, 300)
    const nap = data.IsNap === true ? '小睡段' : data.IsNap === false ? '睡眠段' : '睡眠段（类型未知）'
    if (seconds !== null && seconds >= 1800) pushHealth(result, 'suunto', account, 'SLEEP', date, seconds / 3600, at, 'sleep-segments', segment, `Suunto${nap}时长（部分算法含清醒）`, start, seconds, 'seconds')
    if (hrv !== null) pushHealth(result, 'suunto', account, 'HRV', date, hrv, at, 'sleep-segments', segment, `Suunto${nap}平均HRV（方法未提供）`, start, hrv, 'ms', 'UNSPECIFIED')
  }
  return result
}
