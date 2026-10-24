import '../../../test-fixtures/synthetic/install-plan.ts'
// v83 整改包验收（L1 纯函数 / L2 存储模拟）。编号对应 02_验收与测试 的 A01–A22 / N01–N24。
// L3（真实浏览器）见 qa/v83-matrix.mjs；L4（真实 Garmin/真机）未做，不在这里声称通过。
process.env.TZ = 'Asia/Shanghai'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import V4 from '../../../test-fixtures/synthetic/plan400-v4.json' with { type: 'json' }
import { v4DayFact, dayStatus, progressCounts, type V4Day, type V4Plan } from './plan400-view.ts'
import { v4ExecFrom } from './v4-exec.ts'
import { phoneRows, garminRows, linkRuns, mergeActivities } from './training-read-model.ts'
import { saveComponent, setRunDevice, loadComponents } from './plan400-components-store.ts'
import { summarize } from './log-range.ts'
import { todayCoordinationParts, coachCoordinationView } from './coach-coordination-view.ts'
const days = (V4 as { days: V4Day[] }).days, D = days.find(d => d.date === '2026-10-19')!
const NOW = Date.parse('2026-10-19T12:30:00Z')
const mem = (o: Record<string, unknown> = {}) => { const m = new Map(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, keys: () => [...m.keys()] } }
const garmin = { a: { id: 41019, name: '操场', type: 'track_running', start: '2026-10-19T10:00:00Z', dist: 3200, dur: 1500, avgHr: 150 } }

