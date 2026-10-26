import assert from 'node:assert/strict'
import test from 'node:test'
import { currentAthleteId, setEventContext } from '../core/events'
import { setStoreBackend } from '../core/storage'
import { startTraining } from '../core/training-decision'
import { bindTrainingStart } from '../core/occurrence'
import { emptySets, recordSet } from '../core/execution'
import { recordCoachEvidence } from '../core/coach-brief'
import { completeFromRunner } from '../../components/training-runner'
import { saveDeviceRows, type DeviceHealthRow } from '../health/device-store'
import { saveSelfReportedRest } from '../health/rest-store'
import { commitFoodDraft, draftFromProduct } from '../nutrition/entry-workflow'
import { loadEntries, removeEntry, updateEntry, type FoodEntry } from '../nutrition/log'
import { upsertCheck } from '../nutrition/body'
import type { FoodRow } from '../nutrition/food-db'
import type { Session } from '../strength/model'
import { askOnlineCoach, buildFacts, setOnline } from './online-coach'

process.env.TZ = 'UTC'
const DAY = '2026-10-22', AS_OF = '2026-10-22T12:00:00.000Z'
const FIRST = '你看我的饮食，我应该吃哪些高热量的食物才能增重？'
const FOLLOWUP = '你不是可以读取我饮食健康里面的东西吗？'
const FOOD: FoodRow = { i: 'transport-food', n: '合成传输餐', a: [], br: '合成来源', rg: '测试地区', g: 0, b: 'g', p: [612, 37, 91, 14, 7], s: { g: 100, u: '100g', v: null }, pt: [], src: 'U', st: 'REFERENCE', uri: 'https://example.invalid/synthetic' }
type Body = { question: string; facts: string; local: string; history: { role: string; text: string }[] }

/** Preserve domain facts locally. A browser snapshot never authorizes model dispatch. */
function fixture(t: test.TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(AS_OF) - 30 * 60_000 })
  const owner = currentAthleteId(), originalFetch = globalThis.fetch
  const originals = ['localStorage', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  const map = new Map<string, string>()
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) }, keys: () => [...map.keys()] }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  setStoreBackend(store); setEventContext({ athleteId: 'local' })
  const client: Body[] = [], provider: unknown[] = [], unexpected: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    unexpected.push(String(input))
    throw Error('No server snapshot resolver is installed in this local projection fixture')
  }) as typeof globalThis.fetch
  setOnline(true)
  t.after(() => {
    globalThis.fetch = originalFetch; setStoreBackend(null); setEventContext({ athleteId: owner })
    for (const [key, old] of originals) { if (old) Object.defineProperty(globalThis, key, old); else Reflect.deleteProperty(globalThis, key) }
    assert.deepEqual(unexpected, [], 'No external or unrecognised request is allowed')
  })
  return { map, store, client, provider }
}

function meal(food = FOOD, date = DAY) {
  const result = commitFoodDraft({ draft: { ...draftFromProduct(food), amount: '100' }, date, meal: '午餐', acknowledged: true, athleteId: currentAthleteId() })
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.row
}

function health(metric: DeviceHealthRow['metric'], value: number, date = DAY, syncedAt = `${date}T08:00:00.000Z`, source = 'synthetic-watch'): DeviceHealthRow {
  return { key: `${source}:${metric}:${date}`, metric, value, day: date, source, hrvMethod: 'RMSSD', observation: {
    key: `${source}:${metric}:${date}`, sourceId: source, statistic: metric === 'SLEEP' ? 'night total' : metric === 'HRV' ? 'night RMSSD mean' : 'daily resting HR', syncedAt,
  } }
}

