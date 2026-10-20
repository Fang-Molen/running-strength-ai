// v88（R2 B12/B13）：组合课跑步、力量各自状态；改期后原日期不再催评分
import assert from 'node:assert/strict'
import test from 'node:test'
import V4 from '../plan400-v4.json' with { type: 'json' }
import { componentCta, comboShort, dayStatus, type V4Day } from './plan400-view.ts'
import { pendingFeedback } from './pending-feedback.ts'
const D = (V4 as { days: V4Day[] }).days.find(d => d.date === '2026-10-19')!, T = '2026-10-19'
test('跑步完成（关联手表）、力量没开始 → 主按钮“开始力量部分”，列表“跑步完成·力量待练”，整天不算完成', () => {
  const x = { runLinked: true }
  const s = dayStatus(D, undefined, T, false, x)
  assert.equal(s, 'in_progress')
  assert.deepEqual(componentCta(D, undefined, x, s), { label: '开始力量部分', action: 'start' })
  assert.equal(comboShort(D, undefined, x), '跑步完成·力量待练')
})
test('力量做完、跑步没做 → “开始跑步部分”；两项都完成 → 查看记录；正在逐组 → 继续训练', () => {
  const x = { strengthExec: 'COMPLETED' as const }
  assert.equal(componentCta(D, undefined, x, dayStatus(D, undefined, T, false, x)).label, '开始跑步部分')
  const both = { runLinked: true, strengthExec: 'COMPLETED' as const }
  assert.equal(componentCta(D, undefined, both, dayStatus(D, undefined, T, false, both)).action, 'review')
  assert.equal(componentCta(D, undefined, { runLinked: true }, 'in_progress', true).label, '继续训练')
  assert.equal(comboShort(D, undefined, {}), null)
})
test('原日期已改期且没有实际 → 不催；有真实跑步 → 仍要评价', () => {
  const moved = new Set([T])
  assert.equal(pendingFeedback([D], { [T]: { runCandidates: 1 } }, {}, '2026-10-20', [], 14, moved).length, 0)
  assert.equal(pendingFeedback([D], { [T]: { runLinked: true } }, {}, '2026-10-20', [], 14, moved)[0].kind, 'rate_run')
})
