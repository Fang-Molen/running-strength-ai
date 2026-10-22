import test from 'node:test'
import assert from 'node:assert/strict'
import { currentAthleteId, loadEvents, setEventContext } from '../core/events'
import { setStoreBackend } from '../core/storage'
import { readTrainingContext, startTraining } from '../core/training-decision'
import { bindTrainingStart, getTrainingOccurrence } from '../core/occurrence'
import { emptySets, executionOf, recordSet } from '../core/execution'
import { readTrainingFact } from '../core/fact-read'
import { appendCorrection } from '../core/training-correction'
import { assembleCoachBrief } from '../core/coach-brief'
import { readFormalEvidenceRows } from '../core/coach-v4-formal-rows-store'
import { coachImports } from '../core/coach-import-evidence'
import { completeFromRunner } from '../../components/training-runner'
import { saveGarminActivities } from '../../components/garmin-log'
import { readCoachData } from '../health/coach-data'
import { localDay } from '../health/observation'
import { emptyPlanExecution } from '../coach/plan-execution/core'
import { readGlobalCoachSnapshot, subscribeGlobalCoach } from '../coach/global-coach-host-v89'
import { saveRunningPlan } from '../core/running-plan'
import { projectRunningExecution } from '../core/running-execution'
import { commitTrackContinuous, commitTrackRecovery, commitTrackSlot, confirmTrackPlan, emptyDraft, finishTrackSession, openTrackOccurrence, recordTrackRecoveryFeedback, startTrackSession, withRunningWriteLock } from './running-workouts'
import { loadTrainingActivities, mergeActivities } from './training-read-model'
import { saveDeviceRows } from './device-store'
import type { DeviceActivity } from './device-parse'
import type { Session } from '../strength/model'

const owner = 'synthetic-training-a'
function fixture(t: test.TestContext) {
  const previousOwner = currentAthleteId(), previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const data = new Map<string, string>(), box = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) }, keys: () => [...data.keys()] }
  Object.defineProperty(globalThis, 'localStorage', { value: box, configurable: true })
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true })
  setStoreBackend(box); setEventContext({ athleteId: owner })
  t.after(() => {
    setStoreBackend(null); setEventContext({ athleteId: previousOwner })
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else Reflect.deleteProperty(globalThis, 'localStorage')
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window')
  })
  return { data, box, day: localDay(), repository: { read: async (id: string) => emptyPlanExecution(id) } }
}
function beginRun(planId = 'audit-run') {
  assert.equal(saveRunningPlan({ planId, planSlotId: planId, components: [{ componentId: 'run', modality: 'RUNNING', purpose: 'UNSPECIFIED', structure: { kind: 'CONTINUOUS', plannedDistanceMeters: 400, plannedDurationSeconds: null } }] }).ok, true)
  const started = startTrackSession(planId); assert.equal(started.ok, true)
  if (!started.ok) throw Error(started.reason)
  return started.trainingOccurrenceId
}
const session: Session = { id: 'audit-strength', name: '合成力量课', moves: [{ id: 'squat', catalogId: 'back-squat', customName: '', sets: 1, mode: 'reps', amount: 8, restSec: 60, weightKg: 40 }] }
function beginStrength(decisionId = 'audit-decision') {
  const event = startTraining({ decisionId, sessionId: session.id, action: 'ORIGINAL_PLAN' }); assert.ok(event)
  assert.ok(bindTrainingStart({ startEventId: event.event_id, startedAt: event.timestamp, sessionId: session.id, planSlotId: session.id, plan: session }))
  const set = { ...emptySets(session)[0], actualWeight: 40, actualAmount: 8, completed: true, source: 'user_entered' as const, timestamp: new Date().toISOString() }
  assert.ok(recordSet(session.id, decisionId, set))
  return event.event_id
}
const closeStrength = (decisionId = 'audit-decision') => completeFromRunner({ decisionId, sessionId: session.id, planned: null, actualSets: 1, actualAmount: 8, actualWeightKg: 40, rpe: 6, pain: false, modified: false, interrupted: false })
function device(id = 'run-1'): DeviceActivity {
  return { key: id, sourceIdentity: `synthetic-watch:account:${id}`, source: '合成手表', sport: 'RUNNING', sportLabel: '跑步', startIso: new Date(Date.now() - 60_000).toISOString(), durationSec: 90.1, distanceM: 400, avgHr: 150, maxHr: 160, calories: null, avgCadence: null, avgPower: null, verticalOscMm: null, groundContactMs: null, sets: [] }
}

