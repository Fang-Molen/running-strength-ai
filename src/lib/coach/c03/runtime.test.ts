import test from 'node:test'
import assert from 'node:assert/strict'
import { firstWeekMemory } from '../../core/coach-first-week.fixtures.ts'
import { setStoreBackend, writeEnvelope } from '../../core/storage.ts'
import { currentAthleteId, dispatchEvent, setEventContext, loadEvents } from '../../core/events.ts'
import { confirmTrackPlan, emptyDraft, startTrackSession, commitTrackSlot, finishTrackSession } from '../../ui/running-workouts.ts'
import { projectRunningExecution } from '../../core/running-execution.ts'
import { readFormalEvidenceRows } from '../../core/coach-v4-formal-rows-store.ts'
import { reviewFormalEvidence } from '../../core/coach-v4-c11-adapter.ts'
import { buildReasoningFrame } from '../../core/coach-reasoning.ts'
import { assembleCoachBrief } from '../../core/coach-brief.ts'
import { answerLocally } from '../../core/coach-local-first.ts'
import { emptyDialogue } from '../../core/coach-dialogue.ts'
import { appendCorrection } from '../../core/training-correction.ts'
import { registerDisplayedC03Review, recheckC03Followups, readC03FollowupView,
  startC03FollowupRuntime, withdrawDisplayedC03Hypothesis, C03_FOLLOWUP_CHANGED_EVENT } from './runtime.ts'
import { C03_FOLLOWUP_PREFIX } from './followup.ts'

function course() {
  const saved = confirmTrackPlan('200x4x2', { ...emptyDraft('200x4x2'), repRestSeconds: 120, roundRestSeconds: 300 })
  assert.equal(saved.ok, true); if (!saved.ok) throw Error('plan')
  const start = startTrackSession(saved.plan.planId); assert.equal(start.ok, true); if (!start.ok) throw Error('start')
  const slots = projectRunningExecution(start.trainingOccurrenceId, loadEvents()).repetitions
  slots.forEach((slot, i) => assert.equal(commitTrackSlot(slot, 'complete', String(30 + i), '200').ok, true))
  assert.equal(finishTrackSession(start.trainingOccurrenceId, 'COMPLETED', 7, 0).ok, true)
  return start.trainingOccurrenceId
}
function answer(occurrenceId: string, question = '复盘这次训练，为什么掉速？') {
  const asOf = new Date().toISOString(), athleteId = currentAthleteId()
  const rows = readFormalEvidenceRows(athleteId, asOf)
  const snapshot = reviewFormalEvidence({ athleteId, asOf, question, rows: rows.rows }).audit.snapshot
  const frame = buildReasoningFrame({ snapshot, question, scopeOccurrenceIds: [occurrenceId] })
  return answerLocally(assembleCoachBrief(null, question, occurrenceId), { frame, snapshot }, [], undefined, emptyDialogue(athleteId))
}
async function isolated(fn: (box: ReturnType<typeof firstWeekMemory>) => Promise<void> | void) {
  const box = firstWeekMemory(); setStoreBackend(box); setEventContext({ athleteId: 'synthetic-runtime' })
  try { await fn(box) } finally { setStoreBackend(null); setEventContext({ athleteId: 'local' }); Reflect.deleteProperty(globalThis, 'window') }
}
const delay = () => new Promise(resolve => setTimeout(resolve, 30))

test('explicit real formal replay uses C03 calculations, two limited explanations and original purpose boundary', async () => isolated(box => {
  const occ = course(), before = [...box.data], a = answer(occ)
  assert.ok(a.c03); assert.equal(a.c03.brief.observedOccurrenceId, occ)
  assert.equal(a.c03.brief.groups.length, 2); assert.match(a.text, /30 \/ 31 \/ 32 \/ 33秒/)
  assert.match(a.text, /均值31.5秒/); assert.match(a.text, /可能解释1/); assert.match(a.text, /可能解释2/)
  assert.match(a.text, /反证|削弱/); assert.match(a.text, /下一步具体观察/)
  assert.equal(a.c03.review.semanticCorrectnessEvaluated, false); assert.equal(a.c03.brief.planMutationAuthorized, false)
  assert.equal(a.candidate, null)
  assert.deepEqual([...box.data], before)
}))
for (const question of ['只计算配速是多少？', '查看实际训练记录', '请解释教学案例训练掉速', '下一课要怎么安排？', '复盘这次训练后明天调整吗？'])
 test(`C03 does not hijack unrelated task: ${question}`, async () => isolated(() => {
   assert.equal(answer(course(), question).c03, undefined)
 }))
