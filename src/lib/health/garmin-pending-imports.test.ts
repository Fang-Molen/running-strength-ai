import test from 'node:test'
import assert from 'node:assert/strict'
import { currentAthleteId, setEventContext } from '../core/events'
import { setStoreBackend } from '../core/storage'
import { coachImports } from '../core/coach-import-evidence'
import { CONFIRMED_TRAINING_IMPORTS_KEY, permanentlyDeleteConfirmedTrainingImport } from '../core/training-import'
import { appendCorrection } from '../core/training-correction'
import { saveDeviceRowsWithHealthResult } from '../ui/device-store'
import { saveGarminActivities, garminViewHas } from '../../components/garmin-log'
import { garminActivity, runGarminSyncJob, type GarminDailyProgress } from './garmin-sync-runner'
import { shortHash } from './observation'

const api = await import('./garmin-pending-imports').catch(() => ({})) as typeof import('./garmin-pending-imports')
const scope = 'cn:synthetic-retry', subject = 'synthetic-retry-athlete'
const raw = (id: number) => ({ activityId: id, activityType: { typeKey: 'running' }, activityName: '合成跑步', startTimeGMT: '2026-10-01 08:00:00', duration: 90.1, distance: 400 })
const activity = (id: number, account = scope) => garminActivity(raw(id), account)!

function fixture(t: test.TestContext) {
  const owner = currentAthleteId(), oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const data = new Map<string, string>()
  let blocked: number | null = null, silent = false, queueWrites = 0, failQueueAt = 0, failReadback = false, throwNextImportRead = false
  const box = {
    keys: () => [...data.keys()], getItem: (key: string) => {
      if (key === CONFIRMED_TRAINING_IMPORTS_KEY && throwNextImportRead) { throwNextImportRead = false; throw Error('synthetic readback failure') }
      return data.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      if (key === CONFIRMED_TRAINING_IMPORTS_KEY && (silent || blocked !== null && JSON.parse(value).data.some((row: { sourceRecordIdentity?: string }) => row.sourceRecordIdentity?.endsWith(`:${blocked}`)))) {
        if (silent) return
        throw Error('synthetic import storage failure')
      }
      if (key.startsWith('fk-garmin-pending-imports:') && ++queueWrites === failQueueAt) throw Error('synthetic retry-state storage failure')
      data.set(key, value)
      if (key === CONFIRMED_TRAINING_IMPORTS_KEY && failReadback) { failReadback = false; throwNextImportRead = true }
    },
    removeItem: (key: string) => { data.delete(key) },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: box, configurable: true })
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true })
  setStoreBackend(box); setEventContext({ athleteId: subject })
  t.after(() => {
    setStoreBackend(null); setEventContext({ athleteId: owner })
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage')
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window')
  })
  return { data, box, block: (id: number | null) => { blocked = id }, silent: (value: boolean) => { silent = value }, failQueueAfter: (writes: number) => { failQueueAt = queueWrites + writes }, failReadbackOnce: () => { failReadback = true } }
}
function helper() { assert.equal(typeof api.saveGarminRowsWithRetry, 'function'); return api.saveGarminRowsWithRetry }

test('the 25th failed activity retries locally after a 20-row incremental read and then never duplicates', async t => {
  const f = fixture(t), save = helper(), paths: string[] = [], list = Array.from({ length: 40 }, (_, i) => raw(i + 1))
  let cursor = 14, receipt: GarminDailyProgress | null = null
  f.block(25)
  const host: Parameters<typeof runGarminSyncJob>[0] = {
    day: '2026-10-22', now: '2026-10-22T12:00:00Z', subject: currentAthleteId, generation: () => 0,
    api: async path => {
      paths.push(path)
      if (path === 'status') return { status: 200, body: { loggedIn: true, region: 'cn', profile: { displayName: 'synthetic-retry' } } }
      if (path.includes('activities/search')) { const q = new URL('https://fixture.invalid/' + path).searchParams; return { status: 200, body: list.slice(Number(q.get('start')), Number(q.get('start')) + Number(q.get('limit'))) } }
      return { status: 204, body: null }
    },
    save: (health, rows) => save(scope, subject, health, rows), saveView: saveGarminActivities, activitySeen: garminViewHas,
    bindAccount: () => true, progress: () => {}, report: () => {},
    backfill: { get: () => cursor, set: (_scope, value) => { cursor = value } },
    dailyProgress: { get: () => receipt, set: (_scope, value) => { receipt = value } },
  }
  const first = await runGarminSyncJob(host)
  assert.equal(first.status, 'partial'); assert.equal(coachImports().length, 39)
  assert.equal(api.readGarminPendingImports(scope, subject).length, 1); assert.equal(cursor, 90)
  f.block(null); paths.length = 0
  const second = await runGarminSyncJob(host)
  assert.equal(second.mode, 'RECENT'); assert.equal(second.status, 'ok'); assert.equal(second.activityRows, 20)
  assert.equal(second.saved, 1); assert.equal(second.skipped, 20); assert.equal(coachImports().length, 40)
  assert.equal(paths.filter(path => path.includes('activities/search')).length, 1)
  assert.equal(api.readGarminPendingImports(scope, subject).length, 0)
  const third = await runGarminSyncJob(host)
  assert.equal(third.saved, 0); assert.equal(coachImports().length, 40)
})

