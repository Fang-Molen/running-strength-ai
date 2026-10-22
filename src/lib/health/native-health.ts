import type { DeviceActivity, DeviceHealthRow, DeviceParseResult } from '../ui/device-parse'
import { shortHash, validDay } from './observation'

/** The runtime is Capacitor's registered native plugin, never a custom window shim. */
export type NativeHealthProvider = 'apple_health' | 'health_connect'
export type NativeHealthStatus = {
  /** True also means that an installed provider can present its permission sheet. */
  available: boolean
  state: 'available' | 'needs_native_app' | 'provider_unavailable' | 'permissions_required'
  message: string
}
export type NativeHealthRange = { from: string; to: string }

interface FangkunHealthPlugin {
  checkAvailability(options: { provider: NativeHealthProvider }): Promise<unknown>
  requestReadPermissions(options: { provider: NativeHealthProvider }): Promise<unknown>
  readRecords(options: NativeHealthRange & { provider: NativeHealthProvider }): Promise<unknown>
}

const LABELS: Record<NativeHealthProvider, string> = { apple_health: 'Apple 健康', health_connect: 'Health Connect' }
const MAX_DAYS = 31
const MAX_ROWS = 30_000
const APPLE_READ_NOTICE = 'Apple 健康不会告知读取权限是否获准；空结果可能表示没有记录或未开放读取权限。'
const object = (v: unknown): Record<string, unknown> | null => v != null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const text = (v: unknown, max = 240): string | null => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null
const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
function timestamp(v: unknown): string | null {
  return typeof v === 'string' && validDay(v.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)) ? v : null
}

export function validateNativeReadRange(range: NativeHealthRange): NativeHealthRange {
  const from = timestamp(range?.from), to = timestamp(range?.to)
  if (!from || !to || Date.parse(from) >= Date.parse(to)) throw new Error('读取时间必须是含时区的有效起止时间，且结束晚于开始。')
  if (Date.parse(to) - Date.parse(from) > MAX_DAYS * 86_400_000) throw new Error('每次最多读取 31 天，请缩短时间范围。')
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}

function needsNative(provider: NativeHealthProvider): NativeHealthStatus {
  return { available: false, state: 'needs_native_app', message: `${LABELS[provider]}需要含健康读取模块的方坤原生手机版；当前网页或桌面安装版不能申请手机系统健康权限。` }
}

async function bridgeFor(provider: NativeHealthProvider): Promise<{ plugin?: FangkunHealthPlugin; status?: NativeHealthStatus }> {
  if (typeof window === 'undefined') return { status: needsNative(provider) }
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  if (!Capacitor.isNativePlatform()) return { status: needsNative(provider) }
  const expected = provider === 'apple_health' ? 'ios' : 'android'
  if (Capacitor.getPlatform() !== expected) return { status: { available: false, state: 'provider_unavailable', message: `${LABELS[provider]}只可在${expected === 'ios' ? 'iOS' : 'Android'}手机版读取。` } }
  if (!Capacitor.isPluginAvailable('FangkunHealth')) return { status: { ...needsNative(provider), message: '当前手机版未包含原生健康读取模块，请使用已接入该模块的安装版本。' } }
  return { plugin: registerPlugin<FangkunHealthPlugin>('FangkunHealth') }
}

function bounded<T>(promise: Promise<T>, timeout = 60_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('系统健康读取等待超时，请返回应用后重试。')), timeout)
    promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

function nativeStatus(provider: NativeHealthProvider, raw: unknown): NativeHealthStatus {
  const r = object(raw)
  if (!r || r.provider !== provider || !['available', 'provider_unavailable', 'permissions_required'].includes(String(r.state))) throw new Error('原生健康模块返回了不匹配的来源或状态协议。')
  const state = r.state as NativeHealthStatus['state']
  const message = provider === 'apple_health' && state === 'available'
    ? `Apple 健康读取模块可用，可尝试读取已开放的项目。${APPLE_READ_NOTICE}`
    : text(r.message, 600) ?? (state === 'permissions_required' ? '请先在系统页面选择允许读取的健康项目。' : state === 'available' ? '健康读取模块可用，将只读取获准的项目。' : '当前设备上的健康服务不可用。')
  return { available: state === 'available' || state === 'permissions_required', state, message }
}

export async function getNativeHealthStatus(provider: NativeHealthProvider): Promise<NativeHealthStatus> {
  const runtime = await bridgeFor(provider)
  if (runtime.status) return runtime.status
  try { return nativeStatus(provider, await bounded(runtime.plugin!.checkAvailability({ provider }), 10_000)) }
  catch { return { available: false, state: 'provider_unavailable', message: '原生健康模块暂不可用，请返回应用后重试。' } }
}

export async function requestNativeHealthPermissions(provider: NativeHealthProvider): Promise<NativeHealthStatus> {
  const runtime = await bridgeFor(provider)
  if (runtime.status) return runtime.status
  return nativeStatus(provider, await bounded(runtime.plugin!.requestReadPermissions({ provider }), 180_000))
}