test('running work is recorded immediately but only an explicit finish marks the log completed', async t => {
  const f = fixture(t), id = beginRun()
  assert.equal(startTrackSession('audit-run').ok, true)
  assert.equal(loadEvents().filter(e => e.event_type === 'TRAINING_STARTED').length, 1)
  assert.equal(commitTrackContinuous(id, 'run', '90.1', '400').ok, true)
  assert.equal(commitTrackContinuous(id, 'run', '90.2', '400').ok, false)
  assert.equal(loadTrainingActivities().find(r => r.occurrenceId === id)?.status, 'incomplete')
  assert.equal(readCoachData(f.day).coreActual.sessions, 0)
  assert.equal(finishTrackSession(id, 'COMPLETED', 7, 0).ok, true)
  assert.equal(finishTrackSession(id, 'COMPLETED', 7, 0).ok, false)
  const rows = loadTrainingActivities().filter(r => r.occurrenceId === id)
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'completed'); assert.equal(rows[0].durationSec, 90.1); assert.equal(rows[0].distanceM, 400)
  assert.equal(loadEvents().filter(e => e.event_type === 'TRAINING_COMPLETED').length, 1)
  assert.equal(readTrainingFact(id)?.lifecycle, 'COMPLETED')
  const brief = assembleCoachBrief(null, '复盘这次跑步', id)
  assert.equal(brief.occurrenceId, id); assert.equal(brief.sessionRpe, 7)
  assert.ok(brief.sources?.some(s => s.detail.includes('90.1')))
  const global = await readGlobalCoachSnapshot(f.day, f.repository)
  assert.equal(global.data?.coreActual.sessions, 1); assert.ok(global.data?.coreActual.sourceIds.includes(id))
})

test('strength finish is idempotent and a correction reaches the log and Fangkun without rewriting the original event', async t => {
  const f = fixture(t), id = beginStrength(), first = closeStrength(); assert.ok(first)
  assert.equal(closeStrength()?.event_id, first.event_id)
  assert.equal(loadEvents().filter(e => e.event_type === 'TRAINING_COMPLETED').length, 1)
  assert.equal(loadTrainingActivities().filter(r => r.occurrenceId === id).length, 1)
  assert.equal(loadTrainingActivities().find(r => r.occurrenceId === id)?.strengthVolumeKg, 320)
  const before = await readGlobalCoachSnapshot(f.day, f.repository)
  assert.equal(before.data?.coreActual.sessions, 1)
  assert.ok(appendCorrection({ trainingOccurrenceId: id, kind: 'FIELD', field: 'weight', setKey: 'squat:1', originalValue: '40', newValue: '55', reason: '合成审计更正' }))
  assert.equal(loadTrainingActivities().find(r => r.occurrenceId === id)?.strengthVolumeKg, 440)
  assert.equal(loadEvents().find(e => e.event_type === 'TRAINING_SET_COMPLETED')?.payload.actualWeight, 40)
  const formal = readFormalEvidenceRows(owner).rows, replaced = new Set(formal.map(r => r.supersedesRecordId).filter(Boolean))
  assert.ok(formal.some(r => r.metric === 'STRENGTH_KG' && r.value === 55 && !replaced.has(r.recordId)))
  const brief = assembleCoachBrief(null, '这次力量训练的实际重量', id)
  assert.equal(brief.occurrenceId, id); assert.equal(brief.completedSetCount, 1)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedWeight, 55)
  const after = await readGlobalCoachSnapshot(f.day, f.repository)
  assert.equal(after.data?.coreActual.sessions, 1)
})

test('repeated watch import creates one activity and changed device totals do not overwrite a manual correction', t => {
  const f = fixture(t), a = device()
  assert.equal(saveDeviceRows([], [a]).saved, 1)
  for (let n = 0; n < 3; n++) { const result = saveDeviceRows([], [a]); assert.equal(result.saved, 0); assert.equal(result.skipped, 1) }
  const imported = coachImports()[0]; assert.ok(imported)
  assert.equal(loadTrainingActivities().length, 1)
  assert.ok(appendCorrection({ trainingOccurrenceId: imported.confirmedImportId, kind: 'FIELD', field: 'duration', setKey: null, originalValue: '90.1', newValue: '91.2', reason: '合成审计更正' }))
  const result = saveDeviceRows([], [{ ...a, durationSec: 92.3 }])
  assert.equal(result.saved, 0); assert.equal(result.errors.length, 1); assert.equal(coachImports().length, 1)
  assert.equal(coachImports()[0].durationSeconds.value, 90.1)
  assert.equal(readCoachData(f.day).imports.latest[0].durationSec, null)
})

