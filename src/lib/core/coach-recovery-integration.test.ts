/** Synthetic integration only: no athlete files, network or model API. */
import assert from 'node:assert/strict'
import test, { beforeEach, afterEach, mock } from 'node:test'
import { setStoreBackend, type MemoryStore } from './storage.ts'
import { setEventContext } from './events.ts'
import { saveDeviceRows, type DeviceHealthRow } from '../health/device-store.ts'
import { shiftDay } from '../health/observation.ts'
import { readRecoveryContext, recoveryDayForReview, type RecoveryContext } from './coach-recovery-context.ts'
import { assembleCoachBrief } from './coach-brief.ts'
import { answerLocally } from './coach-local-first.ts'
import { emptyDialogue } from './coach-dialogue.ts'
import { evaluateCoachEvolution, type EvolutionEvidence } from './coach-evolution-v4.ts'
import { buildOfflineReview, emptyOfflineProfile, readOfflineHistory, saveOfflineReview, type ProfileRecord } from './coach-offline-loop.ts'
import { reviseHypotheses } from './coach-development-projection.ts'
import { parseChatTraining, saveChatTraining } from './coach-chat-evidence.ts'
import { readOfflineWorkspace } from './coach-offline-workspace.ts'

const athleteId = 'local', day = '2026-10-18', asOf = '2026-10-18T12:00:00Z'
let data: Map<string, string>, store: MemoryStore
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
beforeEach(() => {
  data = new Map()
  store = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) }, keys: () => [...data.keys()] }
  setStoreBackend(store)
  setEventContext({ athleteId })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store })
  mock.timers.enable({ apis: ['Date'], now: new Date(asOf) })
})
afterEach(() => {
  setStoreBackend(null)
  setEventContext({ athleteId: 'local' })
  mock.timers.reset()
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  else delete (globalThis as { localStorage?: unknown }).localStorage
})

function health(metric: DeviceHealthRow['metric'], value: number, date = day, syncedAt = `${date}T08:00:00Z`, sourceId = 'synthetic-watch-a'): DeviceHealthRow {
  return { key: `${metric}:${date}`, metric, value, day: date, source: 'synthetic-watch', hrvMethod: 'RMSSD', observation: {
    key: `${metric}:${date}`, sourceId, statistic: metric === 'SLEEP' ? 'night total' : metric === 'HRV' ? 'night RMSSD mean' : 'daily resting HR', syncedAt,
  } }
}
function seed(rows: DeviceHealthRow[]) {
  const result = saveDeviceRows(rows)
  assert.deepEqual(result.errors, [])
}
function seedRecovery() {
  seed([health('SLEEP', 6.5), health('RHR', 60), health('HRV', 48), ...Array.from({ length: 7 }, (_, i) => {
    const date = shiftDay(day, -i - 1)
    return [health('RHR', 50, date), health('HRV', 60, date)]
  }).flat()])
}
function context(date = day, now = asOf): RecoveryContext {
  const result = readRecoveryContext(athleteId, date, now)
  assert.ok(result)
  return result
}
function training(date = day): EvolutionEvidence[] {
  return [30, 31, 32, 33].map((value, i) => ({
    id: `split-${i}`, athleteId, occurrenceId: 'synthetic-session', metric: 'SPLIT_SECONDS', value, unit: 's',
    context: `running:main:rep:block:step:1:${i + 1}:200m`, eventAt: `${date}T10:00:00Z`, recordedAt: `${date}T11:00:00Z`,
    source: 'TRAINING_FACT', sourceId: `synthetic-fact:${i}`, confirmation: 'CONFIRMED',
    measurement: { method: 'HAND_STOPWATCH_SAME_START', segmentSourceId: `synthetic-fact:${i}` },
  }))
}
const profile: ProfileRecord = { id: 'synthetic-profile', createdAt: '2026-10-01T08:00:00Z', confirmed: true, supersedes: null,
  profile: { ...emptyOfflineProfile(athleteId), event: '800米', pbSeconds: 120, stage: '基础期' } }
