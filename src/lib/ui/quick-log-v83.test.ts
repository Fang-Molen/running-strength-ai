// v83 整改包 P0-03 / P0-04：记一笔不编造用时、不标按计划；删除笔记与训练事实一致；旧数据读时核对
process.env.TZ = 'Asia/Shanghai'
import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import { setStoreBackend, type MemoryStore } from '../core/storage.ts'
import { setEventContext } from '../core/events.ts'
import { parseQuickLog } from './quick-log.ts'
import { saveQuickTraining, withdrawQuickRecords, legacyQuickAudit, quickDraftInput } from './quick-log-save.ts'
import { loadTrainingActivities } from './training-read-model.ts'
import { weekSummary, weekOf } from './day-schedule-rules.ts'
import { computeStreak } from './streak.ts'
import { summarize } from './log-range.ts'
let data: Map<string, string>
beforeEach(() => { data = new Map(); const store: MemoryStore = { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) }, keys: () => [...data.keys()] } as MemoryStore; setStoreBackend(store); setEventContext({ athleteId: 'local' }); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { ...store, removeItem: (k: string) => data.delete(k) } }) })
const AT = '2026-10-19T01:00:00.000Z' // 早于“现在”（确认时间不能早于训练时间）

test('A/N（P0-03）：“跑了5公里”没写用时 → 距离 5000m、用时未知；不生成日程条目、不标按计划', () => {
  const r = saveQuickTraining(parseQuickLog('跑了5公里'), 'n-1', AT, null); assert.ok(r.ok)
  assert.equal(data.get('fk-schedule-v1'), undefined, '不造计划/日程条目')
  const rows = loadTrainingActivities().filter(x => x.date === '2026-10-19'); assert.equal(rows.length, 1)
  assert.equal(rows[0].distanceM, 5000); assert.equal(rows[0].durationSec, null); assert.equal(rows[0].sport, 'RUNNING'); assert.equal(rows[0].quickLog, true)
  assert.doesNotMatch(rows[0].title ?? '', /按计划/)
  assert.equal(summarize(rows, 'week', 'all', '2026-10-19').count, 1)
})
test('P0-03：写了用时才有用时；力量不按组数估分钟；只写“跑步”无距离无用时 → 只存笔记，不记训练', () => {
  const run = quickDraftInput(parseQuickLog('慢跑 6公里 35分钟') as never, AT, 6) as { durationSeconds: { value: number }; totalDistanceMeters: { value: number } }
  assert.equal(run.durationSeconds.value, 2100); assert.equal(run.totalDistanceMeters.value, 6000)
  const lift = quickDraftInput(parseQuickLog('深蹲 3×8 60kg') as never, AT, null) as { durationSeconds: { value: null }; strengthSets: unknown[] }
  assert.equal(lift.durationSeconds.value, null); assert.equal(lift.strengthSets.length, 3)
  const none = saveQuickTraining(parseQuickLog('跑步'), 'n-2', AT, null); assert.equal(none.ok, false); assert.ok(!none.ok && none.soft)
})
test('P0-03：同一笔记重试不会记两条（幂等）', () => {
  const p = parseQuickLog('跑了5公里'); saveQuickTraining(p, 'n-3', AT, null); const again = saveQuickTraining(p, 'n-3', AT, null); assert.ok(again.ok)
  assert.equal(loadTrainingActivities().length, 1)
})
test('P0-04：删除并撤回 → 日志/统计不再计入；撤销 → 恢复；只删笔记 → 训练保留', () => {
  const r = saveQuickTraining(parseQuickLog('跑了5公里'), 'n-4', AT, null); assert.ok(r.ok)
  assert.equal(withdrawQuickRecords([r.ref]), 1); assert.equal(loadTrainingActivities().length, 0, '撤回后不计入')
  assert.equal(withdrawQuickRecords([r.ref]), 0, '重复撤回不重复写')
  assert.equal(withdrawQuickRecords([r.ref], true), 1); assert.equal(loadTrainingActivities().length, 1, '撤销后恢复')
})
test('旧数据（≤v82 记一笔）：默认 30 分钟、按计划 → 读时显示“用时未知”，补回距离；计划数/按计划不算它；打卡照算', () => {
  const e = { id: 'q-abc', date: '2026-10-18', kind: 'run', modality: 'run', title: '跑步 5 公里', focus: [], minutes: 30, intensity: 'EASY', lowerHeavy: false, source: 'custom', refId: null, status: 'done', unplanned: true, actual: { outcome: 'as_planned', minutes: 30, km: 5, rpe: null, intensity: null, note: '记一笔', reasons: [], at: '2026-10-18T12:00:00.000Z' } }
  data.set('fk-schedule-v1', JSON.stringify({ entries: [e] })); data.set('fk-notes-v1', JSON.stringify([{ id: 'n-old', at: '2026-10-18T12:00:00.100Z', text: '跑了5公里', atts: [] }]))
  const a = legacyQuickAudit([e as never], [{ at: '2026-10-18T12:00:00.100Z', text: '跑了5公里' }]).get('act-q-abc')!
  assert.equal(a.durationSec, null); assert.equal(a.distanceM, 5000); assert.match(a.note, /用时未知/)
  const noNote = legacyQuickAudit([e as never], []).get('act-q-abc')!; assert.equal(noNote.durationSec, null); assert.match(noNote.note, /默认/)
  const real = legacyQuickAudit([{ ...e, minutes: 42, actual: { ...e.actual, minutes: 42 } } as never], []).get('act-q-abc')!; assert.equal(real.durationSec, 2520, '用户当时写了用时的照用')
  const ws = weekSummary([e as never], weekOf('2026-10-18'), '2026-10-19'); assert.equal(ws.planned, 0); assert.equal(ws.asPlanned, 0)
  assert.equal(computeStreak([e as never], '2026-10-18').todayDone, true)
  assert.equal(computeStreak([], '2026-10-19', new Set(['2026-10-19'])).todayDone, true)
})
