// v84：合入 Codex 1019y 包时按 v83 口径改写的验收（读模型只有一套：v83 的 v4DayFact / applyV4Fact）
import test from 'node:test'
import assert from 'node:assert/strict'
import V4 from '../../../test-fixtures/private/plan400-v4.json' with { type: 'json' }
import { dayStatus, progressCounts, type V4Plan } from './plan400-view'
import { phoneRows, mergeActivities, garminRows, linkRuns, occurrenceStrengthTotals } from './training-read-model'
import { parseQuickLog } from './quick-log'

const plan = V4 as V4Plan, date = '2026-10-19', d = plan.days.find(x => x.date === date)!
const now = Date.parse('2026-10-19T12:30:00Z')
const store = (data: Record<string, unknown>) => ({ getItem: (key: string) => key in data ? JSON.stringify(data[key]) : null })
const ps = (parts: unknown, log: unknown = { done: 'done', rpe: '7' }) => store({ 'fk-plan400-v4-log': { [date]: log }, 'fk-plan400-v4-components-v1': { schemaVersion: 1, days: { [date]: parts } } })

test('组合课：跑步跳过＋力量完成 ≠ 整课完成（不再算“已完成·减量”），不计入完成课次', () => {
  const parts = { running: { status: 'skipped' as const }, strength: { status: 'done' as const, rpe: 6 } }
  assert.equal(dayStatus(d, {}, date, false, { parts }), 'in_progress')
  assert.equal(progressCounts(plan, {}, { [date]: { parts } }).completedTrainingDays, 0)
  const [row] = phoneRows(ps(parts, {}), now)
  assert.equal(row.sport, 'STRENGTH'); assert.equal(row.v4?.overall, 'in_progress'); assert.equal(row.rpe, null)
  assert.match(row.title!, /跑步跳过／力量完成/)
})
test('组合课：两项都完成/减量才算完成；两项都跳过＝跳过', () => {
  assert.equal(dayStatus(d, {}, date, false, { parts: { running: { status: 'done' }, strength: { status: 'reduced' } } }), 'reduced')
  assert.equal(dayStatus(d, {}, date, false, { parts: { running: { status: 'done' }, strength: { status: 'done' } } }), 'done')
  assert.equal(dayStatus(d, {}, date, false, { parts: { running: { status: 'skipped' }, strength: { status: 'skipped' } } }), 'skipped')
})
test('新分项（跳过/未记录）优先于旧整课 done；旧整课本身只读保留、RPE 不拆', () => {
  const parts = { running: { status: 'skipped' as const }, strength: { status: 'not_recorded' as const } }
  assert.equal(dayStatus(d, { done: 'done' }, date, false, { parts }), 'in_progress')
  assert.equal(progressCounts(plan, { [date]: { done: 'done' } }, { [date]: { parts } }).completedTrainingDays, 0)
  const [legacy] = phoneRows(store({ 'fk-plan400-v4-log': { [date]: { done: 'done', rpe: '7' } } }), now)
  assert.equal(legacy.v4?.legacyOverall, true); assert.equal(legacy.rpe, 7); assert.match(legacy.title!, /历史整课/)
  assert.equal(legacy.v4?.running?.rpe ?? null, null); assert.equal(legacy.v4?.strength?.rpe ?? null, null)
})
test('普通日程“跑+力量”只是计划：只勾了力量组 → 力量；只填了公里 → 跑步；不凭元数据说练了两样', () => {
  const [lift] = phoneRows(store({ 'fk-schedule-v1': { entries: [{ id: 'mixed-1', date, modality: 'strength', trainingType: 'mixed', status: 'done', actual: { executionState: 'COMPLETED' } }] }, 'fk-today-checklist-v1': { a: { date, sessionId: 'mixed-1', moves: { squat: [{ done: true }] } } } }), now)
  assert.equal(lift.sport, 'STRENGTH')
  const [run] = phoneRows(store({ 'fk-schedule-v1': { entries: [{ id: 'only-run', date, title: '跑+力量', modality: 'strength', trainingType: 'mixed', status: 'done', actual: { outcome: 'as_planned', km: 5, minutes: null } }] } }), now)
  assert.equal(run.sport, 'RUNNING'); assert.equal(run.durationSec, null); assert.equal(run.distanceM, null, '公里数由跑步来源统计，这里不另记，避免重复')
})
test('同一天两节课用同一个模板：仍是两条记录（以前会被合成一条）', () => {
  const rows = phoneRows(store({ 'fk-schedule-v1': { entries: ['a', 'b'].map(id => ({ id, date, modality: 'strength', refId: 'same-template', status: 'done' })) } }), now)
  assert.equal(mergeActivities(rows).length, 2)
  const one = phoneRows(store({ 'fk-schedule-v1': { entries: [{ id: 'a', date, modality: 'strength', refId: 'tpl', status: 'done' }] }, 'fk-today-checklist-v1': { x: { date, sessionId: 'tpl', moves: { squat: [{ done: true }, { done: true }] } } } }), now)
  assert.equal(one.length, 1); assert.equal(one[0].sets, 2, '模板当天唯一时清单照旧关联')
})
test('力量重量×次数只算这一次训练自己的组；未知重量保持未知', () => {
  const ev = (occ: string | undefined, weight: number | null, amount = 5) => ({ event_type: 'TRAINING_SET_COMPLETED', payload: { trainingOccurrenceId: occ, sessionId: 'same-template', moveId: 'squat', setIndex: 1, mode: 'reps', actualWeight: weight, actualAmount: amount, completed: true } }) as never
  const events = [ev('first', 20), ev('second', 80), ev(undefined, 100)]
  assert.deepEqual(occurrenceStrengthTotals(events, 'first'), { sets: 1, volumeKg: 100 })
  assert.deepEqual(occurrenceStrengthTotals(events, 'second'), { sets: 1, volumeKg: 400 })
  assert.deepEqual(occurrenceStrengthTotals([ev('third', null)], 'third'), { sets: 1, volumeKg: null })
  assert.deepEqual(occurrenceStrengthTotals(events, 'missing'), { sets: 0, volumeKg: null })
})
test('当天唯一的手表跑步仍只是候选（要你确认），不会并进 V4 课、不会让组合课变成“跑+力量”', () => {
  const s = ps({ strength: { status: 'done' } }, {})
  const rows = linkRuns([...phoneRows(s, now), ...garminRows({ a: { id: 42, sourceIdentity: 'garmin:local:42', start: '2026-10-19T10:00:00Z', type: 'running', dist: 5000, dur: 1800 } })], s, now)
  assert.equal(rows.length, 2); assert.ok(rows.every(r => r.sport !== 'MIXED')); assert.ok(rows.every(r => !r.runLink))
})
test('其他运动员的佳明活动不进当前运动员的记录', () => {
  assert.equal(garminRows({ a: { id: 1, athleteId: 'other', start: '2026-10-19T10:00:00Z', type: 'running', dist: 5000, dur: 1800 } }).length, 0)
  assert.equal(garminRows({ a: { id: 2, start: '2026-10-19T10:00:00Z', type: 'running', dist: 5000, dur: 1800 } }).length, 1)
})
test('记一笔：只写配速不推算时长（时长未知），“5分30”这类配速不当成 5 分钟', () => {
  const r = parseQuickLog('今晚跑了 5 公里 配速 5:40'); assert.equal(r.kind, 'run'); if (r.kind === 'run') { assert.equal(r.minutes, null); assert.equal(r.pace, '5:40') }
  const r2 = parseQuickLog('跑步 5公里 配速5分30'); assert.equal(r2.kind, 'run'); if (r2.kind === 'run') { assert.equal(r2.minutes, null); assert.equal(r2.km, 5) }
  const r3 = parseQuickLog('轻松跑 5公里 32分'); if (r3.kind === 'run') assert.equal(r3.minutes, 32)
})