function review(recoveryContext: RecoveryContext | undefined = context(), now = asOf, question = '这节课的目的是保持节奏，复盘本课', rows = training()) {
  return buildOfflineReview({
    snapshot: evaluateCoachEvolution({ athleteId, asOf: now, question, evidence: rows }),
    occurrenceId: 'synthetic-session', profile, question, recoveryContext,
  })
}
const chat = '今天实际完成4×200米，分别30、31、32、33秒，组间休息120秒，整课RPE7，本课目的是保持节奏，目前基础期，帮我复盘'
function answer(question = chat) {
  return answerLocally(assembleCoachBrief(null, question, null), undefined, [], undefined, emptyDialogue(athleteId))
}

test('daily context calculates personal RHR and lnRMSSD changes with original sources, never a readiness score', () => {
  seedRecovery()
  const r = context()
  assert.equal(r.scope, 'DAY_CONTEXT')
  assert.equal(r.planWrite, false)
  assert.equal(r.diagnosis, false)
  assert.equal(r.quantitative.decisionAuthorized, false)
  const fact = (metric: string) => r.quantitative.facts.find(f => f.metric === metric)!
  assert.equal(fact('SLEEP').value, 6.5)
  assert.equal(fact('FAT_RHR').value, 10)
  assert.ok(Math.abs(fact('FAT_HRV').value - Math.log(48 / 60)) < 1e-9)
  assert.ok(fact('FAT_RHR').sourceIds.length >= 6)
  assert.ok(r.dependency?.occurrenceId === `health-day:${day}`)
})

test('partial health data keeps actual sleep and missing metrics unavailable instead of inventing zeros', () => {
  seed([health('SLEEP', 7.25)])
  const r = context()
  assert.deepEqual(r.quantitative.facts.map(f => [f.metric, f.value]), [['SLEEP', 7.25]])
  assert.ok(r.quantitative.calculations.filter(c => c.ruleId !== 'REC_SLEEP').every(c => c.status === 'UNAVAILABLE' && c.value === null))
  assert.ok(r.missing.some(m => /静息心率|RHR/.test(m)))
})

test('unconfirmed course date cannot borrow today’s recovery context', () => {
  seedRecovery()
  const snap = evaluateCoachEvolution({ athleteId, asOf, question: '复盘', evidence: [] })
  assert.equal(recoveryDayForReview(snap, 'chat-session', '实际4×200米，复盘', true), null)
  assert.equal(readRecoveryContext(athleteId, null, asOf), null)
  assert.doesNotMatch(answer(chat.replace('今天', '')).text, /睡眠 6\.5|中位数 50 bpm|lnRMSSD较/)
})

test('explicit yesterday and saved occurrence date isolate health context from today', () => {
  const yesterday = shiftDay(day, -1)
  seed([health('SLEEP', 6.5), health('SLEEP', 8, yesterday)])
  const snap = evaluateCoachEvolution({ athleteId, asOf, question: '今天复盘昨天训练', evidence: training(yesterday) })
  assert.equal(recoveryDayForReview(snap, 'synthetic-session', '今天复盘这节课'), yesterday)
  assert.equal(recoveryDayForReview(snap, 'chat-session', '昨天实际4×200米，复盘', true), yesterday)
  const r = answer(chat.replace('今天', '昨天'))
  assert.match(r.text, /睡眠 8 h/)
  assert.doesNotMatch(r.text, /睡眠 6\.5/)
})

test('ambiguous, future and third-party course dates remain unresolved', () => {
  const snap = evaluateCoachEvolution({ athleteId, asOf, question: '复盘', evidence: [] })
  for (const question of ['今天和昨天实际训练，复盘', '2026-10-17和2026-10-18实际训练', '2026-10-19实际训练', '朋友今天实际4×200米']) {
    assert.equal(recoveryDayForReview(snap, 'chat-session', question, true), null, question)
  }
})

test('a late health upload is unavailable to an earlier analysis, including its source dependency', () => {
  seed([health('SLEEP', 4, day, '2026-10-18T13:00:00Z')])
  const r = context()
  assert.equal(r.quantitative.facts.length, 0)
  assert.equal(r.dependency, null)
  assert.ok(r.missing.some(m => /之后录入|之后.*更正/.test(m)))
})

