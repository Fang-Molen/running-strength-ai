import test from 'node:test'
import assert from 'node:assert/strict'
import { structuredCoachingCandidate } from './coach-structured-candidate.ts'
import { formatReasoningCandidate, nextStepReasoningIssues, numericReasoningIssues } from './coach-reasoning.ts'
import { normalizeAskCoachInput, interpretCoachModelOutput } from '../strength/coach-pipeline'
import { deriveCoachBrief } from './coach-brief.ts'
import { answerLocally } from './coach-local-first.ts'
import { fullRows } from '../../../evaluation/r7/fixtures.ts'
import { row, A, BEFORE, request } from '../../../evaluation/r6/fixtures.ts'
import { buildParts, type FactSpec } from '../../../evaluation/k12/fixtures.ts'
import type { FormalEvidenceRow } from './coach-v4-c11-adapter.ts'

const question = '现在无痛，睡眠正常，精神正常。这次计划均速，下一课怎么调整？'
const eligibleRows = () => [
  ...fullRows().map(r => r.metric === 'SPLIT_SECONDS'
    ? { ...r, value: 180 + (Number(r.recordId.slice(-1)) - 1) * 10 }
    : r.metric === 'SESSION_RPE' ? { ...r, value: 7 } : r),
  row('recovery', 'SUBJECTIVE_RECOVERY', 7, { unit: 'score' }),
  row('goal', 'GOAL_SECONDS', 180, { status: 'PLANNED', source: 'PLAN' }),
]
function prepared(rows: FormalEvidenceRow[] = eligibleRows(), extra: FactSpec = {}, q = question) {
  return normalizeAskCoachInput({
    brief: deriveCoachBrief(buildParts(q, { occurrence: { id: 's1', startedAt: '2026-03-01T09:00:00Z' }, rpe: 7, sleep: 7, recovery: 7, ...extra })),
    v4: { athleteId: A, asOf: BEFORE, rows },
  })
}

test('R185 slowing intervals cannot invent a recovery extension without an approved course', () => {
  const data = prepared(), frame = data.v4!.reasoning
  const before = JSON.stringify(frame)
  const candidate = structuredCoachingCandidate(frame)!
  assert.equal(candidate.decision, 'HOLD')
  assert.equal(candidate.changed_variable, null)
  assert.equal(candidate.from, null)
  assert.equal(candidate.to, null)
  assert.match(candidate.unchanged.join('；'), /组数.*距离/)
  assert.ok(candidate.preconditions.length && candidate.stop_conditions.length && candidate.rule_ids.includes('FK-APPROVED-COURSE-REQUIRED'))
  const text = formatReasoningCandidate(frame)
  assert.match(text, /尚不能定剂量/)
  assert.match(text, /逐组表现.*次日反馈/)
  assert.doesNotMatch(text, /4:00|240秒|增加30秒/)
  assert.deepEqual(nextStepReasoningIssues(frame, text, []), [])
  assert.deepEqual(numericReasoningIssues(frame, text), [])
  const local = answerLocally(data.brief, { frame, snapshot: data.v4!.review.audit.snapshot })
  // R189 handoff explicitly supersedes R188 REST default: no approved dose => observation only.
  // Neither a REST prescription nor the old +30 s extension may be invented.
  assert.equal(local.candidate, null)
  assert.match(local.text, /具体观察任务/)
  assert.match(local.text, /不编造剂量/)
  assert.doesNotMatch(local.text, /210秒 → 240秒/)
  const model = interpretCoachModelOutput(data, JSON.stringify({ mode: 'answer', text: '同距离工作段逐段变慢，原因需要核对。', citations: ['work1'], nextStep: null, medicalReferral: false }))
  assert.deepEqual(model.turn.candidate, candidate)
  assert.doesNotMatch(model.turn.text, /210秒 → 240秒/)
  assert.equal(frame.decision.planWrite, false)
  assert.equal(JSON.stringify(frame), before)
})

test('R11 established R7 faster session stays an observational repeat with unchanged rest', () => {
  const frame = request(fullRows()).v4!.reasoning
  assert.equal(structuredCoachingCandidate(frame)?.decision, 'CONDITIONAL_REPEAT')
  assert.match(formatReasoningCandidate(frame), /3:30 → 3:30/)
})

for (const metric of ['SESSION_RPE', 'SLEEP_HOURS', 'SUBJECTIVE_RECOVERY', 'PAIN_SCORE', 'GOAL_SECONDS'] as const)
  test(`R11 conditional extension holds with missing ${metric}`, () => {
    const frame = prepared(eligibleRows().filter(r => r.metric !== metric)).v4!.reasoning
    assert.equal(structuredCoachingCandidate(frame)?.decision, 'HOLD')
    assert.doesNotMatch(formatReasoningCandidate(frame), /210秒 → 240秒/)
  })

for (const [label, extra] of [
  ['near competition', { daysToCompetition: 10 }],
  ['deload', { week: 4, bias: 'deload' }],
  ['short sleep in brief', { sleep: 5 }],
  ['low recovery in brief', { recovery: 3 }],
  ['soreness in brief', { soreness: { location: '腿', intensity: 2 } }],
] as const)
  test(`R11 next-session constraint blocks recovery extension: ${label}`, () => {
    assert.equal(structuredCoachingCandidate(prepared(eligibleRows(), extra).v4!.reasoning)?.decision, 'HOLD')
  })

