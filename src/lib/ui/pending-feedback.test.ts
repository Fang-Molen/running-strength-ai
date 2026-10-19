// v83 整改包 P1-07：“稍后”不丢——待补反馈由事实推出
import assert from 'node:assert/strict'
import test from 'node:test'
import V4 from '../plan400-v4.json' with { type: 'json' }
import { pendingFeedback } from './pending-feedback.ts'
import type { V4Day } from './plan400-view.ts'
const days = (V4 as { days: V4Day[] }).days, T = '2026-10-20'
test('候选未确认 → 待补“确认手表跑步”；点过稍后 → 仍在列表（标已推迟）', () => {
  const a = pendingFeedback(days, { '2026-10-19': { runCandidates: 1 } }, {}, T, [])
  assert.deepEqual(a.map(x => [x.date, x.kind, x.deferred]), [['2026-10-19', 'confirm_run', false]])
  const b = pendingFeedback(days, { '2026-10-19': { runCandidates: 1 } }, {}, T, ['2026-10-19|garmin:1'])
  assert.equal(b.length, 1); assert.equal(b[0].deferred, true)
})
test('已确认关联但没评价 → 待评价；填了跑步评价 → 离开列表；力量逐组完成没评价 → 待评价', () => {
  assert.equal(pendingFeedback(days, { '2026-10-19': { runLinked: true } }, {}, T)[0].kind, 'rate_run')
  assert.equal(pendingFeedback(days, { '2026-10-19': { runLinked: true, parts: { running: { rpe: 7 } } } }, {}, T).length, 0)
  const l = pendingFeedback(days, { '2026-10-19': { strengthExec: 'COMPLETED' } }, {}, T)
  assert.deepEqual(l.map(x => x.kind), ['rate_lift'])
  assert.equal(pendingFeedback(days, { '2026-10-19': { strengthExec: 'COMPLETED', parts: { strength: { status: 'done' } } } }, {}, T).length, 0)
})
test('未来日期、14 天外不进列表', () => {
  assert.equal(pendingFeedback(days, { '2026-10-21': { runLinked: true } }, {}, T).length, 0)
  assert.equal(pendingFeedback(days, { '2026-10-19': { runLinked: true } }, {}, '2026-11-20').length, 0)
})