function seedAll(t: test.TestContext, f: ReturnType<typeof fixture>) {
  const food = meal()
  assert.ok(upsertCheck({ date: DAY, weight: 65.4 }))
  assert.deepEqual(saveDeviceRows([health('SLEEP', 6.5), health('RHR', 58), health('HRV', 48)]).errors, [])
  f.store.setItem('fk-checkin-v1', JSON.stringify([{ athleteId: 'local', date: DAY, at: `${DAY}T09:00:00Z`, fatigue: 'tired', pain: 'none', recovery: 4, recoveryScale: 10 }]))
  assert.equal(saveSelfReportedRest({ requestId: 'transport-rest', athleteId: 'local', contextDay: DAY, kind: 'NAP', duration: { low: 25, high: 25 }, start: null, end: null, timezone: 'UTC' }, Date.parse(`${DAY}T10:00:00Z`)).ok, true)
  const session: Session = { id: 'transport-strength', name: '合成传输力量课', moves: [{ id: 'squat', catalogId: 'back-squat', customName: '', sets: 1, mode: 'reps', amount: 8, restSec: 60, weightKg: 40 }] }
  f.store.setItem('fr255-strength-plan-v3', JSON.stringify({ sessions: [session] }))
  const event = startTraining({ decisionId: 'transport-strength-decision', sessionId: session.id, action: 'ORIGINAL_PLAN' })
  assert.ok(event)
  assert.ok(bindTrainingStart({ startEventId: event.event_id, startedAt: event.timestamp, sessionId: session.id, planSlotId: session.id, plan: session }))
  assert.ok(recordSet(session.id, 'transport-strength-decision', { ...emptySets(session)[0], actualWeight: 40, actualAmount: 8, completed: true, source: 'user_entered', timestamp: new Date().toISOString() }))
  t.mock.timers.tick(30 * 60_000)
  assert.ok(completeFromRunner({ decisionId: 'transport-strength-decision', sessionId: session.id, planned: null, actualSets: 1, actualAmount: 8, actualWeightKg: 40, rpe: 6, pain: false, modified: false, interrupted: false }))
  assert.equal(recordCoachEvidence(event.event_id, { sessionRpe: 6 }).ok, true)
  return { food, occurrenceId: event.event_id }
}

const has = (text: string, expression: RegExp, reason: string) => assert.ok(expression.test(text), reason)
function domain(facts: string, name: string): string {
  const heading = `【${name}】`, start = facts.indexOf(heading)
  assert.ok(start >= 0, `Local facts must contain ${heading}`)
  const next = facts.indexOf('\n【', start + heading.length)
  return facts.slice(start + heading.length, next < 0 ? undefined : next)
}
async function send(f: ReturnType<typeof fixture>, question = FIRST, options: { asOf?: string; local?: string; history?: Body['history']; selectedOccurrenceId?: string | null; expectAuditRejection?:boolean } = {}) {
  const facts = buildFacts(DAY, null, null, { question, asOf: options.asOf ?? new Date().toISOString(), selectedOccurrenceId: options.selectedOccurrenceId ?? null })
  const result = await askOnlineCoach({ question, facts, local: options.local ?? '', history: options.history ?? [] })
  assert.ok('error' in result)
  if ('error' in result) assert.match(result.error, /本地/)
  assert.equal(f.client.length, 0); assert.equal(f.provider.length, 0)
  return { facts }

}

for (const question of [FIRST, FOLLOWUP]) test(`unbound free chat retains meal and measured weight in local facts: ${question}`, async t => {
  const f = fixture(t); seedAll(t, f)
  const { facts } = await send(f, question)
  has(facts, /查询日期[^\n]*2026-10-22/, 'The final snapshot states its query day')
  has(facts, /读取截止时间[^\n]*2026-10-22T12:00:00/, 'The final snapshot states its as-of time')
  const nutrition = domain(facts, '饮食')
  has(nutrition, /合成传输餐/, 'A confirmed food entry reaches local facts without a linked workout or local answer')
  has(nutrition, /612/, 'Confirmed energy remains in local facts')
  has(nutrition, /蛋白[^\n]*37/, 'Confirmed protein remains in local facts')
  has(nutrition, /碳水[^\n]*91/, 'The actual saved carb field remains in local facts')
  has(nutrition, /65\.4/, 'Measured weight remains in local facts')
  has(nutrition, /不完整|完整性|未确认.*完整|不代表全天/, 'Recorded meals are not declared a complete day')
  domain(facts, '训练与力量'); domain(facts, '健康与恢复')
  assert.equal(f.client.length, 0, 'Local nutrition remains readable without uploading a client assertion')
})

test('unbound native strength retains actual load, repetitions and RPE at the local fact boundary', async t => {
  const f = fixture(t); seedAll(t, f)
  const { facts } = await send(f, '看看我的力量训练记录',{expectAuditRejection:true})
  const training = domain(facts, '训练与力量')
  has(training, /40\s*(?:kg|公斤|千克)/i, 'Actual strength weight must survive local assembly')
  has(training, /8\s*次/, 'Actual completed repetitions must survive local assembly')
  has(training, /RPE[^\n]{0,12}6/i, 'Recorded session RPE must survive local assembly')
})

