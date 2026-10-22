// These assertions fail if free chat bypasses owner/time boundaries or silently loses a domain.
process.env.TZ = 'Asia/Shanghai'
import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import { setStoreBackend } from '../core/storage.ts'
import { setEventContext } from '../core/events.ts'
import { buildFacts } from './online-coach.ts'
import { createTrainingImportDraft, confirmTrainingImport, type ImportField } from '../core/training-import.ts'
import { appendCorrection } from '../core/training-correction.ts'
import { coachImports } from '../core/coach-import-evidence.ts'
import type { GActivity } from './plain-coach.ts'

const DAY = '2026-10-22'
const AS_OF = '2026-10-22T04:00:00.000Z'
let data: Map<string, string>
beforeEach(() => {
  data = new Map()
  const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) }, keys: () => [...data.keys()] }
  setStoreBackend(store)
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store })
  setEventContext({ athleteId: 'local' })
})
const facts = (question = '看看我的饮食、训练、力量和恢复') => buildFacts(DAY, null, null, { question, asOf: AS_OF } as never)
const plan = (main = '跑步20分钟') => data.set('fk-plan-doc-v1', JSON.stringify({ schema: 'fangkun-plan-v1', plan: { name: '测试计划', shiftDays: 0, weeks: [], days: [{ date: DAY, orig: DAY, weekday: '四', week: '1', title: '跑步与力量', main: [main], aux: [], strength: ['深蹲3组'] }] } }))

test('unbound chat preserves independently labelled diet, training and recovery availability', () => {
  const text = facts()
  for (const label of ['【饮食】', '【训练与力量】', '【健康与恢复】']) assert.ok(text.includes(label), label)
  assert.match(text, /未关联.*不影响.*饮食.*恢复/)
})

test('yesterday and explicit date queries resolve the actual fact date with the request cutoff', () => {
  assert.match(facts('昨天健康和饮食怎么样'), /查询日期：2026-10-21/)
  assert.match(facts('2026-10-19力量练得怎么样'), /查询日期：2026-10-19/)
  assert.match(facts(), /读取截止时间：2026-10-22T04:00:00.000Z/)
})

test('legacy V4 fallback never sends another athlete even when it is the only saved record', () => {
  data.set('fk-plan400-v4-log', JSON.stringify({ [DAY]: { athleteId: 'other-athlete', strength: 'FOREIGN_ONLY_STRENGTH_99KG', rpe: '9', done: 'done' } }))
  assert.doesNotMatch(facts(), /FOREIGN_ONLY_STRENGTH_99KG/)
})

test('an explicitly owned legacy record remains readable for a non-default athlete', () => {
  setEventContext({ athleteId: 'athlete-b' })
  data.set('fk-plan400-v4-log', JSON.stringify({ [DAY]: { athleteId: 'athlete-b', strength: '自有力量35kg×8次', done: 'done' } }))
  assert.match(facts(), /自有力量35kg×8次/)
})

test('owned legacy V4 actuals remain available without importing a plan and without arbitrary notes', () => {
  data.set('fk-plan400-v4-log', JSON.stringify({ [DAY]: { strength: '深蹲35kg×8次', rpe: '6', done: 'done', note: 'PRIVATE_NOTE_PHONE_12345678' } }))
  const text = facts()
  assert.match(text, /深蹲35kg×8次/)
  assert.match(text, /历史整课/)
  assert.doesNotMatch(text, /PRIVATE_NOTE_PHONE_12345678/)
})

test('foreign component detail cannot re-enter an otherwise owned V4 projection', () => {
  plan()
  data.set('fk-plan400-v4-log', JSON.stringify({ [DAY]: { strength: '深蹲35kg×8次', rpe: '6', done: 'done' } }))
  data.set('fk-plan400-v4-components-v1', JSON.stringify({ schemaVersion: 1, days: { [DAY]: { athleteId: 'other-athlete', strength: { status: 'done', rpe: 10, note: 'FOREIGN_COMPONENT_DETAIL' } } } }))
  assert.doesNotMatch(facts(), /FOREIGN_COMPONENT_DETAIL|RPE 10/)
})