test('A01/N08：旧整课 done + 新版跑步跳过、力量未记 → 进行中，不算整课完成', () => {
  const f = v4DayFact(D, { done: 'done', rpe: '7' }, { parts: { running: { status: 'skipped' } } })
  assert.equal(f.overall, 'in_progress'); assert.equal(f.legacyOverall, false)
  assert.equal(dayStatus(D, { done: 'done' }, '2026-10-19', false, { parts: { running: { status: 'skipped' } } }), 'in_progress')
  const c = progressCounts(V4 as unknown as V4Plan, { '2026-10-19': { done: 'done' } }, { '2026-10-19': { parts: { running: { status: 'skipped' } } } })
  assert.equal(c.completedTrainingDays, 0)
})
test('A02/N07：只有力量逐组完成 → 力量完成、跑步未记录；日志不是 MIXED/完成跑步', () => {
  const occ = [{ trainingOccurrenceId: 'o1', sessionId: 'scheduled:plan400:2026-10-19:strength:strength', lifecycle: 'COMPLETED' }] as never
  const ev = [{ event_type: 'TRAINING_SET_COMPLETED', payload: { trainingOccurrenceId: 'o1', completed: true } }] as never
  const exec = v4ExecFrom(occ, ev, () => false); assert.equal(exec['2026-10-19'].strength, 'COMPLETED')
  const f = v4DayFact(D, undefined, { strengthExec: exec['2026-10-19'].strength })
  assert.equal(f.strength?.state, 'done'); assert.equal(f.running?.state, 'none'); assert.equal(f.actualRun, false)
  const rows = linkRuns(phoneRows(mem(), NOW), mem(), NOW, exec)
  const r = rows.find(x => x.v4)!; assert.equal(r.sport, 'STRENGTH'); assert.match(r.title ?? '', /力量完成/); assert.match(r.title ?? '', /跑步待补/)
  const voided = v4ExecFrom(occ, ev, () => true); assert.deepEqual(voided, {}, '作废的课次不算')
})
test('A03/A20：只确认关联了跑步 → 跑步有实际、力量未记录；只有一条设备活动；解除后设备记录独立可见', () => {
  const s = mem(); setRunDevice('2026-10-19', { sourceIdentity: 'garmin:41019', source: 'garmin', linkedBy: 'user' }, undefined, s)
  const rows = linkRuns([...phoneRows(s, NOW), ...garminRows(garmin)], s, NOW)
  assert.equal(rows.length, 1); assert.equal(rows[0].v4?.strength?.state, 'none'); assert.equal(rows[0].v4?.running?.source, 'device'); assert.equal(rows[0].distanceM, 3200)
  setRunDevice('2026-10-19', null, 'garmin:41019', s)
  const after = linkRuns([...phoneRows(s, NOW), ...garminRows(garmin)], s, NOW)
  assert.equal(after.filter(r => r.source === 'garmin').length, 1, '解除后手表记录还在'); assert.ok(!after.some(r => r.runLink))
})
test('A04/N19：两项都完成 → 各自 RPE；旧整课 RPE 只读不拆、不平均', () => {
  const s = mem({ 'fk-plan400-v4-log': { '2026-10-19': { done: 'done', rpe: '9' } } })
  saveComponent('2026-10-19', 'running', { status: 'done', rpe: 8 }, s); saveComponent('2026-10-19', 'strength', { status: 'done', rpe: 6 }, s)
  const f = v4DayFact(D, { done: 'done', rpe: '9' }, { parts: loadComponents(s).days['2026-10-19'] })
  assert.equal(f.overall, 'done'); assert.equal(f.running?.rpe, 8); assert.equal(f.strength?.rpe, 6); assert.equal(f.legacyOverall, false)
  const r = phoneRows(s, NOW).find(x => x.v4)!; assert.equal(r.rpe, null, '有分项时整课 RPE 不当这一条的 RPE'); assert.equal(r.sport, 'MIXED'); assert.equal(r.status, 'completed')
})
test('A05：跑步完成、力量跳过 → 已结束（减量/部分），力量不继承完成', () => {
  const f = v4DayFact(D, undefined, { parts: { running: { status: 'done' }, strength: { status: 'skipped' } } })
  assert.equal(f.strength?.state, 'skipped'); assert.notEqual(f.overall, 'done'); assert.equal(f.actualLift, false)
})
test('A06/N24：旧历史只有整课 RPE=8 → 可读、标“历史整课”，不给两项各填 8', () => {
  const f = v4DayFact(D, { done: 'done', rpe: '8' }, {})
  assert.equal(f.overall, 'done'); assert.equal(f.legacyOverall, true); assert.equal(f.running?.rpe ?? null, null); assert.equal(f.strength?.rpe ?? null, null)
  const r = phoneRows(mem({ 'fk-plan400-v4-log': { '2026-10-19': { done: 'done', rpe: '8' } } }), NOW)[0]
  assert.equal(r.rpe, 8); assert.match(r.title ?? '', /历史整课/)
  const old = phoneRows(mem({ 'fk-plan400-v4-log': { '2026-10-12': { done: 'done', rpe: '7', reps: '150m: 22' } } }), NOW)
  assert.equal(old.length, 1, '+7 天平移前的旧日期记录照样保留'); assert.match(old[0].title ?? '', /历史整课/)
})
test('A07/A08/N14：分段课同日唯一手表跑步只是候选；两条都列出；都不算完成', () => {
  linkRuns([...phoneRows(mem(), NOW), ...garminRows(garmin)], mem(), NOW)
  const f = v4DayFact(D, undefined, { runCandidates: 1 }); assert.equal(f.running?.state, 'candidate'); assert.equal(f.actualRun, false); assert.equal(f.overall, null)
})
test('A17：公开合成夹具 hash 固定（不冒充用户原始 V4 校验）；W1 从 10/19 开始（+7 天）', () => {
  const h = createHash('sha256').update(readFileSync(new URL('../../../test-fixtures/synthetic/plan400-v4.json', import.meta.url))).digest('hex')
  assert.equal(h, '6de961750547d1f3b6989efd193c833bf343ea284ecc535982b655d5075579fb'); assert.equal(days[0].date, '2026-10-19')
})
test('A18/A19：更正留历史；同一份存储读两次结果一致（刷新不重复、不丢）', () => {
  const s = mem(); saveComponent('2026-10-19', 'strength', { status: 'done', rpe: 6 }, s); saveComponent('2026-10-19', 'strength', { rpe: 7 }, s)
  assert.deepEqual(loadComponents(s).days['2026-10-19'].strength!.corrections!.map(c => [c.field, c.from, c.to]), [['rpe', 6, 7]])
  const a = JSON.stringify(linkRuns([...phoneRows(s, NOW), ...garminRows(garmin)], s, NOW)), b = JSON.stringify(linkRuns([...phoneRows(s, NOW), ...garminRows(garmin)], s, NOW))
  assert.equal(a, b)
  const rows = mergeActivities([...phoneRows(s, NOW), ...phoneRows(s, NOW)]); assert.equal(rows.length, 1, '同一份记录读两遍也只一条')
  assert.equal(summarize(linkRuns([...phoneRows(s, NOW), ...garminRows(garmin)], s, NOW), 'week', 'all', '2026-10-19').count, 2, '力量一条 + 未确认的手表跑步一条（计划外），不合并不重复')
})
test('A22/N09：只做了力量 → 今日“跑步未记录，力量已完成”，不是两项都完成', () => {
  const rows = [{ date: '2026-10-19', v4: { date: '2026-10-19', running: { state: 'none' as const }, strength: { state: 'done' as const } } }]
  const t = todayCoordinationParts(rows, [], '2026-10-19', { run: true, lift: true })
  assert.equal(coachCoordinationView({ loaded: true, todayParts: t.parts, strengthSessions: 1 })[1].readout, '跑步未记录，力量已完成')
})