test('daily recovery retains quantitative readings, subjective recovery and independent rest', async t => {
  const f = fixture(t); seedAll(t, f)
  const recovery = domain((await send(f, '看看我的健康与恢复')).facts, '健康与恢复')
  has(recovery, /6小时30分|6\.5\s*(?:小时|h\b)/, 'Saved sleep reaches the local fact summary')
  has(recovery, /很累|tired/, 'Saved subjective fatigue reaches the local fact summary')
  has(recovery, /恢复[^\n]{0,30}4/, 'Saved subjective recovery reaches the local fact summary')
  has(recovery, /午睡[^\n]{0,45}25\s*分/, 'An independent rest report is retained')
})

test('unknown nutrition stays unknown while an explicit recorded zero remains zero', async t => {
  const f = fixture(t)
  const base = { date: DAY, meal: '加餐' as const, athleteId: 'local', recordedAt: `${DAY}T08:00:00Z` }
  const rows: FoodEntry[] = [
    { ...base, id: 'unknown-food', name: '合成未知餐', kcal: 0, label: '未估算' },
    { ...base, id: 'zero-food', name: '合成明确零餐', kcal: 0, label: '手填', source: 'MANUAL', protein: 0, carb: 0, fat: 0 },
  ]
  f.store.setItem('fr255-food-log-v1', JSON.stringify(rows))
  const nutrition = domain((await send(f)).facts, '饮食')
  has(nutrition, /合成未知餐[^\n]*(?:未知|待补|未估算)/, 'Unknown energy has a distinct availability state')
  assert.ok(!/合成未知餐[^\n]*\b0\s*(?:千卡|kcal)/i.test(nutrition), 'Unknown energy is never presented as measured zero')
  has(nutrition, /合成明确零餐[^\n]*\b0\s*(?:千卡|kcal)/i, 'An explicit confirmed zero remains zero')
})

test('unreadable food and health storage remain errors in the local domain summaries', async t => {
  const f = fixture(t)
  f.store.setItem('fr255-food-log-v1', '{BROKEN_SYNTHETIC_FOOD')
  f.store.setItem('fr255-vitals-v1', '{BROKEN_SYNTHETIC_HEALTH')
  const { facts } = await send(f, FOLLOWUP)
  has(domain(facts, '饮食'), /无法读取|读取失败|损坏/, 'Unreadable food storage must not be flattened to no meals')
  has(domain(facts, '健康与恢复'), /无法读取|读取失败|损坏/, 'Unreadable health storage must not be flattened to missing health')
})

test('future-known and future-day records are excluded by the request as-of boundary', async t => {
  const f = fixture(t); seedAll(t, f)
  f.store.setItem('fr255-food-log-v1', JSON.stringify([
    { id: 'future-known-meal', name: 'SENTINEL_FUTURE_KNOWN_MEAL', date: DAY, meal: '晚餐', kcal: 9999, athleteId: 'local', recordedAt: `${DAY}T18:00:00Z` },
    { id: 'future-day-meal', name: 'SENTINEL_FUTURE_DAY_MEAL', date: '2026-10-23', meal: '早餐', kcal: 8888, athleteId: 'local', recordedAt: `${DAY}T08:00:00Z` },
  ]))
  assert.deepEqual(saveDeviceRows([health('SLEEP', 7.75, DAY, `${DAY}T18:00:00Z`, 'future-watch')]).errors, [])
  const { facts } = await send(f, FOLLOWUP, { asOf: AS_OF })
  assert.ok(!/SENTINEL_FUTURE|9999|8888/.test(facts), 'Future food is absent from local fact summary')
  assert.ok(!/7小时45分|7\.75\s*(?:小时|h\b)/.test(domain(facts, '健康与恢复')), 'A later-known same-day sleep value is absent')
  has(domain(facts, '饮食'), /合成传输餐/, 'Eligible current records remain available')
})

test('foreign food, body, health and legacy V4 records never enter the local snapshot', async t => {
  const f = fixture(t); seedAll(t, f)
  setEventContext({ athleteId: 'foreign-transport-athlete' })
  meal({ ...FOOD, i: 'foreign-food', n: 'SENTINEL_FOREIGN_FOOD', p: [7777, 77, 77, 77, 7] })
  assert.ok(upsertCheck({ date: DAY, weight: 111.1 }))
  assert.deepEqual(saveDeviceRows([health('RHR', 96, DAY, `${DAY}T08:00:00Z`, 'SENTINEL_FOREIGN_WATCH')]).errors, [])
  f.store.setItem('fk-plan400-v4-log', JSON.stringify({ [DAY]: { athleteId: 'foreign-transport-athlete', done: 'done', strength: 'SENTINEL_FOREIGN_STRENGTH', rpe: '9' } }))
  setEventContext({ athleteId: 'local' })
  const { facts } = await send(f, FOLLOWUP)
  assert.ok(!/SENTINEL_FOREIGN|7777|111\.1/.test(facts), 'Foreign athlete data is absent at the final local fact boundary')
  has(domain(facts, '饮食'), /合成传输餐/, 'Current athlete food is retained')
  has(domain(facts, '健康与恢复'), /58/, 'Current athlete resting heart rate is retained')
})

