import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend } from '../../core/storage'
import { currentAthleteId, EVENTS_KEY, setEventContext } from '../../core/events'
import { emptyPlanExecution, type PlanExecutionDocument, type PlanExecutionRepository } from './core'
import { readCoachPlanHostSnapshot, createCoachPlanChangeController } from './host'
import { SCHEDULE_KEY } from '../../ui/day-schedule'
import { scheduleExecutionId } from '../../ui/scheduled-execution'
import type { ScheduleEntry } from '../../ui/day-schedule-rules'
import type { AppEvent } from '../../core/types'

const ATHLETE = 'synthetic-plan-ui-owner', AS_OF = '2026-10-19T12:00:00.000Z'
const entry = (patch: Partial<ScheduleEntry> = {}): ScheduleEntry => ({ id: 'schedule-owned', athleteId: ATHLETE, date: '2026-10-19', kind: 'run', modality: 'run', title: '合成组合课', focus: [], minutes: 30, intensity: 'EASY', lowerHeavy: false, source: 'custom', refId: null, status: 'planned', runComponents: [{ componentId: 'running-source-component', modality: 'RUNNING', purpose: 'UNSPECIFIED', structure: { kind: 'CONTINUOUS', plannedDistanceMeters: 1000, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } }, { componentId: 'strength-source-component', modality: 'STRENGTH', strengthSessionId: 'approved-source-session' }], ...patch })
function fixture(t: test.TestContext, entries = [entry()]) {
  const previous = currentAthleteId(), data = new Map<string, string>()
  const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, keys: () => [...data.keys()] }
  store.setItem(SCHEDULE_KEY, JSON.stringify({ entries, acks: [] }))
  setStoreBackend(store); setEventContext({ athleteId: ATHLETE })
  t.after(() => { setStoreBackend(null); setEventContext({ athleteId: previous }) })
  const events = (rows: Partial<AppEvent>[]) => store.setItem(EVENTS_KEY, JSON.stringify({ schemaVersion: 1, revision: 1, updatedAt: AS_OF, data: rows.map((row, i) => ({ event_id: `event-${i}`, athlete_id: ATHLETE, event_type: 'TRAINING_STARTED', timestamp: '2026-10-19T10:00:00.000Z', payload: {}, source: 'MANUAL', confidence: 1, data_quality: 'HIGH', context: {}, cycle_id: 'synthetic', schema_version: 1, ...row })) }))
  return { data, store, events }
}

test('host reads explicit current ownership and stable source component identities only', async t => {
  const f = fixture(t, [entry(), entry({ id: 'foreign', athleteId: 'another-athlete' }), entry({ id: 'legacy', athleteId: undefined })])
  const before = [...f.data], snapshot = await readCoachPlanHostSnapshot(AS_OF)
  assert.deepEqual(snapshot.host.targets.map(x => [x.scheduleId, x.componentId]), [['schedule-owned', 'running-source-component'], ['schedule-owned', 'strength-source-component']])
  assert.equal(snapshot.coverage.ownedEntries, 1); assert.equal(snapshot.coverage.unattributedEntries, 1)
  assert.equal(snapshot.host.actor?.scope, 'LOCAL_DEVICE_ONLY'); assert.equal(snapshot.host.persistenceBoundary, 'UNCOORDINATED')
  assert.equal(snapshot.host.calendarCoverage, 'UNKNOWN'); assert.equal(snapshot.host.safety, 'UNKNOWN')
  assert.deepEqual([...f.data], before)
})

test('standalone strength without a saved component ID is unresolved rather than invented', async t => {
  fixture(t, [entry({ kind: 'strength', modality: 'strength', runComponents: undefined, title: 'strength-source-component' })])
  const snapshot = await readCoachPlanHostSnapshot(AS_OF)
  assert.equal(snapshot.host.targets.length, 0); assert.equal(snapshot.choices[0]?.componentId, null)
  assert.equal(snapshot.choices[0]?.identityResolved, false)
})

