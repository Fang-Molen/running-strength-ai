import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend, writeEnvelope } from './storage'
import { EVENTS_KEY } from './events'
import { bindTrainingStart, closeTrainingOccurrence } from './occurrence'
import { readTrainingFact } from './fact-read'
import { loadTrainingFact } from './training-fact'
import type { AppEvent } from './types'
import type { Session } from '@/lib/strength/model'

const session: Session = { id: 'shared-template', name: '课次归属', moves: [{ id: 'squat', catalogId: 'back-squat', customName: '', sets: 1, mode: 'reps', amount: 5, restSec: 90, weightKg: 20 }] }
const event = (id: string, type: AppEvent['event_type'], at: string, payload: Record<string, unknown>, athlete = 'local'): AppEvent => ({ event_id: id, event_type: type, timestamp: `2026-10-07T${at}:00Z`, athlete_id: athlete, payload, source: 'MANUAL', confidence: 1, data_quality: 'HIGH', context: {}, cycle_id: 'test', schema_version: 1 })
const start = (id: string, at: string, athlete = 'local') => event(id, 'TRAINING_STARTED', at, { sessionId: session.id }, athlete)
const set = (id: string, owner: Record<string, unknown> = {}, athlete = 'local') => event(id, 'TRAINING_SET_COMPLETED', '08:15', { sessionId: session.id, moveId: 'squat', setIndex: 1, actualWeight: 20, actualAmount: 5, completed: true, skipped: false, ...owner }, athlete)
function fixture(overlap = false) {
  const map = new Map<string, string>(), store = { keys: () => [...map.keys()], getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } }
  setStoreBackend(store)
  const first = start('first', '08:00'), second = start('second', overlap ? '08:10' : '09:00')
  const closeFirst = event('close-first', 'TRAINING_COMPLETED', '08:30', { sessionId: session.id, trainingOccurrenceId: 'first', actual: { sets: 1 } })
  const closeSecond = event('close-second', 'TRAINING_COMPLETED', '09:30', { sessionId: session.id, trainingOccurrenceId: 'second', actual: { sets: 1 } })
  writeEnvelope(EVENTS_KEY, [first])
  assert.ok(bindTrainingStart({ startEventId: first.event_id, startedAt: first.timestamp, sessionId: session.id, planSlotId: 'slot', plan: session }))
  assert.ok(closeTrainingOccurrence(closeFirst))
  assert.ok(bindTrainingStart({ startEventId: second.event_id, startedAt: second.timestamp, sessionId: session.id, planSlotId: 'slot', plan: session }))
  assert.ok(closeTrainingOccurrence(closeSecond))
  const events = overlap ? [first, second, closeFirst, closeSecond] : [first, closeFirst, second, closeSecond]
  return { events, save: () => { writeEnvelope(EVENTS_KEY, events) } }
}
test('explicit other-occurrence and unknown-occurrence sets inside the first window never count for first', () => {
  const f = fixture()
  f.events.splice(1, 0, set('foreign', { trainingOccurrenceId: 'second' }), set('unknown-owner', { trainingOccurrenceId: 'not-a-known-occurrence' }))
  f.save()
  assert.equal(readTrainingFact('first')?.attemptCount, 0)
  assert.equal(readTrainingFact('first')?.completedSetCount, 0)
  assert.equal(readTrainingFact('first')?.notRecordedSetCount, 1)
})
test('legacy sets with no occurrence ID remain compatible in a single unambiguous window', () => {
  const f = fixture(); f.events.splice(1, 0, set('legacy')); f.save()
  assert.equal(readTrainingFact('first')?.completedSetCount, 1)
  assert.equal(readTrainingFact('second')?.completedSetCount, 0)
})
test('overlapping windows use explicit occurrence ownership instead of the newest same-template start', () => {
  const f = fixture(true)
  f.events.splice(2, 0, set('owned-by-first', { trainingOccurrenceId: 'first' }), set('owned-by-second', { trainingOccurrenceId: 'second' }))
  f.save()
  assert.equal(readTrainingFact('first')?.completedSetCount, 1)
  assert.equal(readTrainingFact('second')?.completedSetCount, 1)
  assert.equal(readTrainingFact('first')?.duplicateSetCount, 0)
  assert.equal(readTrainingFact('second')?.duplicateSetCount, 0)
})
test('legacy sets in overlapping same-template windows stay unknown for both occurrences', () => {
  const f = fixture(true); f.events.splice(2, 0, set('ambiguous')); f.save()
  for (const id of ['first', 'second']) {
    assert.equal(readTrainingFact(id)?.attemptCount, null)
    assert.equal(readTrainingFact(id)?.completedSetCount, null)
    assert.equal(readTrainingFact(id)?.completionRatio, null)
  }
})
test('an unbound same-template start makes later legacy attribution ambiguous', () => {
  const f = fixture(); f.events.splice(1, 0, start('unbound-start', '08:10'), set('ambiguous')); f.save()
  assert.equal(readTrainingFact('first')?.completedSetCount, null)
})
test('other-athlete starts and sets cannot truncate or populate local facts', () => {
  const f = fixture(); f.events.splice(1, 0, start('other-start', '08:10', 'other'), set('other-owned', { trainingOccurrenceId: 'first' }, 'other'), set('local-legacy')); f.save()
  assert.equal(readTrainingFact('first')?.completedSetCount, 1)
  assert.equal(readTrainingFact('first')?.attemptCount, 1)
})
test('an explicit malformed occurrence field never falls back to a legacy unbound set', () => {
  const f = fixture(); f.events.splice(1, 0, set('malformed', { trainingOccurrenceId: '' })); f.save()
  assert.equal(readTrainingFact('first')?.completedSetCount, null)
})
test('an event slice before a future close cannot expose that future outcome, end or duration', () => {
  const f = fixture()
  const beforeClose = [f.events[0], set('known-set', { trainingOccurrenceId: 'first' })]
  const fact = loadTrainingFact('first', beforeClose)!
  assert.equal(fact.lifecycle, 'IN_PROGRESS'); assert.equal(fact.outcome, 'UNKNOWN')
  assert.equal(fact.endedAt, null); assert.equal(fact.duration, null); assert.equal(fact.completedSetCount, null)
  const beforeStart = loadTrainingFact('first', [])!
  assert.equal(beforeStart.lifecycle, 'UNKNOWN'); assert.equal(beforeStart.startedAt, null); assert.equal(beforeStart.outcome, 'UNKNOWN')
})
test('a future sibling absent from the supplied history cannot erase a completed past fact', () => {
  const f = fixture()
  const past = [f.events[0], set('known-past-set', { trainingOccurrenceId: 'first' }), f.events[1]]
  const fact = loadTrainingFact('first', past)!
  assert.equal(fact.completedSetCount, 1); assert.equal(fact.lifecycle, 'COMPLETED'); assert.equal(fact.completionRatio, 1)
})
test('a future duplicate close cannot change the earlier visible completed result', () => {
  const f = fixture()
  const duplicate = event('duplicate-close', 'TRAINING_COMPLETED', '10:00', { sessionId: session.id, trainingOccurrenceId: 'second', actual: { sets: 1 } })
  assert.ok(closeTrainingOccurrence(duplicate))
  const beforeDuplicate = [f.events[0], f.events[1], f.events[2], set('second-set', { trainingOccurrenceId: 'second' }), f.events[3]]
  const fact = loadTrainingFact('second', beforeDuplicate)!
  assert.equal(fact.lifecycle, 'COMPLETED'); assert.equal(fact.outcome, 'COMPLETED')
  assert.equal(fact.endedAt, f.events[3].timestamp); assert.equal(fact.duration, 30 * 60_000)
})
