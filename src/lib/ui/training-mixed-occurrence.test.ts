import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend, writeEnvelope } from '@/lib/core/storage'
import { EVENTS_KEY, loadEvents } from '@/lib/core/events'
import { bindTrainingStart, closeTrainingOccurrence } from '@/lib/core/occurrence'
import { saveRunningPlan, getRunningPlanSnapshot } from '@/lib/core/running-plan'
import { recordRunningContinuousCompleted } from '@/lib/core/running-execution'
import { loadTrainingActivities, completedPlanIds } from './training-read-model'
import type { Session } from '@/lib/strength/model'
import type { AppEvent } from '@/lib/core/types'

function fixture(strengthSets: number, recordedSets: number, close: boolean) {
  const data = new Map<string, string>(), store = { keys: () => [...data.keys()], getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
  setStoreBackend(store)
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })
  const session: Session = { id: 'mixed-session', name: '混合实际', moves: [{ id: 'squat', catalogId: 'back-squat', customName: '', sets: strengthSets, mode: 'reps', amount: 5, restSec: 90, weightKg: 20 }] }
  assert.ok(saveRunningPlan({ planId: 'mixed-plan', planSlotId: 'mixed-slot', components: [{ componentId: 'run', modality: 'RUNNING', purpose: 'UNSPECIFIED', structure: { kind: 'CONTINUOUS', plannedDistanceMeters: 1000, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } }, { componentId: 'lift', modality: 'STRENGTH', strengthSessionId: session.id }] }).ok)
  const event = (id: string, event_type: AppEvent['event_type'], payload: Record<string, unknown>, timestamp: string): AppEvent => ({ event_id: id, athlete_id: 'local', timestamp, event_type, source: 'MANUAL', payload, confidence: 1, data_quality: 'HIGH', context: {}, cycle_id: 'test', schema_version: 1 })
  const start = event('mixed-occ', 'TRAINING_STARTED', { sessionId: session.id, decisionId: 'test' }, '2026-10-07T08:00:00Z')
  writeEnvelope(EVENTS_KEY, [start])
  assert.ok(bindTrainingStart({ startEventId: start.event_id, startedAt: start.timestamp, sessionId: session.id, planSlotId: 'mixed-slot', plan: session, runningPlanId: 'mixed-plan' }))
  const snapshot = getRunningPlanSnapshot(start.event_id)!
  assert.ok(recordRunningContinuousCompleted({ trainingOccurrenceId: start.event_id, runningSnapshotId: snapshot.runningSnapshotId, componentId: 'run', actualDistanceMeters: 1050, actualDurationSeconds: 300 }))
  const sets = Array.from({ length: recordedSets }, (_, index) => event(`set-${index}`, 'TRAINING_SET_COMPLETED', { sessionId: session.id, trainingOccurrenceId: start.event_id, moveId: 'squat', setIndex: index + 1, mode: 'reps', plannedWeight: 20, plannedAmount: 5, actualWeight: 20, actualAmount: 5, completed: true, skipped: false }, '2026-10-07T08:10:00Z'))
  const end = event('mixed-close', 'TRAINING_COMPLETED', { sessionId: session.id, trainingOccurrenceId: start.event_id, setsCompleted: recordedSets, actual: { sets: recordedSets }, rpe: 7 }, '2026-10-07T08:30:00Z')
  writeEnvelope(EVENTS_KEY, [...loadEvents(), ...sets, ...(close ? [end] : [])])
  if (close) assert.ok(closeTrainingOccurrence(end))
  return loadTrainingActivities().find(r => r.occurrenceId === start.event_id)!
}
test('same occurrence retains actual running and strength independently; both must finish', () => {
  const row = fixture(1, 1, true)
  assert.equal(row.sport, 'MIXED'); assert.equal(row.status, 'completed'); assert.equal(row.distanceM, 1050)
  assert.equal(row.sets, 1); assert.equal(row.strengthVolumeKg, 100); assert.equal(row.rpe, null)
  assert.equal(row.durationSec, 1800, 'explicit session elapsed is distinct from running work duration')
  assert.equal(row.componentFacts?.find(f => f.componentId === 'running')?.durationSec, 300)
  assert.equal(row.componentFacts?.find(f => f.componentId === 'strength')?.durationSec, null)
  assert.deepEqual(completedPlanIds([row], '2026-10-07', 'local'), ['mixed-slot'])
})
test('finishing running and only one of two strength sets cannot finish the mixed occurrence', () => {
  const row = fixture(2, 1, true)
  assert.equal(row.sport, 'MIXED'); assert.equal(row.status, 'incomplete'); assert.equal(row.sets, 1); assert.equal(row.strengthVolumeKg, 100)
  assert.equal(row.componentFacts?.find(f => f.componentId === 'running')?.status, 'done')
  assert.equal(row.componentFacts?.find(f => f.componentId === 'strength')?.status, 'recorded')
  assert.deepEqual(completedPlanIds([row], '2026-10-07', 'local'), [])
})
test('mixed occurrence without an end keeps total duration unknown instead of copying running work time', () => {
  const row = fixture(1, 1, false)
  assert.equal(row.sport, 'MIXED'); assert.equal(row.durationSec, null); assert.equal(row.status, 'incomplete')
  assert.equal(row.componentFacts?.find(f => f.componentId === 'running')?.durationSec, 300)
})
