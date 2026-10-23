// v84：Codex 1019y 的边界测试，只保留与 v83 口径一致的部分（v4RecordLine 的分项写法在 v83 里由 v4FactLine 承担，另有 v83 测试覆盖）
import assert from 'node:assert/strict'
import test, { beforeEach, afterEach } from 'node:test'
import { v4RecordLine, reviewActivity, type GActivity, type GLap } from './plain-coach'
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

test('absent and malformed records do not become an invented completion', () => {
  assert.equal(v4RecordLine(date), null)
  records.set('fk-plan400-v4-log', '{broken')
  assert.equal(v4RecordLine(date), null)
})

test('legacy local fallback cannot read another athlete through an otherwise valid watch review', () => {
  put('fk-plan400-v4-log', { [date]: { athleteId: 'another-athlete', done: 'done', strength: 'FOREIGN_LEGACY_ACTUAL', rpe: '10' } })
  assert.equal(v4RecordLine(date), null)
  assert.doesNotMatch(reviewActivity(run, null, date), /FOREIGN_LEGACY_ACTUAL/)
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
  assert.match(answer, /后半程比前半程慢 20 秒\/公里；心率变化 12 bpm/)
})

