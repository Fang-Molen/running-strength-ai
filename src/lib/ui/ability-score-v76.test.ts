import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreAbilities } from './ability-score-v76.ts'
const asOf = '2026-10-19'
test('no data => every axis 待评估 with reason, never 0', () => {
  const r = scoreAbilities({ asOf, marks: [], acts: [], laps: {}, lifts: [], bodyWeightKg: null })
  assert.equal(r.length, 5); for (const a of r) { assert.equal(a.score, null); assert.equal(a.reason, '缺记录'); assert.ok(a.reasonText.length > 10) }
})
test('scores come from real inputs with transparent formulas', () => {
  const acts = [{ id: 1, start: '2026-10-15T10:00:00Z', type: 'track_running', dist: 4000, dur: 1200, vo2: 54, vr: 8 }]
  const laps = { '1': [[400, 62], [400, 63], [400, 64], [400, 65.5]].map(([d, t]) => ({ dist: d, dur: t })) }
  const r = Object.fromEntries(scoreAbilities({ asOf, marks: [{ meters: 400, recentSec: 58, goalSec: 53.5 }], acts, laps, lifts: [{ name: '杠铃深蹲', weightKg: 100, reps: 5, date: '2026-10-10' }], bodyWeightKg: 70 }).map(a => [a.key, a]))
  assert.equal(r.speed.score, Math.round(100 * 53.5 / 58)) // PB 58 better than laps 62
  assert.match(r.speed.inputs[0], /最近 400 米成绩/)
  const decay = ((64.75 - 62.5) / 62.5) * 100; assert.equal(r.speedEndurance.score, Math.round(100 - 10 * decay))
  assert.equal(r.endurance.score, 60)
  assert.equal(r.strength.score, Math.round(100 * (100 * (1 + 5 / 30)) / 70 / 2))
  assert.equal(r.economy.score, 75)
})
test('missing bodyweight keeps strength pending (no invented weight)', () => {
  const r = scoreAbilities({ asOf, marks: [], acts: [], laps: {}, lifts: [{ name: '深蹲', weightKg: 80, reps: 5, date: '2026-10-10' }], bodyWeightKg: null })
  const s = r.find(a => a.key === 'strength')!; assert.equal(s.score, null); assert.match(s.reasonText, /缺体重/)
})
test('400m laps inside a road run are not a speed test (条件不可比)', () => {
  const r = scoreAbilities({ asOf, marks: [], acts: [{ id: 3, start: '2026-10-18T05:54:00Z', type: 'running', dist: 6010, dur: 1898 }], laps: { '3': [{ dist: 400, dur: 66 }] }, lifts: [], bodyWeightKg: null })
  const s = r.find(a => a.key === 'speed')!; assert.equal(s.score, null); assert.equal(s.reason, '条件不可比')
})
