import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateCoachEvolution } from '../../core/coach-evolution-v4.ts'
import { compileC03MetricBrief } from './evidence.ts'
import { buildC03ObservationReview, requiredC03NumericHandles, reviewC03Argument, type C03ArgumentDraft, type C03HostOption } from './argument.ts'

const snapshot = evaluateCoachEvolution({ athleteId: 'synthetic', asOf: '2026-10-18T12:00:00Z', question: '算实际',
  evidence: [30, 33].map((value, i) => ({ id: `s${i}`, athleteId: 'synthetic', occurrenceId: 'observed', metric: 'SPLIT_SECONDS',
    value, unit: 's', context: `running:main:rep:b:step:1:${i + 1}:200m`, eventAt: '2026-10-17T01:00:00Z',
    recordedAt: '2026-10-17T01:01:00Z', source: 'TRAINING_FACT', sourceId: `synthetic-event:${i}`, confirmation: 'CONFIRMED' })) })
const brief = compileC03MetricBrief(snapshot, 'observed', 'future')
const options: C03HostOption[] = [{ id: 'hold', kind: 'HOLD', changes: [] }, { id: 'ask', kind: 'ASK_FOR_CONTEXT', changes: [] }]
const host = { task: 'EXPLAIN' as const, options, requiredNumericHandles: requiredC03NumericHandles(brief) }
const draft = (): C03ArgumentDraft => ({ version: 'FK-APP-C03-ARGUMENT-1', revisionReceipt: brief.revisionReceipt, selectedOptionId: 'hold',
  comparisons: options.map(o => ({ optionId: o.id, numbers: brief.numbers.filter(n => host.requiredNumericHandles.includes(n.handle)).map(n => ({
    handle: n.handle, value: n.value, unit: n.unit, role: 'SUPPORT' })), benefitToCheck: '核对目的与条件', limitation: '不会直接证明原因' })),
  explanations: ['pacing', 'context'].map((id, i) => ({ id, supportHandles: ['s0', 's1'], counterHandles: [], missing: ['缺少对应条件'],
    observation: { metric: i ? '次日恢复' : '对应恢复与逐段用时', protocol: '原有批准课程同协议观察',
      supportOutcome: '同条件多次共同变化，仅支持待验证', refuteOutcome: '控制条件后不再重复，削弱解释' } })) })
test('C03 checks every host option and key numeric obligation without claiming professional benefit', () => {
  const r = reviewC03Argument(brief, draft(), host)
  assert.equal(r.state, 'STRUCTURAL_REVIEW_ONLY'); assert.equal(r.semanticCorrectnessEvaluated, false)
  assert.equal(r.trainingBenefitProven, false); assert.equal(r.planMutationAuthorized, false)
  assert.deepEqual(r.candidateTable, options); assert.equal(r.didCallModel, false)
})
test('model cannot use an empty selected number list or host empty obligation to bypass actual figures', () => {
  const d = structuredClone(draft()) as any; d.comparisons[0].numbers = []
  assert.equal(reviewC03Argument(brief, d, host).state, 'NEEDS_REVISION')
  assert.equal(reviewC03Argument(brief, draft(), { ...host, requiredNumericHandles: [] }).state, 'BLOCKED')
})
test('invention, unit swap, extra dose fields, different revision and foreign options are blocked', () => {
  for (const mutation of [
    (d: any) => { d.comparisons[0].numbers[0].value = 77 },
    (d: any) => { d.comparisons[0].numbers[0].unit = 'ms' },
    (d: any) => { d.comparisons[0].dose = 'run 8x400' },
    (d: any) => { d.revisionReceipt = 'stale' },
    (d: any) => { d.comparisons[0].optionId = 'run_more' },
    (d: any) => { d.comparisons.pop() },
    (d: any) => { d.comparisons[1].optionId = 'hold' },
  ]) { const d = structuredClone(draft()); mutation(d); assert.equal(reviewC03Argument(brief, d, host).state, 'BLOCKED') }
})
test('host hold option cannot carry doses and returned host-approved changes are not model-authored', () => {
  assert.equal(reviewC03Argument(brief, draft(), { ...host, options: [{ ...options[0], changes: [{ reps: 8 }] }] }).state, 'BLOCKED')
})
test('two explanations need bound evidence and distinguishable support versus refutation observations', () => {
  const d = structuredClone(draft()) as any
  d.explanations[1].observation = structuredClone(d.explanations[0].observation)
  assert.ok(reviewC03Argument(brief, d, host).reasons.includes('NON_DISTINGUISHING_OBSERVATIONS'))
  d.explanations[0].supportHandles = ['foreign']
  assert.equal(reviewC03Argument(brief, d, host).state, 'BLOCKED')
})
test('single explanation requires revision; arithmetic request does not need artificial explanations', () => {
  const d = structuredClone(draft()) as any; d.explanations = []
  assert.equal(reviewC03Argument(brief, d, host).state, 'NEEDS_REVISION')
  assert.equal(reviewC03Argument(brief, d, { ...host, task: 'FACT' }).state, 'STRUCTURAL_REVIEW_ONLY')
})
test('deterministic fallback uses real numeric facts, keeps UNKNOWN purpose and creates no training dose', () => {
  const r = buildC03ObservationReview(brief)
  assert.match(r.facts.join(''), /30 \/ 33秒，均值31.5秒/)
  assert.equal(r.purpose, 'UNKNOWN'); assert.equal(r.explanations.length, 2)
  assert.notEqual(r.explanations[0].observation.metric, r.explanations[1].observation.metric)
  assert.match(r.nextObservation, /已批准/); assert.match(r.nextObservation, /不额外编造/)
  assert.equal(r.planMutationAuthorized, false)
  for (const h of r.explanations) { assert.ok(h.support.length); assert.ok(h.against.length); assert.ok(h.basisIds.length) }
})
test('blocked safety yields no explanations or observations to run a workout', () => {
  const blocked = compileC03MetricBrief({ ...snapshot, safety: 'MEDICAL_REVIEW' }, 'observed')
  assert.equal(reviewC03Argument(blocked, draft(), host).state, 'BLOCKED')
  const r = buildC03ObservationReview(blocked)
  assert.equal(r.explanations.length, 0); assert.equal(r.facts.length, 0)
  assert.match(r.nextObservation, /按原安全门控/)
})
test('one recorded segment cannot be described as stable repeat performance', () => {
  const one = compileC03MetricBrief({ ...snapshot, active: snapshot.active.slice(0, 1) }, 'observed')
  const r = buildC03ObservationReview(one)
  assert.match(r.explanations[0].explanation, /单个已记录段/)
  assert.doesNotMatch(r.explanations[0].explanation, /较一致/)
})
test('equal first and last repetitions do not hide a different middle repetition', () => {
  const s = { ...snapshot, active: [30, 60, 30].map((value, i) => ({ ...snapshot.active[0], id: `s${i}`,
    sourceId: `synthetic-event:${i}`, value, context: `running:main:rep:b:step:1:${i + 1}:200m` })) }
  const r = buildC03ObservationReview(compileC03MetricBrief(s, 'observed'))
  assert.match(r.explanations[0].explanation, /首末相同也不能代表中间各段稳定/)
})
