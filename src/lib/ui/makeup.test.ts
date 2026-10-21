// v87.2（用户 2026-10-20）：10-19 的力量A 没做，10-20 补练 → 记录在 10-20、10-19 显示“力量补练于 10月20日”、周统计算在 10-20、只算一次。
process.env.TZ = 'Asia/Shanghai'
import assert from 'node:assert/strict'
import test from 'node:test'
import V4 from '../../../test-fixtures/private/plan400-v4.json' with { type: 'json' }
import { linkRuns, phoneRows, garminRows, detachMakeup, type ActivityRow } from './training-read-model.ts'
import { setRunDevice, saveComponent } from './plan400-components-store.ts'
import { v4ExecFrom } from './v4-exec.ts'
import { v4DayFact, dayStatus, type V4Day } from './plan400-view.ts'
import { partDoneOn, madeUpOn } from './makeup.ts'
import { summarize } from './log-range.ts'
const D = (V4 as { days: V4Day[] }).days.find(d => d.date === '2026-10-19')!, NOW = Date.parse('2026-10-20T06:00:00Z'), T = '2026-10-20'
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } } }
const garmin = { a: { id: 41019, name: '操场', type: 'track_running', start: '2026-10-19T10:00:00Z', dist: 3200, dur: 1500 } }
const execRow = (startedAt: string): ActivityRow => { const r = { id: 'o1', startedAt, date: startedAt.slice(0, 10) === '2026-10-20' || Date.parse(startedAt) >= Date.parse('2026-10-19T16:00:00Z') ? '2026-10-20' : '2026-10-19', sport: 'STRENGTH', distanceM: null, durationSec: 1800, strengthVolumeKg: 1000, sets: 10, rpe: null, source: 'execution', occurrenceId: 'o1', title: '力量', status: 'completed',
  originIds: ['o1', 'sched:scheduled:plan400:2026-10-19:strength', 'plan400:2026-10-19', 'sched:plan400:2026-10-19:strength'] } as ActivityRow; detachMakeup(r, 'scheduled:plan400:2026-10-19:strength'); return r }

test('执行日期 = 开始时间的本地日期（strengthOn）', () => {
  const occ = [{ trainingOccurrenceId: 'o1', sessionId: 'scheduled:plan400:2026-10-19:strength:strength', lifecycle: 'COMPLETED', startedAt: '2026-10-20T02:00:00Z' }] as never
  const ev = [{ event_type: 'TRAINING_SET_COMPLETED', payload: { trainingOccurrenceId: 'o1', completed: true } }] as never
  assert.deepEqual(v4ExecFrom(occ, ev, () => false)['2026-10-19'], { strength: 'COMPLETED', strengthOn: '2026-10-20' })
})
test('唯一出处：执行日期 ＞ 用户填的实际日期 ＞ 计划当天', () => {
  assert.equal(partDoneOn('2026-10-19', 'strength', {}), '2026-10-19')
  assert.equal(partDoneOn('2026-10-19', 'strength', { parts: { strength: { doneOn: '2026-10-20' } } }), '2026-10-20')
  assert.equal(partDoneOn('2026-10-19', 'strength', { strengthOn: '2026-10-19', parts: { strength: { doneOn: '2026-10-21' } } }), '2026-10-19')
  assert.equal(madeUpOn('2026-10-19', 'strength', { strengthOn: '2026-10-19' }), null)
})
test('10-19 计划：跑步当天做（手表已关联）＋力量 10-20 逐组补练 → 10-19 整课完成、标“力量补练于 10月20日”；记录分两天、各算一次', () => {
  const f = v4DayFact(D, undefined, { runLinked: true, strengthExec: 'COMPLETED', strengthOn: T })
  assert.equal(f.madeUp.strength, T); assert.match(f.strength!.label, /补练于 10月20日/); assert.equal(f.strength!.state, 'done')
  assert.equal(dayStatus(D, undefined, T, false, { runLinked: true, strengthExec: 'COMPLETED', strengthOn: T }), 'done')
  const s = mem(); setRunDevice('2026-10-19', { sourceIdentity: 'garmin:41019', source: 'garmin', linkedBy: 'user' }, undefined, s)
  const rows = linkRuns([execRow('2026-10-20T02:00:00Z'), ...phoneRows(s, NOW), ...garminRows(garmin)], s, NOW, { '2026-10-19': { strength: 'COMPLETED', strengthOn: T } })
  const d19 = rows.filter(r => r.date === '2026-10-19'), d20 = rows.filter(r => r.date === T)
  assert.equal(d19.length, 1); assert.equal(d19[0].sport, 'RUNNING'); assert.equal(d19[0].status, 'completed'); assert.match(d19[0].title!, /力量补练于 10月20日/)
  assert.equal(d20.length, 1); assert.equal(d20[0].sport, 'STRENGTH'); assert.equal(d20[0].makeupOf, '2026-10-19'); assert.match(d20[0].title!, /补练·原定 10月19日/)
  const w = summarize(rows, 'week', 'all', T)
  assert.equal(w.count, 2); assert.equal(w.run, 1); assert.equal(w.lift, 1)
  assert.equal(w.bars.find(b => b.start === T)!.count, 1); assert.equal(w.bars.find(b => b.start === '2026-10-19')!.count, 1)
})
test('手动补练（力量评价里填实际日期 10-20，没有逐组记录）→ 10-20 一条力量、10-19 不再按力量计；没跑步时 10-19 那条不计数', () => {
  const s = mem(); assert.ok(saveComponent('2026-10-19', 'strength', { status: 'done', rpe: 6, doneOn: T }, s))
  const rows = linkRuns(phoneRows(s, NOW), s, NOW)
  const d20 = rows.filter(r => r.date === T), d19 = rows.filter(r => r.date === '2026-10-19')
  assert.equal(d20.length, 1); assert.equal(d20[0].sport, 'STRENGTH'); assert.equal(d20[0].status, 'completed'); assert.equal(d20[0].makeupOf, '2026-10-19')
  assert.ok(d19.every(r => r.status === 'incomplete'), '计划那天只显示，不重复计数')
  const w = summarize(rows, 'week', 'all', T); assert.equal(w.lift, 1); assert.equal(w.count, 1)
})
test('计划当天做的执行不受影响：仍并成同一条', () => {
  const s = mem(); setRunDevice('2026-10-19', { sourceIdentity: 'garmin:41019', source: 'garmin', linkedBy: 'user' }, undefined, s)
  const rows = linkRuns([execRow('2026-10-19T12:00:00Z'), ...phoneRows(s, NOW), ...garminRows(garmin)], s, NOW, { '2026-10-19': { strength: 'COMPLETED', strengthOn: '2026-10-19' } })
  assert.equal(rows.length, 1); assert.equal(rows[0].sport, 'MIXED'); assert.equal(rows[0].makeupOf, undefined)
})
