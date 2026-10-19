import test from 'node:test'
import assert from 'node:assert/strict'
import { currentAthleteId, setEventContext } from './events'
import { setStoreBackend, writeEnvelope, readEnvelope } from './storage'
import { appendJournal } from './storage-journal'
import { INTAKE_PREFIX, appendIntakeAnswer, loadIntake, buildFirstWeek, recordFirstWeekChoice } from './coach-first-week'
import { COGNITION_MEMORY_KEY, type LearningRecord } from './coach-cognition-learning'
import { firstWeekMemory, firstWeekRecords, FIRST_WEEK_TEST_DAY } from './coach-first-week.fixtures'
import { COACH_PLAN_CANDIDATES_KEY, loadCoachPlanCandidates, saveCoachPlanCandidate, chooseCoachPlanCandidate, coachPlanPreferenceSources, type CoachPlanCandidate, type StoredCoachPlanCandidate } from './coach-plan'
const candidate: CoachPlanCandidate = { status: 'DRAFT_PENDING_CONFIRMATION', horizonWeeks: 1, phases: [], firstWeek: [], assumptions: [], evidenceGaps: [], safetyBoundaries: [], progressionRule: '待核实', deloadRule: '待核实', acceptanceRequired: true }
const row = (id: string, athleteId?: string): StoredCoachPlanCandidate => ({ candidateId: id, ...(athleteId === undefined ? {} : { athleteId }), createdAt: '2026-10-19T00:00:00Z', status: 'MODIFIED', candidate, modification: `${id}偏好` })
const run = (actor: string, fn: (box: ReturnType<typeof firstWeekMemory>) => void) => { const prior = currentAthleteId(), box = firstWeekMemory(); setStoreBackend(box); setEventContext({ athleteId: actor }); try { fn(box) } finally { setStoreBackend(null); setEventContext({ athleteId: prior }) } }
test('HOST-03 named athlete reads neither another athlete intake nor unassigned intake', () => run('synthetic-A', () => {
  for (const r of firstWeekRecords(undefined, 'shared-session')) { appendJournal(INTAKE_PREFIX, `foreign-${r.id}`, { ...r, athleteId: 'synthetic-B' }); appendJournal(INTAKE_PREFIX, `legacy-${r.id}`, { ...r, athleteId: undefined }) }
  assert.deepEqual(loadIntake('shared-session'), [])
}))
test('HOST-03 intake answers stamp actor; correction cannot supersede foreign or legacy evidence', () => run('synthetic-A', () => {
  appendJournal(INTAKE_PREFIX, 'foreign', { ...firstWeekRecords()[0], id: 'foreign', athleteId: 'synthetic-B', sessionId: 'same' })
  assert.equal(appendIntakeAnswer('same', 'goal', { event: '400米', targetSeconds: 55 }, 'foreign').ok, false)
  assert.equal(appendIntakeAnswer('same', 'goal', { event: '400米', targetSeconds: 55 }).ok, true)
  assert.equal(loadIntake('same').length, 1)
  assert.equal(loadIntake('same')[0].athleteId, 'synthetic-A')
}))
test('HOST-03 local legacy intake remains readable history but cannot generate or accept a new course', () => run('local', box => {
  const legacy = firstWeekRecords().map(({ athleteId: _old, ...r }) => r)
  for (const r of legacy) appendJournal(INTAKE_PREFIX, r.id, r)
  const before = JSON.stringify([...box.data])
  assert.equal(loadIntake(legacy[0].sessionId).length, 6)
  const oldDraft = { id: 'legacy-draft', version: 'FK-FIRST-WEEK-R2-20261011', evidenceIds: legacy.map(r => r.id) } as never
  assert.notEqual(buildFirstWeek(legacy, FIRST_WEEK_TEST_DAY).status, 'READY_CANDIDATE')
  assert.equal(recordFirstWeekChoice(legacy[0].sessionId, oldDraft, 'ACCEPT'), false)
  assert.equal(appendIntakeAnswer(legacy[0].sessionId, 'goal', { event: '400米', targetSeconds: 55 }, legacy[0].id).ok, false)
  assert.equal(JSON.stringify([...box.data]), before)
}))
test('HOST-03 candidate loader and preference sources exclude foreign and unassigned entries for named actor', () => run('synthetic-A', () => {
  writeEnvelope(COACH_PLAN_CANDIDATES_KEY, [row('mine', 'synthetic-A'), row('foreign', 'synthetic-B'), row('legacy')])
  assert.deepEqual(loadCoachPlanCandidates().map(r => r.candidateId), ['mine'])
  assert.deepEqual(coachPlanPreferenceSources().map(r => r.text), ['mine偏好'])
}))
test('HOST-03 saving a candidate preserves all foreign, legacy and older owned rows', () => run('synthetic-A', () => {
  const existing = [row('legacy'), ...Array.from({ length: 25 }, (_, i) => row(`foreign-${i}`, 'synthetic-B')), ...Array.from({ length: 25 }, (_, i) => row(`older-${i}`, 'synthetic-A'))]
  writeEnvelope(COACH_PLAN_CANDIDATES_KEY, existing)
  const stored = saveCoachPlanCandidate(candidate)
  const after = readEnvelope<StoredCoachPlanCandidate[]>(COACH_PLAN_CANDIDATES_KEY, []).data
  assert.deepEqual(after.slice(0, existing.length), existing)
  assert.equal(after.length, existing.length + 1)
  assert.equal(stored.athleteId, 'synthetic-A')
  assert.equal(stored.persistence, 'SAVED')
}))
test('HOST-03 neither foreign nor unassigned candidates can be chosen, including local legacy history', () => run('local', box => {
  writeEnvelope(COACH_PLAN_CANDIDATES_KEY, [row('foreign', 'synthetic-B'), row('legacy')])
  const before = box.getItem(COACH_PLAN_CANDIDATES_KEY)
  assert.equal(chooseCoachPlanCandidate('foreign', 'ACCEPTED'), null)
  assert.equal(chooseCoachPlanCandidate('legacy', 'MODIFIED', '把旧计划认领给我'), null)
  assert.equal(box.getItem(COACH_PLAN_CANDIDATES_KEY), before)
  assert.deepEqual(coachPlanPreferenceSources(), [])
}))
test('HOST-03 choosing an owned candidate preserves other owners and every older row', () => run('synthetic-A', () => {
  const existing = [row('mine', 'synthetic-A'), row('foreign', 'synthetic-B'), row('legacy'), ...Array.from({ length: 24 }, (_, i) => row(`old-${i}`, 'synthetic-A'))]
  writeEnvelope(COACH_PLAN_CANDIDATES_KEY, existing)
  assert.equal(chooseCoachPlanCandidate('mine', 'ACCEPTED')?.status, 'ACCEPTED')
  const after = readEnvelope<StoredCoachPlanCandidate[]>(COACH_PLAN_CANDIDATES_KEY, []).data
  assert.equal(after.length, existing.length)
  assert.deepEqual(after.slice(1), existing.slice(1))
}))
test('HOST-03 persistence failure is explicit and never returns a saved candidate', () => {
  const prior = currentAthleteId(); setEventContext({ athleteId: 'synthetic-A' }); setStoreBackend({ getItem: () => null, setItem: () => { throw Error('synthetic quota') }, keys: () => [] })
  try { const stored = saveCoachPlanCandidate(candidate); assert.equal(stored.persistence, 'NOT_SAVED'); assert.notEqual(stored.status, 'PENDING') } finally { setStoreBackend(null); setEventContext({ athleteId: prior }) }
})