test('long context preserves all three domain summaries and discloses omitted details', async t => {
  const f = fixture(t); seedAll(t, f)
  f.store.setItem('fk-plan-doc-v1', JSON.stringify({ schema: 'fangkun-plan-v1', plan: { name: '合成长计划', shiftDays: 0, weeks: [], days: [{ date: DAY, orig: DAY, weekday: '四', week: '1', title: '合成长训练说明', main: ['合成训练说明'.repeat(2200)], aux: [], strength: [] }] } }))
  const { facts } = await send(f, FOLLOWUP, { local: '合成旧参考结论'.repeat(500) })
  assert.ok(facts.length <= 7800, 'The assembled facts remain inside the agreed client budget')
  has(domain(facts, '饮食'), /612/, 'Nutrition is retained even with a long training plan')
  has(domain(facts, '训练与力量'), /实际|记录|完成/, 'The training summary remains available')
  has(domain(facts, '健康与恢复'), /6小时30分|6\.5\s*(?:小时|h\b)/, 'Health is retained even with a long training plan')
  has(facts, /省略|截断/, 'Omitted details are disclosed in local facts')
})

test('the requested historical day is preserved in local nutrition and health', async t => {
  const f = fixture(t)
  meal(FOOD, '2026-10-21')
  meal({ ...FOOD, i: 'today-food', n: 'SENTINEL_TODAY_FOOD', p: [913, 10, 20, 2, 1] })
  assert.deepEqual(saveDeviceRows([health('SLEEP', 6, '2026-10-21'), health('SLEEP', 8)]).errors, [])
  // Match the real UI: pass today's date once, and let the question select yesterday.
  const { facts } = await send(f, '昨天的饮食健康记录怎么样', { asOf: AS_OF })
  has(facts, /查询日期[^\n]*2026-10-21/, 'The selected historical day is not relabelled today')
  has(domain(facts, '饮食'), /合成传输餐/, 'Yesterday meal is retained')
  assert.ok(!domain(facts, '饮食').includes('SENTINEL_TODAY_FOOD'), 'Today meal is not presented as yesterday')
  has(domain(facts, '健康与恢复'), /6\s*(?:小时|h\b)/, 'Yesterday sleep is retained')
  assert.ok(!/8\s*(?:小时|h\b)/.test(domain(facts, '健康与恢复')), 'Today sleep is not presented as yesterday')
})

test('food corrections and deletions are reflected by the next local projection', async t => {
  const f = fixture(t), original = meal()
  has(domain((await send(f)).facts, '饮食'), /612/, 'Initial meal remains in local facts')
  t.mock.timers.tick(1000)
  assert.ok(updateEntry(original.id, { kcal: 913 }))
  has(domain((await send(f)).facts, '饮食'), /913/, 'A correction reaches the next request without stale caching')
  t.mock.timers.tick(1000)
  assert.ok(removeEntry(original.id)); assert.equal(loadEntries().length, 0)
  assert.ok(!domain((await send(f)).facts, '饮食').includes(FOOD.n), 'A deleted meal is absent from the next request')
})

test('online off stops the client before either proxy or provider receives a request', async t => {
  const f = fixture(t); meal(); setOnline(false)
  const facts = buildFacts(DAY, null, null, { question: FIRST, asOf: AS_OF, selectedOccurrenceId: null })
  assert.ok('error' in await askOnlineCoach({ question: FIRST, facts, local: '', history: [] }))
  assert.equal(f.client.length, 0); assert.equal(f.provider.length, 0)
})

test('new local records remain readable when old chat denies visibility, without authorizing upload', async t => {
  const f = fixture(t); meal()
  const facts = buildFacts(DAY, null, null, { question: FOLLOWUP, asOf: AS_OF })
  const result = await askOnlineCoach({ question: FOLLOWUP, facts, local: '旧本地参考：没有饮食数据。', history: [{ role: 'user', text: FIRST }, { role: 'coach', text: '我读不到你的饮食和健康记录。' }] })
  assert.ok('error' in result); assert.match(facts, /合成传输餐/)
  assert.equal(f.client.length, 0); assert.equal(f.provider.length, 0)
})

