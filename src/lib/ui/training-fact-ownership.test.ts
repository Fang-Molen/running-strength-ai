import test from 'node:test'
import assert from 'node:assert/strict'
import V4 from '../plan400-v4.json' with { type: 'json' }
import { dayStatus, progressCounts, type V4Plan } from './plan400-view'
import { phoneRows, mergeActivities, garminRows, linkRuns, completedPlanIds, occurrenceStrengthTotals, type ActivityRow } from './training-read-model'
import { normalizePlanSessionId } from './training-component-facts'
import { summarize } from './log-range'
import { comboView } from './plan400-components'

const plan = V4 as V4Plan, date = '2026-10-19', d = plan.days.find(d => d.date === date)!
const now = Date.parse('2026-10-19T12:30:00Z')
const store = (data: Record<string, unknown>) => ({ getItem: (key: string) => key in data ? JSON.stringify(data[key]) : null })
const partsStore = (parts: unknown, log: unknown = { done: 'done', rpe: '7' }) => store({ 'fk-plan400-v4-log': { [date]: log }, 'fk-plan400-v4-components-v1': { schemaVersion: 1, days: { [date]: parts } } })

test('P0-01: explicit skipped / not_recorded supersedes legacy whole-session done in status and progress', () => {
  const parts = { running: { status: 'skipped' as const }, strength: { status: 'not_recorded' as const } }
  assert.equal(dayStatus(d, { done: 'done' }, date, false, { parts }), 'in_progress')
  assert.equal(progressCounts(plan, { [date]: { done: 'done' } }, { [date]: { parts } }).completedTrainingDays, 0)
  assert.equal(phoneRows(partsStore(parts), now).filter(r => r.status === 'completed').length, 0)
})
test('P0-01: explicit not_recorded alone cannot fall back to legacy done; recovery-only retains history', () => {
  assert.notEqual(dayStatus(d, { done: 'done' }, date, false, { parts: { running: { status: 'not_recorded' } } }), 'done')
  assert.equal(dayStatus(d, { done: 'done' }, date, false, { parts: { recovery: { runLegs24: '酸' } } }), 'done')
})
test('P0-02: strength-only evidence stays STRENGTH and incomplete for a planned combination', () => {
  const [row] = phoneRows(partsStore({ strength: { status: 'done', rpe: 6 } }), now)
  assert.equal(row.sport, 'STRENGTH'); assert.equal(row.status, 'incomplete'); assert.equal(row.rpe, null)
})
test('P0-02: skipped running plus completed strength is partial, not a completed session', () => {
  const parts = { running: { status: 'skipped' as const }, strength: { status: 'done' as const, rpe: 6 } }
  assert.equal(dayStatus(d, {}, date, false, { parts }), 'in_progress')
  assert.equal(phoneRows(partsStore(parts, {}), now)[0].status, 'incomplete')
})
test('P0-02: mixed schedule metadata does not turn strength sets into actual running', () => {
  const [row] = phoneRows(store({ 'fk-schedule-v1': { entries: [{ id: 'mixed-1', date, modality: 'strength', trainingType: 'mixed', status: 'done', actual: { executionState: 'COMPLETED' } }] }, 'fk-today-checklist-v1': { a: { date, sessionId: 'mixed-1', moves: { squat: [{ done: true }] } } } }), now)
  assert.equal(row.sport, 'STRENGTH'); assert.equal(row.status, 'incomplete')
})
test('P0-02: unique same-day Garmin remains a candidate and cannot join a V4 strength session automatically', () => {
  const s = partsStore({ strength: { status: 'done' } }, {})
  const runs = garminRows({ a: { id: 42, sourceIdentity: 'garmin:local:42', start: '2026-10-19T10:00:00Z', type: 'running', dist: 5000, dur: 1800 } })
  const rows = linkRuns([...phoneRows(s, now), ...runs], s, now)
  assert.equal(rows.length, 2); assert.ok(rows.every(r => r.sport !== 'MIXED'))
  assert.equal(rows.find(r => r.plan === 'v4')?.status, 'incomplete')
})
test('P0-02: two calendar courses using the same template on the same date keep separate identities', () => {
  const rows = phoneRows(store({ 'fk-schedule-v1': { entries: ['a', 'b'].map(id => ({ id, date, modality: 'strength', refId: 'same-template', status: 'done' })) } }), now)
  assert.equal(mergeActivities(rows).length, 2)
})
test('P0-02: shared source identities cannot merge different athletes', () => {
  const base = { id: 'x', date, startedAt: '2026-10-19T10:00:00Z', sport: 'STRENGTH', distanceM: null, durationSec: null, strengthVolumeKg: null, sets: 1, rpe: null, source: 'phone', originIds: ['shared'] } as ActivityRow
  assert.equal(mergeActivities([{ ...base, athleteId: 'a' }, { ...base, athleteId: 'b' }] as ActivityRow[]).length, 2)
})
test('P0-02: candidate device does not make the combination overview say actual running was recorded', () => {
  const view = comboView(d, {}, { strengthLive: false, strengthEntry: undefined, parts: { strength: { status: 'done' } }, deviceRuns: [{ id: 'g', source: 'garmin', sourceLabel: '佳明', title: '', startedAt: '2026-10-19T10:00:00Z', distanceM: 5000, durationSec: 1800, avgHr: null }] })
  assert.match(view.overall, /只有力量/)
})
test('P0-04: completion IDs require every planned component; legacy history and standalone devices count zero', () => {
  const complete = phoneRows(partsStore({ running: { status: 'done', rpe: 8 }, strength: { status: 'reduced', rpe: 6 } }), now)
  assert.deepEqual(completedPlanIds(complete, date, 'local'), [`plan400:${date}`])
  assert.equal(complete[0].rpe, null); assert.equal(complete[0].v4parts?.running?.rpe, 8); assert.equal(complete[0].v4parts?.strength?.rpe, 6)
  assert.deepEqual(completedPlanIds(phoneRows(partsStore({ strength: { status: 'done' } }), now), date, 'local'), [])
  const legacy = phoneRows(store({ 'fk-plan400-v4-log': { [date]: { done: 'done', rpe: '7' } } }), now)
  assert.equal(legacy[0].status, 'completed'); assert.equal(legacy[0].sport, 'UNKNOWN'); assert.match(legacy[0].title!, /历史整课/)
  assert.deepEqual(completedPlanIds(legacy, date, 'local'), [])
  assert.equal(normalizePlanSessionId(`scheduled:plan400:${date}:strength:run`), `plan400:${date}`)
  assert.equal(normalizePlanSessionId('scheduled:calendar-run:run'), 'calendar-run')
  assert.equal(normalizePlanSessionId('scheduled:calendar-strength:strength'), 'calendar-strength')
  assert.equal(normalizePlanSessionId('custom:run'), 'custom:run', 'only a generated scheduled execution suffix may be removed')
})
test('P0-02: a completed strength source cannot upgrade an incomplete combination during deduplication', () => {
  const [row] = phoneRows(partsStore({ running: { status: 'skipped' }, strength: { status: 'done', rpe: 6 } }), now)
  const strength: ActivityRow = { ...row, id: 'exec', source: 'execution', status: 'completed', componentFacts: [{ sessionId: row.sessionId!, componentId: 'strength', status: 'done', rpe: 6, originIds: ['exec'], provenance: 'execution' }] }
  const [merged] = mergeActivities([strength, row])
  assert.equal(merged.status, 'incomplete'); assert.equal(merged.sport, 'STRENGTH'); assert.equal(merged.v4parts?.running?.status, 'skipped'); assert.equal(merged.rpe, null)
  assert.deepEqual(completedPlanIds([merged], date, 'local'), [])
})
test('P0-02: legacy global phone keys belong only to local; explicit other-athlete entries remain isolated', () => {
  const s = store({ 'fk-plan400-v4-log': { [date]: { done: 'done' } }, 'fk-schedule-v1': { entries: [{ id: 'local', date, modality: 'strength', status: 'done' }, { id: 'other', date, modality: 'strength', status: 'done', athleteId: 'other' }] } })
  assert.equal(phoneRows(s, now, 'other').length, 1); assert.equal(phoneRows(s, now, 'other')[0].sessionId, 'other')
  assert.equal(phoneRows(s, now, 'local').some(r => r.sessionId === 'other'), false)
})
test('P0-02: same-component repeated occurrences stay separate even when they share a planned course', () => {
  const [row] = phoneRows(partsStore({ strength: { status: 'done' } }, {}), now)
  const repeated = ['first', 'second'].map(occurrenceId => ({ ...row, id: occurrenceId, occurrenceId, source: 'execution' as const, originIds: [occurrenceId, row.sessionId!] }))
  assert.equal(mergeActivities(repeated).length, 2)
})
test('P0-02: historical strength weights and repetitions come only from their own occurrence; unknown stays null', () => {
  const event = (occ: string | undefined, weight: number | null, amount = 5) => ({ event_type: 'TRAINING_SET_COMPLETED', payload: { trainingOccurrenceId: occ, sessionId: 'same-template', moveId: 'squat', setIndex: 1, mode: 'reps', actualWeight: weight, actualAmount: amount, completed: true } }) as never
  const events = [event('first', 20), event('second', 80), event(undefined, 100)]
  assert.deepEqual(occurrenceStrengthTotals(events, 'first'), { sets: 1, volumeKg: 100 })
  assert.deepEqual(occurrenceStrengthTotals(events, 'second'), { sets: 1, volumeKg: 400 })
  assert.deepEqual(occurrenceStrengthTotals([event('third', null)], 'third'), { sets: 1, volumeKg: null })
  assert.deepEqual(occurrenceStrengthTotals(events, 'missing'), { sets: 0, volumeKg: null })
})
test('P0-02: real confirmed-device distance survives an incomplete parent; missing duration remains unknown', () => {
  const data = { 'fk-plan400-v4-components-v1': { schemaVersion: 1, days: { [date]: { strength: { status: 'done' }, running: { device: { sourceIdentity: 'garmin:42', source: 'garmin', linkedBy: 'user' } } } } } }
  const s = store(data), rows = linkRuns([...phoneRows(s, now), ...garminRows({ a: { id: 42, start: '2026-10-19T10:00:00Z', type: 'running', dist: 5000 } })], s, now)
  assert.equal(rows.length, 1); assert.equal(rows[0].sport, 'MIXED'); assert.equal(rows[0].status, 'incomplete')
  const totals = summarize(rows, 'week', 'all', date)
  assert.equal(totals.count, 1); assert.equal(totals.distanceM, 5000); assert.equal(totals.missingDuration, 1); assert.equal(rows[0].durationSec, null)
  assert.deepEqual(completedPlanIds(rows, date, 'local'), [])
})
test('P0-04: legacy unplanned actual remains an activity and never completes a planned course', () => {
  const rows = phoneRows(store({ 'fk-schedule-v1': { entries: [{ id: 'quick-old', date, unplanned: true, modality: 'strength', status: 'done' }] } }), now)
  assert.equal(rows[0].status, 'completed'); assert.deepEqual(completedPlanIds(rows, date, 'local'), [])
})
test('P0-02: merging separate running and strength occurrences keeps component time without inventing mixed total time', () => {
  const sessionId = `plan400:${date}`
  const make = (componentId: 'running' | 'strength', durationSec: number): ActivityRow => ({ id: componentId, occurrenceId: componentId, athleteId: 'local', sessionId, date, startedAt: '2026-10-19T10:00:00Z', source: 'execution', originIds: [componentId, sessionId], sport: componentId === 'running' ? 'RUNNING' : 'STRENGTH', distanceM: componentId === 'running' ? 1000 : null, durationSec, durationScope: 'component', strengthVolumeKg: componentId === 'strength' ? 100 : null, sets: componentId === 'strength' ? 1 : null, rpe: null, plannedComponents: ['running', 'strength'], componentFacts: [{ sessionId, componentId, status: 'done', rpe: null, originIds: [componentId], provenance: 'execution', durationSec }] })
  const [row] = mergeActivities([make('running', 300), make('strength', 1200)])
  assert.equal(row.sport, 'MIXED'); assert.equal(row.durationSec, null); assert.equal(row.distanceM, 1000); assert.equal(row.sets, 1); assert.equal(row.strengthVolumeKg, 100)
  assert.equal(row.componentFacts?.find(f => f.componentId === 'running')?.durationSec, 300)
  assert.equal(row.componentFacts?.find(f => f.componentId === 'strength')?.durationSec, 1200)
})
test('P0-02: a mixed calendar whole-session done plus actual running does not create strength evidence', () => {
  const rows = phoneRows(store({ 'fk-schedule-v1': { entries: [{ id: 'only-run', date, modality: 'strength', trainingType: 'mixed', status: 'done', restLog: [{ actual: 90 }], actual: { outcome: 'as_planned', executionState: 'COMPLETED', km: 5, minutes: null } }] } }), now)
  assert.equal(rows[0].sport, 'RUNNING'); assert.equal(rows[0].status, 'incomplete'); assert.equal(rows[0].sets, null)
  assert.equal(rows[0].componentFacts?.some(f => f.componentId === 'strength'), false)
  assert.equal(rows[0].durationSec, null); assert.deepEqual(completedPlanIds(rows, date, 'local'), [])
})
test('P0-02: an unplanned mixed label also cannot turn running-only actual into strength', () => {
  const rows = phoneRows(store({ 'fk-schedule-v1': { entries: [{ id: 'unplanned-run', date, unplanned: true, modality: 'strength', trainingType: 'mixed', status: 'done', actual: { outcome: 'different', km: 5, minutes: null } }] } }), now)
  assert.equal(rows[0].sport, 'RUNNING'); assert.equal(rows[0].componentFacts?.some(f => f.componentId === 'strength'), false)
  assert.deepEqual(completedPlanIds(rows, date, 'local'), [])
})
test('P0-02: another athlete component document cannot upgrade the local athlete activity', () => {
  const [row] = phoneRows(partsStore({ strength: { status: 'done' } }, {}), now)
  const foreign = partsStore({ athleteId: 'other', running: { status: 'done' }, strength: { status: 'done' } }, {})
  const [projected] = linkRuns([row], foreign, now)
  assert.equal(projected.sport, 'STRENGTH'); assert.equal(projected.status, 'incomplete')
  assert.deepEqual(completedPlanIds([projected], date, 'local'), [])
})