test('structured persistence failures include silent dropped writes, while invalid data is never queued', t => {
  const f = fixture(t), save = helper()
  f.silent(true)
  const lost = save(scope, subject, [], [activity(1)])
  assert.equal(lost.saved, 0); assert.equal(lost.activityResults[0].status, 'persistence_failed')
  assert.equal(api.readGarminPendingImports(scope, subject).length, 1)
  f.silent(false)
  const retried = save(scope, subject, [], [{ ...activity(2), sport: 'UNKNOWN' }])
  assert.equal(retried.saved, 1); assert.equal(retried.activityResults.find(row => row.sourceIdentity?.endsWith(':2'))?.status, 'rejected')
  assert.equal(api.readGarminPendingImports(scope, subject).length, 0)
})

test('retry state is account and athlete scoped and stale owners cannot write', t => {
  const f = fixture(t), save = helper(); f.block(25)
  save(scope, subject, [], [activity(25)]); f.block(null)
  const queued = [...f.data]
  assert.equal(save('com:other-account', subject, [], []).saved, 0)
  setEventContext({ athleteId: 'another-athlete' })
  assert.throws(() => save(scope, subject, [], []), /归属/)
  assert.equal(save(scope, 'another-athlete', [], []).saved, 0)
  assert.deepEqual([...f.data], queued)
  setEventContext({ athleteId: subject })
  assert.equal(save(scope, subject, [], []).saved, 1)
})

test('old raw-only history and an explicitly deleted confirmed activity are never inferred as failed imports', t => {
  fixture(t); const save = helper(), a = activity(25)
  saveGarminActivities([{ ...raw(25), fkSourceIdentity: a.sourceIdentity, fkStartIso: a.startIso }], shortHash(scope))
  assert.equal(save(scope, subject, [], []).saved, 0); assert.equal(coachImports().length, 0)
  assert.equal(save(scope, subject, [], [a]).saved, 1)
  assert.equal(permanentlyDeleteConfirmedTrainingImport(coachImports()[0].confirmedImportId), true)
  assert.equal(save(scope, subject, [], []).saved, 0); assert.equal(coachImports().length, 0)
  assert.deepEqual(api.readGarminPendingImports(scope, subject), [])
})

test('an already confirmed source clears its failed retry but source conflicts preserve manual corrections', t => {
  const f = fixture(t), save = helper(), a = activity(25); f.block(25)
  save(scope, subject, [], [a]); f.block(null)
  assert.equal(saveDeviceRowsWithHealthResult([], [a]).saved, 1)
  const record = coachImports()[0]
  assert.ok(appendCorrection({ trainingOccurrenceId: record.confirmedImportId, kind: 'FIELD', field: 'duration', setKey: null, originalValue: '90.1', newValue: '91.2', reason: '合成更正' }))
  const result = save(scope, subject, [], [{ ...a, durationSec: 92.3 }])
  assert.equal(result.saved, 0); assert.equal(result.activityResults[0].status, 'conflict'); assert.ok(result.errors.length)
  assert.deepEqual(api.readGarminPendingImports(scope, subject), [])
  assert.equal(coachImports()[0].durationSeconds.value, 90.1); assert.equal(coachImports().length, 1)
})

test('a failed retry acknowledgement cannot later resurrect a user-deleted successful import', t => {
  const f = fixture(t), save = helper(); f.block(25)
  save(scope, subject, [], [activity(25)]); f.block(null)
  f.failQueueAfter(2) // The attempting receipt succeeds; the final acknowledgement fails.
  const result = save(scope, subject, [], [])
  assert.equal(result.saved, 1); assert.ok(result.errors.some(error => /重试|复核/.test(error)))
  assert.equal(api.readGarminPendingImports(scope, subject)[0].state, 'attempting')
  assert.ok(permanentlyDeleteConfirmedTrainingImport(coachImports()[0].confirmedImportId))
  const later = save(scope, subject, [], [])
  assert.equal(later.saved, 0); assert.equal(coachImports().length, 0)
  assert.ok(later.errors.some(error => /复核/.test(error)))
})

test('a successful write whose readback throws remains unconfirmed and cannot resurrect a later deletion', t => {
  const f = fixture(t), save = helper(); f.failReadbackOnce()
  const result = save(scope, subject, [], [activity(25)])
  assert.equal(result.saved, 0); assert.equal(result.activityResults[0].status, 'persistence_unconfirmed')
  assert.equal(coachImports().length, 1, 'the store did persist the record before readback failed')
  assert.equal(api.readGarminPendingImports(scope, subject)[0].state, 'attempting')
  assert.ok(permanentlyDeleteConfirmedTrainingImport(coachImports()[0].confirmedImportId))
  const later = save(scope, subject, [], [])
  assert.equal(later.saved, 0); assert.equal(coachImports().length, 0)
  assert.ok(later.errors.some(error => /复核/.test(error)))
})

test('corrupt retry state is preserved and reported without blocking independent health persistence', t => {
  const f = fixture(t), save = helper(), key = `fk-garmin-pending-imports:${shortHash(scope)}:${encodeURIComponent(subject)}`
  f.data.set(key, '{corrupt')
  const health = { key: 'steps', source: '合成佳明', metric: 'STEPS' as const, day: '2026-10-22', value: 100, observation: { key: 'steps:2026-10-22', sourceId: 'synthetic', statistic: '当日步数', syncedAt: '2026-10-22T12:00:00Z' } }
  const result = save(scope, subject, [health], [activity(1)])
  assert.equal(result.saved, 1); assert.deepEqual(result.healthErrors, []); assert.ok(result.errors.length)
  assert.equal(coachImports().length, 0); assert.equal(f.data.get(key), '{corrupt')
})
