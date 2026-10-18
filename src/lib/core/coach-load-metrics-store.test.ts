import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { confirmLoadCoverage, LOAD_COVERAGE_PREFIX, projectSavedSessionLoads, readLoadCoverage, readLoadTrend } from './coach-load-metrics-store.ts'
import { savedSessionAu } from './coach-load-metrics.ts'
import { createTrainingImportDraft, CONFIRMED_TRAINING_IMPORTS_KEY, type ConfirmedTrainingImport } from './training-import.ts'
import { setStoreBackend, writeEnvelope } from './storage.ts'
import { readJournal } from './storage-journal.ts'
import { setEventContext } from './events.ts'
import type { AppEvent } from './types.ts'
import type { TrainingOccurrence } from './occurrence.ts'
import type { TrainingCorrection } from './training-correction.ts'

const athleteId = 'load-athlete', asOf = '2026-05-29T12:00:00.000Z'
const startedAt = '2026-05-28T01:00:00.000Z', endedAt = '2026-05-28T01:30:00.000Z'
function event(id: string, event_type: AppEvent['event_type'], timestamp: string, payload: AppEvent['payload'] = {}): AppEvent {
  return { event_id: id, athlete_id: athleteId, timestamp, event_type, payload, source: 'MANUAL', confidence: 1, data_quality: 'HIGH', context: {}, cycle_id: 'test', schema_version: 1 }
}
const occurrence: TrainingOccurrence = { trainingOccurrenceId: 'native-start', startEventId: 'native-start', closeEventId: 'native-end', sessionId: 'native', planSlotId: 'native', trainingPlanSnapshotId: null, planKnowledge: 'UNKNOWN', lifecycle: 'COMPLETED', outcome: 'COMPLETED', reason: 'UNKNOWN', startedAt, endedAt, duplicateCloseEventIds: [], duplicateStartEventIds: [], futureLinks: { strengthRpeEventId: null, painEventIds: [], injuryEventId: null } }
const nativeEvents = [event('native-start', 'TRAINING_STARTED', startedAt), event('native-end', 'TRAINING_COMPLETED', endedAt), event('native-rpe', 'RPE_RECORDED', endedAt, { evidenceType: 'SESSION_RPE', trainingOccurrenceId: 'native-start', value: 6 })]
function imported(): ConfirmedTrainingImport {
  const field = (value: unknown) => ({ status: 'RECORDED', value, sourceIds: ['user-confirmed'] })
  const draft = createTrainingImportDraft({ sport: 'RUNNING', title: field('30分钟轻松跑'), occurredAt: field(startedAt), durationSeconds: field(1800), totalDistanceMeters: field(5000), sessionRpe: field(6), runningStructure: 'CONTINUOUS' }, 'TEXT', ['user-confirmed'])
  return { ...draft, draftId: 'load-import', confirmedImportId: 'confirmed:load-import', athleteId, confirmedAt: '2026-05-28T02:00:00.000Z', userConfirmed: true, recordMode: 'ACTUAL_ONLY', canonicalOccurrenceId: null, sourceIds: ['import-source'], sources: [{ id: 'import-source', detail: '本人确认的整课训练' }] }
}
function sources() { return { athleteId, asOf, events: nativeEvents, occurrences: [occurrence], imports: [imported()], corrections: [] as TrainingCorrection[], ratings: [] } }
function memory() {
  const data = new Map<string, string>()
  setStoreBackend({ getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) }, keys: () => [...data.keys()] })
  setEventContext({ athleteId })
  return data
}
afterEach(() => { setStoreBackend(null); setEventContext({ athleteId: 'local' }) })

