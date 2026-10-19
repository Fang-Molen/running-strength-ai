import assert from 'node:assert/strict'
import test, { beforeEach, afterEach } from 'node:test'
import { v4RecordLine, reviewActivity, type GActivity, type GLap } from './plain-coach'
import { buildFacts } from './online-coach'
import { setStoreBackend } from '../core/storage'
import { setEventContext } from '../core/events'

const date = '2026-10-19'
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let records: Map<string, string>
beforeEach(() => {
  records = new Map()
  const store = { getItem: (k: string) => records.get(k) ?? null, setItem: (k: string, v: string) => { records.set(k, v) }, keys: () => [...records.keys()] }
  setStoreBackend(store); setEventContext({ athleteId: 'local' })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store })
})
afterEach(() => {
  setStoreBackend(null); setEventContext({ athleteId: 'local' })
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else delete (globalThis as { localStorage?: unknown }).localStorage
})
const put = (key: string, value: unknown) => records.set(key, JSON.stringify(value))

test('new running/strength state also governs the text supplied to local and online coaching', () => {
  put('fk-plan400-v4-log', { [date]: { done: 'done', rpe: '8' } })
  put('fk-plan400-v4-components-v1', { schemaVersion: 1, days: { [date]: { running: { status: 'skipped' }, strength: { status: 'done', rpe: 6 } } } })
  const line = v4RecordLine(date)!
  assert.match(line, /跑步.*跳过|跑步.*取消/)
  assert.match(line, /力量.*完成.*RPE 6/)
  assert.match(line, /旧整课标记 done.*历史口径/)
  assert.match(line, /历史整课RPE（不可拆分） 8/)
  assert.doesNotMatch(line, /整课派生 已完成/)
})

test('strength alone explicitly leaves running unrecorded even when the original plan title includes running', () => {
  put('fk-plan400-v4-components-v1', { schemaVersion: 1, days: { [date]: { strength: { status: 'done', rpe: 6 } } } })
  const line = v4RecordLine(date)!
  assert.ok(line)
  assert.match(line, /原计划「/)
  assert.match(line, /跑步 未记录/)
  assert.match(line, /力量 完成/)
  assert.doesNotMatch(line, /整课派生 已完成/)
})

test('fully confirmed components can supersede a legacy skipped marker without copying whole-session RPE', () => {
  put('fk-plan400-v4-log', { [date]: { done: 'skipped', rpe: '8' } })
  put('fk-plan400-v4-components-v1', { schemaVersion: 1, days: { [date]: { running: { status: 'done', rpe: 5 }, strength: { status: 'done', rpe: 7 } } } })
  const line = v4RecordLine(date)!
  assert.match(line, /跑步 完成 · RPE 5/)
  assert.match(line, /力量 完成 · RPE 7/)
  assert.match(line, /整课派生 已完成/)
  assert.doesNotMatch(line, /跑步 完成 · RPE 8|力量 完成 · RPE 8/)
})

test('purely legacy data remains readable and explicitly historical', () => {
  put('fk-plan400-v4-log', { [date]: { done: 'done', reps: '150米三次', rpe: '8' } })
  const line = v4RecordLine(date)!
  assert.match(line, /历史整课口径：已完成/)
  assert.match(line, /不能拆成两项各自完成/)
  assert.match(line, /150米三次/)
})

test('absent and malformed records do not become an invented completion', () => {
  assert.equal(v4RecordLine(date), null)
  records.set('fk-plan400-v4-log', '{broken')
  assert.equal(v4RecordLine(date), null)
})

const run: GActivity = { id: 'synthetic-run', name: 'synthetic', type: 'running', start: `${date}T06:00:00Z`, dist: 6000, dur: 1860, avgHr: null, maxHr: null, cad: null, elev: null, cal: null, sets: null, reps: null, tl: null, te: null }
const laps = (heart: (number | null)[]): GLap[] => heart.map((avgHr, i) => ({ i: i + 1, dist: 1000, dur: i < 3 ? 300 : 320, avgHr, maxHr: null, cad: null, elev: null, speed: null }))

test('missing lap heart rates stay unknown while real pace change is still calculated', () => {
  const answer = reviewActivity(run, laps([null, null, null, null, null, null]), date)
  assert.match(answer, /慢 20 秒\/公里/)
  assert.match(answer, /心率变化未知/)
  assert.doesNotMatch(answer, /心率 \+0|心率没明显飘|乳酸没有明显堆积/)
})

test('incomplete lap heart-rate coverage is not silently promoted to a complete-half drift', () => {
  const answer = reviewActivity(run, laps([140, null, 140, 150, 150, 150]), date)
  assert.match(answer, /分段心率缺失或不完整/)
  assert.doesNotMatch(answer, /心率还上升 10|心率变化 10/)
})

test('zero or nonfinite lap heart rate cannot represent a reassuring zero drift', () => {
  for (const value of [0, NaN, Infinity]) {
    const answer = reviewActivity(run, laps([140, 140, 140, 140, 140, value]), date)
    assert.match(answer, /心率变化未知/)
  }
})

test('complete valid heart-rate observations retain their measured change', () => {
  const answer = reviewActivity(run, laps([140, 140, 140, 152, 152, 152]), date)
  assert.match(answer, /后半程掉速 20 秒\/公里、心率还上升 12/)
})

test('online facts stay readonly and cannot announce legacy completion over missing new components', () => {
  put('fk-plan400-v4-log', { [date]: { done: 'done' } })
  put('fk-plan400-v4-components-v1', { schemaVersion: 1, days: { [date]: { running: { status: 'not_recorded' }, strength: { status: 'done', rpe: 6 } } } })
  const before = [...records]
  const facts = buildFacts(date, null, null)
  assert.match(facts, /跑步 未记录/)
  assert.match(facts, /力量 完成/)
  assert.doesNotMatch(facts, /整课派生 已完成|V4 计划记录[^\n]*）：已完成/)
  assert.match(facts, /整课待补录；仅采用明确的分项实际，未记录部分未知/)
  assert.doesNotMatch(facts, /不要当作练过|未完成[^）]*不计入/)
  assert.deepEqual([...records], before)
})