test('changing athlete cannot read or bind another athlete’s health context', () => {
  seedRecovery()
  setEventContext({ athleteId: 'other-athlete' })
  assert.equal(readRecoveryContext(athleteId, day, asOf), null)
  const other = readRecoveryContext('other-athlete', day, asOf)
  assert.ok(other)
  assert.equal(other.quantitative.facts.length, 0)
  assert.equal(other.dependency, null)
})

test('independent source conflict blocks only the affected metric and keeps unrelated actual sleep', () => {
  seedRecovery()
  seed([health('RHR', 70, day, `${day}T09:00:00Z`, 'synthetic-watch-b')])
  const r = context()
  assert.ok(r.quantitative.facts.some(f => f.metric === 'SLEEP' && f.value === 6.5))
  assert.ok(!r.quantitative.facts.some(f => f.metric === 'RHR' || f.metric === 'FAT_RHR'))
  assert.equal(r.quantitative.calculations.find(c => c.ruleId === 'FAT_RHR')?.status, 'UNAVAILABLE')
  assert.ok(r.missing.some(m => /冲突/.test(m)))
})

test('actual local answer keeps concrete split numbers and adds scoped recovery facts with counterevidence', () => {
  seedRecovery()
  const result = answer()
  assert.match(result.text, /31\.5|30.*31.*32.*33/)
  assert.match(result.text, /保持节奏/)
  assert.match(result.text, /睡眠 6\.5 h/)
  assert.match(result.text, /中位数 50 bpm.*\+10 bpm/)
  assert.match(result.text, /lnRMSSD.*-0\.2231/)
  assert.match(result.text, /削弱|反证|不能证明/)
  assert.doesNotMatch(result.text, /疲劳评分\s*\d|自动减量|已修改.*计划/)
})

test('partial day context supplements an actual session review without blocking its numerical analysis', () => {
  seed([health('SLEEP', 7.25)])
  const result = answer()
  assert.match(result.text, /31\.5|30.*31.*32.*33/)
  assert.match(result.text, /睡眠 7\.25 h/)
  assert.doesNotMatch(result.text, /HRV 0|静息心率 0|恢复得分/)
})

test('generating integrated answers performs no fetch and leaves all formal data unchanged', () => {
  seedRecovery()
  store.setItem('fr255-original-plan', 'synthetic unchanged formal plan')
  const before = [...data], oldFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (() => { calls++; throw Error('network forbidden') }) as typeof fetch
  try {
    const result = answer()
    assert.match(result.text, /6\.5 h/)
    assert.equal(calls, 0)
    assert.deepEqual([...data], before)
  } finally { globalThis.fetch = oldFetch }
})

test('daily health is a separate dependency and is never rewritten as session sleep or an ability score', () => {
  seedRecovery()
  const r = review(), ctx = r.recoveryContext!
  assert.ok(ctx)
  assert.equal(r.metrics.points.length, 4)
  assert.equal(r.metrics.ratings.some(f => f.metric === 'SLEEP_HOURS'), false)
  assert.equal(r.basis.sources.some(s => s.sourceId === ctx.sourceId), false)
  assert.equal(r.development?.dependencies.filter(d => d.occurrenceId === `health-day:${day}`).length, 1)
  assert.equal(r.hypotheses.length, 2)
  assert.equal(r.hypotheses.filter(h => h.sourceIds.includes(ctx.sourceId)).length, 1)
  assert.equal(r.abilityScoreChange, 0)
  assert.equal(r.planWrite, false)
  assert.equal(r.development?.cycleCandidate.planWrite, false)
})

test('advancing the analysis clock alone does not retract the same unchanged health evidence', () => {
  seedRecovery()
  const before = review(), later = '2026-10-18T12:01:00Z'
  mock.timers.tick(60_000)
  const after = review(context(day, later), later)
  assert.deepEqual(after.recoveryContext?.dependency?.signature, before.recoveryContext?.dependency?.signature)
  assert.ok(reviseHypotheses('before', before, after).every(r => r.status !== 'WITHDRAWN'))
})

