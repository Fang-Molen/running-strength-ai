import test from 'node:test'
import assert from 'node:assert/strict'
import { dateConflicts, loadDateConfirm, migrateUserConfirmedDates, saveDateConfirm, shiftedText, DATE_CONFIRM_KEY, type V4Plan } from './plan400-view.ts'
import planJson from '../plan400-v4.json' with { type: 'json' }
const plan = planJson as unknown as V4Plan
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, m } }
test('v78 用户确认 W1=10/19：升级写一次确认，原课表不改；撤销后不再自动写', () => {
  const before = JSON.stringify(plan), s = mem()
  migrateUserConfirmedDates(plan, s); const c = loadDateConfirm(plan, s)
  assert.ok(c && c.shiftDays === 7 && /用户确认/.test(c.by))
  assert.equal(JSON.stringify(plan), before)
  const s2 = mem(); s2.setItem(DATE_CONFIRM_KEY + ':revoked', '1'); migrateUserConfirmedDates(plan, s2); assert.equal(loadDateConfirm(plan, s2), null)
  // 换了顺延天数的计划 → 旧确认不算
  assert.equal(loadDateConfirm({ ...plan, shiftDays: 3 }, s), null)
  assert.ok(saveDateConfirm(plan, 'x', s))
})
test('v78 标题显示顺延后日期：W3「10月31日」→「11月7日」，原标题不变', () => {
  const w3 = plan.weeks.find(w => w.week === 'W3')!
  assert.match(w3.title, /10月31日/)
  const c = dateConflicts(plan).find(x => x.week === 'W3')!; assert.equal(c.matchedDay?.date, '2026-11-07')
  assert.equal(shiftedText(plan, 'W3', w3.title), w3.title.replace('10月31日', '11月7日'))
  assert.match(w3.title, /10月31日/)
})