test('large Chinese context retains local domain facts without uploading unauthorised records', async t => {
  const f = fixture(t); seedAll(t, f)
  for (let index = 0; index < 32; index++) meal({ ...FOOD, i: `bulk-food-${index}`, n: `合成多餐${index}：` + '经核对保存的食物'.repeat(12) })
  for (let index = 0; index < 7; index++) {
    const session: Session = { id: `bulk-strength-${index}`, name: '合成多组力量课', moves: [{ id: 'squat', catalogId: 'back-squat', customName: '', sets: 8, mode: 'reps', amount: 8, restSec: 60, weightKg: 40 }] }
    const decisionId = `bulk-decision-${index}`
    const start = startTraining({ decisionId, sessionId: session.id, action: 'ORIGINAL_PLAN' }); assert.ok(start)
    assert.ok(bindTrainingStart({ startEventId: start.event_id, startedAt: start.timestamp, sessionId: session.id, planSlotId: session.id, plan: session }))
    for (const set of emptySets(session)) assert.ok(recordSet(session.id, decisionId, { ...set, actualWeight: 40, actualAmount: 8, completed: true, source: 'user_entered', timestamp: new Date().toISOString() }))
    t.mock.timers.tick(60_000)
    assert.ok(completeFromRunner({ decisionId, sessionId: session.id, planned: null, actualSets: 8, actualAmount: 64, actualWeightKg: 40, rpe: 6, pain: false, modified: false, interrupted: false }))
    assert.equal(recordCoachEvidence(start.event_id, { sessionRpe: 6 }).ok, true)
  }
  f.store.setItem('fk-plan-doc-v1', JSON.stringify({ schema: 'fangkun-plan-v1', plan: { name: '合成超长计划', shiftDays: 0, weeks: [], days: [{ date: DAY, orig: DAY, weekday: '四', week: '1', title: '合成超长训练说明', main: ['合成训练说明'.repeat(2400)], aux: [], strength: [] }] } }))
  assert.deepEqual(saveDeviceRows([health('BODY_BATTERY', 73), health('READINESS', 86), health('STRESS', 24)]).errors, [])
  for (let index = 0; index < 6; index++) assert.equal(saveSelfReportedRest({ requestId: `bulk-rest-${index}`, athleteId: 'local', contextDay: DAY, kind: 'NAP', duration: { low: 20 + index, high: 20 + index }, start: null, end: null, timezone: 'UTC' }, Date.parse(`${DAY}T10:00:00Z`) + index).ok, true)
  const prefix = '查看我的饮食健康训练记录：', question = prefix + '问'.repeat(1000 - prefix.length)
  const facts = buildFacts(DAY, null, null, { question, asOf: new Date().toISOString(), selectedOccurrenceId: null })
  const local = '本地参考'.repeat(750)
  const history = Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? 'coach' : 'user', text: '史'.repeat(400) }))
  const result = await askOnlineCoach({ question, facts, local, history })
  assert.equal(question.length, 1000); assert.equal(local.length, 3000)
  assert.equal(f.client.length, 0); assert.equal(f.provider.length, 0)
  assert.ok('error' in result)
  has(domain(facts, '饮食'), /已记录/, 'The nutrition summary is retained under byte pressure')
  has(domain(facts, '饮食'), /65\.4/, 'Measured weight is retained under byte pressure')
  has(domain(facts, '训练与力量'), /已完成/, 'Actual strength training summary is retained under byte pressure')
  has(domain(facts, '健康与恢复'), /6\.5\s*(?:小时|h\b)|6小时30分/, 'Recovery summary is retained under byte pressure')
  has(facts, /省略|截断/, 'Summarised domain details are disclosed')
  t.diagnostic(`Preserved local fact summary: ${facts.length} characters; model uploads: 0`)
})

for (const [label, facts] of [['UTF-8 byte cap', '事实'.repeat(4000)], ['proxy fact character cap', 'x'.repeat(8001)]] as const) {
  test(`oversized local facts (${label}) do not bypass missing server authorization`, async t => {
    const f = fixture(t)
    const result = await askOnlineCoach({ question: FIRST, facts, local: '', history: [] })
    assert.ok('error' in result, 'An unforwardable fact snapshot must use the existing error/fallback path')
    assert.equal(f.client.length, 0, 'The client must not transmit facts that the proxy would reject or silently cut')
    assert.equal(f.provider.length, 0)
  })
}
