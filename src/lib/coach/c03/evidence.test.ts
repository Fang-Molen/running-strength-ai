import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateCoachEvolution, type EvolutionEvidence } from '../../core/coach-evolution-v4.ts'
import { compileC03MetricBrief, deriveC03SegmentBindings, describeC03Group } from './evidence.ts'

const ASOF = '2026-10-18T12:00:00Z'
const row = (id: string, seconds = 30, patch: Partial<EvolutionEvidence> = {}): EvolutionEvidence => ({
  id, athleteId: 'synthetic-c03', occurrenceId: 'observed', metric: 'SPLIT_SECONDS', value: seconds, unit: 's',
  context: `running:main:rep:b:step:1:${id.replace(/\D/g, '') || '1'}:200m`, eventAt: '2026-10-17T01:00:00Z',
  recordedAt: '2026-10-17T01:01:00Z', source: 'TRAINING_FACT', sourceId: `synthetic-event:${id}`, confirmation: 'CONFIRMED', ...patch,
})
const snapshot = (rows: EvolutionEvidence[], asOf = ASOF) => evaluateCoachEvolution({ athleteId: 'synthetic-c03', asOf,
  question: '只读计算', evidence: rows })

test('C03 reuses native R13 raw-precision pace, source numbers and grouped calculations', () => {
  const brief = compileC03MetricBrief(snapshot([row('s1', 30.125), row('s2', 33.5)]), 'observed', 'future')
  assert.equal(brief.state, 'PARTIAL'); assert.ok(brief.missing.includes('WORK_ROLE_UNKNOWN'))
  assert.equal(brief.r13Status, 'READY_FOR_QUALIFIED_COACH_REVIEW')
  assert.equal(brief.numbers.find(n => n.metric === 'PACE_SECONDS_PER_KM')?.value, 150.625)
  assert.deepEqual(brief.numbers.find(n => n.metric === 'PACE_SECONDS_PER_KM')?.basisIds, ['s1'])
  assert.equal(brief.groups[0].meanSeconds, 31.8125); assert.equal(brief.groups[0].lastMinusFirstSeconds, 3.375)
  assert.equal(brief.planMutationAuthorized, false); assert.equal(brief.medicalClearance, 'UNKNOWN')
  assert.match(describeC03Group(brief.groups[0]), /30.125 \/ 33.5秒，均值31.813秒/)
  assert.match(describeC03Group(brief.groups[0]), /不能据此宣称整课完成/)
})
test('200m x 4 x 2 remains two independently ordered rounds without flattening', () => {
  const rows = [31, 32, 33, 34, 35, 36, 37, 38].map((s, i) => row(`s${i + 1}`, s, {
    context: `running:main:rep:b:step:${Math.floor(i / 4) + 1}:${i % 4 + 1}:200m` }))
  const brief = compileC03MetricBrief(snapshot(rows.reverse()), 'observed')
  assert.equal(brief.groups.length, 2)
  assert.deepEqual(brief.groups.map(g => g.durationsSeconds), [[31, 32, 33, 34], [35, 36, 37, 38]])
  assert.deepEqual(brief.groups.map(g => g.meanSeconds), [32.5, 36.5])
})
test('component, block, step, distance and warm-up roles never mix into a work mean', () => {
  const s = snapshot([row('s1', 30), row('s2', 300, { context: 'running:warm:rep:b:step:1:1:200m' }),
    row('s3', 32, { context: 'running:main:rep:b2:step:1:1:200m' }),
    row('s4', 34, { context: 'running:main:rep:b:other:1:1:200m' }),
    row('s5', 70, { context: 'running:main:rep:b:step:1:2:400m' })])
  const bindings = deriveC03SegmentBindings(s, 'observed').map(b => ({ ...b, role: b.componentId === 'warm' ? 'WARMUP' as const : 'WORK' as const }))
  const b = compileC03MetricBrief(s, 'observed', null, bindings)
  assert.equal(b.state, 'READY'); assert.equal(b.groups.length, 5)
  assert.equal(b.groups.find(g => g.role === 'WARMUP')?.meanSeconds, 300)
  assert.equal(b.groups.find(g => g.componentId === 'main' && g.blockId === 'b' && g.stepId === 'step' && g.distanceMeters === 200)?.meanSeconds, 30)
})
test('observed occurrence cannot be reused as the future target; other-session same-day rows excluded', () => {
  const s = snapshot([row('s1'), row('s2', 999, { occurrenceId: 'future' })])
  assert.equal(compileC03MetricBrief(s, 'observed', 'observed').state, 'BLOCKED')
  assert.deepEqual(compileC03MetricBrief(s, 'observed', 'future').numbers.filter(n => n.kind === 'SOURCE').map(n => n.value), [30])
})
for (const [label, patch] of Object.entries({ event: { sourceId: 'wrong-source' }, scope: { occurrenceId: 'other' },
  block: { blockId: 'wrong' }, order: { order: 2 }, distance: { distanceMeters: 400 }, protocol: { protocol: 'made up' } }))
  test(`C03 rejects forged ${label} binding`, () => {
    const s = snapshot([row('s1')]), bindings = deriveC03SegmentBindings(s, 'observed')
    Object.assign(bindings[0], patch)
    assert.equal(compileC03MetricBrief(s, 'observed', null, bindings).state, 'BLOCKED')
  })
