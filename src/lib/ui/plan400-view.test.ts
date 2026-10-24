import '../../../test-fixtures/synthetic/install-plan.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { currentWeek, dateConflicts, dayKind, dayOf, dayStatus, entryLink, hasStrength, primaryCta, progressCounts, shiftSummary, weekDays, type V4Plan } from './plan400-view.ts'

const raw = readFileSync(new URL('../../../test-fixtures/synthetic/plan400-v4.json', import.meta.url), 'utf8')
const plan = JSON.parse(raw) as V4Plan

test('public synthetic fixture stays immutable during view projections (not the private V4 checksum)', () => {
  assert.equal(createHash('sha256').update(raw).digest('hex'), '6de961750547d1f3b6989efd193c833bf343ea284ecc535982b655d5075579fb')
})
test('71 = 70 calendar days (W1–W10 incl. rest/recovery) + 1 final test; not 71 training sessions', () => {
  const c = progressCounts(plan, {})
  assert.equal(c.calendarEntries, 71)
  assert.equal(plan.weeks.length, 10)
  assert.equal(c.trainingDays + c.recoveryDays + c.restDays + c.testDays, 71)
  assert.ok(c.trainingDays < 71 && c.restDays > 0 && c.testDays === 2)
  assert.equal(c.recordedDays, 0)
})
test('skipped / rest days never count as completed training', () => {
  const rest = plan.days.find(d => dayKind(d) === 'rest')!
  const train = plan.days.find(d => dayKind(d) === 'train')!
  const c = progressCounts(plan, { [rest.date]: { done: 'done' }, [train.date]: { done: 'skipped' } })
  assert.equal(c.completedTrainingDays, 0); assert.equal(c.skippedDays, 1); assert.equal(c.recordedDays, 2)
})
test('W3 title says 10/31 but shown week is 11/2–11/8 → reported, matched to shifted test day, not fixed', () => {
  const before = JSON.stringify(plan)
  const cs = dateConflicts(plan)
  const w3 = cs.filter(c => c.week === 'W3')
  assert.equal(w3.length, 1)
  assert.equal(w3[0].mentioned, '2026-10-31'); assert.equal(w3[0].shownRange, '11/2—11/8'); assert.equal(w3[0].originalRange, '10/26—11/01')
  assert.deepEqual(w3[0].matchedDay, { orig: '2026-10-31', date: '2026-11-07', weekday: '周六', title: '阶段测试' })
  assert.equal(JSON.stringify(plan), before)
  assert.deepEqual(shiftSummary(plan), { shifted: 71, total: 71, shiftDays: 7, uniform: true })
})
test('today 10/19 binds to W1 day 1 (速度耐力＋力量A) with strength component; final test 12/28', () => {
  assert.equal(currentWeek(plan, '2026-10-19'), 'W1')
  const d = dayOf(plan, '2026-10-19')!
  assert.equal(d.title, '速度耐力＋力量A'); assert.ok(hasStrength(d))
  assert.equal(weekDays(plan, 'W1').length, 7)
  assert.equal(dayOf(plan, '2026-12-28')?.title, '最终测试')
  assert.equal(currentWeek(plan, '2026-01-01'), 'W1'); assert.equal(currentWeek(plan, '2027-03-01'), 'W10')
})
test('status → exactly one primary CTA; rest day is not "unscheduled"; past unlogged = 需补录', () => {
  const d = dayOf(plan, '2026-10-19')!, rest = dayOf(plan, '2026-10-23')!
  assert.equal(dayStatus(d, undefined, '2026-10-19'), 'not_started'); assert.equal(primaryCta('not_started').label, '开始今日训练')
  assert.equal(dayStatus(d, { reps: '21.3' }, '2026-10-19'), 'in_progress'); assert.equal(primaryCta('in_progress').label, '继续训练')
  assert.equal(dayStatus(d, undefined, '2026-10-19', true), 'in_progress')
  assert.equal(dayStatus(d, { done: 'done' }, '2026-10-19'), 'done')
  assert.equal(dayStatus(d, undefined, '2026-10-20'), 'unrecorded')
  assert.equal(dayStatus(rest, undefined, '2026-10-19'), 'rest')
})
test('temp sessions are linked only by real id, never by date/title', () => {
  assert.equal(entryLink(plan, { id: 'plan400:2026-10-19:strength', date: '2026-10-19', source: 'custom' }).linkedToV4, true)
  const l = entryLink(plan, { id: 'fk-123', date: '2026-10-19', source: 'custom' })
  assert.equal(l.linkedToV4, false); assert.equal(l.sameDayV4?.title, '速度耐力＋力量A')
  assert.equal(entryLink(plan, { id: 'x', date: '2026-10-25', source: 'fangkun' }).sourceLabel, '方坤安排')
  assert.deepEqual(entryLink(plan, { id: 'x', date: '2026-10-25', source: 'fangkun' }).sameDayV4, { title: '恢复', kind: 'recovery' })
  assert.equal(entryLink(plan, { id: 'x', date: '2026-10-23', source: 'custom' }).sameDayV4, undefined) // V4 休息日不算冲突
})
