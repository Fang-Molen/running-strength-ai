import test from 'node:test'
import assert from 'node:assert/strict'
import { readDeviceImportDisplay, readGarminSyncDisplay, syncSummary, latestGarminReceipt } from './sync-status.ts'
const kv = (o: Record<string, string>) => ({ getItem: (k: string) => o[k] ?? null })
const S = 'local'
test('SYNC-01 never attempted → no fake success, no zeros', () => {
  const g = readGarminSyncDisplay(kv({}), S, false)
  assert.equal(g.status, 'never'); assert.equal(g.lastCompleteSuccessAt, null); assert.equal(g.activityRows, null)
  assert.equal(syncSummary(g), '佳明账号未连接')
})
test('SYNC-02 ok report → last complete success and counts', () => {
  const at = '2026-10-19T00:25:00.000Z'
  const g = readGarminSyncDisplay(kv({ 'fk-garmin-last-attempt:local': at, 'fk-garmin-last-sync:local': at, 'fk-garmin-last-full-ok:local': at, 'fk-garmin-sync-report:local': JSON.stringify({ at, status: 'ok', activityRows: 12, healthRows: 40, saved: 5, skipped: 47, errors: [], coverageDays: ['2026-10-19', '2026-10-06'], healthDaysRequested: 14, activityLimit: 200 }) }), S, true)
  assert.equal(g.status, 'ok'); assert.equal(g.lastCompleteSuccessAt, at); assert.equal(g.activityRows, 12); assert.equal(g.coveredFrom, '2026-10-06'); assert.equal(g.coveredTo, '2026-10-19')
})
test('SYNC-03 partial → attempt marked partial, previous complete success preserved (not advanced) even though v76 writes last-sync on useful partial', () => {
  const g = readGarminSyncDisplay(kv({ 'fk-garmin-last-attempt:local': '2026-10-19T00:25:00Z', 'fk-garmin-last-sync:local': '2026-10-19T00:25:00Z', 'fk-garmin-last-full-ok:local': '2026-10-17T10:00:00Z', 'fk-garmin-sync-report:local': JSON.stringify({ status: 'partial', errors: ['10-18 HRV 缺失'], saved: 3, skipped: 0 }) }), S, true)
  assert.equal(g.status, 'partial'); assert.equal(g.lastPartialAt, '2026-10-19T00:25:00Z'); assert.equal(g.lastCompleteSuccessAt, '2026-10-17T10:00:00Z'); assert.equal(g.lastUsefulSyncAt, '2026-10-19T00:25:00Z'); assert.equal(g.errors[0].message, '10-18 HRV 缺失')
})
test('SYNC-04 failed/unreadable report → visible failure, prior success still readable', () => {
  const g = readGarminSyncDisplay(kv({ 'fk-garmin-last-full-ok:local': '2026-10-17T10:00:00Z', 'fk-garmin-sync-report:local': '{broken' }), S, null)
  assert.equal(g.status, 'unknown'); assert.equal(g.lastCompleteSuccessAt, '2026-10-17T10:00:00Z'); assert.match(g.errors[0].message, /无法读取/)
  const f = readGarminSyncDisplay(kv({ 'fk-garmin-sync-report:local': JSON.stringify({ status: 'fail', errors: ['网络中断或请求超时'] }) }), S, null)
  assert.equal(f.status, 'failed')
})
test('subject scoping: another athlete key is ignored', () => {
  assert.equal(readGarminSyncDisplay(kv({ 'fk-garmin-last-full-ok:other': '2026-10-17T10:00:00Z' }), S, null).lastCompleteSuccessAt, null)
})
test('SYNC-05 file import vs account sync rows are separated by sourceId', () => {
  const obs = [{ sourceId: 'garmin:abc', syncedAt: '2026-10-19T00:25:00Z', day: '2026-10-19' }, { sourceId: 'import:x', syncedAt: '2026-10-10T08:00:00Z', day: '2026-10-09' }]
  const d = readDeviceImportDisplay(obs)
  assert.equal(d.lastCompleteSuccessAt, '2026-10-10T08:00:00Z'); assert.equal(d.healthRows, 1)
  assert.equal(latestGarminReceipt(obs), '2026-10-19T00:25:00Z')
  assert.equal(readDeviceImportDisplay([obs[0]]).status, 'never')
})
