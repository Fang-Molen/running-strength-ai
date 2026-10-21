import test from 'node:test'
import assert from 'node:assert/strict'
import { corosToDevice, corosSport } from './coros-account-sync.ts'
const base = { labelId: '4711', name: '晨跑', sportType: 100, date: '20261020', startTime: 1760925600, endTime: null, totalTime: 959, distance: 1410.4, avgHr: 150, maxHr: 178, calorie: 90000 }
test('maps a COROS run to a confirm-before-save device activity with stable identity', () => {
  const [a] = corosToDevice([base], 'abcdef0123456789')
  assert.equal(a.sport, 'RUNNING'); assert.equal(a.sourceIdentity, 'coros:abcdef0123456789:4711'); assert.equal(a.distanceM, 1410); assert.equal(a.durationSec, 959)
  assert.equal(a.startIso, new Date(1760925600 * 1000).toISOString()); assert.deepEqual(a.sets, [])
})
test('ms epoch accepted, bad ref or id rejected, implausible values dropped, no body battery fields', () => {
  assert.equal(corosToDevice([{ ...base, startTime: 1760925600000 }], 'abcdef0123456789')[0].startIso, new Date(1760925600000).toISOString())
  assert.equal(corosToDevice([base], 'token-like-ref!').length, 0)
  assert.equal(corosToDevice([{ ...base, labelId: '' }], 'abcdef0123456789').length, 0)
  const [a] = corosToDevice([{ ...base, avgHr: 0, distance: -5, startTime: null }], 'abcdef0123456789')
  assert.equal(a.avgHr, null); assert.equal(a.distanceM, null); assert.equal(a.startIso, '2026-10-20T12:00:00')
  assert.ok(!('bodyBattery' in a))
})
test('sport codes', () => { assert.equal(corosSport(102), 'RUNNING'); assert.equal(corosSport(402), 'STRENGTH'); assert.equal(corosSport(200), 'UNKNOWN'); assert.equal(corosSport(null), 'UNKNOWN') })
