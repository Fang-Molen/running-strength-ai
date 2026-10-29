import test from 'node:test'
import assert from 'node:assert/strict'
import { cycleFixture } from './fixtures'
import { buildCycleDraft } from './planner'
import { assessCycleFeedback, type CycleDocument } from './host'
import type { Actual } from '../../ui/day-schedule-rules'

const recordedAt = '2026-11-02T10:00:00Z'
function fixture(actual: Actual) {
  const input = cycleFixture(), draft = buildCycleDraft(input)
  const document: CycleDocument = { id: 'synthetic-cutoff', athleteId: draft.athleteId, draft, status: 'ACCEPTED', history: [] }
  const candidates = draft.weeks[0].sessions.flatMap(session => session.candidate ? [session.candidate] : [])
  assert.equal(candidates.length, 3)
  input.entries = [...input.entries, ...candidates.map(candidate => ({ ...candidate, status: 'planned' as const }))]
  input.snapshot.context.asOf = '2026-11-01T10:00:00Z'
  const before = assessCycleFeedback(document, input)
  input.entries = input.entries.map(entry => entry.id === candidates[0].id ? { ...entry, actual } : entry)
  return { input, document, before, candidateId: candidates[0].id }
}

test('future missed feedback stays unknown at an earlier cutoff and appears when recorded', () => {
  const f = fixture({ outcome: 'missed', minutes: null, rpe: null, intensity: null, reasons: [], note: '合成迟到记录', at: recordedAt })
  const earlier = assessCycleFeedback(f.document, f.input)
  assert.equal(earlier.state, 'PENDING')
  assert.equal(earlier.missed, 0)
  assert.equal(earlier.unrecorded, 3)
  assert.equal(earlier.basis, f.before.basis)
  f.input.snapshot.context.asOf = recordedAt
  const current = assessCycleFeedback(f.document, f.input)
  assert.equal(current.state, 'WEAKENED')
  assert.equal(current.missed, 1)
  assert.notEqual(current.basis, earlier.basis)
})

test('future pain and high exertion do not become earlier cycle counterevidence', () => {
  const f = fixture({ outcome: 'different', minutes: 20, rpe: 10, intensity: 'EASY', reasons: ['pain'], note: '合成后续反馈', at: recordedAt })
  assert.equal(assessCycleFeedback(f.document, f.input).state, 'PENDING')
  assert.equal(assessCycleFeedback(f.document, f.input).basis, f.before.basis)
  f.input.snapshot.context.asOf = recordedAt
  assert.equal(assessCycleFeedback(f.document, f.input).state, 'WEAKENED')
})

test('feedback with an invalid recorded time remains unknown instead of establishing a missed session', () => {
  const f = fixture({ outcome: 'missed', minutes: null, rpe: null, intensity: null, reasons: [], note: '合成未知时间', at: 'invalid' })
  const result = assessCycleFeedback(f.document, f.input)
  assert.equal(result.state, 'PENDING')
  assert.equal(result.missed, 0)
  assert.equal(result.unrecorded, 3)
  assert.equal(result.basis, f.before.basis)
})

test('a current skipped status cannot expose future missed feedback at an earlier cutoff', () => {
  const f = fixture({ outcome: 'missed', minutes: null, rpe: null, intensity: null, reasons: [], note: '合成迟到跳过记录', at: recordedAt })
  f.input.entries = f.input.entries.map(entry => entry.id === f.candidateId ? { ...entry, status: 'skipped' as const } : entry)
  const earlier = assessCycleFeedback(f.document, f.input)
  assert.equal(earlier.state, 'PENDING')
  assert.equal(earlier.missed, 0)
  assert.equal(earlier.basis, f.before.basis)
  f.input.snapshot.context.asOf = recordedAt
  const current = assessCycleFeedback(f.document, f.input)
  assert.equal(current.state, 'WEAKENED')
  assert.equal(current.missed, 1)
})

test('a legacy skipped status without a recorded feedback time remains unknown', () => {
  const f = fixture({ outcome: 'missed', minutes: null, rpe: null, intensity: null, reasons: [], note: '合成未知时间', at: recordedAt })
  f.input.entries = f.input.entries.map(entry => entry.id === f.candidateId ? { ...entry, status: 'skipped' as const, actual: undefined } : entry)
  const result = assessCycleFeedback(f.document, f.input)
  assert.equal(result.state, 'PENDING')
  assert.equal(result.missed, 0)
  assert.equal(result.unrecorded, 3)
  assert.equal(result.basis, f.before.basis)
})