test('a health correction retracts only its dependent recovery hypothesis and preserves the old saved evidence', () => {
  seedRecovery()
  const before = review(), saved = saveOfflineReview(before)
  assert.equal(saved.ok, true)
  mock.timers.tick(60_000)
  const later = new Date().toISOString()
  seed([health('SLEEP', 8, day, later)])
  const after = review(context(day, later), later)
  const changes = reviseHypotheses(saved.id!, before, after)
  const dependent = before.hypotheses.find(h => h.sourceIds.includes(before.recoveryContext!.sourceId))!
  assert.ok(dependent)
  assert.equal(changes.find(c => c.hypothesisId === dependent.id)?.status, 'WITHDRAWN')
  assert.ok(changes.some(c => c.hypothesisId !== dependent.id && c.status === 'PENDING'))
  assert.equal(saveOfflineReview(after).ok, true)
  const history = readOfflineHistory(athleteId)
  assert.equal(history.length, 2)
  assert.equal(history[0].kind === 'ANALYSIS' && history[0].review.recoveryContext?.quantitative.facts.find(f => f.metric === 'SLEEP')?.value, 6.5)
})

test('a corrected personal baseline also invalidates the previous recovery interpretation', () => {
  seedRecovery()
  const before = review()
  mock.timers.tick(60_000)
  const later = new Date().toISOString()
  seed([health('RHR', 55, shiftDay(day, -1), later)])
  const after = review(context(day, later), later)
  const dependent = before.hypotheses.find(h => h.sourceIds.includes(before.recoveryContext!.sourceId))!
  assert.ok(dependent)
  assert.equal(reviseHypotheses('before', before, after).find(r => r.hypothesisId === dependent.id)?.status, 'WITHDRAWN')
})

test('JSON restoration retains health evidence, hypotheses, and readonly plan guarantees', () => {
  seedRecovery()
  const r = review()
  assert.equal(saveOfflineReview(r).ok, true)
  const restored = new Map<string, string>(JSON.parse(JSON.stringify([...data])))
  setStoreBackend({ getItem: key => restored.get(key) ?? null, setItem: (key, value) => { restored.set(key, value) }, keys: () => [...restored.keys()] })
  const history = readOfflineHistory(athleteId)
  assert.equal(history.length, 1)
  assert.ok(history[0].kind === 'ANALYSIS')
  assert.deepEqual(history[0].review.recoveryContext, r.recoveryContext)
  assert.deepEqual(history[0].review.hypotheses, r.hypotheses)
  assert.equal(history[0].review.planWrite, false)
  assert.equal(history[0].review.development?.cycleCandidate.requiresConfirmation, true)
})

test('missing context in a later review is not counterevidence and does not retract earlier health judgments', () => {
  seedRecovery()
  const before = review(), later = '2026-10-18T12:01:00Z'
  const after = buildOfflineReview({ snapshot: evaluateCoachEvolution({ athleteId, asOf: later, question: '复盘', evidence: training() }), occurrenceId: 'synthetic-session', profile, question: '这节课的目的是保持节奏，复盘本课' })
  assert.ok(reviseHypotheses('before', before, after).every(r => r.status !== 'WITHDRAWN'))
})

test('same-day reported pain blocks ordinary exploration even when sleep and baseline values look reassuring', () => {
  seedRecovery()
  store.setItem('fk-checkin-v1', JSON.stringify([{ athleteId, date: day, at: `${day}T09:00:00Z`, pain: 'sharp', fatigue: 'fresh' }]))
  const r = review()
  assert.equal(r.safetyRestricted, true)
  assert.equal(r.hypotheses.length, 0)
  assert.ok(r.development?.observationTasks.every(task => task.status === 'SAFETY_HOLD'))
  assert.equal(r.development?.cycleCandidate.decision, 'HOLD')
  assert.doesNotMatch(r.text, /可以加量|正常完成高强度|已恢复/)
})