test('medical emergency and persisted medical hold stay ahead of C03', async () => isolated(() => {
  const occ = course(), a = answer(occ, '复盘这次训练，现在胸痛呼吸困难')
  assert.equal(a.c03, undefined); assert.match(a.text, /急救|急诊|120/)
  const asOf = new Date().toISOString(), snapshot = reviewFormalEvidence({ athleteId: currentAthleteId(), asOf, question: '', rows: readFormalEvidenceRows(currentAthleteId(), asOf).rows }).audit.snapshot
  const dialogue = emptyDialogue(currentAthleteId()); dialogue.medicalHold = { level: 'MEDICAL_REVIEW', subject: 'SELF', negated: false, temporal: 'HISTORY', classes: ['PAIN'], evidence: ['仍有疼痛限制'] }
  const b = answerLocally(assembleCoachBrief(null, '复盘这次训练掉速原因', occ), { snapshot, frame: buildReasoningFrame({ snapshot, question: '复盘', scopeOccurrenceIds: [occ] }) }, [], undefined, dialogue)
  assert.equal(b.c03, undefined)
}))
test('displayed review registers exact sourced nonnumeric hypotheses; duplicates do not create forecasts', async () => isolated(async box => {
  const occ = course(), a = answer(occ), official = [...box.data].filter(([k]) => !k.startsWith(C03_FOLLOWUP_PREFIX))
  const result = await registerDisplayedC03Review(a); assert.equal(result.ok, true, result.reason); assert.equal(result.ids.length, 2)
  const p = readC03FollowupView(); assert.equal(p.hypotheses.length, 2); assert.equal(p.forecastVersions, 0)
  assert.ok(p.hypotheses.every(h => h.status === 'PENDING' && h.supportEvidence.length && h.counterConditions?.length))
  assert.ok(p.hypotheses.every(h => h.basis.length === 2 && h.basis.some(b => JSON.parse(b.scopeKey).kind === 'RELATED_PROTOCOL')))
  assert.equal((await registerDisplayedC03Review(a)).ok, true)
  assert.equal(readC03FollowupView().hypotheses.length, 2)
  assert.deepEqual([...box.data].filter(([k]) => !k.startsWith(C03_FOLLOWUP_PREFIX)), official)
}))
test('restored backend sees hypotheses and withdrawal keeps versions and facts', async () => isolated(async box => {
  const a = answer(course()), result = await registerDisplayedC03Review(a); assert.equal(result.ok, true)
  setStoreBackend({ getItem: box.getItem, setItem: box.setItem, keys: box.keys })
  assert.equal(readC03FollowupView().hypotheses.length, 2)
  const before = loadEvents().length
  assert.equal(withdrawDisplayedC03Hypothesis(result.ids[0]).ok, true)
  assert.equal(readC03FollowupView().hypotheses.find(h => h.id === result.ids[0])?.status, 'WITHDRAWN')
  assert.equal(readC03FollowupView().hypotheses.length, 2); assert.equal(loadEvents().length, before)
}))
test('another athlete cannot register or read the previous local-profile history', async () => isolated(async () => {
  const a = answer(course()); assert.equal((await registerDisplayedC03Review(a)).ok, true)
  setEventContext({ athleteId: 'other-athlete' })
  assert.equal(readC03FollowupView().hypotheses.length, 0)
  assert.equal((await registerDisplayedC03Review(a)).ok, false)
}))
test('correction after display blocks stale registration; missing or unbound evidence is never upgraded', async () => isolated(async () => {
  const occ = course(), a = answer(occ)
  assert.ok(appendCorrection({ trainingOccurrenceId: occ, kind: 'VOID', reason: '合成作废测试' }))
  assert.equal((await registerDisplayedC03Review(a)).ok, false)
  assert.equal(readC03FollowupView().hypotheses.length, 0)
  assert.equal((await registerDisplayedC03Review({ text: '无实际来源', sources: [], escalationAvailable: false })).ok, false)
}))
test('only related dependency changes mark a review stale; unrelated evidence does not', async () => isolated(async () => {
  const occ = course(); assert.equal((await registerDisplayedC03Review(answer(occ))).ok, true)
  dispatchEvent('TRAINING_STARTED', { sessionId: 'unrelated-template' })
  const unchanged = await recheckC03Followups(); assert.equal(unchanged.ok, true); assert.equal(unchanged.reviewed.length, 0)
  assert.ok(appendCorrection({ trainingOccurrenceId: occ, kind: 'VOID', reason: '合成更正' }))
  const changed = await recheckC03Followups(); assert.equal(changed.ok, true); assert.equal(changed.reviewed.length, 2)
  assert.ok(readC03FollowupView().hypotheses.every(h => h.status === 'STALE_NEEDS_REVIEW'))
}))
test('a previously empty same-protocol query detects later comparable-source evidence', async () => isolated(async () => {
  assert.equal((await registerDisplayedC03Review(answer(course()))).ok, true)
  course()
  assert.equal((await recheckC03Followups()).reviewed.length, 2)
  assert.ok(readC03FollowupView().hypotheses.every(h => h.status === 'STALE_NEEDS_REVIEW'))
}))
test('source read failure and quota failure are explicit and do not touch saved training', async () => isolated(async box => {
  const a = answer(course()), before = loadEvents().length
  setStoreBackend({ getItem: box.getItem, keys: box.keys, setItem: () => { throw Error('quota') } })
  assert.equal((await registerDisplayedC03Review(a)).ok, false)
  assert.equal(loadEvents().length, before)
  setStoreBackend(box); box.setItem('fr255-events-v1', '{malformed')
  assert.equal((await registerDisplayedC03Review(a)).ok, false)
}))
test('failed source reads mark existing dependency judgments for review instead of certifying an empty history', async () => isolated(async box => {
  assert.equal((await registerDisplayedC03Review(answer(course()))).ok, true)
  box.setItem('fr255-events-v1', '{malformed')
  const result = await recheckC03Followups()
  assert.equal(result.ok, true); assert.equal(result.reviewed.length, 2)
  assert.ok(readC03FollowupView().hypotheses.every(h => h.status === 'STALE_NEEDS_REVIEW'))
}))
test('post-save runtime is deferred, reviews new corrections, and can be stopped', async () => isolated(async () => {
  const target = new EventTarget(); Object.defineProperty(globalThis, 'window', { value: target, configurable: true })
  const occ = course(); assert.equal((await registerDisplayedC03Review(answer(occ))).ok, true)
  let notices = 0; target.addEventListener('fk-training-corrected', () => notices++)
  const stop = startC03FollowupRuntime(); await delay()
  const completed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { target.removeEventListener(C03_FOLLOWUP_CHANGED_EVENT, done); reject(Error('POST_SAVE_REVIEW_DID_NOT_COMPLETE')) }, 2000)
    const done = () => { if (readC03FollowupView().hypotheses.every(h => h.status === 'STALE_NEEDS_REVIEW')) {
      clearTimeout(timeout); target.removeEventListener(C03_FOLLOWUP_CHANGED_EVENT, done); resolve() } }
    target.addEventListener(C03_FOLLOWUP_CHANGED_EVENT, done)
  })
  assert.ok(appendCorrection({ trainingOccurrenceId: occ, kind: 'VOID', reason: '保存后复核' }))
  assert.equal(notices, 1); assert.ok(readC03FollowupView().hypotheses.every(h => h.status === 'PENDING'))
  await completed; assert.ok(readC03FollowupView().hypotheses.every(h => h.status === 'STALE_NEEDS_REVIEW'))
  stop()
}))
test('failed correction persistence emits no success notification', async () => isolated(box => {
  const target = new EventTarget(); Object.defineProperty(globalThis, 'window', { value: target, configurable: true })
  let notices = 0; target.addEventListener('fk-training-corrected', () => notices++)
  setStoreBackend({ getItem: box.getItem, keys: box.keys, setItem: () => { throw Error('quota') } })
  assert.equal(appendCorrection({ trainingOccurrenceId: 'synthetic-occurrence', kind: 'VOID', reason: '保存失败' }), null)
  assert.equal(notices, 0)
}))
test('account switch while queued cancels the former athlete review result', async () => isolated(async () => {
  const target = new EventTarget(); Object.defineProperty(globalThis, 'window', { value: target, configurable: true })
  const occ = course(); assert.equal((await registerDisplayedC03Review(answer(occ))).ok, true)
  const stop = startC03FollowupRuntime()
  appendCorrection({ trainingOccurrenceId: occ, kind: 'VOID', reason: '排队中换账号' })
  setEventContext({ athleteId: 'other-athlete' }); await delay()
  assert.equal(readC03FollowupView().hypotheses.length, 0)
  stop(); setEventContext({ athleteId: 'synthetic-runtime' })
  assert.ok(readC03FollowupView().hypotheses.every(h => h.status === 'PENDING'))
}))
test('unknown-commit related source cannot be treated as an empty complete query', async () => isolated(async () => {
  const a = answer(course()), event = loadEvents().find(e => e.event_type === 'RUNNING_REPETITION_COMPLETED')!
  writeEnvelope('fr255-events-v1', [{ ...event, event_id: 'legacy-uncommitted-related',
    payload: { ...event.payload, trainingOccurrenceId: 'other-same-protocol-occurrence' } }])
  assert.equal((await registerDisplayedC03Review(a)).ok, false)
  assert.equal(readC03FollowupView().hypotheses.length, 0)
}))
test('a fully excluded current-occurrence event cannot disappear from completeness accounting', async () => isolated(async () => {
  const occ = course(), a = answer(occ)
  dispatchEvent('RPE_RECORDED', { trainingOccurrenceId: occ, evidenceType: 'SESSION_RPE', value: 7 }, { source: 'SYSTEM' })
  assert.equal((await registerDisplayedC03Review(a)).ok, false)
}))
test('unknown-commit correction on a related course cannot hide that course and certify an empty query', async () => isolated(async () => {
  const related = course(), current = course(), a = answer(current)
  writeEnvelope('fr255-training-correction-v1', [{ schemaVersion: 1, correctionId: 'unknown-related-correction', trainingOccurrenceId: related,
    kind: 'FIELD', field: 'duration', setKey: null, originalValue: '30', newValue: '31', reason: '合成旧更正缺提交时间', at: new Date().toISOString() }])
  assert.equal((await registerDisplayedC03Review(a)).ok, false)
  assert.equal(readC03FollowupView().hypotheses.length, 0)
}))
test('athlete switch during the asynchronous source digest cannot append an old-athlete hypothesis', async () => isolated(async () => {
  const a = answer(course()), original = crypto.subtle.digest.bind(crypto.subtle)
  let n = 0
  Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (...args: Parameters<typeof original>) => {
    if (++n === 10) setEventContext({ athleteId: 'other-athlete' })
    return original(...args)
  } })
  try {
    assert.equal((await registerDisplayedC03Review(a)).ok, false)
    setEventContext({ athleteId: 'synthetic-runtime' }); assert.equal(readC03FollowupView().hypotheses.length, 0)
  } finally { Reflect.deleteProperty(crypto.subtle, 'digest') }
}))
test('source correction during the asynchronous digest is rechecked immediately before append', async () => isolated(async () => {
  const occ = course(), a = answer(occ), original = crypto.subtle.digest.bind(crypto.subtle)
  let n = 0
  Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (...args: Parameters<typeof original>) => {
    if (++n === 10) assert.ok(appendCorrection({ trainingOccurrenceId: occ, kind: 'VOID', reason: '异步等待时更正' }))
    return original(...args)
  } })
  try {
    assert.equal((await registerDisplayedC03Review(a)).ok, false)
    assert.equal(readC03FollowupView().hypotheses.length, 0)
  } finally { Reflect.deleteProperty(crypto.subtle, 'digest') }
}))
