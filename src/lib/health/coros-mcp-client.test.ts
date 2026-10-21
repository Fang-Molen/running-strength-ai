import test from 'node:test'
import assert from 'node:assert/strict'
import { mcpToDevice, mergeCorosHealth, corosTrend } from './coros-mcp-client.ts'
import { corosLabelOf, providerOf } from './brand-isolation.ts'
const act = (o = {}) => ({ labelId: '4711abc', sportType: 100, sportName: 'Run', date: '2026-10-20', startIso: '2026-10-20T07:05:00.000Z', startLocal: null, durationSec: 1810, distanceM: 5020, avgHr: 150, maxHr: null, calories: null, issues: [], ...o })
test('MCP activity → COROS device row with provenance; missing id/time not saveable; other sports skipped', () => {
  const r = mcpToDevice([act(), act({ labelId: null }), act({ labelId: 'x2', startIso: null, startLocal: null }), act({ labelId: 'b1', sportType: 200, sportName: 'Bike' })], 'abcdef0123456789', '2026-10-21T00:00:00.000Z')
  assert.equal(r.rows.length, 1); assert.equal(r.unusable.length, 2); assert.equal(r.other, 1)
  const a = r.rows[0]; assert.equal(a.sourceIdentity, 'coros:abcdef0123456789:4711abc'); assert.equal(providerOf(a.sourceIdentity), 'COROS'); assert.equal(a.provenance?.recordId, '4711abc'); assert.equal(a.timeAssumed, false); assert.equal(a.calories, null)
  const local = mcpToDevice([act({ startIso: null, startLocal: '2026-10-20T07:05:00' })], null, '2026-10-21T00:00:00.000Z').rows[0]; assert.equal(local.timeAssumed, true); assert.equal(local.provenance?.accountRef, null)
})
test('old password-login records match new OAuth records by labelId', () => {
  assert.equal(corosLabelOf('coros:0123456789abcdef:4711abc'), '4711abc'); assert.equal(corosLabelOf('coros:mcp:4711abc'), '4711abc'); assert.equal(corosLabelOf('garmin:x:1'), null)
})
test('health cache merges by date without zero-filling; recovery keeps last real value', () => {
  const a = mergeCorosHealth(null, { fetchedAt: '2026-10-20T10:00:00.000Z', days: [{ date: '2026-10-20', hrvMs: 48 }], stress: [{ local: '2026-10-20T09:00:00', iso: null, value: 35 }], recovery: { percent: 80, level: null, fullRecoveryText: null }, issues: [], raw: {} })
  const b = mergeCorosHealth(a, { fetchedAt: '2026-10-21T10:00:00.000Z', days: [{ date: '2026-10-20', restingHr: 52, hrvMs: null }], stress: [], recovery: { percent: null, level: null, fullRecoveryText: null }, issues: ['x 待核'], raw: {} })
  assert.equal(b.days[0].hrvMs, 48); assert.equal(b.days[0].restingHr, 52); assert.equal(b.days[0].steps, undefined); assert.equal(b.recovery?.percent, 80); assert.equal(b.stress.length, 1)
})
test('per-brand baseline needs 7 prior complete days; otherwise null', () => {
  const days = Array.from({ length: 8 }, (_, i) => ({ date: `2026-10-${String(10 + i).padStart(2, '0')}`, hrvMs: 40 + i, restingHr: 50 }))
  const t = corosTrend(days, 'a', '2026-10-30'); assert.equal(t.at(-1)!.reference.hrvMs, 43); assert.equal(corosTrend(days.slice(0, 5), 'a', '2026-10-30').at(-1)!.reference.hrvMs, null)
})
