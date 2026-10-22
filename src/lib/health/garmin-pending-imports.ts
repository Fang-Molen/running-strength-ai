import { currentAthleteId } from '../core/events'
import { currentStore } from '../core/storage'
import { coachImports } from '../core/coach-import-evidence'
import { saveDeviceRowsWithHealthResult, type DeviceSaveResult } from '../ui/device-store'
import type { DeviceActivity, DeviceHealthRow } from '../ui/device-parse'
import { shortHash } from './observation'

export type GarminPendingImport = { activity: DeviceActivity; failedAt: string; state: 'pending' | 'attempting' }
const keyFor = (scope: string, athleteId: string) => `fk-garmin-pending-imports:${shortHash(scope)}:${encodeURIComponent(athleteId)}`
const checkOwner = (scope: string, athleteId: string) => {
  if (!scope || !athleteId || currentAthleteId() !== athleteId) throw Error('活动同步归属已变化，未保存')
}
function hasSource(activity: DeviceActivity, scope: string): boolean {
  const prefix = `garmin:${encodeURIComponent(scope)}:`
  return typeof activity?.sourceIdentity === 'string' && activity.sourceIdentity.startsWith(prefix) && /^\d+$/.test(activity.sourceIdentity.slice(prefix.length))
}
function validEntry(value: unknown, scope: string): value is GarminPendingImport {
  if (!value || typeof value !== 'object') return false
  const entry = value as GarminPendingImport, a = entry.activity
  const numeric = (v: unknown) => v === null || typeof v === 'number' && Number.isFinite(v) && v >= 0
  return (entry.state === 'pending' || entry.state === 'attempting') && typeof entry.failedAt === 'string' && Number.isFinite(Date.parse(entry.failedAt))
    && !!a && hasSource(a, scope) && typeof a.key === 'string' && typeof a.source === 'string' && typeof a.sportLabel === 'string'
    && ['RUNNING', 'STRENGTH', 'MIXED'].includes(a.sport) && typeof a.startIso === 'string' && Number.isFinite(Date.parse(a.startIso))
    && [a.durationSec, a.distanceM, a.avgHr, a.maxHr, a.calories, a.avgCadence, a.avgPower, a.verticalOscMm, a.groundContactMs].every(numeric)
    && Array.isArray(a.sets) && a.sets.length <= 80 && a.sets.every(s => typeof s.name === 'string' && [s.reps, s.weightKg, s.durationSec].every(numeric))
}

/** Only explicit failed automatic imports are eligible. Raw activity views are
 * never scanned: an absent formal record may have been intentionally deleted. */
export function readGarminPendingImports(scope: string, athleteId: string): GarminPendingImport[] {
  checkOwner(scope, athleteId)
  const store = currentStore()
  if (!store) throw Error('活动重试记录无法读取')
  const raw = store.getItem(keyFor(scope, athleteId))
  if (raw === null) return []
  const record = JSON.parse(raw)
  if (record?.version !== 1 || record.accountScope !== scope || record.athleteId !== athleteId || !Array.isArray(record.entries)
    || !record.entries.every((entry: unknown) => validEntry(entry, scope))
    || new Set(record.entries.map((entry: GarminPendingImport) => entry.activity.sourceIdentity)).size !== record.entries.length) throw Error('活动重试记录无法读取')
  return record.entries
}
function writePending(scope: string, athleteId: string, entries: GarminPendingImport[]) {
  checkOwner(scope, athleteId)
  const store = currentStore()
  if (!store) throw Error('活动重试记录保存失败')
  const key = keyFor(scope, athleteId), raw = JSON.stringify({ version: 1, accountScope: scope, athleteId, entries }), before = store.getItem(key)
  if (before === raw || before === null && entries.length === 0) return
  store.setItem(key, raw)
  if (store.getItem(key) !== raw) throw Error('活动重试记录保存失败')
}
function healthOnly(health: DeviceHealthRow[], message: string): DeviceSaveResult {
  const result = saveDeviceRowsWithHealthResult(health, [])
  result.errors.push(message)
  return result
}

/** Reuse known failed activity snapshots locally; no network or history scan.
 * A retry is marked attempting before saving. If acknowledging it later fails,
 * the ambiguous result needs explicit review rather than reviving a deletion. */
export function saveGarminRowsWithRetry(scope: string, athleteId: string, health: DeviceHealthRow[], activities: DeviceActivity[], manualReview = false): DeviceSaveResult {
  checkOwner(scope, athleteId)
  let previous: GarminPendingImport[]
  try { previous = readGarminPendingImports(scope, athleteId) }
  catch { return healthOnly(health, '活动重试记录无法读取；本次仅保存健康数据，请检查本机存储后重试。') }
  const confirmed = previous.length ? new Set(coachImports().map(record => record.sourceRecordIdentity).filter(Boolean)) : new Set<string>()
  const remaining = previous.filter(entry => !confirmed.has(entry.activity.sourceIdentity))
  const ambiguous = new Map(remaining.filter(entry => entry.state === 'attempting').map(entry => [entry.activity.sourceIdentity!, entry]))
  const invalidSources = activities.filter(activity => !hasSource(activity, scope))
  const fresh = activities.filter(activity => hasSource(activity, scope) && (manualReview || !ambiguous.has(activity.sourceIdentity!)))
  const freshIds = new Set(fresh.map(activity => activity.sourceIdentity))
  const work = [...remaining.filter(entry => entry.state === 'pending' && !freshIds.has(entry.activity.sourceIdentity)).map(entry => entry.activity), ...fresh]
  // Even a retry already confirmed elsewhere receives the attempting receipt
  // before removal, so a failed cleanup cannot later resurrect a deleted record.
  if (previous.length) {
    try { writePending(scope, athleteId, previous.map(entry => ({ ...entry, state: 'attempting' }))) }
    catch { return healthOnly(health, '活动重试状态保存失败，未重试活动；请进行完整复核。') }
  }
  checkOwner(scope, athleteId)
  const result = saveDeviceRowsWithHealthResult(health, work)
  if (invalidSources.length) result.errors.push('部分活动来源与当前佳明账号不匹配，未保存。')
  const workById = new Map(work.map(activity => [activity.sourceIdentity!, activity]))
  const next = new Map(ambiguous)
  for (const outcome of result.activityResults) {
    const identity = outcome.sourceIdentity
    if (!identity) continue
    if (outcome.status === 'persistence_failed' || outcome.status === 'persistence_unconfirmed') {
      const activity = workById.get(identity)!
      next.set(identity, { activity, failedAt: new Date().toISOString(), state: outcome.status === 'persistence_failed' ? 'pending' : 'attempting' })
    } else if (outcome.status === 'conflict' && previous.some(entry => entry.activity.sourceIdentity === identity) && !confirmed.has(identity)) {
      next.set(identity, { ...previous.find(entry => entry.activity.sourceIdentity === identity)!, state: 'attempting' })
    } else next.delete(identity)
  }
  if (next.size && [...next.values()].some(entry => entry.state === 'attempting')) result.errors.push('有先前活动的保存结果未确认，请进行完整复核；未自动恢复可能已删除的记录。')
  try { writePending(scope, athleteId, [...next.values()]) }
  catch { result.errors.push('活动重试记录保存失败，尚未确认后续自动补存；请进行完整复核。') }
  return result
}
