import test from 'node:test'
import assert from 'node:assert/strict'
import { dateConflicts, loadDateConfirm, migrateUserConfirmedDates, saveDateConfirm, shiftedText, DATE_CONFIRM_KEY, type V4Plan } from './plan400-view.ts'
import planJson from '../../../test-fixtures/private/plan400-v4.json' with { type: 'json' }
const plan = planJson as unknown as V4Plan
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, m } }
test('v89.6 不再按个人计划自动写日期确认；已有确认保留；手动确认照常', () => {
  const before = JSON.stringify(plan), s = mem()
  migrateUserConfirmedDates(plan, s); assert.equal(loadDateConfirm(plan, s), null)
  assert.equal(JSON.stringify(plan), before)
  const s2 = mem(); s2.setItem(DATE_CONFIRM_KEY, JSON.stringify({ shiftDays: 7, at: '2026-10-19T02:46:00Z', by: '用户确认' })); migrateUserConfirmedDates(plan, s2); assert.ok(loadDateConfirm(plan, s2))
  // 换了顺延天数的计划 → 旧确认不算
  assert.equal(loadDateConfirm({ ...plan, shiftDays: 3 }, s), null)
  assert.ok(saveDateConfirm(plan, 'x', s)); assert.ok(loadDateConfirm(plan, s))
})
test('v78 标题显示顺延后日期：W3「10月31日」→「11月7日」，原标题不变', () => {
  const w3 = plan.weeks.find(w => w.week === 'W3')!
  assert.match(w3.title, /10月31日/)
  const c = dateConflicts(plan).find(x => x.week === 'W3')!; assert.equal(c.matchedDay?.date, '2026-11-07')
  assert.equal(shiftedText(plan, 'W3', w3.title), w3.title.replace('10月31日', '11月7日'))
  assert.match(w3.title, /10月31日/)
})