/** Read only. The caller owns the athlete fence, preview, explicit confirmation and save. */
export async function readNativeHealth(provider: NativeHealthProvider, range: NativeHealthRange): Promise<DeviceParseResult> {
  const validated = validateNativeReadRange(range)
  const runtime = await bridgeFor(provider)
  if (runtime.status) throw new Error(runtime.status.message)
  const status = nativeStatus(provider, await bounded(runtime.plugin!.checkAvailability({ provider }), 10_000))
  if (status.state !== 'available') throw new Error(status.message)
  return normalizeNativeHealthRead(provider, await bounded(runtime.plugin!.readRecords({ provider, ...validated })))
}

type Source = { id: string; originId: string; originName: string }
function sourceOf(raw: Record<string, unknown>): Source | null {
  const id = text(raw.id, 160), originId = text(raw.originId, 240)
  if (!id || !originId) return null
  return { id, originId, originName: text(raw.originName, 160) ?? originId }
}
function stableIdentity(provider: NativeHealthProvider, source: Source): string { return `${provider}:${encodeURIComponent(source.originId)}:${encodeURIComponent(source.id)}` }
function healthSourceId(provider: NativeHealthProvider, origin: string): string { return `${provider}:${origin.slice(0, 75)}:${shortHash(origin)}` }
function sourceLabel(provider: NativeHealthProvider, source: Source): string { return `${LABELS[provider]} · ${source.originName}`.slice(0, 80) }
function insertUnique<T>(map: Map<string, T>, blocked: Set<string>, key: string, value: T): boolean {
  if (blocked.has(key)) return false
  const previous = map.get(key)
  if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(value)) { map.delete(key); blocked.add(key); return false }
  map.set(key, value)
  return true
}
function sportOf(value: unknown): Pick<DeviceActivity, 'sport' | 'sportLabel'> {
  if (value === 'running') return { sport: 'RUNNING', sportLabel: '跑步' }
  if (value === 'strength') return { sport: 'STRENGTH', sportLabel: '力量' }
  return { sport: 'UNKNOWN', sportLabel: value === 'walking' ? '步行' : value === 'cycling' ? '骑行' : value === 'swimming' ? '游泳' : '未分类训练' }
}

type HealthRecord = Source & { metric: string; day: string; startAt: string; endAt: string; value: number | null; unit: string | null; stage: string | null }
type SleepGroup = { source: Source; day: string; intervals: [number, number][]; measuredAt: string }
function unionSeconds(intervals: [number, number][]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  let total = 0, start = sorted[0][0], end = sorted[0][1]
  for (const [nextStart, nextEnd] of sorted.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd)
    else { total += end - start; start = nextStart; end = nextEnd }
  }
  return (total + end - start) / 1000
}

