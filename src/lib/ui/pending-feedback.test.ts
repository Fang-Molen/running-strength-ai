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

test('v83: 跑步已手动评价但同日手表跑步未确认 → 仍待确认', () => {
  const d = (V4.days as V4Day[]).find(x => x.date === '2026-10-19')!
  const items = pendingFeedback([d], { '2026-10-19': { parts: { running: { status: 'done', rpe: 8 } } as never, runCandidates: 1 } }, {}, '2026-10-19')
  assert.deepEqual(items.map(i => i.kind), ['confirm_run'])
})

test('v87.1: 恢复课（非组合）在课后整课表填了反馈（fk-plan400-v4-log）→ 不再待评价；稍后过也一样消失', () => {
  const d = (V4.days as V4Day[]).find(x => x.date === '2026-10-20')!
  assert.match(d.title, /恢复/)
  const x = { '2026-10-20': { runLinked: true } }, pr = ['2026-10-20|garmin:1']
  assert.equal(pendingFeedback([d], x, {}, T, pr)[0].kind, 'rate_run')
  for (const log of [{ rpe: '3' }, { done: 'done' }, { note: '轻松' }, { pain: '无' }])
    assert.equal(pendingFeedback([d], x, { '2026-10-20': log }, T, pr).length, 0, JSON.stringify(log))
  // 只有训练中记录（成绩）不算评价
  assert.equal(pendingFeedback([d], x, { '2026-10-20': { reps: '5.79km' } }, T, pr).length, 1)
})
test('v87.1: 组合课的旧整课分不复制给分项 → 仍待分项评价', () => {
  const d = (V4.days as V4Day[]).find(x => x.date === '2026-10-19')!
  assert.equal(pendingFeedback([d], { '2026-10-19': { runLinked: true } }, { '2026-10-19': { rpe: '7' } }, T).length, 1)
})

test('v88.1: 组合课跑步已关联、没填 RPE，但 24h 跑步腿感填了“无” → 不再待补；只填力量酸痛 → 跑步仍待补；48–72h 从不进列表', async () => {
  const { pendingLabel } = await import('./pending-feedback.ts')
  const d = (V4.days as V4Day[]).find(x => x.date === '2026-10-19')!
  const base = { runLinked: true, strengthExec: 'COMPLETED' as const, parts: { strength: { status: 'done' as const, rpe: 3 } } }
  const a = pendingFeedback([d], { '2026-10-19': base }, {}, T)
  assert.deepEqual(a.map(i => i.kind), ['rate_run'])
  assert.equal(pendingLabel(a[0], d.title), '10月19日「速度耐力＋力量A」 跑步：已关联手表·待评价')
  assert.equal(pendingFeedback([d], { '2026-10-19': { ...base, parts: { ...base.parts, recovery: { runLegs24: '无' } } } as never }, {}, T).length, 0)
  assert.equal(pendingFeedback([d], { '2026-10-19': { ...base, parts: { ...base.parts, recovery: { strengthSoreness24: '无' } } } as never }, {}, T).length, 1)
  assert.ok(pendingFeedback([d], { '2026-10-19': { ...base, parts: { ...base.parts, running: { rpe: 4 } } } }, {}, '2026-10-21').every(i => !/48|72/.test(i.text)))
})
