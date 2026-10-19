import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveCoachBrief, type CoachParts } from '../core/coach-brief'
import { buildCoachModelRequest, normalizeAskCoachInput, interpretCoachModelOutput } from '../strength/coach-pipeline'
import { estimateInputTokenUpperBound } from './deepseek-policy'
import { assertDeepSeekNumericGrounding } from './deepseek-grounding'

const parts = (extra: Partial<CoachParts> = {}): CoachParts => ({ question: '请解释这两种可能原因', occurrenceId: null, runningStructure: 'UNAVAILABLE', sessionRpe: null, sleepHours: null, subjectiveRecovery: null, recoveryState: null, fatigueState: null, duplicateCount: 0, repetitionSlots: 0, continuousCount: 0, plannedSetCount: null, completedSetCount: null, durationSec: null, pain: false, daysToCompetition: null, week: null, bias: null, sourceIds: [], sources: [], running: [], ...extra })
test('minimal transport omits repeated catalogue and chat but preserves the same guard context', () => {
  const data = normalizeAskCoachInput({ brief: deriveCoachBrief(parts()), history: [{ role: 'user', text: 'old-chat-canary' }] })
  const before = structuredClone(data), standard = buildCoachModelRequest(data), minimal = buildCoachModelRequest(data, { profile: 'minimal-transport' })
  assert.equal(buildCoachModelRequest(data).packet, standard.packet)
  assert.ok(estimateInputTokenUpperBound(minimal.messages) < estimateInputTokenUpperBound(standard.messages))
  assert.ok(estimateInputTokenUpperBound(minimal.messages, { response_format: { type: 'json_object' }, model: 'approved-model', max_tokens: 900, stream: false }) < 4000)
  assert.equal(minimal.maxTokens, 900); assert.equal(JSON.parse(minimal.packet).history.length, 0)
  assert.equal(minimal.packet.includes('old-chat-canary'), false)
  assert.ok(JSON.parse(minimal.packet).transport.omitted.includes('knowledge-catalogue'))
  assert.deepEqual(data, before)
})
test('minimal packet retains numeric observations, provenance, actual structure and unknowns', () => {
  const data = normalizeAskCoachInput({ brief: deriveCoachBrief(parts({ occurrenceId: 'synthetic-occ', question: '实际用时变化如何', durationSec: 80, sourceIds: ['split'], sources: [{ id: 'split', kind: 'FACT', detail: '实际400米用时80秒' }], runningStructure: 'AVAILABLE', repetitionSlots: 1, running: [{ kind: 'REPETITION', position: 'round1/rep1', status: 'COMPLETED', planned: '400m', actual: '400m 80s', sourceEventIds: ['split'] }] })) })
  const standard = JSON.parse(buildCoachModelRequest(data).packet), minimal = JSON.parse(buildCoachModelRequest(data, { profile: 'minimal-transport' }).packet)
  assert.equal(minimal.current.durationSec, 80); assert.equal(minimal.current.sessionRpe, null)
  assert.deepEqual(minimal.current.running, standard.current.running)
  assert.deepEqual(minimal.current.sources, standard.current.sources)
})
test('minimal system explicitly retains medical, uncertainty, source and plan authority limits', () => {
  const data = normalizeAskCoachInput({ brief: deriveCoachBrief(parts()) })
  const system = buildCoachModelRequest(data, { profile: 'minimal-transport' }).system
  for (const bound of ['回归许可始终UNKNOWN', '高RPE后缺恢复先核对', '不得改计划', '剂量仅沿用已核准课程', '相关不当因果', '不足两种不编造', '开始id不代替用时来源', '同协议', '缺失/UNKNOWN不是0']) assert.ok(system.includes(bound), bound)
})
test('changing transport does not weaken real numeric, citation, medical or plan output guards', () => {
  const data = normalizeAskCoachInput({ brief: deriveCoachBrief(parts({ occurrenceId: 'selected', durationSec: 80, sourceIds: ['time'], sources: [{ id: 'time', kind: 'FACT', detail: '实际用时80秒' }] })) })
  const invalid = [
    { text: '本次实际完成77秒，说明能力提高。', citations: ['time'] },
    { text: '你已经完全恢复，可以安全回归。', citations: ['time'] },
    { text: '本次训练实际用时80秒。', citations: ['unknown-source'] },
    { text: '我已改好你的正式训练计划。', citations: ['time'], planChanged: true },
  ]
  for (const candidate of invalid) {
    const raw = JSON.stringify({ mode: 'answer', text: candidate.text, nextStep: null, citations: candidate.citations, medicalReferral: false, planChanged: candidate.planChanged ?? false })
    const original = interpretCoachModelOutput(data, raw)
    buildCoachModelRequest(data, { profile: 'minimal-transport' })
    assert.deepEqual(interpretCoachModelOutput(data, raw), original)
    assert.equal(original.turn.planChanged, false)
    if (candidate.text.includes('77秒') || candidate.planChanged === true) assert.throws(() => assertDeepSeekNumericGrounding(data, raw))
    else assert.notEqual(original.code, 'ACCEPTED', candidate.text)
  }
})
