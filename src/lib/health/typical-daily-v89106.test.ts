import test from 'node:test'
import assert from 'node:assert/strict'
import { typicalDaily } from './intraday-recovery-bridge-v89'
import { importedRunDetail } from './recovery-host-u11'

const day = (i: number) => new Date(Date.UTC(2026, 9, 1 + i, 12)).toISOString().slice(0, 10)
test('daily 方坤 norm needs ≥7 prior days within 28 and uses only earlier days', () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({ d: day(i), v: 50 + i }))
  const n = typicalDaily(pts)
  assert.deepEqual(n.map(x => x.d), [day(7), day(8), day(9)])
  assert.equal(n[0].median, 53); assert.equal(n[0].days, 7)
  assert.ok(n[0].p25 <= n[0].median && n[0].median <= n[0].p75)
})
test('imported run card shows only recorded facts; unknowns are not invented', () => {
  const t = importedRunDetail({ title: { value: '晨跑' }, totalDistanceMeters: { value: 5000 }, durationSeconds: { value: 1500 } })
  assert.match(t, /晨跑 · 5\.00 km · 用时 25:00 · 配速 5:00\/km/)
  assert.match(t, /没算进肌肉负荷/)
  const u = importedRunDetail({ title: { value: null }, totalDistanceMeters: { value: null }, durationSeconds: { value: null } })
  assert.match(u, /没有距离\/用时/); assert.doesNotMatch(u, /km|配速/)
})
