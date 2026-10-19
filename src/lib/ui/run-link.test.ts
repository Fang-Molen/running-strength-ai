// v79（用户 t492/t493）：计划跑步课 ↔ 佳明跑步
process.env.TZ = 'Asia/Shanghai'
import test from 'node:test'
import assert from 'node:assert/strict'
import { matchRuns, planVsActual, planKm } from './run-link.ts'
import { garminRows, mergeActivities, phoneRows } from './training-read-model.ts'
import { summarize } from './log-range.ts'
const E = (o: Record<string, unknown>) => ({ kind: 'run', modality: 'run', trainingType: 'run', focus: [], intensity: 'EASY', lowerHeavy: false, refId: null, status: 'planned', ...o }) as never
const easy = E({ id: 'run-1018', date: '2026-10-18', title: '轻松跑', minutes: 60, source: 'fangkun' })
const k8 = E({ id: 'run-1017', date: '2026-10-17', title: '跑步 8公里 ×1', minutes: 40, source: 'custom' })
const lift = { id: 'lift-1018', date: '2026-10-18', kind: 'strength', modality: 'strength', trainingType: 'strength', title: '力量·小腿', minutes: 40, source: 'custom', refId: null, status: 'planned' } as never
// 用户形态：佳明 10-18 07:30 上海（10-17 23:30Z）6.01km；10-17 晚 6.37km
const g = garminRows({ a: { id: 31018, name: '晨跑', type: 'running', start: '2026-10-17T23:30:00Z', dist: 6010, dur: 1897.6, avgHr: 143.6 }, b: { id: 31017, name: '杭州市 跑步', type: 'running', start: '2026-10-17T10:30:00Z', dist: 6370, dur: 2050, avgHr: 144 } })
const rows = mergeActivities(g)
test('同一北京日期 1 对 1 → 自动关联；计划不改；力量课不受影响', () => {
  const m = matchRuns([easy, k8, lift], rows, {}, '2026-10-19')
  assert.deepEqual(m.links.map(l => [l.entry.id, l.run.date, l.by]).sort(), [['run-1017', '2026-10-17', 'auto'], ['run-1018', '2026-10-18', 'auto']])
  assert.equal(m.suggestions.length, 0)
  assert.ok(!m.links.some(l => l.entry.id === 'lift-1018'))
  assert.equal((easy as { status: string }).status, 'planned')
})
test('只算一次：日志/统计里只有 2 条佳明跑步，计划课不生成第二条', () => {
  const all = mergeActivities([...g, ...phoneRows({ getItem: k => k === 'fk-schedule-v1' ? JSON.stringify({ entries: [easy, k8] }) : null }, Date.parse('2026-10-19T01:30:00Z'))])
  const s = summarize(all, '4w', 'all', '2026-10-19'); assert.equal(s.count, 2); assert.equal(s.run, 2); assert.equal(Math.round(s.distanceM), 12380)
})
test('同一天两条跑步 / 只有相邻一天 → 只给“是这次吗？”建议，不自动', () => {
  const two = mergeActivities([...g, ...garminRows({ c: { id: 31019, name: '夜跑', type: 'running', start: '2026-10-18T12:00:00Z', dist: 3000, dur: 900 } })])
  const m = matchRuns([easy], two, {}, '2026-10-19'); assert.equal(m.links.length, 0); assert.equal(m.suggestions[0].runs.length, 2)
  const adj = matchRuns([E({ id: 'r16', date: '2026-10-16', title: '轻松跑', minutes: 40, source: 'custom' })], rows, {}, '2026-10-19')
  assert.equal(adj.links.length, 0); assert.equal(adj.suggestions[0].runs[0].date, '2026-10-17')
})
test('用户确认/取消关联', () => {
  const two = mergeActivities([...g, ...garminRows({ c: { id: 31019, name: '夜跑', type: 'running', start: '2026-10-18T12:00:00Z', dist: 3000, dur: 900 } })])
  const night = two.find(r => r.title === '夜跑')!
  assert.equal(matchRuns([easy], two, { 'run-1018': { garminId: night.id, by: 'user' } }, '2026-10-19').links[0].run.title, '夜跑')
  const morning = rows.find(r => r.date === '2026-10-18')!
  const un = matchRuns([easy], rows, { 'run-1018': { rejected: [morning.id] } }, '2026-10-19'); assert.equal(un.links.length, 0); assert.ok(!un.suggestions.flatMap(x => x.runs).some(r => r.id === morning.id))
})
test('计划 vs 实际 偏差说明', () => {
  assert.equal(planKm(k8 as never), 8)
  const c = planVsActual(k8 as never, rows.find(r => r.date === '2026-10-17')!)
  assert.match(c.plan, /8 km · 40 分钟/); assert.match(c.actual, /6\.37 km · 34 分钟 · 5'2\d"\/km · 心率 144/); assert.match(c.note, /距离少 1\.6 km/)
  assert.match(planVsActual(easy as never, rows.find(r => r.date === '2026-10-18')!).note, /时长少 28 分钟/)
})
