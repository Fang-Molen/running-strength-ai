import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import { deriveCoordinationCounts } from './coach-coordination-facts'
import { setEventContext } from '../core/events'
import type { ActivityRow } from './training-read-model'
import type { ComponentFact } from './training-component-facts'
import type { ScheduleEntry } from './day-schedule-rules'
import type { V4Day } from './plan400-view'

const date = '2026-10-19'
const id = `plan400:${date}`
const v4Day: V4Day = { orig: '', date, weekday: '一', week: '1', title: '跑步＋力量', main: [], aux: [], strength: ['力量A'] }
const entry = (name = id, overrides: Partial<ScheduleEntry> = {}): ScheduleEntry => ({ id: name, date, kind: 'strength', modality: 'strength', title: '合成计划', focus: [], minutes: 30, intensity: 'EASY', lowerHeavy: false, source: 'custom', refId: null, status: 'planned', ...overrides })
const fact = (componentId: ComponentFact['componentId'], status: ComponentFact['status'], sessionId = id): ComponentFact => ({ sessionId, componentId, status, rpe: null, originIds: [sessionId], provenance: 'component' })
const row = (facts: ComponentFact[], overrides: Partial<ActivityRow> = {}): ActivityRow => ({ id, sessionId: id, athleteId: 'local', date, startedAt: `${date}T08:00:00Z`, source: 'phone', originIds: [id], sport: 'MIXED', distanceM: null, durationSec: null, strengthVolumeKg: null, sets: null, rpe: null, plannedComponents: ['running', 'strength'], componentFacts: facts, status: 'incomplete', ...overrides })
beforeEach(() => setEventContext({ athleteId: 'local' }))
afterEach(() => setEventContext({ athleteId: 'local' }))

test('empty actuals retain a dated mixed plan in the denominator without inventing completion', () => {
  assert.deepEqual(deriveCoordinationCounts({ date, entries: [], rows: [], v4Day }), { planned: 1, completed: 0, plannedIds: [id], completedIds: [] })
})
test('one completed component is real work but cannot complete the mixed planned course', () => {
  assert.equal(deriveCoordinationCounts({ date, entries: [], v4Day, rows: [row([fact('strength', 'done')])] }).completed, 0)
})
test('skipped running and completed strength cannot produce whole-course completion', () => {
  assert.equal(deriveCoordinationCounts({ date, entries: [], v4Day, rows: [row([fact('strength', 'done'), fact('running', 'skipped')])] }).completed, 0)
})
test('all required components count the original planned course exactly once', () => {
  const r = row([fact('strength', 'done'), fact('running', 'reduced')])
  assert.deepEqual(deriveCoordinationCounts({ date, entries: [entry(`${id}:strength`)], v4Day, rows: [r, { ...r, id: 'duplicate-view' }] }), { planned: 1, completed: 1, plannedIds: [id], completedIds: [id] })
})
test('a historical whole-course done flag cannot replace explicit component evidence', () => {
  assert.equal(deriveCoordinationCounts({ date, entries: [entry()], rows: [row([], { componentFacts: undefined, legacyStatus: 'done', status: 'completed' })] }).completed, 0)
})
test('same-day independent courses remain distinct rather than a single daily completion', () => {
  const other = 'custom-strength-2'
  const rows = [row([fact('running', 'done'), fact('strength', 'done')]), row([fact('strength', 'done', other)], { id: other, sessionId: other, originIds: [other], plannedComponents: ['strength'] })]
  assert.equal(deriveCoordinationCounts({ date, entries: [entry(), entry(other)], rows }).completed, 2)
})
test('wrong date, rest, rejected, proposed and unplanned entries are outside today planned count', () => {
  const entries = [entry('old', { date: '2026-10-18' }), entry('rest', { modality: 'rest' }), entry('rejected', { status: 'rejected' }), entry('proposed', { status: 'proposed' }), entry('unplanned', { unplanned: true })]
  assert.deepEqual(deriveCoordinationCounts({ date, entries, rows: [] }), { planned: 0, completed: 0, plannedIds: [], completedIds: [] })
})
test('other athlete, past dates and quick notes cannot satisfy today plan', () => {
  const facts = [fact('running', 'done'), fact('strength', 'done')]
  const rows = [row(facts, { athleteId: 'other' }), row(facts, { date: '2026-10-18', originIds: ['old'] }), row(facts, { id: 'qlog-synthetic', originIds: ['qlog-synthetic'] })]
  assert.equal(deriveCoordinationCounts({ date, entries: [entry()], rows }).completed, 0)
})
test('unlinked actual course or record-only evidence cannot complete a planned session', () => {
  const rows = [row([fact('running', 'recorded'), fact('strength', 'done')]), row([fact('running', 'done'), fact('strength', 'done')], { id: 'other', sessionId: 'other', originIds: ['other'] })]
  assert.equal(deriveCoordinationCounts({ date, entries: [entry()], rows }).completed, 0)
})
test('rest days are excluded even when a V4 date exists', () => {
  assert.equal(deriveCoordinationCounts({ date, entries: [], rows: [], v4Day: { ...v4Day, title: '休息日' } }).planned, 0)
})
test('planned and completed denominator both belong to the current athlete, including legacy V4 scope', () => {
  const entries = [entry(), { ...entry('other-owned'), athleteId: 'other' }]
  assert.deepEqual(deriveCoordinationCounts({ date, entries, rows: [], v4Day }).plannedIds, [id])
  setEventContext({ athleteId: 'other' })
  assert.deepEqual(deriveCoordinationCounts({ date, entries, rows: [], v4Day }).plannedIds, ['other-owned'])
})
