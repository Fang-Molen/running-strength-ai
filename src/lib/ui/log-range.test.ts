import test from 'node:test'
import assert from 'node:assert/strict'
import { rangeOf, summarize, outsideHint, filterRows } from './log-range.ts'
const row = (id: string, date: string, sport: any, extra: any = {}) => ({ id, date, startedAt: date + 'T10:00:00+08:00', sport, distanceM: null, durationSec: null, strengthVolumeKg: null, sets: null, rpe: null, source: 'garmin', originIds: [id], ...extra })
const today = '2026-10-19' // Monday
test('本周 = Mon–Sun of today, by day; 近4周 = 4 weeks by week', () => {
  const w = rangeOf('week', today); assert.equal(w.start, '2026-10-19'); assert.equal(w.end, '2026-10-25'); assert.equal(w.buckets.length, 7)
  const f = rangeOf('4w', today); assert.equal(f.start, '2026-09-28'); assert.equal(f.buckets.length, 4); assert.equal(f.buckets[3].start, '2026-10-19')
})
test('summary, chart and list share the same filter; missing ≠ 0', () => {
  const rows = [row('a', '2026-10-18', 'RUNNING', { distanceM: 6010, durationSec: 1898 }), row('b', '2026-10-16', 'STRENGTH', { durationSec: 2700 }), row('c', '2026-10-12', 'RUNNING'), row('d', '2026-09-20', 'RUNNING', { durationSec: 600 })] as any
  const s = summarize(rows, '4w', 'run', today)
  assert.equal(s.count, 2); assert.equal(s.list.length, 2); assert.equal(s.distanceM, 6010); assert.equal(s.missingDistance, 1)
  assert.equal(s.bars.reduce((n, b) => n + b.count, 0), s.count)
  assert.equal(summarize(rows, '4w', 'lift', today).list[0].id, 'b')
  assert.equal(filterRows(rows, 'week', 'all', today).length, 0)
  assert.match(outsideHint(rows, 'week', 'run', today)!, /最近一条跑步在 2026-10-18/)
})