test('a real start blocks that modality while preserving independent unstarted strength', async t => {
  const f = fixture(t)
  f.events([{ payload: { sessionId: scheduleExecutionId('schedule-owned', 'run') } }])
  const snapshot = await readCoachPlanHostSnapshot(AS_OF)
  assert.equal(snapshot.host.targets.find(x => x.componentId === 'running-source-component')?.state, 'STARTED')
  assert.equal(snapshot.host.targets.find(x => x.componentId === 'strength-source-component')?.state, 'NOT_STARTED')
})

test('whole combo completion is not evidence that both running and strength completed', async t => {
  const f = fixture(t, [entry({status:'done'})])
  f.events([{event_type:'TRAINING_COMPLETED',payload:{sessionId:scheduleExecutionId('schedule-owned','run')}}])
  const snapshot = await readCoachPlanHostSnapshot(AS_OF)
  assert.equal(snapshot.host.targets.find(x=>x.componentId==='running-source-component')?.state,'COMPLETED')
  assert.equal(snapshot.host.targets.find(x=>x.componentId==='strength-source-component')?.state,'UNKNOWN')
})

test('another athlete start is excluded and a future-known start is UNKNOWN', async t => {
  const f = fixture(t)
  f.events([{ athlete_id: 'another-athlete', payload: { sessionId: scheduleExecutionId('schedule-owned', 'run') } }])
  assert.equal((await readCoachPlanHostSnapshot(AS_OF)).host.targets[0]?.state, 'NOT_STARTED')
  f.events([{ timestamp: '2026-10-20T10:00:00.000Z', payload: { sessionId: scheduleExecutionId('schedule-owned', 'run') } }])
  assert.equal((await readCoachPlanHostSnapshot(AS_OF)).host.targets[0]?.state, 'UNKNOWN')
})

test('actual partial data and duplicate schedule identities cannot become movable pending work', async t => {
  const f = fixture(t, [entry({ actual: { outcome: 'different', executionState: 'PARTIAL', minutes: 10, intensity: null, note: '', reasons: [], at: AS_OF } })])
  assert.ok((await readCoachPlanHostSnapshot(AS_OF)).host.targets.every(x => x.state === 'UNKNOWN'))
  f.store.setItem(SCHEDULE_KEY, JSON.stringify({ entries: [entry(), entry()], acks: [] }))
  assert.ok((await readCoachPlanHostSnapshot(AS_OF)).host.targets.every(x => !x.identityResolved))
  assert.equal(f.data.size, 1)
})

test('full source bytes and transaction journal changes affect versions without clipping', async t => {
  const f = fixture(t, [entry({ overrideNote: 'x'.repeat(12000) + 'first' })])
  const a = await readCoachPlanHostSnapshot(AS_OF)
  const unchanged = await readCoachPlanHostSnapshot('2026-10-19T12:00:01.000Z')
  assert.notEqual(a.asOf, unchanged.asOf)
  assert.equal(a.signature, unchanged.signature)
  assert.deepEqual([a.host.calendarVersion, a.host.factsVersion, a.host.safetyVersion], [unchanged.host.calendarVersion, unchanged.host.factsVersion, unchanged.host.safetyVersion])
  f.store.setItem(SCHEDULE_KEY, JSON.stringify({ entries: [entry({ overrideNote: 'x'.repeat(12000) + 'second' })], acks: [] }))
  const b = await readCoachPlanHostSnapshot(AS_OF)
  assert.notEqual(a.host.targets[0]?.sourceVersion, b.host.targets[0]?.sourceVersion); assert.notEqual(a.signature, b.signature)
  f.store.setItem('fr255-running-tx-r3:synthetic', JSON.stringify({ ignoredByEventReaderButStillVersioned: true }))
  const c = await readCoachPlanHostSnapshot(AS_OF)
  assert.notEqual(b.signature, c.signature)
  assert.match(c.signature, /^[a-f0-9]{64}$/); assert.equal(c.asOf, AS_OF)
})

test('corrupt storage is explicitly unavailable rather than empty calendar', async t => {
  const f = fixture(t); f.store.setItem(SCHEDULE_KEY, '{bad-json')
  const snapshot = await readCoachPlanHostSnapshot(AS_OF)
  assert.equal(snapshot.host.readState, 'FAILED'); assert.equal(snapshot.host.actor, null)
  assert.equal(snapshot.host.calendarCoverage, 'UNKNOWN')
})

