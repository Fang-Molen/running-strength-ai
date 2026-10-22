import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getNativeHealthStatus,
  normalizeNativeHealthRead,
  readNativeHealth,
  requestNativeHealthPermissions,
  validateNativeReadRange,
} from './native-health'

const readAt = '2026-10-22T09:00:00.000Z'
const from = '2026-10-01T00:00:00.000Z'
const to = '2026-10-22T00:00:00.000Z'
const workout = (extra: Record<string, unknown> = {}) => ({
  id: 'workout-1', originId: 'com.example.synthetic-watch', originName: '合成测试手表',
  startAt: '2026-10-20T00:00:00.000Z', endAt: '2026-10-20T00:00:12.300Z',
  durationSec: 12.3, distanceM: null, energyKcal: null, sport: 'running', ...extra,
})
const metric = (extra: Record<string, unknown> = {}) => ({
  id: 'sample-1', originId: 'com.example.synthetic-watch', originName: '合成测试手表',
  startAt: '2026-10-20T00:00:00.000Z', endAt: '2026-10-20T00:00:00.000Z',
  day: '2026-10-20', metric: 'RHR', value: 50.2, unit: 'bpm', ...extra,
})
const payload = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1, provider: 'apple_health', readAt, workouts: [], health: [], notes: [], truncated: false, ...extra,
})

test('a web or SSR runtime cannot claim either native health service is connected', async () => {
  for (const provider of ['apple_health', 'health_connect'] as const) {
    const status = await getNativeHealthStatus(provider)
    assert.equal(status.state, 'needs_native_app')
    assert.equal(status.available, false)
    assert.match(status.message, /原生|手机版/)
    assert.equal((await requestNativeHealthPermissions(provider)).state, 'needs_native_app')
    await assert.rejects(readNativeHealth(provider, { from, to }), /原生|手机版/)
  }
})

test('native workout values retain fractional seconds and missing values without inferred sets', () => {
  const result = normalizeNativeHealthRead('apple_health', payload({ workouts: [workout()] }))
  assert.equal(result.activities.length, 1)
  const a = result.activities[0]
  assert.equal(a.durationSec, 12.3)
  assert.equal(a.distanceM, null)
  assert.equal(a.avgHr, null)
  assert.equal(a.calories, null)
  assert.deepEqual(a.sets, [])
  assert.equal(a.sourceIdentity, 'apple_health:com.example.synthetic-watch:workout-1')
  assert.deepEqual(a.provenance, { provider: 'APPLE_HEALTH', accountRef: null, recordId: 'workout-1', measuredAt: '2026-10-20T00:00:00.000Z', receivedAt: readAt })
  const absent = normalizeNativeHealthRead('apple_health', payload({ workouts: [workout({ durationSec: null, sport: 'strength' })] })).activities[0]
  assert.equal(absent.durationSec, null)
  assert.equal(absent.sport, 'STRENGTH')
  assert.deepEqual(absent.sets, [])
})

test('native unknown sports stay unknown and zero distance remains a recorded zero', () => {
  const a = normalizeNativeHealthRead('apple_health', payload({ workouts: [workout({ sport: 'unrecognized-sport', distanceM: 0 })] })).activities[0]
  assert.equal(a.sport, 'UNKNOWN')
  assert.equal(a.distanceM, 0)
})

test('native identities deduplicate only identical records from the same origin', () => {
  const result = normalizeNativeHealthRead('apple_health', payload({ workouts: [workout(), workout(), workout({ originId: 'com.example.other' })] }))
  assert.equal(result.activities.length, 2)
  assert.notEqual(result.activities[0].sourceIdentity, result.activities[1].sourceIdentity)
  const conflicting = normalizeNativeHealthRead('apple_health', payload({ workouts: [workout(), workout({ durationSec: 13.4 })] }))
  assert.equal(conflicting.activities.length, 0)
  assert.match(conflicting.notes.join(' '), /冲突/)
})

test('provider and protocol mismatches fail instead of relabelling health records', () => {
  assert.throws(() => normalizeNativeHealthRead('health_connect', payload()), /来源|协议/)
  assert.throws(() => normalizeNativeHealthRead('apple_health', payload({ schemaVersion: 99 })), /协议/)
  assert.throws(() => normalizeNativeHealthRead('apple_health', payload({ health: null })), /格式|协议/)
})

test('iOS SDNN and Android RMSSD keep their methods and exact original measurements', () => {
  const apple = normalizeNativeHealthRead('apple_health', payload({ health: [metric({ metric: 'HRV_SDNN', value: 52.75, unit: 'ms' })] })).health[0]
  assert.equal(apple.metric, 'HRV')
  assert.equal(apple.hrvMethod, 'SDNN')
  assert.equal(apple.value, 52.75)
  assert.equal(apple.observation?.rawValue, 52.75)
  assert.equal(apple.observation?.rawUnit, 'ms')
  assert.equal(apple.observation?.measuredAt, '2026-10-20T00:00:00.000Z')
  assert.match(apple.observation!.sourceId, /^apple_health:/)
  const android = normalizeNativeHealthRead('health_connect', payload({ provider: 'health_connect', health: [metric({ metric: 'HRV_RMSSD', value: 48.125, unit: 'ms' })] })).health[0]
  assert.equal(android.hrvMethod, 'RMSSD')
  assert.equal(android.value, 48.125)
  assert.equal(normalizeNativeHealthRead('health_connect', payload({ provider: 'health_connect', health: [metric({ metric: 'HRV_SDNN', unit: 'ms' })] })).health.length, 0)
})

