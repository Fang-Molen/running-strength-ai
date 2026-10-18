import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateCoachEvolution, type EvolutionEvidence } from './coach-evolution-v4.ts'
import { reviewDecisionEvidence, type DecisionEvidenceDraft } from './coach-decision-evidence.ts'
import { auditEvaluationLedger } from './coach-evaluation-ledger.ts'
import { openCoachEvidenceTools } from './coach-evidence-tools.ts'
import { setStoreBackend } from './storage.ts'
import { setEventContext, EVENT_JOURNAL_PREFIX } from './events.ts'

const ASOF = '2026-10-18T12:00:00Z'
const row = (patch: Partial<EvolutionEvidence> = {}): EvolutionEvidence => ({ id: 'r1', athleteId: 'synthetic', occurrenceId: 'session1',
  metric: 'SPLIT_SECONDS', value: 80.125, unit: 's', context: 'running:c:rep:b:s:1:1:400m', eventAt: '2026-10-17T01:00:00Z',
  recordedAt: '2026-10-17T01:01:00Z', source: 'TRAINING_FACT', sourceId: 'event1', confirmation: 'CONFIRMED', ...patch })
const snap = (rows = [row()]) => evaluateCoachEvolution({ athleteId: 'synthetic', asOf: ASOF, question: '算配速', evidence: rows })
const draft = (): DecisionEvidenceDraft => ({ selectedOption: 'HOLD', numericReasons: [{ evidenceId: 'r1', value: 80.125, unit: 's', role: 'SUPPORT' }], hypotheses: [] })

test('native R13 calculates same-row pace with raw precision, no artificial hypotheses or authorization', () => {
  const r = reviewDecisionEvidence(snap(), ['session1'], draft())
  assert.equal(r.status, 'READY_FOR_QUALIFIED_COACH_REVIEW'); assert.equal(r.metrics[0].paceSecondsPerKm, 200.3125)
  assert.equal(r.metrics[0].durationSeconds, 80.125); assert.equal(r.maySendToAthlete, false); assert.equal(r.planMutationAuthorized, false)
})
test('R13 detects cited but unused numeric evidence', () => {
  const d = draft(); d.numericReasons = []
  assert.ok(reviewDecisionEvidence(snap(), ['session1'], d).findings.includes('NUMERIC_FACTS_NOT_USED'))
})
for (const [label, change] of Object.entries({ wrongValue: { value: 81 }, wrongUnit: { unit: 'ms' }, foreignId: { evidenceId: 'elsewhere' } }))
  test(`R13 rejects ${label}`, () => { const d = draft(); Object.assign(d.numericReasons[0], change); assert.equal(reviewDecisionEvidence(snap(), ['session1'], d).status, 'BLOCKED') })
