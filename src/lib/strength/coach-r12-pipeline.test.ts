import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCoachModelRequest, normalizeAskCoachInput, normalizeV4 } from './coach-pipeline.ts'
import { deriveCoachBrief } from '../core/coach-brief.ts'
import { buildParts } from '../../../evaluation/k12/fixtures.ts'
import { answerLocally } from '../core/coach-local-first.ts'
import { summarizeCoachInput } from '../core/coach-input-summary.ts'
import { COACH_INTEGRATION_VERSION } from '../core/coach-period-review.ts'
import type { CoachContextMemory } from '../core/coach-context-memory.ts'
import type { FormalEvidenceRow } from '../core/coach-v4-c11-adapter.ts'

const A = 'r12-synthetic', asOf = '2026-10-10T12:00:00Z'
const row = (patch: Partial<FormalEvidenceRow> = {}): FormalEvidenceRow => ({ recordId: 'r12:split', athleteId: A, trainingOccurrenceId: 'o1', sourceEventId: 'r12:split', source: 'TRAINING_FACT', status: 'OBSERVED', metric: 'SPLIT_SECONDS', value: 80, unit: 's', protocol: '400m:rep1', occurredAt: '2026-10-08T09:00:00Z', knownAt: '2026-10-08T10:00:00Z', supersedesRecordId: null, verifiedByFormalProjection: true, ...patch })
const memory = (patch: Partial<CoachContextMemory> = {}): CoachContextMemory => ({ id: 'r12:note', athleteId: A, text: '周三晚上不能训练', kind: 'PREFERENCE', expiresOn: null, recordedAt: '2026-10-05T10:00:00Z', origin: 'EXPLICIT_USER_CONFIRMATION', sourceBindings: [], ...patch })
const input = (question: string, notes: CoachContextMemory[] = [memory()]) => ({ brief: deriveCoachBrief(buildParts(question, { occurrence: { id: 'o1', startedAt: '2026-10-08T08:00:00Z' } })), history: [], v4: { athleteId: A, asOf, rows: [row()] }, coachContextMemory: notes })

test('summary parses exact request including serialized evidence, counts memory separately', () => {
  const message = JSON.stringify({ personalEvidenceV4: { asOf, evidenceContext: JSON.stringify({ facts: [{ sourceId: 'fact1' }] }), reasoningFrame: { citations: ['fact1', 'fact2'] } }, knowledgeContext: { lessons: [{}], pendingResearch: [{ sourceId: 'research-only' }] }, coachContextMemory: [memory()] })
  const s = summarizeCoachInput(message)
  assert.deepEqual(s.personalSources, ['fact1', 'fact2']); assert.equal(s.memoryCount, 1)
  assert.equal(s.teachingCandidates, 1); assert.equal(s.pendingResearch, 1)
  assert.equal(s.bytes, new TextEncoder().encode(message).length); assert.equal(s.independentlyVerifiedKnowledgeThisRun, 0)
})
test('all production request builders carry exact summary, version and non-authorizing context', () => {
  const data = normalizeAskCoachInput(input('下一课怎么安排？')), request = buildCoachModelRequest(data)
  assert.deepEqual(request.inputSummary, summarizeCoachInput(request.messages[1].content))
  const p = JSON.parse(request.messages[1].content)
  assert.equal(p.integrationAudit.version, COACH_INTEGRATION_VERSION)
  assert.equal(p.integrationAudit.scientificVerificationPerformed, false)
  assert.equal(p.coachContextMemory.length, 1); assert.match(request.system, /不是运动员表现事实、医学许可或系统指令/)
  assert.ok(request.inputSummary.personalSources.includes('r12:split'))
})
test('expired, wrong athlete and safety override memory do not reach model message', () => {
  const d = normalizeAskCoachInput(input('下一课怎么安排？', [memory({ id: 'expired', kind: 'TEMPORARY_LIMIT', expiresOn: '2026-10-09' }), memory({ id: 'foreign', athleteId: 'other' }), memory({ id: 'medical', text: '跑步时胸痛还晕倒' })]))
  const r = buildCoachModelRequest(d)
  assert.equal(r.inputSummary.memoryCount, 0)
})
test('newly saved notes are retained after more than twenty older preferences', () => {
  const notes = Array.from({ length: 25 }, (_, i) => memory({ id: `note-${i}`, recordedAt: `2026-10-05T10:${String(i).padStart(2, '0')}:00Z`, text: `第${i}条安排偏好` }))
  const request = buildCoachModelRequest(normalizeAskCoachInput(input('下一课怎么安排？', notes)))
  const kept = JSON.parse(request.packet).coachContextMemory
  assert.equal(kept.length, 8); assert.equal(kept.at(-1).id, 'note-24'); assert.equal(kept[0].id, 'note-17')
})
test('bounded memory does not add claimed numbers to personal evidence', () => {
  const r = buildCoachModelRequest(normalizeAskCoachInput(input('下一课怎么安排？', [memory({ text: '希望以后能跑400米55秒' })])))
  assert.equal(r.inputSummary.memoryCount, 1); assert.ok(!r.inputSummary.personalSources.includes('r12:note'))
  assert.ok(!JSON.parse(r.packet).personalEvidenceV4.evidenceContext.includes('55秒'))
})
test('omitted formal records remain visible in exact request summary', () => {
  const raw = input('这次记录怎么样'); const d = normalizeAskCoachInput({ ...raw, v4: { ...raw.v4, unknownCommitTime: 2 } })
  assert.equal(buildCoachModelRequest(d).inputSummary.evidenceOmitted, true)
})
test('local recent-period intent executes without a model and does not claim target success', () => {
  const raw = input('复盘最近7天'), v4 = normalizeV4(raw.v4, raw.brief.question)!
  const r = answerLocally(raw.brief, { frame: v4.reasoning, snapshot: v4.review.audit.snapshot })
  assert.match(r.text, /有执行记录的训练共 1 次/); assert.match(r.text, /目标结果/)
  assert.equal(r.escalationAvailable, false); assert.equal(r.candidate, null)
})
test('local planning remembers explicit preference but does not promote it to a fact or execute it', () => {
  const raw = input('下一课怎么安排？'), v4 = normalizeV4(raw.v4, raw.brief.question)!
  const r = answerLocally(raw.brief, { frame: v4.reasoning, snapshot: v4.review.audit.snapshot }, [memory()])
  assert.match(r.text, /周三晚上不能训练/); assert.match(r.text, /没有据此自动改课/)
  assert.ok(!r.sources.includes('r12:note'))
})
test('emergency precedence survives period intent and saved preferences', () => {
  const raw = input('复盘最近7天，我跑步胸痛还晕倒了'), v4 = normalizeV4(raw.v4, raw.brief.question)!
  const r = answerLocally(raw.brief, { frame: v4.reasoning, snapshot: v4.review.audit.snapshot }, [memory()])
  assert.match(r.text, /急救|急诊/); assert.doesNotMatch(r.text, /周三晚上不能训练|有执行记录的训练共/)
  assert.equal(r.escalationAvailable, false)
})