test('independent same-day heart samples stay independent rather than being averaged', () => {
  const result = normalizeNativeHealthRead('apple_health', payload({ health: [metric(), metric({ id: 'sample-2', value: 61.9 })] }))
  assert.deepEqual(result.health.map(x => x.value), [50.2, 61.9])
  assert.notEqual(result.health[0].observation?.key, result.health[1].observation?.key)
})

test('sleep unions overlapping actual asleep intervals within one origin and day only', () => {
  const sleep = (id: string, startAt: string, endAt: string, extra: Record<string, unknown> = {}) => metric({ id, startAt, endAt, metric: 'SLEEP_STAGE', stage: 'asleep', value: null, unit: 's', ...extra })
  const result = normalizeNativeHealthRead('apple_health', payload({ health: [
    sleep('sleep-a', '2026-10-19T22:00:00Z', '2026-10-20T00:00:00Z'),
    sleep('sleep-b', '2026-10-19T23:00:00Z', '2026-10-20T01:00:00.100Z', { stage: 'deep' }),
    sleep('awake', '2026-10-20T01:00:00.100Z', '2026-10-20T02:00:00Z', { stage: 'awake' }),
    sleep('bed', '2026-10-19T20:00:00Z', '2026-10-20T04:00:00Z', { stage: 'in_bed' }),
    sleep('other-source', '2026-10-19T22:00:00Z', '2026-10-20T00:00:00Z', { originId: 'com.example.other' }),
  ] }))
  assert.equal(result.health.length, 2)
  const first = result.health.find(x => x.observation?.rawValue === 10800.1)!
  assert.ok(first)
  assert.equal(first.value, 10800.1 / 3600)
  assert.equal(first.observation?.rawUnit, 's')
  assert.match(first.observation!.statistic, /实际睡眠|睡眠分段/)
})

test('explicit zero steps are preserved, but absent, wrong-unit and nonfinite readings are skipped', () => {
  const result = normalizeNativeHealthRead('health_connect', payload({ provider: 'health_connect', health: [
    metric({ id: 'zero-steps', metric: 'STEPS', value: 0, unit: 'count' }),
    metric({ id: 'missing-steps', metric: 'STEPS', value: null, unit: 'count' }),
    metric({ id: 'bad-unit', metric: 'HRV_RMSSD', unit: 's' }),
    metric({ id: 'infinite', value: Infinity }),
    metric({ id: 'fabricated-score', metric: 'READINESS', value: 99 }),
  ] }))
  assert.equal(result.health.length, 1)
  assert.equal(result.health[0].value, 0)
  assert.equal(result.health[0].metric, 'STEPS')
  assert.ok(result.notes.length)
})

test('repeated daily step aggregates retain a stable key for revision rather than duplicate addition', () => {
  const make = (value: number) => normalizeNativeHealthRead('health_connect', payload({ provider: 'health_connect', health: [metric({ id: 'steps:2026-10-20', metric: 'STEPS', value, unit: 'count' })] })).health[0]
  assert.equal(make(10).observation?.key, make(20).observation?.key)
})

test('an incomplete sleep read cannot replace a previously complete daily total', () => {
  const sleep = metric({ metric: 'SLEEP_STAGE', stage: 'asleep', unit: 's', value: null, endAt: '2026-10-20T01:00:00Z' })
  const result = normalizeNativeHealthRead('apple_health', payload({ health: [sleep], truncated: true }))
  assert.equal(result.health.length, 0)
  assert.match(result.notes.join(' '), /睡眠.*完整|完整.*睡眠/)
})

test('conflicting sleep fragments exclude the affected daily total rather than silently reducing it', () => {
  const sleep = metric({ metric: 'SLEEP_STAGE', stage: 'asleep', unit: 's', value: null, endAt: '2026-10-20T01:00:00Z' })
  const result = normalizeNativeHealthRead('apple_health', payload({ health: [sleep, { ...sleep, endAt: '2026-10-20T02:00:00Z' }, { ...sleep, id: 'another-fragment' }] }))
  assert.equal(result.health.length, 0)
  assert.match(result.notes.join(' '), /冲突/)
})

test('empty HealthKit results state the read-authorization ambiguity', () => {
  const result = normalizeNativeHealthRead('apple_health', payload())
  assert.equal(result.activities.length, 0)
  assert.equal(result.health.length, 0)
  assert.match(result.notes.join(' '), /权限|授权/)
})

test('native range validation is explicit, bounded and does not reinterpret calendar-only dates', () => {
  assert.deepEqual(validateNativeReadRange({ from, to }), { from, to })
  assert.throws(() => validateNativeReadRange({ from: '2026-10-01', to }), /时间|日期/)
  assert.throws(() => validateNativeReadRange({ from: to, to: from }), /时间|日期/)
  assert.throws(() => validateNativeReadRange({ from: '2026-08-01T00:00:00Z', to }), /31/)
})
