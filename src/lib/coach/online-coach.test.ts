import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { activityFacts, type GActivity } from './plain-coach.ts'
import { onlineSetting, onlineSettingKey, setOnline, askOnlineCoach, buildFacts, type TrustedCoachAuthorization } from './online-coach.ts'
import { garminRpe } from '../ui/training-read-model.ts'
import { setStoreBackend } from '../core/storage.ts'
import { setEventContext } from '../core/events.ts'
import { freshMemory, saveCoach } from '../strength/coach.ts'
import { emptyDialogue } from '../core/coach-dialogue.ts'
const run: GActivity = { id: 99, sourceIdentity: 'garmin:abc:99', name: '杭州市 跑步', type: 'running', start: '2026-10-18T05:54:00Z', dist: 6010, dur: 1898, avgHr: 144, maxHr: 162, cad: 172, elev: 12, cal: 400, sets: null, reps: null, tl: 85, te: 2.9 }
const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), oldFetch = globalThis.fetch
let records: Map<string, string>, calls: { url: string; init: RequestInit }[]
beforeEach(() => {
  records = new Map(); calls = []
  const store = { getItem: (k: string) => records.get(k) ?? null, setItem: (k: string, v: string) => { records.set(k, v) }, keys: () => [...records.keys()] }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store })
  setStoreBackend(store); setEventContext({ athleteId: 'local' })
  globalThis.fetch = (async (url: string, init: RequestInit) => { calls.push({url, init}); return new Response(JSON.stringify({ text: '受控解释' })) }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = oldFetch; setStoreBackend(null); setEventContext({ athleteId: 'local' })
  if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage)
  else delete (globalThis as {localStorage?:unknown}).localStorage
})
const input = { question: '比较已有课程', facts: 'SECRET_FACTS GPS', local: 'SECRET_LOCAL', history: [{ role: 'user', text: 'SECRET_CHAT' }] }
const authorization: TrustedCoachAuthorization = { explicitConsent: true, requestId: 'req-1', snapshotId: 'snap-1', consentId: 'consent-1', asOf: '2026-10-19T00:00:00Z' }
const put = (k: string, v: unknown) => records.set(k, JSON.stringify(v))