test('same-source divergent facts and duplicate ordinal are blocked', () => {
  const sameSource = snapshot([row('s1'), row('s2', 32, { sourceId: 'synthetic-event:s1' })])
  assert.equal(compileC03MetricBrief(sameSource, 'observed').state, 'BLOCKED')
  const sameOrder = snapshot([row('s1'), row('s2', 32, { context: 'running:main:rep:b:step:1:1:200m' })])
  assert.equal(compileC03MetricBrief(sameOrder, 'observed').state, 'BLOCKED')
})
test('plan, other athlete, future observations and future commits are not actual facts', () => {
  const s = snapshot([row('s1'), row('s2', 300, { source: 'PLAN' }), row('s3', 400, { athleteId: 'other' }),
    row('s4', 500, { recordedAt: '2026-10-19T01:00:00Z' }), row('s5', 600, { eventAt: '2026-10-19T01:00:00Z', recordedAt: '2026-10-19T02:00:00Z' })])
  assert.deepEqual(compileC03MetricBrief(s, 'observed').numbers.filter(n => n.kind === 'SOURCE').map(n => n.value), [30])
})
test('correction visibility follows knownAt cutoff and revision receipt changes, old value never coexists', () => {
  const rows = [row('s1', 30), row('corrected', 32, { context: 'running:main:rep:b:step:1:1:200m', supersedes: 's1',
    recordedAt: '2026-10-18T11:00:00Z' })]
  const before = compileC03MetricBrief(snapshot(rows, '2026-10-18T10:00:00Z'), 'observed')
  const after = compileC03MetricBrief(snapshot(rows), 'observed')
  assert.equal(before.groups[0].meanSeconds, 30); assert.equal(after.groups[0].meanSeconds, 32)
  assert.notEqual(before.revisionReceipt, after.revisionReceipt)
  assert.deepEqual(after.numbers.filter(n => n.kind === 'SOURCE').map(n => n.handle), ['corrected'])
})
test('null fields, omitted binding and missing distance stay partial/UNKNOWN, not zero', () => {
  const s = snapshot([row('s1'), row('s2', 32, { value: null }), row('s3', 35, { context: 'running:main:rep:b:step:1:3' })])
  const b = compileC03MetricBrief(s, 'observed', null, [])
  assert.equal(b.state, 'PARTIAL'); assert.equal(b.groups.length, 0)
  assert.ok(b.missing.some(m => m.includes('s2:UNKNOWN'))); assert.ok(b.missing.some(m => m.startsWith('UNBOUND_SEGMENT')))
  assert.equal(b.numbers.some(n => n.value === 0), false)
})
test('empty scope is partial, pain or emergency safety cannot be cleared by valid calculations', () => {
  assert.equal(compileC03MetricBrief(snapshot([]), 'observed').state, 'PARTIAL')
  assert.notEqual(compileC03MetricBrief(snapshot([]), 'observed', 'next-a').revisionReceipt,
    compileC03MetricBrief(snapshot([]), 'observed', 'next-b').revisionReceipt)
  assert.notEqual(compileC03MetricBrief(snapshot([]), 'observed').revisionReceipt,
    compileC03MetricBrief({ ...snapshot([]), athleteId: 'other' }, 'observed').revisionReceipt)
  const s = snapshot([row('s1')])
  for (const safety of ['MEDICAL_REVIEW', 'EMERGENCY'] as const)
    assert.equal(compileC03MetricBrief({ ...s, safety }, 'observed').state, 'BLOCKED')
})
test('invalid units, stale superseded rows and oversized proof fail closed', () => {
  const s = snapshot([row('s1')])
  assert.equal(compileC03MetricBrief({ ...s, active: [row('s1', 30, { unit: 'ms' })] }, 'observed').state, 'BLOCKED')
  assert.equal(compileC03MetricBrief({ ...s, corrections: [{ replacedId: 's1', replacementId: 'new' }] }, 'observed').state, 'BLOCKED')
  assert.equal(compileC03MetricBrief(snapshot(Array.from({ length: 81 }, (_, i) => row(`s${i + 1}`))), 'observed').state, 'BLOCKED')
})
test('round identity is numerically ordered beyond round nine', () => {
  const rows = [10, 2, 1].map(round => row(`r${round}`, round + 30, { context: `running:main:rep:b:step:${round}:1:200m` }))
  assert.deepEqual(compileC03MetricBrief(snapshot(rows), 'observed').groups.map(g => g.round), [1, 2, 10])
})