test('HOST-03 first-week learning explanation only counts current athlete observations', () => run('synthetic-A', () => {
  const base = { athleteId: 'local', trainingOccurrenceId: 'foreign-occurrence', sourceIds: ['foreign-source'], layer: 'M3' as const, sessionAt: '2026-10-09T08:00:00Z', context: { event: '400米', distanceMeters: 200, reps: 4, rounds: 2, restSeconds: 120, timing: 'electronic', surface: 'track', phase: 'specific' }, horizonHours: 24 as const, supersedes: null, confirmed: true as const, choice: null, value: 7 };
  const prediction = { ...base, id: 'foreign-prediction', kind: 'PREDICTION', createdAt: '2026-10-09T09:00:00Z', observedAt: null, predictionId: null } as unknown as LearningRecord;
  const observation = { ...base, id: 'foreign-observation', kind: 'OBSERVATION', createdAt: '2026-10-10T09:00:00Z', observedAt: '2026-10-10T08:00:00Z', predictionId: prediction.id } as unknown as LearningRecord;
  writeEnvelope(COGNITION_MEMORY_KEY, [prediction, observation]);
  const draft = buildFirstWeek(firstWeekRecords(), FIRST_WEEK_TEST_DAY).draft;
  assert.ok(draft);
  assert.match(draft.warnings.join(' '), /反馈记忆可核对0条配对/);
  const ownedPrediction = { ...prediction, id: 'owned-prediction', athleteId: 'synthetic-A', trainingOccurrenceId: 'owned-occurrence' };
  const ownedObservation = { ...observation, id: 'owned-observation', athleteId: 'synthetic-A', trainingOccurrenceId: 'owned-occurrence', predictionId: ownedPrediction.id };
  writeEnvelope(COGNITION_MEMORY_KEY, [prediction, observation, ownedPrediction, ownedObservation]);
  const updated = buildFirstWeek(firstWeekRecords(), FIRST_WEEK_TEST_DAY).draft;
  assert.ok(updated);
  assert.match(updated.warnings.join(' '), /反馈记忆可核对1条配对/);
}));