test('the actual Garmin view writer and formal import reader merge one scoped activity after repeated saves', t => {
  fixture(t)
  const a = { ...device('same-garmin-run'), sourceIdentity: 'garmin:synthetic-account:987' }
  const raw = { activityId: 987, activityName: '合成间歇跑', activityType: { typeKey: 'running' }, fkStartIso: a.startIso, fkSourceIdentity: a.sourceIdentity, duration: a.durationSec, distance: a.distanceM, averageHR: 150 }
  for (let n = 0; n < 3; n++) {
    saveGarminActivities([raw], 'synthetic-account')
    const saved = saveDeviceRows([], [a]); assert.equal(saved.errors.length, 0)
    assert.equal(saved.saved, n === 0 ? 1 : 0)
  }
  const rows = loadTrainingActivities()
  assert.equal(rows.length, 1); assert.equal(coachImports().length, 1)
  assert.deepEqual(new Set(rows[0].sources), new Set(['import', 'garmin']))
  assert.equal(rows[0].durationSec, 90.1); assert.equal(rows[0].distanceM, 400); assert.equal(rows[0].garminId, 987)
  setEventContext({ athleteId: 'synthetic-training-b' })
  assert.equal(loadTrainingActivities().length, 0)
})

test('independent phone and watch sources need a confirmed identity link; equal values alone do not merge', t => {
  const f = fixture(t), id = beginRun(); assert.ok(commitTrackContinuous(id, 'run', '90.1', '400').ok); assert.ok(finishTrackSession(id, 'COMPLETED', null, null).ok)
  const a = device(); assert.equal(saveDeviceRows([], [a]).saved, 1)
  const rows = loadTrainingActivities(); assert.equal(rows.length, 2)
  assert.equal(mergeActivities([rows[0], { ...rows[1], originIds: [...rows[1].originIds, ...rows[0].originIds] }]).length, 1)
  const context = readCoachData(f.day)
  assert.equal(context.coreActual.sessions, 1); assert.equal(context.imports.count, 1)
  assert.ok(context.warnings.some(w => w.includes('不重复累加')))
})

test('switching athlete excludes both automatic and explicitly selected old training from Fangkun', async t => {
  const f = fixture(t), id = beginStrength(); assert.ok(closeStrength())
  assert.equal(assembleCoachBrief(null, '复盘这次训练', id).occurrenceId, id)
  setEventContext({ athleteId: 'synthetic-training-b' })
  assert.equal(loadTrainingActivities().length, 0)
  assert.equal((await readGlobalCoachSnapshot(f.day, f.repository)).data?.coreActual.sessions, 0)
  assert.equal(assembleCoachBrief(null, '复盘这次训练', id).occurrenceId, null)
  assert.equal(assembleCoachBrief(null, '复盘最近训练').occurrenceId, null)
})

test('switching athlete cannot resume or write into another athlete running occurrence', t => {
  const f = fixture(t), id = beginRun(); const before = [...f.data]
  setEventContext({ athleteId: 'synthetic-training-b' })
  assert.equal(openTrackOccurrence('audit-run'), null)
  assert.equal(commitTrackContinuous(id, 'run', '90.1', '400').ok, false)
  assert.equal(finishTrackSession(id, 'INTERRUPTED', null, null).ok, false)
  assert.deepEqual([...f.data], before)
  const own = startTrackSession('audit-run'); assert.equal(own.ok, true)
  if (own.ok) assert.notEqual(own.trainingOccurrenceId, id)
  assert.equal(getTrainingOccurrence(id)?.lifecycle, 'IN_PROGRESS')
})

test('switching athlete does not restore another athlete recorded strength sets', t => {
  fixture(t); beginStrength()
  assert.equal(executionOf(session.id).sets.length, 1)
  setEventContext({ athleteId: 'synthetic-training-b' })
  assert.deepEqual(executionOf(session.id), { open: false, decisionId: null, sets: [] })
})

