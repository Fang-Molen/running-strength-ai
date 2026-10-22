import test from 'node:test'
import assert from 'node:assert/strict'
import { currentAthleteId, loadEvents, setEventContext } from './events'
import { setStoreBackend } from './storage'
import { emptySets, recordSet } from './execution'
import { startTraining } from './training-decision'
import { bindTrainingStart, getTrainingOccurrence, listTrainingOccurrences } from './occurrence'
import { completeFromRunner } from '../../components/training-runner'
import type { Session } from '../strength/model'

const plan: Session = { id: 'alias-strength', name: '合成力量课', moves: [{ id: 'squat', catalogId: 'back-squat', customName: '', sets: 1, mode: 'reps', amount: 8, restSec: 60, weightKg: 40 }] }
function fixture(t: test.TestContext) {
  const owner = currentAthleteId(), data = new Map<string, string>()
  setStoreBackend({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) }, keys: () => [...data.keys()] })
  setEventContext({ athleteId: 'synthetic-start-alias' })
  t.after(() => { setStoreBackend(null); setEventContext({ athleteId: owner }) })
}
function begin(decisionId: string) {
  const event = startTraining({ decisionId, sessionId: plan.id, action: 'ORIGINAL_PLAN' }); assert.ok(event)
  const occurrence = bindTrainingStart({ startEventId: event.event_id, startedAt: event.timestamp, sessionId: plan.id, planSlotId: plan.id, plan })
  assert.ok(occurrence)
  return { event, occurrence }
}
const done = () => ({ ...emptySets(plan)[0], actualWeight: 40, actualAmount: 8, completed: true, source: 'user_entered' as const, timestamp: new Date().toISOString() })
const finish = (decisionId: string) => completeFromRunner({ decisionId, sessionId: plan.id, planned: null, actualSets: 1, actualAmount: 8, actualWeightKg: 40, rpe: 6, pain: false, modified: false, interrupted: false })

test('resuming one open training under a new decision binds its set to the original occurrence', t => {
  fixture(t)
  const first = begin('first-decision'), resumed = begin('resumed-decision')
  assert.equal(resumed.occurrence.trainingOccurrenceId, first.occurrence.trainingOccurrenceId)
  assert.deepEqual(resumed.occurrence.duplicateStartEventIds, [resumed.event.event_id])
  const set = recordSet(plan.id, 'resumed-decision', done()); assert.ok(set)
  assert.equal(set.payload.trainingOccurrenceId, first.occurrence.trainingOccurrenceId)
  assert.equal(loadEvents().filter(e => e.event_type === 'TRAINING_SET_COMPLETED').length, 1)
  assert.equal(listTrainingOccurrences().length, 1)
})

test('finishing through either start decision returns the same completion event', t => {
  fixture(t)
  const first = begin('first-decision'); begin('resumed-decision')
  assert.ok(recordSet(plan.id, 'resumed-decision', done()))
  const closed = finish('resumed-decision'); assert.ok(closed)
  assert.equal(closed.payload.trainingOccurrenceId, first.occurrence.trainingOccurrenceId)
  assert.equal(finish('first-decision')?.event_id, closed.event_id)
  assert.equal(finish('resumed-decision')?.event_id, closed.event_id)
  assert.equal(loadEvents().filter(e => e.event_type === 'TRAINING_COMPLETED').length, 1)
  assert.equal(getTrainingOccurrence(first.occurrence.trainingOccurrenceId)?.lifecycle, 'COMPLETED')
  assert.deepEqual(getTrainingOccurrence(first.occurrence.trainingOccurrenceId)?.duplicateCloseEventIds, [])
})

test('closed start aliases cannot record new sets or close the next occurrence of the same session', t => {
  fixture(t)
  const first = begin('first-decision'); begin('resumed-decision')
  assert.ok(recordSet(plan.id, 'resumed-decision', done()))
  const closed = finish('resumed-decision'); assert.ok(closed)
  const next = begin('next-decision'); assert.notEqual(next.occurrence.trainingOccurrenceId, first.occurrence.trainingOccurrenceId)
  const before = loadEvents().length
  for (const oldDecision of ['first-decision', 'resumed-decision']) {
    assert.equal(recordSet(plan.id, oldDecision, done()), null)
    assert.equal(finish(oldDecision)?.event_id, closed.event_id)
  }
  assert.equal(loadEvents().length, before)
  assert.equal(getTrainingOccurrence(next.occurrence.trainingOccurrenceId)?.lifecycle, 'IN_PROGRESS')
  assert.equal(recordSet(plan.id, 'next-decision', done())?.payload.trainingOccurrenceId, next.occurrence.trainingOccurrenceId)
})

test('another athlete cannot use either original or resumed decision to write into the occurrence', t => {
  fixture(t)
  const first = begin('first-decision'); begin('resumed-decision')
  const before = loadEvents().length
  setEventContext({ athleteId: 'synthetic-start-other' })
  for (const decision of ['first-decision', 'resumed-decision']) {
    assert.equal(recordSet(plan.id, decision, done()), null)
    assert.equal(finish(decision), null)
  }
  assert.equal(loadEvents().length, before)
  assert.equal(getTrainingOccurrence(first.occurrence.trainingOccurrenceId)?.lifecycle, 'IN_PROGRESS')
})
