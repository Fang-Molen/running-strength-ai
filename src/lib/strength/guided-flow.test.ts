import test from 'node:test'
import assert from 'node:assert/strict'
import { afterStep, addRest, remainingMs, parseRpe, decodeGuided, type FlowMove, type FlowSet } from './guided-flow.ts'
const moves: FlowMove[] = [
  { id: 'split', name: '分腿蹲', sets: 2, perSide: true, restSec: 75, sideRestSec: 15, betweenRestSec: 120 },
  { id: 'rdl', name: 'RDL', sets: 2, restSec: 75, betweenRestSec: 120 },
]
const sets = (): FlowSet[] => [{ moveId: 'split', setIndex: 1, done: false }, { moveId: 'split', setIndex: 2, done: false }, { moveId: 'rdl', setIndex: 1, done: false }, { moveId: 'rdl', setIndex: 2, done: false }]
test('unilateral: left -> 换侧间隔 15s -> right of same set', () => {
  assert.deepEqual(afterStep(moves, sets(), 0, 'L'), { kind: 'side', seconds: 15, cursor: 0, side: 'R' })
})
test('right side done -> 组间休息 75s -> next set starts on left', () => {
  assert.deepEqual(afterStep(moves, sets(), 0, 'R'), { kind: 'set', seconds: 75, cursor: 1, side: 'L' })
})
test('last set of a move -> 动作之间休息 -> next exercise', () => {
  const s = sets(); s[0].done = true
  assert.deepEqual(afterStep(moves, s, 1, 'R'), { kind: 'between', seconds: 120, cursor: 2, side: null })
})
test('bilateral set rest and finish after last set', () => {
  const s = sets(); s[0].done = s[1].done = true
  assert.deepEqual(afterStep(moves, s, 2, null), { kind: 'set', seconds: 75, cursor: 3, side: null })
  s[2].done = true
  assert.equal(afterStep(moves, s, 3, null).kind, 'finish')
})
test('between rest falls back to set rest; missing side rest = 0 (direct switch)', () => {
  const m: FlowMove[] = [{ id: 'a', name: 'A', sets: 1, perSide: true, restSec: 60 }, { id: 'b', name: 'B', sets: 1, restSec: 90 }]
  const s: FlowSet[] = [{ moveId: 'a', setIndex: 1, done: false }, { moveId: 'b', setIndex: 1, done: false }]
  assert.deepEqual(afterStep(m, s, 0, 'L'), { kind: 'side', seconds: 0, cursor: 0, side: 'R' })
  assert.deepEqual(afterStep(m, s, 0, 'R'), { kind: 'between', seconds: 60, cursor: 1, side: null })
})
test('skipped/earlier open sets are revisited after the end', () => {
  const s = sets(); s[2].done = s[3].done = true
  assert.deepEqual(afterStep(moves, s, 1, 'R'), { kind: 'set', seconds: 75, cursor: 0, side: 'L' })
})
test('timestamp clock survives background: remaining from deadline, +15s, skip', () => {
  const now = 1_000_000
  assert.equal(remainingMs(now + 75_000, 0, now + 60_000), 15_000)
  assert.equal(remainingMs(now + 75_000, 0, now + 999_000), 0)
  assert.deepEqual(addRest(now + 10_000, 0, now, 15), { deadlineMs: now + 25_000, remainingMs: 25_000 })
  assert.deepEqual(addRest(null, 5_000, now, 15), { deadlineMs: null, remainingMs: 20_000 })
})
test('RPE accepts decimals 1–10, blank is unknown', () => {
  assert.equal(parseRpe('7.5'), 7.5); assert.equal(parseRpe('8，5'), 8.5); assert.equal(parseRpe(''), null)
  assert.equal(parseRpe('11'), 'invalid'); assert.equal(parseRpe('abc'), 'invalid')
})
test('guided state decode rejects garbage', () => {
  assert.equal(decodeGuided('{"version":1,"side":"X"}'), null); assert.equal(decodeGuided('nope'), null)
  assert.equal(decodeGuided('{"version":1,"side":"R","restKind":"side","restSide":"R","restStartedAt":1}')?.side, 'R')
})