test('stale running write callbacks cannot mutate another athlete before any resume check', t => {
  const f = fixture(t), id = beginRun(), draft = emptyDraft('200x4x2')
  draft.repRestSeconds = 60; draft.roundRestSeconds = 180
  assert.equal(confirmTrackPlan('200x4x2', draft).ok, true)
  const intervals = startTrackSession('track-200-4-2'); assert.equal(intervals.ok, true)
  if (!intervals.ok) throw Error(intervals.reason)
  const intervalView = projectRunningExecution(intervals.trainingOccurrenceId, loadEvents())
  assert.ok(intervalView.repetitions[0]); assert.ok(intervalView.recoveries[0])
  const ended = beginRun('audit-feedback')
  assert.equal(commitTrackContinuous(ended, 'run', '90.1', '400').ok, true)
  assert.equal(finishTrackSession(ended, 'COMPLETED', null, null).ok, true)
  const followupAt = new Date(Date.parse(getTrainingOccurrence(ended)!.startedAt) + 24 * 3600000)
  const before = [...f.data]
  setEventContext({ athleteId: 'synthetic-training-b' })
  assert.equal(commitTrackSlot(intervalView.repetitions[0], 'complete', '33.5', '200').ok, false)
  assert.equal(commitTrackRecovery(intervalView.recoveries[0], '60').ok, false)
  assert.equal(commitTrackContinuous(id, 'run', '90.1', '400').ok, false)
  assert.equal(finishTrackSession(id, 'INTERRUPTED', null, null).ok, false)
  assert.equal(recordTrackRecoveryFeedback(ended, '24H', 7, null, followupAt).ok, false)
  assert.deepEqual([...f.data], before)
})

test('stale strength completion does not append an event or close the old athlete occurrence', t => {
  const f = fixture(t), id = beginStrength(), before = [...f.data]
  setEventContext({ athleteId: 'synthetic-training-b' })
  assert.equal(recordSet(session.id, 'audit-decision', { ...emptySets(session)[0], completed: true, actualWeight: 99, actualAmount: 8, source: 'user_entered' }), null)
  assert.equal(closeStrength(), null)
  assert.equal(getTrainingOccurrence(id)?.lifecycle, 'IN_PROGRESS')
  assert.deepEqual([...f.data], before)
})

test('two athletes can execute the same strength template independently', t => {
  fixture(t); const a = beginStrength('decision-a')
  setEventContext({ athleteId: 'synthetic-training-b' }); const b = beginStrength('decision-b')
  assert.notEqual(a, b); assert.ok(getTrainingOccurrence(b))
  assert.equal(loadEvents().filter(e => e.athlete_id === 'synthetic-training-b' && e.event_type === 'TRAINING_SET_COMPLETED')[0]?.payload.trainingOccurrenceId, b)
  assert.ok(closeStrength('decision-b'))
  assert.equal(getTrainingOccurrence(a)?.lifecycle, 'IN_PROGRESS'); assert.equal(getTrainingOccurrence(b)?.lifecycle, 'COMPLETED')
  setEventContext({ athleteId: owner }); assert.ok(closeStrength('decision-a'))
  assert.equal(loadTrainingActivities().length, 1)
})

test('a repeated completion from an older decision cannot close a newer strength session', t => {
  fixture(t); const a = beginStrength('decision-old'), closed = closeStrength('decision-old'); assert.ok(closed)
  const b = beginStrength('decision-new')
  assert.notEqual(a, b)
  const before = [...loadEvents()]
  assert.equal(recordSet(session.id, 'decision-old', { ...emptySets(session)[0], completed: true, actualWeight: 99, actualAmount: 8, source: 'user_entered' }), null)
  assert.deepEqual(loadEvents(), before)
  assert.equal(closeStrength('decision-old')?.event_id, closed.event_id)
  assert.equal(getTrainingOccurrence(b)?.lifecycle, 'IN_PROGRESS')
  assert.equal(loadEvents().filter(e => e.event_type === 'TRAINING_COMPLETED').length, 1)
})

test('an athlete A to B to A switch invalidates a queued running write', async t => {
  const f = fixture(t), id = beginRun(), before = [...f.data]
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let release: (() => void) | undefined
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_name: string, work: () => unknown) => new Promise(resolve => { release = () => resolve(work()) }) } } })
  t.after(() => { if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else Reflect.deleteProperty(globalThis, 'navigator') })
  const pending = withRunningWriteLock(() => commitTrackContinuous(id, 'run', '90.1', '400'))
  setEventContext({ athleteId: 'synthetic-training-b' }); setEventContext({ athleteId: owner })
  assert.ok(release); release()
  const result = await pending; assert.equal(result.ok, false)
  assert.deepEqual([...f.data], before)
})

test('a completed training event triggers a fresh Fangkun projection after the commit', async t => {
  const f = fixture(t), id = beginStrength(); const revisions: number[] = []
  const off = subscribeGlobalCoach(() => revisions.push(readCoachData(f.day).coreActual.sessions)); t.after(off)
  assert.ok(closeStrength()); assert.equal(revisions.length, 0)
  await Promise.resolve()
  assert.deepEqual(revisions, [1]); assert.equal(getTrainingOccurrence(id)?.lifecycle, 'COMPLETED')
})