test('a future evidence cutoff is unavailable rather than accepting future training state', async t => {
  fixture(t)
  const snapshot = await readCoachPlanHostSnapshot(new Date(Date.now() + 60_000).toISOString())
  assert.equal(snapshot.host.readState, 'FAILED'); assert.equal(snapshot.host.actor, null)
  assert.equal(snapshot.host.authorization, 'UNVERIFIED')
  assert.ok(snapshot.host.targets.every(row => row.state === 'UNKNOWN'))
})

test('controller refresh reads owner journal; explicit confirmation and undo cannot write', async t => {
  const f = fixture(t); let writes = 0
  const doc = emptyPlanExecution(ATHLETE)
  const repository: PlanExecutionRepository = { read: async athlete => { assert.equal(athlete, ATHLETE); return structuredClone(doc) }, transact: async <T>(_athlete: string, work: (draft: PlanExecutionDocument) => T) => { writes++; return work(doc) } }
  const controller = createCoachPlanChangeController({ repository, now: () => new Date(AS_OF), lock: async work => work() })
  const before = [...f.data], read = await controller.refresh()
  assert.equal(read.document.ok, true)
  const confirm = await controller.confirm({ id: 'untrusted-proposal', diffHash: 'not-authority' })
  assert.equal(confirm.ok, false); if (!confirm.ok) assert.equal(confirm.code, 'BLOCKED_UNCOORDINATED')
  const undo = await controller.undo({ id: 'untrusted-receipt' })
  assert.equal(undo.ok, false); if (!undo.ok) assert.equal(undo.code, 'BLOCKED_UNCOORDINATED')
  const preview = await controller.previewMove({ scheduleId: 'schedule-owned', componentId: 'running-source-component', toDate: '2026-10-20' })
  assert.equal(preview.ok, false); if (!preview.ok) assert.equal(preview.code, 'BLOCKED_INCOMPLETE_CONTEXT')
  assert.equal(writes, 0); assert.deepEqual([...f.data], before)
})

test('controller switches journal scope on current athlete changes', async t => {
  fixture(t)
  const reads: string[] = [], repository: PlanExecutionRepository = { read: async athlete => { reads.push(athlete); return emptyPlanExecution(athlete) }, transact: async () => { throw new Error('NO_WRITES') } }
  const controller = createCoachPlanChangeController({ repository, now: () => new Date(AS_OF) })
  await controller.refresh(); setEventContext({ athleteId: 'synthetic-other' })
  const after = await controller.refresh()
  assert.equal(after.snapshot.host.actor?.athleteId, 'synthetic-other'); assert.equal(after.snapshot.choices.length, 0)
  assert.deepEqual(reads, [ATHLETE, 'synthetic-other'])
})

test('an account switch during async snapshot hashing rejects the old subject data', async t => {
  fixture(t)
  const pending = readCoachPlanHostSnapshot(AS_OF)
  setEventContext({ athleteId: 'synthetic-other' })
  await assert.rejects(pending, /SUBJECT_CHANGED/)
})

test('an older async controller refresh cannot replace a newer actor snapshot', async t => {
  fixture(t)
  let releaseOld!: () => void, notifyRead!: () => void
  const firstReadStarted = new Promise<void>(resolve => { notifyRead = resolve })
  const gate = new Promise<void>(resolve => { releaseOld = resolve })
  const repository: PlanExecutionRepository = { read: async athlete => { if (athlete === ATHLETE) { notifyRead(); await gate }; return emptyPlanExecution(athlete) }, transact: async () => { throw new Error('NO_WRITES') } }
  const controller = createCoachPlanChangeController({ repository, now: () => new Date(AS_OF) })
  const oldRead = controller.refresh()
  await firstReadStarted
  setEventContext({ athleteId: 'synthetic-other' })
  const fresh = await controller.refresh()
  releaseOld()
  await assert.rejects(oldRead, /SUBJECT_CHANGED/)
  assert.equal(fresh.snapshot.host.actor?.athleteId, 'synthetic-other')
  const newest = await controller.refresh()
  assert.equal(newest.snapshot.host.actor?.athleteId, 'synthetic-other')
})