test('an emergency supersedes numeric recovery context in the actual answer path', () => {
  seedRecovery()
  const result = answer(chat + '，现在胸痛喘不上气')
  assert.match(result.text, /120|急救|急诊/)
  assert.doesNotMatch(result.text, /6\.5 h|中位数 50|lnRMSSD|下一次.*训练/)
})
test('saved pain safety survives an ordinary next-turn question and JSON refresh',()=>{
 seedRecovery()
 store.setItem('fk-checkin-v1',JSON.stringify([{athleteId,date:day,at:`${day}T09:00:00Z`,pain:'sharp',fatigue:'fresh'}]))
 const first=answer(chat)
 assert.equal(first.dialogue?.medicalHold?.level,'MEDICAL_REVIEW')
 const next=answerLocally(assembleCoachBrief(null,'明天怎么练',null),undefined,[],undefined,JSON.parse(JSON.stringify(first.dialogue)))
 assert.match(next.text,/专业评估|专业运动许可/);assert.equal(next.candidate,null)
})

test('independent UI pain log with unknown entry time is a current safety clue, not a timed health measurement', () => {
  store.setItem('fk-pain-log-v1', JSON.stringify([{ date: day, part: '膝关节', score: 4 }]))
  const r = context()
  assert.equal(r.safetyHold, true)
  assert.equal(r.dependency, null)
  assert.equal(r.quantitative.facts.length, 0)
  assert.match(r.safetyNotes.join('；'), /时间.*未知|未知.*时间|时间未记录/)
  assert.equal(r.subjective.length, 0)
  const first = answer()
  assert.equal(first.dialogue?.medicalHold?.level, 'MEDICAL_REVIEW')
  assert.equal(first.candidate, null)
  assert.doesNotMatch(first.text, /可以加量|正常完成高强度|已恢复/)
})

test('independent pain from another athlete or another day cannot be imported into this session', () => {
  seedRecovery()
  for (const pain of [
    { athleteId: 'other-athlete', date: day, part: '膝关节', score: 4 },
    { athleteId, date: shiftDay(day, -1), part: '膝关节', score: 4 },
    { athleteId, date: shiftDay(day, 1), part: '膝关节', score: 4 },
  ]) {
    store.setItem('fk-pain-log-v1', JSON.stringify([pain]))
    assert.equal(context().safetyHold, false)
    const result = answer()
    assert.equal(result.dialogue?.medicalHold ?? null, null)
    assert.match(result.text, /31\.5|30.*31.*32.*33/)
  }
})

test('independent pain with a known future entry timestamp cannot leak into earlier context or keyword routing', () => {
  seedRecovery()
  for (const timestamp of [{ at: `${day}T13:00:00Z` }, { timestamp: `${day}T13:00:00Z` }]) {
    store.setItem('fk-pain-log-v1', JSON.stringify([{ athleteId, date: day, part: '膝关节', score: 4, ...timestamp }]))
    assert.equal(context().safetyHold, false)
    const result = answer(chat + '，睡眠怎么样')
    assert.equal(result.dialogue?.medicalHold ?? null, null)
    assert.match(result.text, /31\.5|30.*31.*32.*33/)
  }
})

test('sleep keywords cannot discard an independent pain hold before a next-turn training request', () => {
  seedRecovery()
  store.setItem('fk-pain-log-v1', JSON.stringify([{ date: day, part: '足部', score: 3 }]))
  const first = answer(chat + '，睡眠怎么样')
  assert.equal(first.dialogue?.medicalHold?.level, 'MEDICAL_REVIEW')
  const before = [...data]
  const next = answerLocally(assembleCoachBrief(null, '明天怎么练', null), undefined, [], undefined, JSON.parse(JSON.stringify(first.dialogue)))
  assert.equal(next.candidate, null)
  assert.equal(next.dialogue?.medicalHold?.level, 'MEDICAL_REVIEW')
  assert.match(next.text, /专业评估|专业运动许可/)
  assert.deepEqual([...data], before)
})

test('a timestamp-free historical pain note is not backdated into a past asOf dependency', () => {
  const priorDay = shiftDay(day, -1)
  store.setItem('fk-pain-log-v1', JSON.stringify([{ date: priorDay, part: '膝关节', score: 4 }]))
  const r = readRecoveryContext(athleteId, priorDay, `${priorDay}T12:00:00Z`)
  assert.ok(r)
  assert.equal(r.dependency, null)
  assert.equal(r.safetyHold, false)
})