for (const [label, transform] of [
  ['high RPE', (rows: FormalEvidenceRow[]) => rows.map(r => r.metric === 'SESSION_RPE' ? { ...r, value: 8 } : r)],
  ['short sleep in rows', (rows: FormalEvidenceRow[]) => rows.map(r => r.metric === 'SLEEP_HOURS' ? { ...r, value: 5 } : r)],
  ['low recovery in rows', (rows: FormalEvidenceRow[]) => rows.map(r => r.metric === 'SUBJECTIVE_RECOVERY' ? { ...r, value: 3 } : r)],
  ['unverified timing', (rows: FormalEvidenceRow[]) => rows.map(r => r.metric === 'SPLIT_SECONDS' ? { ...r, verifiedByFormalProjection: false, source: 'DEVICE' as const } : r)],
  ['duplicate recovery interval', (rows: FormalEvidenceRow[]) => [...rows, row('extra-rest', 'REST_SECONDS', 210, { protocol: 'running:c:rest:b:AFTER_REPEAT:step:1:1' })]],
  ['rest linked to last instead of first repeat', (rows: FormalEvidenceRow[]) => rows.map(r => r.recordId === 'rest1' ? { ...r, protocol: 'running:c:rest:b:AFTER_REPEAT:step:1:4' } : r)],
  ['unequal recovery intervals', (rows: FormalEvidenceRow[]) => rows.map(r => r.recordId === 'rest1' ? { ...r, value: 180 } : r)],
  ['withdrawn split', (rows: FormalEvidenceRow[]) => rows.map(r => r.recordId === 'work2' ? { ...r, status: 'VOIDED' as const } : r)],
  ['too-long rest', (rows: FormalEvidenceRow[]) => rows.map(r => r.metric === 'REST_SECONDS' ? { ...r, value: 600 } : r)],
] as const)
  test(`R11 inadequate evidence holds: ${label}`, () => {
    assert.equal(structuredCoachingCandidate(prepared(transform(eligibleRows())).v4!.reasoning)?.decision, 'HOLD')
  })

for (const q of ['下一课怎么调整？', '现在无痛，睡眠正常，下一课怎么调整？', '这次计划均速，下一课怎么调整？', '现在无痛，睡眠正常，计划均速，复盘这次训练', '现在无痛，睡眠正常，计划逐组加速，下一课怎么调整？', '现在无痛，睡眠正常，如果计划均速，下一课怎么调整？', '现在无痛，睡眠正常，原来不是计划均速，下一课怎么调整？'])
  test(`R11 missing current-state, goal, or decision context holds: ${q}`, () => {
    assert.equal(structuredCoachingCandidate(prepared(eligibleRows(), {}, q).v4!.reasoning)?.decision, 'HOLD')
  })

test('R11 emergency never returns a conditional candidate', () => {
  assert.equal(structuredCoachingCandidate(prepared(eligibleRows(), {}, '我现在跑步胸口发紧，下一课怎么调整？').v4!.reasoning), null)
})

test('R11 incomplete basis and multi-session scope hold without changing original data', () => {
  for (const change of [
    (frame: ReturnType<typeof prepared>['v4']) => { frame!.reasoning.basis.complete = false },
    (frame: ReturnType<typeof prepared>['v4']) => { frame!.reasoning.scopeOccurrenceIds.push('other-session') },
    (frame: ReturnType<typeof prepared>['v4']) => { frame!.reasoning.nextSession = undefined },
  ]) {
    const data = prepared()
    change(data.v4)
    assert.equal(structuredCoachingCandidate(data.v4!.reasoning)?.decision, 'HOLD')
  }
})

test('R185 mixed session preserves every segment and holds unapproved recovery changes', () => {
  const rows = [
    ...eligibleRows(),
    row('warmup', 'SPLIT_SECONDS', 420, { protocol: 'running:warm:rep:warm:step:1:1:1200m', occurredAt: '2026-03-01T09:50:00Z' }),
    row('stride1', 'SPLIT_SECONDS', 18, { protocol: 'running:finish:rep:strides:step:1:1:100m', occurredAt: '2026-03-01T10:30:00Z' }),
    row('stride2', 'SPLIT_SECONDS', 19, { protocol: 'running:finish:rep:strides:step:1:2:100m', occurredAt: '2026-03-01T10:32:00Z' }),
  ]
  const frame = prepared(rows).v4!.reasoning
  const before = JSON.stringify(frame.computed)
  const candidate = structuredCoachingCandidate(frame)!
  assert.equal(candidate.decision, 'HOLD')
  assert.equal(candidate.to, null)
  assert.match(candidate.unchanged.join('；'), /其余训练段/)
  assert.doesNotMatch(formatReasoningCandidate(frame), /240秒|4:00/)
  assert.equal(JSON.stringify(frame.computed), before)
})

test('R185 fractional recorded recovery remains precise without inventing a new dose', () => {
  const frame = prepared(eligibleRows().map(r => r.metric === 'REST_SECONDS' ? { ...r, value: 210.12 } : r)).v4!.reasoning
  const candidate = structuredCoachingCandidate(frame)!
  assert.equal(candidate.decision, 'HOLD')
  assert.equal(candidate.to, null)
  assert.ok(frame.computed.rests.length>0)
  assert.ok(frame.computed.rests.every(r=>r.seconds===210.12))
  assert.doesNotMatch(formatReasoningCandidate(frame), /240.12/)
  assert.doesNotMatch(JSON.stringify(candidate), /\d+\.\d{6,}/)
})