test('load adapter native elapsed milliseconds and imported seconds both yield 30 minutes × RPE 6 = 180 AU', () => {
  const result = projectSavedSessionLoads(sources())
  assert.equal(result.length, 2)
  assert.deepEqual(result.map(r => r.minutes), [30, 30])
  assert.deepEqual(result.map(savedSessionAu), [180, 180])
})
test('load adapter cannot turn unclosed native session into whole-session duration', () => {
  const result = projectSavedSessionLoads({ ...sources(), imports: [], occurrences: [{ ...occurrence, lifecycle: 'IN_PROGRESS', endedAt: null }] })
  assert.equal(result[0].minutes, null)
  assert.equal(savedSessionAu(result[0]), null)
})
test('load adapter ignores other athlete starts and imported records', () => {
  const input = sources()
  const result = projectSavedSessionLoads({ ...input, events: input.events.map(e => ({ ...e, athlete_id: 'other' })), imports: [{ ...imported(), athleteId: 'other' }] })
  assert.deepEqual(result, [])
})
test('load adapter does not count set RPE or unbound RPE as session RPE', () => {
  for (const payload of [{ value: 9, evidenceType: 'SET_RPE', trainingOccurrenceId: 'native-start' }, { value: 9, evidenceType: 'SESSION_RPE' }]) {
    const result = projectSavedSessionLoads({ ...sources(), imports: [], events: [...nativeEvents.slice(0, 2), event('other-rpe', 'RPE_RECORDED', endedAt, payload)] })
    assert.equal(result[0].sessionRpe, null)
  }
})
test('load adapter explicit saved import rating fills missing RPE; duplicate ratings remain unresolved', () => {
  const record = imported(); record.sessionRpe = { value: null, status: 'ABSENT', sourceIds: [] }
  const rating = { id: 'saved-rating', occurrenceId: record.confirmedImportId, athleteId, value: 7, scope: 'SESSION_RPE' as const, recordedAt: '2026-05-28T03:00:00.000Z', eventAt: startedAt }
  const input = { ...sources(), events: [], occurrences: [], imports: [record], ratings: [rating] }
  assert.equal(savedSessionAu(projectSavedSessionLoads(input)[0]), 210)
  assert.equal(projectSavedSessionLoads({ ...input, ratings: [rating, { ...rating, id: 'second' }] })[0].sessionRpe, null)
})
test('load adapter void removes evidence; feedback or duration correction withdraws stale values', () => {
  const change: TrainingCorrection = { correctionId: 'change', schemaVersion: 1, trainingOccurrenceId: 'confirmed:load-import', kind: 'VOID', field: null, setKey: null, originalValue: '', newValue: '', reason: '更正', at: asOf, recordedAt: asOf }
  assert.equal(projectSavedSessionLoads({ ...sources(), corrections: [change] }).length, 1)
  for (const field of ['feedback', 'duration'] as const) {
    const result = projectSavedSessionLoads({ ...sources(), corrections: [{ ...change, kind: 'FIELD', field }] })
    assert.equal(savedSessionAu(result[1]), null)
  }
})
test('load coverage is explicit append-only, excludes current/future days and isolates athletes', () => {
  memory()
  assert.equal(readLoadTrend('2026-05-28').knownDays, 0)
  assert.equal(confirmLoadCoverage('2026-05-01', '2026-05-29', asOf).ok, false)
  assert.equal(confirmLoadCoverage('2026-05-01', '2026-05-28', asOf).ok, true)
  assert.equal(readLoadTrend('2026-05-28').status, 'ZERO_BASELINE')
  assert.equal(confirmLoadCoverage('2026-05-01', '2026-05-28', asOf).ok, true)
  assert.equal(readJournal(LOAD_COVERAGE_PREFIX).length, 2)
  setEventContext({ athleteId: 'other' })
  assert.equal(readLoadCoverage().length, 0)
})
test('load coverage invalidates a confirmed rest day after an actual import arrives', () => {
  memory()
  assert.equal(confirmLoadCoverage('2026-05-01', '2026-05-28', asOf).ok, true)
  writeEnvelope(CONFIRMED_TRAINING_IMPORTS_KEY, [imported()])
  const result = readLoadTrend('2026-05-28')
  assert.equal(result.status, 'INSUFFICIENT')
  assert.equal(result.days[27].confirmed, false)
  assert.equal(confirmLoadCoverage('2026-05-01', '2026-05-28', asOf).ok, true)
  assert.equal(readLoadTrend('2026-05-28').status, 'AVAILABLE')
})
test('load coverage failed storage never reports successful save', () => {
  setStoreBackend({ getItem: () => null, setItem: () => { throw new Error('full') }, keys: () => [] })
  assert.equal(confirmLoadCoverage('2026-05-01', '2026-05-28', asOf).ok, false)
})

function correction(kind: TrainingCorrection['kind'], recordedAt: string | undefined, id = 'confirmed:load-import'): TrainingCorrection {
  return { correctionId: `${kind}-${recordedAt ?? 'unknown'}`, schemaVersion: 1, trainingOccurrenceId: id, kind, field: kind === 'FIELD' ? 'feedback' : null, setKey: null, originalValue: '', newValue: '', reason: '时序核对', at: startedAt, recordedAt }
}
test('load adapter future restoration cannot revive a session before the requested asOf', () => {
  for (const id of ['native-start', 'confirmed:load-import']) {
    const result = projectSavedSessionLoads({ ...sources(), corrections: [correction('VOID', '2026-05-28T03:00:00.000Z', id), correction('RESTORE', '2026-05-30T03:00:00.000Z', id)] })
    assert.equal(result.some(s => s.id === id), false)
  }
})
test('load adapter orders correction commit times instead of trusting input array order', () => {
  const restore = correction('RESTORE', '2026-05-29T03:00:00.000Z'), remove = correction('VOID', '2026-05-28T03:00:00.000Z')
  const input = sources()
  const ordered = projectSavedSessionLoads({ ...input, corrections: [remove, restore] })
  const unordered = projectSavedSessionLoads({ ...input, corrections: [restore, remove] })
  assert.equal(unordered.length, 2)
  assert.deepEqual(unordered, ordered)
})
test('load adapter future field correction does not withdraw existing facts prematurely', () => {
  for (const id of ['native-start', 'confirmed:load-import']) {
    const result = projectSavedSessionLoads({ ...sources(), corrections: [correction('FIELD', '2026-05-30T03:00:00.000Z', id)] })
    assert.equal(savedSessionAu(result.find(s => s.id === id)!), 180)
  }
})
test('load adapter unknown correction commit time keeps affected day incomplete without inventing chronology', () => {
  for (const id of ['native-start', 'confirmed:load-import']) for (const time of [undefined, 'invalid']) {
    const result = projectSavedSessionLoads({ ...sources(), corrections: [correction('VOID', '2026-05-28T03:00:00.000Z', id), correction('RESTORE', time, id)] })
    const session = result.find(s => s.id === id)
    assert.ok(session)
    assert.equal(session.sessionRpe, null)
    assert.equal(session.minutes, null)
    assert.equal(savedSessionAu(session), null)
  }
})
