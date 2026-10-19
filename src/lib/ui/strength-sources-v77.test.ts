// v77：手机上记的力量课（各版本存储形态）都要进日志；日期按这节课的日期（用户时区），不是保存时间。
process.env.TZ = 'Asia/Shanghai'
import test from 'node:test'
import assert from 'node:assert/strict'
import { phoneRows, orphanSetRows, mergeActivities } from './training-read-model.ts'
import { summarize, sourceLabels } from './log-range.ts'
import { fmtDistance, fmtDuration, fmtPace, fmtHr, activityLocalDay, activityLocalTime } from './activity-format.ts'
const NOW = Date.parse('2026-10-19T01:30:00Z') // 上海 10-19 09:30
const store = (o: Record<string, unknown>) => ({ getItem: (k: string) => k in o ? JSON.stringify(o[k]) : null })
const set = (done: boolean) => ({ done, reps: 8, kg: 20 })
const ev = (type: string, payload: Record<string, unknown>, ts: string) => ({ event_id: Math.random().toString(36), event_type: type, timestamp: ts, payload } as never)

test('v72+ 日程条目 + 今日逐组清单（按了完成）→ 10-18 力量·下肢 已完成，手机记录', () => {
  const rows = phoneRows(store({
    'fk-schedule-v1': { entries: [{ id: 'str:low:2026-10-18:ab12', date: '2026-10-18', kind: 'strength', modality: 'strength', title: '力量·下肢', refId: 'low', status: 'done', actual: { outcome: 'as_planned', minutes: 50, rpe: 7, at: '2026-10-18T13:40:00Z' } }] },
    'fk-today-checklist-v1': { '2026-10-18|low': { date: '2026-10-18', sessionId: 'low', moves: { sq: [set(true), set(true)], rdl: [set(true), set(false)] }, run: null, rpe: 7, state: null, startedAt: Date.parse('2026-10-18T12:55:00Z'), restEndsAt: null, updatedAt: Date.parse('2026-10-18T13:40:00Z') } },
  }), NOW)
  assert.equal(rows.length, 1)
  const r = rows[0]
  assert.equal(r.date, '2026-10-18'); assert.equal(r.sport, 'STRENGTH'); assert.equal(r.status, 'completed'); assert.equal(r.title, '力量·下肢')
  assert.equal(r.sets, 3); assert.equal(r.durationSec, 3000); assert.equal(r.rpe, 7)
  assert.deepEqual(sourceLabels(r), ['手机记录'])
  assert.equal(summarize(rows, 'week', 'lift', '2026-10-19').count, 0, '10-18 是上周日：本周不含') // 周一为一周开始
  assert.equal(summarize(rows, '4w', 'lift', '2026-10-19').count, 1)
})
test('改了组但没点完成 → 已记录未完成（不隐藏）；只有计划预填、没动过 → 不生成记录', () => {
  const touched = { date: '2026-10-18', sessionId: 'low', moves: { sq: [set(true), set(false)] }, run: null, rpe: null, state: null, startedAt: Date.parse('2026-10-18T13:00:00Z'), restEndsAt: null, updatedAt: Date.parse('2026-10-18T13:05:00Z') }
  const prefilled = { date: '2026-10-17', sessionId: 'up', moves: { bp: [set(false)] }, run: null, rpe: null, state: null, startedAt: null, restEndsAt: null, updatedAt: 0 }
  const rows = phoneRows(store({ 'fk-today-checklist-v1': { '2026-10-18|low': touched, '2026-10-17|up': prefilled } }), NOW)
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'incomplete'); assert.equal(rows[0].date, '2026-10-18')
  assert.equal(summarize(rows, '4w', 'lift', '2026-10-19').incomplete, 1)
  // 日程条目 planned 但清单动过 → 已记录未完成
  const r2 = phoneRows(store({ 'fk-schedule-v1': { entries: [{ id: 'e1', date: '2026-10-18', modality: 'strength', title: '力量·下肢', refId: 'low', status: 'planned' }] }, 'fk-today-checklist-v1': { '2026-10-18|low': touched } }), NOW)
  assert.equal(r2.length, 1); assert.equal(r2[0].status, 'incomplete'); assert.equal(r2[0].title, '力量·下肢')
})
test('旧版本形态：v53–v60 清单按日期为键、日程无 trainingType；v53 只填组间休息（restLog）', () => {
  const rows = phoneRows(store({
    'fk-schedule-v1': { entries: [{ id: 'str:low:2026-10-17:x1', date: '2026-10-17', kind: 'strength', modality: 'strength', title: '力量课 · 下肢', refId: 'low', status: 'planned', restLog: [{ name: '分腿蹲', actual: 75 }] }], acks: [] },
    'fk-today-checklist-v1': { '2026-10-16': { date: '2026-10-16', sessionId: 'full', moves: { sq: [set(true)] }, run: null, rpe: 6, state: 'normal', startedAt: Date.parse('2026-10-16T11:00:00Z'), restEndsAt: null, updatedAt: Date.parse('2026-10-16T11:30:00Z') } },
  }), NOW)
  const by = Object.fromEntries(rows.map(r => [r.date, r]))
  assert.equal(by['2026-10-17'].status, 'incomplete'); assert.equal(by['2026-10-17'].timeUnknown, true)
  assert.equal(by['2026-10-16'].status, 'incomplete'); assert.equal(activityLocalTime(by['2026-10-16'].startedAt), '19:00')
})
test('400 米计划日志填了“力量实际”→ 力量记录（计划日期）；没填力量/取消 → 不生成', () => {
  const rows = phoneRows(store({ 'fk-plan400-v4-log': { '2026-10-18': { done: 'done', strength: '分腿蹲 2×20kg×5/腿', rpe: '7', savedAt: '2026-10-19T00:10:00Z' }, '2026-10-15': { done: 'done', reps: '150m: 21.3' }, '2026-10-14': { done: 'skipped', strength: 'x' } } }), NOW)
  assert.equal(rows.length, 1); assert.equal(rows[0].date, '2026-10-18', '按计划日期，不按保存时间 10-19'); assert.equal(rows[0].status, 'completed'); assert.equal(rows[0].rpe, 7)
})
test('力量页“完成这节”（只有 TRAINING_COMPLETED，无开始事件）+ 直接记下的组 → 一条，按记录时间的本地日期', () => {
  const evs = [ev('TRAINING_SET_COMPLETED', { sessionId: 'low', completed: true }, '2026-10-17T16:30:00Z'), ev('TRAINING_SET_COMPLETED', { sessionId: 'low', completed: true }, '2026-10-17T16:40:00Z'), ev('TRAINING_COMPLETED', { sessionId: 'low', feel: 'ok' }, '2026-10-17T16:50:00Z'),
    ev('TRAINING_SET_COMPLETED', { sessionId: 'low', trainingOccurrenceId: 'occ-void', completed: true }, '2026-10-17T16:45:00Z')]
  const rows = orphanSetRows(evs, [])
  assert.equal(rows.length, 1); assert.equal(rows[0].date, '2026-10-18', 'UTC 10-17 16:30 = 上海 10-18 00:30'); assert.equal(rows[0].sets, 2); assert.equal(rows[0].status, 'completed')
})
test('去重只靠可靠 id：日程条目 ↔ 同课同日的组记录 ↔ “完成”生成的导入；同日同名但无 id 关联的不合并', () => {
  const sched = phoneRows(store({ 'fk-schedule-v1': { entries: [{ id: 'e1', date: '2026-10-18', modality: 'strength', title: '力量·下肢', refId: 'low', status: 'done', actual: { outcome: 'as_planned', minutes: 50 } }] } }), NOW)
  const sets = orphanSetRows([ev('TRAINING_SET_COMPLETED', { sessionId: 'low', completed: true }, '2026-10-18T12:00:00Z')], [])
  const other = orphanSetRows([ev('TRAINING_SET_COMPLETED', { sessionId: 'other', completed: true }, '2026-10-18T12:00:00Z')], []).map(r => ({ ...r, title: '力量·下肢' }))
  const imp = { ...sched[0], id: 'imp1', source: 'import' as const, originIds: ['act-e1'], sources: undefined }
  const merged = mergeActivities([...sets, ...sched, ...other, imp])
  assert.equal(merged.length, 2)
  const main = merged.find(r => r.originIds.includes('sched:e1'))!
  assert.equal(main.status, 'completed'); assert.equal(main.sets, 1); assert.equal(main.title, '力量·下肢')
})
test('统一格式化：取整先总秒再拆分、Safari 空格时间、心率取整', () => {
  assert.equal(fmtDuration(1897.6), '31:38'); assert.equal(fmtDuration(3725), '1:02:05')
  assert.equal(fmtPace(1000, 359.6), `6'00"/km`); assert.equal(fmtPace(6010, 1898), `5'16"/km`)
  assert.equal(fmtDistance(6010), '6.01 km'); assert.equal(fmtDistance(400), '400 m'); assert.equal(fmtHr(143.6), 144)
  assert.equal(activityLocalDay('2026-10-18 07:30:00'), '2026-10-18'); assert.equal(activityLocalDay('2026-10-17T23:30:00Z'), '2026-10-18')
})