test('R13 never pairs different source events, plans or future/foreign data', () => {
  const s = snap([row({ context: 'no-distance' }), row({ id: 'planned', source: 'PLAN', value: 80 }), row({ id: 'other', athleteId: 'other' }), row({ id: 'future', recordedAt: '2026-10-19T12:00:00Z' })])
  assert.deepEqual(reviewDecisionEvidence(s, ['session1'], draft()).metrics, [])
})
test('R13 duplicate provenance is blocked', () => {
  assert.equal(reviewDecisionEvidence(snap([row(), row({ id: 'r2', context: 'running:c:rep:b:s:1:2:400m' })]), ['session1'], draft()).status, 'BLOCKED')
})
test('R13 safety restriction dominates valid arithmetic', () => {
  assert.equal(reviewDecisionEvidence({ ...snap(), safety: 'EMERGENCY' }, ['session1'], draft()).status, 'BLOCKED')
})
test('R13 cannot smuggle unapproved dosage options', () => {
  assert.equal(reviewDecisionEvidence(snap(), ['session1'], { ...draft(), selectedOption: 'RUN_6X400' as any }).status, 'BLOCKED')
})
test('two hypotheses must have distinguishable followup and actual counter/missing evidence', () => {
  const d = draft(); const observation = { metric: 'split', protocol: 'same protocol', supportOutcome: 'repeats', refuteOutcome: 'does not repeat' }
  d.hypotheses = ['pacing', 'fatigue'].map(id => ({ id, supportIds: ['r1'], counterIds: [], missing: ['recovery'], observation }))
  assert.ok(reviewDecisionEvidence(snap(), ['session1'], d).findings.includes('FOLLOWUPS_NOT_DISTINGUISHABLE'))
  d.hypotheses[1].observation = { ...observation, metric: 'next-day recovery' }
  assert.equal(reviewDecisionEvidence(snap(), ['session1'], d).status, 'READY_FOR_QUALIFIED_COACH_REVIEW')
})
test('evaluation denominator retains all frozen cases and both arms including timeout/refusal/not-run', () => {
  const r = auditEvaluationLedger([{ id: 'a', inputDigest: 'i' }, { id: 'b', inputDigest: 'j' }], [
    { caseId: 'a', arm: 'A', inputDigest: 'i', configDigest: 'c', status: 'TIMEOUT', outputId: null },
    { caseId: 'b', arm: 'A', inputDigest: 'j', configDigest: 'c', status: 'REFUSED', outputId: 'o' },
  ], 'c')
  assert.equal(r.denominator, 4); assert.equal(r.failedOrUnexecuted, 4); assert.equal(r.pairedAnswers, 0); assert.equal(r.qualityScore, null)
})
test('evaluation rejects duplicate attempts, changed frozen input and answer without output', () => {
  const a = { caseId: 'a', arm: 'A' as const, inputDigest: 'i', configDigest: 'c', status: 'ANSWERED' as const, outputId: 'o' }
  const r = auditEvaluationLedger([{ id: 'a', inputDigest: 'i' }], [a, a, { ...a, arm: 'B', inputDigest: 'different' }], 'c')
  assert.deepEqual(r.slots.map(s => s.status), ['DUPLICATE', 'MISMATCH']); assert.equal(r.answered, 0)
})
function memory() {
  const data = new Map<string, string>()
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, keys: () => [...data.keys()] }
  setStoreBackend(store); setEventContext({ athleteId: 'synthetic' }); return { data, store }
}
test('snapshot tools reuse committed facts, show records, clone output and never write', () => {
  const { data } = memory()
  try {
    const events = [
      { event_id: 'session1', event_type: 'TRAINING_STARTED', payload: { sessionId: 'strength' } },
      { event_id: 'set1', event_type: 'TRAINING_SET_COMPLETED', payload: { trainingOccurrenceId: 'session1', moveId: 'squat', setIndex: 1, completed: true, actualAmount: 8, actualWeight: 60 } },
    ]
    events.forEach((e, i) => data.set(EVENT_JOURNAL_PREFIX + e.event_id, JSON.stringify({ schemaVersion: 1, id: e.event_id, order: i, recordedAt: '2026-10-17T02:00:00Z', data: { ...e, athlete_id: 'synthetic', source: 'MANUAL', timestamp: '2026-10-17T01:00:00Z' } })))
    const before = JSON.stringify([...data]), tools = openCoachEvidenceTools('2026-10-18', 7, ASOF), view = tools.readView()
    if (!view.ok) throw Error(view.code)
    assert.equal(view.ok, true)
    assert.equal(view.data.profile.recordedSessions, 1); assert.equal(view.data.profile.recordedDays, 1); assert.equal(view.data.rows.length, 2)
    view.data.rows[0] = { ...view.data.rows[0], value: 999 }
    const again = tools.readView(); assert.ok(again.ok && again.data.rows[0].value !== 999)
    assert.deepEqual(tools.invoke('read_confirmed_training_records', { occurrenceId: 'foreign' }), { ok: false, code: 'OUTSIDE_SNAPSHOT' })
    assert.equal(JSON.stringify([...data]), before)
  } finally { setStoreBackend(null); setEventContext({ athleteId: 'local' }) }
})
test('snapshot invalidates on new correction, including a commit after the frozen cutoff', () => {
  const { data } = memory()
  try {
    const tools = openCoachEvidenceTools('2026-10-18', 7, ASOF)
    data.set('fr255-correction-new', JSON.stringify({ recordedAt: '2026-10-19T01:00:00Z' }))
    assert.deepEqual(tools.invoke('query_training_profile'), { ok: false, code: 'STALE_SNAPSHOT' })
    assert.deepEqual(tools.reviewDecision(draft()), { ok: false, code: 'STALE_SNAPSHOT' })
  } finally { setStoreBackend(null); setEventContext({ athleteId: 'local' }) }
})
test('snapshot rejects subject injection, user switch and unapproved muscle scoring', () => {
  memory()
  try {
    const tools = openCoachEvidenceTools('2026-10-18', 28, ASOF)
    assert.deepEqual(tools.invoke('query_training_profile', { athleteId: 'other' }), { ok: false, code: 'INVALID_ARGUMENTS' })
    const muscle = tools.invoke('read_muscle_history'); assert.ok(muscle.ok && (muscle.data as any).muscleTotals === null)
    setEventContext({ athleteId: 'other' }); assert.deepEqual(tools.invoke('query_training_profile'), { ok: false, code: 'SUBJECT_CHANGED' })
  } finally { setStoreBackend(null); setEventContext({ athleteId: 'local' }) }
})
