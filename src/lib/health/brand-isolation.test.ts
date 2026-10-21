import test from 'node:test'
import assert from 'node:assert/strict'
import { providerOf, rowProvider, sameActivityCandidate, crossBrandCandidates, crossBrandPairsInLog } from './brand-isolation.ts'
import { corosToDevice, CorosError, corosNeedsLogin } from './coros-account-sync.ts'
const g = { id: 'garmin:cn%3As:1', sport: 'RUNNING', startedAt: '2026-10-20T10:00:00.000Z', distanceM: 5000, durationSec: 1800, source: 'garmin', originIds: ['garmin:cn%3As:1'] }
const c = { id: 'coros:ab:9', sport: 'RUNNING', startedAt: '2026-10-20T10:01:30.000Z', distanceM: 5040, durationSec: 1810, source: 'import', originIds: ['dev-stable-x', 'coros:ab:9'] }
test('provider by stable identity prefix only', () => {
  assert.equal(providerOf('garmin:x:1'), 'GARMIN'); assert.equal(providerOf('coros:a:1'), 'COROS'); assert.equal(providerOf('佳明账号同步'), 'OTHER'); assert.equal(providerOf(null), 'OTHER')
  assert.equal(rowProvider(g), 'GARMIN'); assert.equal(rowProvider(c), 'COROS'); assert.equal(rowProvider({ ...c, originIds: ['dev-1'] }), 'OTHER')
})
test('same run within 2 min and similar distance = candidate; otherwise not', () => {
  assert.ok(sameActivityCandidate(c, g))
  assert.ok(!sameActivityCandidate({ ...c, startedAt: '2026-10-20T10:02:30.000Z' }, g))
  assert.ok(!sameActivityCandidate({ ...c, distanceM: 8000 }, g))
  assert.ok(!sameActivityCandidate({ ...c, sport: 'STRENGTH' }, g))
  assert.ok(!sameActivityCandidate({ ...c, distanceM: null, durationSec: null }, g))
  assert.ok(!sameActivityCandidate({ ...c, timeUnknown: true }, g))
})
test('cross-brand only: COROS vs COROS never flagged (stable IDs handle that); OTHER rows ignored', () => {
  assert.deepEqual([...crossBrandCandidates([c], [g], 'COROS')], [[c.id, g.id]])
  assert.equal(crossBrandCandidates([c], [{ ...c, id: 'coros:ab:8', originIds: ['coros:ab:8'] }], 'COROS').size, 0)
  assert.equal(crossBrandCandidates([c], [{ ...g, source: 'execution', originIds: ['occ1'] }], 'COROS').size, 0)
  assert.deepEqual(crossBrandPairsInLog([g, c]), [[c.id, g.id]])
})
test('COROS rows carry provenance and stay non-Garmin', () => {
  const [a] = corosToDevice([{ labelId: '4711', name: '', sportType: 100, date: '20261020', startTime: 1760925600, endTime: null, totalTime: 959, distance: 1410, avgHr: 150, maxHr: 178, calorie: null }], 'abcdef0123456789', '2026-10-21T00:00:00.000Z')
  assert.deepEqual(a.provenance, { provider: 'COROS', accountRef: 'abcdef0123456789', recordId: '4711', measuredAt: new Date(1760925600000).toISOString(), receivedAt: '2026-10-21T00:00:00.000Z' })
  assert.equal(providerOf(a.sourceIdentity), 'COROS')
})
test('expired / not logged in need re-login; bad password and transient errors do not', () => {
  assert.ok(corosNeedsLogin(new CorosError('x', 'TOKEN_EXPIRED', 401))); assert.ok(corosNeedsLogin(new CorosError('x', 'NOT_LOGGED_IN', 401)))
  assert.ok(!corosNeedsLogin(new CorosError('x', 'BAD_CREDENTIALS', 401))); assert.ok(!corosNeedsLogin(new CorosError('x', 'UPSTREAM', 502))); assert.ok(!corosNeedsLogin(new Error('net')))
})