test('future saved legacy facts and future watch observations are absent at a fixed request cutoff', () => {
  data.set('fk-plan400-v4-log', JSON.stringify({ [DAY]: { strength: 'FUTURE_STRENGTH_77KG', done: 'done', savedAt: '2026-10-22T10:00:00Z' } }))
  data.set('fk-garmin-acts-v1', JSON.stringify({ future: { id: 4, start: '2026-10-22T10:00:00Z', type: 'running', dist: 9999, dur: 1333, avgHr: 177 } }))
  const text = facts()
  assert.doesNotMatch(text, /FUTURE_STRENGTH_77KG|10\.00 km|心率177/)
})

test('long plan text cannot erase domain availability and omission is explicit', () => {
  plan('训练说明'.repeat(4000))
  const text = facts()
  assert.ok(text.length <= 7800, `facts exceeded transport budget: ${text.length}`)
  for (const label of ['【饮食】', '【训练与力量】', '【健康与恢复】']) assert.ok(text.includes(label), label)
  assert.match(text, /省略/)
})

test('rebuilding an online snapshot does not mutate the saved data', () => {
  plan()
  const before = [...data.entries()]
  facts()
  assert.deepEqual([...data.entries()], before)
})

function watchRecord(t: test.TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(AS_OF) })
  const recorded = <T,>(value: T): ImportField<T> => ({ status: 'RECORDED', value, sourceIds: ['user-confirmed'] })
  const draft = createTrainingImportDraft({ sport: 'RUNNING', occurredAt: recorded('2026-10-22T02:00:00.000Z'), totalDistanceMeters: recorded(5321), durationSeconds: recorded(1845) }, 'TEXT', ['user-confirmed'])
  draft.sourceRecordIdentity = 'garmin:synthetic-account:12345'
  const saved = confirmTrainingImport(draft)
  if (!saved.ok) throw Error(saved.reason)
  assert.equal(coachImports('local', AS_OF).length, 1, 'confirmed fixture must satisfy the actual coach reader contract')
  const act = { id: 12345, sourceIdentity: draft.sourceRecordIdentity, name: 'PRIVATE_CITY', type: 'running', start: '2026-10-22T02:00:00.000Z', dist: 5321, dur: 1845, avgHr: 145 } as GActivity
  data.set('fk-garmin-acts-v1', JSON.stringify({ 12345: act }))
  return { act, record: saved.record }
}

test('a confirmed watch record and its optional view cache are one source in an unbound request', t => {
  watchRecord(t)
  const text = facts()
  assert.equal(text.match(/5321|5\.32 km/g)?.length, 1, text)
})

test('manual watch corrections withdraw old cached totals in unbound, selected and V4-linked requests', t => {
  const { act, record } = watchRecord(t)
  assert.ok(appendCorrection({ trainingOccurrenceId: record.confirmedImportId, kind: 'FIELD', field: 'distance', originalValue: '5321', newValue: '6000', reason: 'synthetic correction' }))
  assert.doesNotMatch(facts(), /5321|5\.32 km/)
  assert.doesNotMatch(buildFacts(DAY, act, null, { asOf: AS_OF, selectedOccurrenceId: record.confirmedImportId }), /5321|5\.32 km/)
  plan()
  data.set('fk-plan400-v4-components-v1', JSON.stringify({ schemaVersion: 1, days: { [DAY]: { running: { device: { sourceIdentity: act.sourceIdentity, source: 'garmin', linkedAt: AS_OF, linkedBy: 'user' } } } } }))
  assert.doesNotMatch(facts(), /5321|5\.32 km/)
})

test('a voided confirmed watch record is not resurrected by a stale cache or selected activity', t => {
  const { act, record } = watchRecord(t)
  assert.ok(appendCorrection({ trainingOccurrenceId: record.confirmedImportId, kind: 'VOID', reason: 'synthetic void' }))
  assert.doesNotMatch(facts(), /5321|5\.32 km|1845|30:45/)
  assert.doesNotMatch(buildFacts(DAY, act, null, { asOf: AS_OF, selectedOccurrenceId: record.confirmedImportId }), /5321|5\.32 km|1845|30:45/)
})