test('UTC+8 morning uses the athlete’s local calendar day even though asOf is still the previous UTC date', () => {
  const oldTZ = process.env.TZ
  process.env.TZ = 'Asia/Shanghai'
  mock.timers.reset()
  const morning = '2026-10-17T23:00:00Z'
  mock.timers.enable({ apis: ['Date'], now: new Date(morning) })
  try {
    seed([health('SLEEP', 6.5, day, '2026-10-17T22:30:00Z')])
    const snap = evaluateCoachEvolution({ athleteId, asOf: morning, question: chat, evidence: [] })
    assert.equal(recoveryDayForReview(snap, 'chat-morning', chat, true), day)
    const r = context(day, morning)
    assert.equal(r.quantitative.facts.find(f => f.metric === 'SLEEP')?.value, 6.5)
    assert.equal(r.quantitative.calculations.find(c => c.ruleId === 'REC_SLEEP')?.status, 'AVAILABLE')
    assert.ok(r.dependency)
    assert.ok(Date.parse(r.dependency.eventAt) <= Date.parse(morning))
    assert.match(answer().text, /睡眠 6\.5 h/)
  } finally {
    if (oldTZ === undefined) delete process.env.TZ
    else process.env.TZ = oldTZ
  }
})

test('confirmed chat training reaches the saved workspace with original splits and separately sourced recovery context', () => {
  seedRecovery()
  store.setItem('fr255-original-plan', 'synthetic unchanged formal plan')
  const saved = saveChatTraining(parseChatTraining(chat), `${day}T10:00:00Z`, true)
  assert.ok(saved.ok)
  mock.timers.tick(1000)
  const before = [...data]
  const result = readOfflineWorkspace(null, athleteId, saved.record.confirmedImportId, '复盘这节课，原计划目的是保持节奏').review
  assert.deepEqual(result.metrics.points.map(p => p.seconds), [30, 31, 32, 33])
  assert.equal(result.purpose.purpose, '保持节奏')
  assert.equal(result.recoveryContext?.day, day)
  assert.match(result.text, /睡眠 6\.5 h/)
  assert.match(result.text, /中位数 50 bpm.*\+10 bpm/)
  assert.equal(result.basis.sources.some(s => s.sourceId === result.recoveryContext?.sourceId), false)
  assert.equal(result.development?.dependencies.filter(d => d.occurrenceId === `health-day:${day}`).length, 1)
  assert.equal(result.planWrite, false)
  assert.deepEqual([...data], before)
})

test('a generic medical referral constraint does not invent a pain-specific dialogue history', () => {
  seedRecovery()
  const brief = assembleCoachBrief(null, '今天健康睡眠数据怎么样', null)
  const result = answerLocally({ ...brief, constraints: { ...brief.constraints, medicalReferral: true } }, undefined, [], undefined, emptyDialogue(athleteId))
  assert.equal(result.dialogue?.medicalHold?.classes.includes('PAIN') ?? false, false)
  assert.doesNotMatch(result.text, /已有疼痛记录/)
})

test('measurement and structure hypotheses do not inherit recovery sources merely because they occupy the second slot', () => {
  seedRecovery()
  const rows = training().slice(0, 2).map((r, i) => ({ ...r, value: i ? 65 : 30, context: `running:main:continuous:block:step${i}:${i ? 400 : 200}m` }))
  const r = review(context(), asOf, '这节课的目的是保持节奏，复盘本课', rows)
  assert.ok(r.hypotheses.length > 0)
  assert.ok(r.hypotheses.every(h => h.id !== 'SESSION_CONTEXT'))
  assert.ok(r.hypotheses.every(h => !h.sourceIds.includes(r.recoveryContext!.sourceId)))
  assert.ok(r.hypotheses.every(h => !h.support.some(s => s.startsWith('同日背景'))))
  assert.match(r.text, /睡眠 6\.5 h/)
})