/** Strict versioned JSON boundary shared by both real native implementations. */
export function normalizeNativeHealthRead(provider: NativeHealthProvider, payload: unknown): DeviceParseResult {
  const p = object(payload)
  if (!p || p.schemaVersion !== 1 || p.provider !== provider) throw new Error('原生健康数据来源或协议版本不匹配，未导入。')
  const readAt = timestamp(p.readAt)
  if (!readAt || !Array.isArray(p.workouts) || !Array.isArray(p.health)) throw new Error('原生健康返回格式无效，未导入。')
  if (p.workouts.length + p.health.length > MAX_ROWS) throw new Error('单次健康返回记录过多，请缩短读取日期。')
  const notes = Array.isArray(p.notes) ? p.notes.flatMap(n => text(n, 600) ? [String(n)] : []).slice(0, 40) : []
  if (p.truncated === true) notes.push('本次达到原生读取上限，只显示已取得的记录；请缩短日期后分次读取。')
  if (provider === 'apple_health') notes.push(APPLE_READ_NOTICE)
  const activities = new Map<string, DeviceActivity>(), activityConflicts = new Set<string>()
  let invalid = 0
  for (const entry of p.workouts) {
    const raw = object(entry), source = raw && sourceOf(raw)
    if (!raw || !source) { invalid++; continue }
    const sourceIdentity = stableIdentity(provider, source)
    const startIso = timestamp(raw.startAt)
    const activity: DeviceActivity = {
      key: sourceIdentity, sourceIdentity, source: sourceLabel(provider, source), ...sportOf(raw.sport), startIso,
      durationSec: finite(raw.durationSec), distanceM: finite(raw.distanceM), calories: finite(raw.energyKcal),
      avgHr: null, maxHr: null, avgCadence: null, avgPower: null, verticalOscMm: null, groundContactMs: null, sets: [],
      provenance: { provider: provider === 'apple_health' ? 'APPLE_HEALTH' : 'HEALTH_CONNECT', accountRef: null, recordId: source.id, measuredAt: startIso, receivedAt: readAt },
    }
    insertUnique(activities, activityConflicts, sourceIdentity, activity)
  }

  const records = new Map<string, HealthRecord>(), healthConflicts = new Set<string>(), blockedSleepDays = new Set<string>()
  const incompleteSleep = Array.isArray(p.incompleteTypes) ? p.incompleteTypes.includes('SLEEP_STAGE') : p.truncated === true
  for (const entry of p.health) {
    const raw = object(entry), source = raw && sourceOf(raw)
    const startAt = raw && timestamp(raw.startAt), endAt = raw && timestamp(raw.endAt)
    if (!raw || !source || !startAt || !endAt || typeof raw.day !== 'string' || !validDay(raw.day)) { invalid++; continue }
    const metric = text(raw.metric, 40)
    const correctHrv = provider === 'apple_health' ? 'HRV_SDNN' : 'HRV_RMSSD'
    if (!metric || !['RHR', correctHrv, 'SLEEP_STAGE', 'STEPS'].includes(metric)) { invalid++; continue }
    const expectedUnit = metric === 'RHR' ? 'bpm' : metric === 'STEPS' ? 'count' : metric === 'SLEEP_STAGE' ? 's' : 'ms'
    const value = finite(raw.value)
    if (raw.unit !== expectedUnit || (metric !== 'SLEEP_STAGE' && value === null) || Date.parse(endAt) < Date.parse(startAt)) { invalid++; continue }
    const record: HealthRecord = { ...source, metric, day: raw.day, startAt, endAt, value, unit: expectedUnit, stage: text(raw.stage, 30) }
    const identity = `${stableIdentity(provider, source)}:${metric}`, previous = records.get(identity)
    if (!insertUnique(records, healthConflicts, identity, record) && metric === 'SLEEP_STAGE') {
      blockedSleepDays.add(`${record.originId}:${record.day}`)
      if (previous) blockedSleepDays.add(`${previous.originId}:${previous.day}`)
    }
  }

  const health: DeviceHealthRow[] = [], sleeps = new Map<string, SleepGroup>()
  for (const record of records.values()) {
    const sourceId = healthSourceId(provider, record.originId)
    if (record.metric === 'SLEEP_STAGE') {
      if (incompleteSleep || blockedSleepDays.has(`${record.originId}:${record.day}`)) continue
      if (!['asleep', 'light', 'deep', 'rem'].includes(record.stage ?? '') || Date.parse(record.endAt) <= Date.parse(record.startAt)) continue
      const groupKey = `${record.originId}:${record.day}`
      const group = sleeps.get(groupKey) ?? { source: record, day: record.day, intervals: [], measuredAt: record.endAt }
      group.intervals.push([Date.parse(record.startAt), Date.parse(record.endAt)])
      if (Date.parse(record.endAt) > Date.parse(group.measuredAt)) group.measuredAt = record.endAt
      sleeps.set(groupKey, group)
      continue
    }
    const metric = record.metric.startsWith('HRV_') ? 'HRV' : record.metric as 'RHR' | 'STEPS'
    const key = `${provider}:${shortHash(record.originId)}:${record.metric}:${encodeURIComponent(record.id)}`
    if (key.length > 160) { invalid++; continue }
    health.push({
      key, source: sourceLabel(provider, record), metric, day: record.day, value: record.value!,
      ...(metric === 'HRV' ? { hrvMethod: provider === 'apple_health' ? 'SDNN' as const : 'RMSSD' as const } : {}),
      observation: {
        key, sourceId, syncedAt: readAt, measuredAt: record.startAt, rawValue: record.value!, rawUnit: record.unit!,
        statistic: metric === 'STEPS' ? (provider === 'apple_health' ? 'HealthKit按来源累计日步数' : 'Health Connect系统去重日步数') : metric === 'HRV' ? '原始HRV样本（未做日均）' : '原始静息心率样本（未做日均）',
      },
    })
  }
  for (const group of sleeps.values()) {
    const seconds = unionSeconds(group.intervals)
    const key = `${provider}:${shortHash(group.source.originId)}:sleep:${group.day}`
    health.push({ key, source: sourceLabel(provider, group.source), metric: 'SLEEP', day: group.day, value: seconds / 3600,
      observation: { key, sourceId: healthSourceId(provider, group.source.originId), syncedAt: readAt, measuredAt: group.measuredAt, rawValue: seconds, rawUnit: 's', statistic: '实际睡眠分段并集（按记录归属日）' },
    })
  }
  const conflicts = activityConflicts.size + healthConflicts.size
  if (conflicts) notes.push(`${conflicts} 条同来源标识的记录内容冲突，已排除，未猜测采用哪个版本。`)
  if (invalid) notes.push(`${invalid} 条缺少有效来源、时间、单位或读数的记录未导入。`)
  if (incompleteSleep) notes.push('本次睡眠分段读取不完整，未生成可覆盖原记录的睡眠日总量；请缩短日期后重试。')
  if (sleeps.size) notes.push('睡眠仅合计明确标为睡着的分段，同来源同归属日的重叠区间只算一次；未跨来源相加。')
  return { kind: '手机系统健康', brand: LABELS[provider], activities: [...activities.values()], health, notes: [...new Set(notes)] }
}
