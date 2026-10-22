import test from 'node:test'
import assert from 'node:assert/strict'
import { readGarminSyncStatus } from './garmin-sync-status.ts'
const mk = (o: Record<string, string>) => ({ getItem: (k: string) => o[k] ?? null })
const k = (n: string) => `${n}:local`
test('nothing synced => not connected, no invented times', () => {
  const s = readGarminSyncStatus('local', mk({}))
  assert.equal(s.connection, 'not_connected'); assert.equal(s.lastAttemptAt, null); assert.equal(s.lastFullSuccessAt, null); assert.equal(s.importRange, null)
})
test('partial attempt keeps last full success separate and lists errors + range', () => {
  const report = { at: '2026-10-19T00:20:00Z', status: 'partial', subjectId: 'local', accountScope: 'abc', healthRows: 30, activityRows: 200, saved: 5, skipped: 40, errors: ['10-12 睡眠超时'], healthDaysRequested: 14, coverageDays: ['2026-10-06', '2026-10-19'], activityLimit: 200, completeHistory: false }
  const s = readGarminSyncStatus('local', mk({ [k('fk-garmin-sync-report')]: JSON.stringify(report), [k('fk-garmin-last-attempt')]: report.at, [k('fk-garmin-last-sync')]: report.at, [k('fk-garmin-last-full-ok')]: '2026-10-18T10:00:00Z' }))
  assert.equal(s.connection, 'connected'); assert.equal(s.lastFullSuccessAt, '2026-10-18T10:00:00Z'); assert.equal(s.lastUsefulSyncAt, report.at)
  assert.deepEqual(s.partialFailure!.errors, ['10-12 睡眠超时']); assert.match(s.importRange!.label, /最近 14 天/); assert.match(s.importRange!.label, /更早的历史不导入/)
})
test('auth failure => expired; auto backoff exposed', () => {
  const now = Date.parse('2026-10-19T00:30:00Z')
  const s = readGarminSyncStatus('local', mk({ [k('fk-garmin-sync-report')]: JSON.stringify({ at: '2026-10-19T00:20:00Z', status: 'auth', errors: [], saved: 0, skipped: 0, coverageDays: [], healthDaysRequested: 14, activityLimit: 200, activityRows: 0, completeHistory: false }), [k('fk-garmin-auto-fail')]: '2026-10-19T00:20:00Z' }), now)
  assert.equal(s.connection, 'expired'); assert.equal(s.autoSync.backoffUntil, '2026-10-19T00:50:00.000Z')
})

test('resuming noncontiguous dates is labeled catch-up rather than a new full first sync', () => {
  const report = { at: '2026-10-22T12:00:00Z', status: 'partial', subjectId: 'local', accountScope: 'abc', mode: 'BACKFILL', healthRows: 50, activityRows: 20, saved: 3, skipped: 60, errors: ['同一来源活动数值已变化'], healthDaysRequested: 17, coverageDays: ['2026-08-28', '2026-10-22'], activityLimit: 20, completeHistory: false, requests: 58 }
  const s = readGarminSyncStatus('local', mk({ [k('fk-garmin-sync-report')]: JSON.stringify(report) }))
  assert.match(s.importRange!.label, /补齐历史/)
  assert.match(s.importRange!.label, /17 个日期/)
  assert.doesNotMatch(s.importRange!.label, /最近 17 天|最近 14 天 \+|首次/)
  assert.ok(s.details.some(detail => detail.includes('补齐历史')))
  assert.equal(s.lastFullSuccessAt, null)
})

test('a verified report supplies newer successful times when timestamp caches are stale or unavailable', () => {
  const old = '2026-10-21T12:00:00Z', at = '2026-10-22T12:00:00Z'
  const report = { at, status: 'ok', subjectId: 'local', accountScope: 'abc', healthRows: 3, activityRows: 1, saved: 1, skipped: 3, errors: [], healthDaysRequested: 3, coverageDays: ['2026-10-22'], activityLimit: 20, completeHistory: false }
  for (const cached of [old, 'invalid']) {
    const store = mk({ [k('fk-garmin-sync-report')]: JSON.stringify(report), [k('fk-garmin-last-attempt')]: cached, [k('fk-garmin-last-sync')]: cached, [k('fk-garmin-last-full-ok')]: cached })
    const s = readGarminSyncStatus('local', store)
    assert.equal(s.lastAttemptAt, at); assert.equal(s.lastUsefulSyncAt, at); assert.equal(s.lastFullSuccessAt, at)
  }
  const partial = readGarminSyncStatus('local', mk({ [k('fk-garmin-sync-report')]: JSON.stringify({ ...report, status: 'partial', errors: ['活动待核对'] }), [k('fk-garmin-last-full-ok')]: old }))
  assert.equal(partial.lastUsefulSyncAt, at); assert.equal(partial.lastFullSuccessAt, old)
  const failed = readGarminSyncStatus('local', mk({ [k('fk-garmin-sync-report')]: JSON.stringify({ ...report, status: 'fail', saved: 0, skipped: 0 }) }))
  assert.equal(failed.lastUsefulSyncAt, null); assert.equal(failed.lastFullSuccessAt, null)
})