test('local activity facts omit the known activity name and identity, without claiming full anonymization', () => {
  const f = activityFacts(run, [{ i: 1, dist: 1000, dur: 316, avgHr: 140, maxHr: 150, cad: 170, elev: 2, speed: null }]).join('\n')
  assert.match(f, /跑步：6\.01 km/); assert.match(f, /第1段/)
  for (const bad of ['杭州', 'garmin:abc', '99']) assert.equal(f.includes(bad), false, bad)
})
test('garmin directWorkoutRpe 10-100 maps to RPE 1-10', () => {
  assert.equal(garminRpe(70), 7); assert.equal(garminRpe(null), null); assert.equal(garminRpe(5), 5); assert.equal(garminRpe(300), null)
})
test('first read is off and read-only; old t460 global consent is retained but never imported', () => {
  put('fk-coach-online-v1', { on: true, consentAt: authorization.asOf, by: 't460' })
  const before = [...records]
  assert.equal(onlineSetting().on, false); assert.deepEqual([...records], before)
  setEventContext({ athleteId: 'athlete-B' }); assert.equal(onlineSetting().on, false)
  assert.deepEqual([...records], before)
})
test('online preference is owned by the current athlete and never substitutes for per-turn consent', async () => {
  setOnline(true); assert.equal(onlineSetting().on, true)
  assert.match(onlineSettingKey(), /local/)
  setEventContext({ athleteId: 'athlete-B' }); assert.equal(onlineSetting().on, false)
  setOnline(true); setEventContext({ athleteId: 'athlete-C' }); assert.equal(onlineSetting().on, false)
  setEventContext({ athleteId: 'local' }); assert.equal(onlineSetting().on, true)
  assert.ok('error' in await askOnlineCoach(input)); assert.equal(calls.length, 0)
})
test('legacy facts/local/history calls cannot reach fetch, even when preference is on', async () => {
  setOnline(true)
  for (let i = 0; i < 3; i++) assert.ok('error' in await askOnlineCoach(input))
  assert.equal(calls.length, 0)
})
test('invalid or missing trusted refs, future asOf and false consent all fail before fetch', async () => {
  setOnline(true)
  for (const patch of [{ snapshotId: '' }, { consentId: '' }, { requestId: 'x\n' }, { asOf: 'invalid' }, { asOf: '2999-01-01T00:00:00Z' }, { explicitConsent: false }]) {
    assert.ok('error' in await askOnlineCoach({ ...input, authorization: { ...authorization, ...patch } as TrustedCoachAuthorization }))
  }
  assert.equal(calls.length, 0)
})
test('valid request sends only the five reference-contract fields, never private legacy payload or body identity', async () => {
  setOnline(true)
  const result = await askOnlineCoach({ ...input, authorization, athleteId: 'forged', user: 'forged' } as typeof input & { authorization: TrustedCoachAuthorization })
  assert.deepEqual(result, { text: '受控解释' }); assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/coach-chat'); assert.equal(calls[0].init.credentials, 'same-origin')
  const sent = JSON.parse(String(calls[0].init.body))
  assert.deepEqual(Object.keys(sent).sort(), ['question','requestId','snapshotId','consentId','asOf'].sort())
  assert.equal(sent.question, input.question); assert.equal(sent.snapshotId, authorization.snapshotId)
  assert.doesNotMatch(String(calls[0].init.body), /SECRET_|GPS|athleteId|forged/)
})
test('disabled scoped preference or oversized question prevents even a reference-only call', async () => {
  assert.ok('error' in await askOnlineCoach({ ...input, authorization }))
  setOnline(true)
  assert.ok('error' in await askOnlineCoach({ ...input, question: 'x'.repeat(4001), authorization }))
  assert.equal(calls.length, 0)
})
test('facts keep actual numeric values, exclude future activities, and do not invent a fixed athlete target', () => {
  put('fk-garmin-acts-v1', { old: run, future: { ...run, id: 100, start: '2027-01-01T00:00:00Z', dist: 98765 } })
  const f = buildFacts('2026-10-19', run, null)
  assert.match(f, /6\.01 km/); assert.match(f, /目标：UNKNOWN/)
  assert.doesNotMatch(f, /53秒|12\/28|2027-01-01|98\.77/)
  assert.match(f, /本地事实摘要（不用于直接上传）/); assert.equal(calls.length, 0)
})
test('another athlete cannot inherit local plan feedback, health, goals or Garmin data', () => {
  put('fk-garmin-acts-v1', { old: run })
  put('fk-plan400-v4-log', { '2026-10-19': { done: 'done', note: 'LOCAL_PRIVATE_NOTE' } })
  const dialogue = { ...emptyDialogue('local'), goal: 'LOCAL_PRIVATE_GOAL' }
  saveCoach({ ...freshMemory(), dialogue })
  setEventContext({ athleteId: 'athlete-B' })
  const f = buildFacts('2026-10-19', run, null)
  assert.match(f, /目标：UNKNOWN/); assert.doesNotMatch(f, /LOCAL_PRIVATE|6\.01 km|V4 计划记录|本地历史计划|恢复指标/)
  assert.equal(calls.length, 0)
})
test('goals come from current athlete context and remain reported, not a formal training objective', () => {
  setEventContext({ athleteId: 'athlete-B' })
  saveCoach({ ...freshMemory(), dialogue: { ...emptyDialogue('athlete-B'), goal: '1500米提高个人成绩' } })
  const f = buildFacts('2026-10-19', null, null)
  assert.match(f, /目标：1500米提高个人成绩/); assert.match(f, /未核准为正式计划/); assert.doesNotMatch(f, /53秒|12\/28/)
})
