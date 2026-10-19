import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveCoachBrief, type CoachParts } from '../core/coach-brief'
import { normalizeAskCoachInput } from '../strength/coach-pipeline'
import { assertDeepSeekNumericGrounding } from './deepseek-grounding'
const parts: CoachParts = { question: '请解释变化的可能原因', occurrenceId: 'selected', runningStructure: 'AVAILABLE', sessionRpe: 7, sleepHours: null, recoveryState: null, fatigueState: null, duplicateCount: 0, repetitionSlots: 1, continuousCount: 0, plannedSetCount: null, completedSetCount: null, durationSec: 80, pain: false, daysToCompetition: null, week: null, bias: null, sourceIds: ['time', 'rpe'], sources: [{ id: 'time', kind: 'FACT', detail: '本次实际400米用时80秒' }, { id: 'rpe', kind: 'FACT', detail: 'SESSION_RPE 已记录：7/10' }], running: [] }
const data = normalizeAskCoachInput({ brief: deriveCoachBrief(parts) })
const raw = (text: string, citations = ['time', 'rpe'], extra = {}) => JSON.stringify({ text, nextStep: null, citations, planChanged: false, ...extra })
test('actual80 cannot be changed to77 merely by attaching a real citation', () => {
  assert.throws(() => assertDeepSeekNumericGrounding(data, raw('本次实际完成77秒。')), /UNVERIFIED_MODEL_QUANTITY/)
})
test('Chinese, fullwidth, invisible-separated and unitless variants cannot bypass numeric grounding', () => {
  for (const text of ['本次用时七十七秒。', '本次用时７７秒。', '本次用时77。', '实际完成7\u200b7秒。', '本次心率144bpm。', '实际能力82分。']) assert.throws(() => assertDeepSeekNumericGrounding(data, raw(text)), text)
})
test('properly cited actual values and equivalent units remain usable', () => {
  for (const text of ['本次400米用时80秒。', '本次0.4公里用时1分20秒。', '已记录RPE7。', '已记录RPE7/10。', '本次用时８０秒。']) assert.doesNotThrow(() => assertDeepSeekNumericGrounding(data, raw(text)))
})
test('uncited, wrong-unit, fabricatedRPE and fabricatedderived values are rejected', () => {
  for (const [text, citations] of [['本次80秒。', []], ['本次重量80公斤。', ['time']], ['RPE9。', ['rpe']], ['掉速5%。', ['time']]] as const) assert.throws(() => assertDeepSeekNumericGrounding(data, raw(text, [...citations])))
})
test('unsupported conditional dose is still rejected rather than exempting numbers as suggestions', () => {
  assert.throws(() => assertDeepSeekNumericGrounding(data, raw('如果恢复后，候选下次600米；不适则停止。')), /UNVERIFIED_MODEL_QUANTITY/)
})
test('model cannot claim it has modified a plan even when all numeric claims are valid', () => {
  assert.throws(() => assertDeepSeekNumericGrounding(data, raw('本次80秒。', ['time'], { planChanged: true })), /PLAN_WRITE_ASSERTION/)
})
test('unknown units, semantic source attribution and number-free clinical claims remain for existing guards and expert review', () => {
  assert.doesNotThrow(() => assertDeepSeekNumericGrounding(data, raw('可能与配速安排有关，需对照可比条件。')))
  // This assertion documents the scope: no claim of complete semantic certification.
  assert.doesNotThrow(() => assertDeepSeekNumericGrounding(data, raw('你已经痊愈。')))
})
