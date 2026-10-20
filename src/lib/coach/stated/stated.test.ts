// v86（R1.1）：本地解析用户这次说出的数字并核算。用改写过的输入测行为，不对齐公开校准稿的原句。
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseStatedFacts, hasStatedNumbers } from './parse.ts'
import { statedFactsSection } from './compose.ts'
import { detectRedFlags } from '../../core/coach-red-flags.ts'

test('plan vs actual stay separate; deviation uses plan as denominator', () => {
  const f = parseStatedFacts('同距离800米，计划用时180秒，实际189秒。请算偏差。')
  assert.equal(f.planActual.length, 1); assert.equal(f.planActual[0].planSec, 180); assert.equal(f.planActual[0].actualSec, 189)
  const s = statedFactsSection('同距离800米，计划用时180秒，实际189秒。请算偏差。').text ?? ''
  assert.match(s, /\+9秒/); assert.match(s, /\+5(\.0+)?%/); assert.doesNotMatch(s, /\+0秒/)
})
test('splits with target/rest/RPE are parsed and averaged', () => {
  const f = parseStatedFacts('今天5×300米目标55秒，实际54/55/56/57/58、休90秒、RPE8，疼痛0。')
  assert.equal(f.sets.length, 1); assert.deepEqual(f.sets[0].splits, [54, 55, 56, 57, 58])
  const s = statedFactsSection('今天5×300米目标55秒，实际54/55/56/57/58、休90秒、RPE8，疼痛0。').text ?? ''
  assert.match(s, /均值56秒/); assert.match(s, /RPE8/); assert.doesNotMatch(s, /分段未记录/)
})
test('scores like 恢复6/10 are not splits; sleep and RHR/HRV vs baseline computed', () => {
  const q = '晨脉58、基线52，RMSSD今天50ms、基线58ms，睡6小时，恢复6/10。'
  const f = parseStatedFacts(q); assert.equal(f.sets.length, 0)
  const s = statedFactsSection(q).text ?? ''
  assert.match(s, /\+6次\/分/); assert.match(s, /−8ms/); assert.match(s, /睡眠6小时/)
})
test('no numbers → no stated section', () => { assert.equal(hasStatedNumbers(parseStatedFacts('你好，今天练什么？')), false) })
test('negated symptoms do not trip the emergency gate; real red flags still do', () => {
  for (const q of ['疼痛0、无发热，没有胸痛和晕厥。', '目前没有晕厥、胸痛或急性骨痛。', '走路疼痛0/10，无明显畸形。']) assert.equal(detectRedFlags(q).level, 'NONE', q)
  assert.equal(detectRedFlags('跑完胸口压迫感、出冷汗，现在还没缓解').level, 'EMERGENCY')
  assert.notEqual(detectRedFlags('今天跑步时晕厥了一次').level, 'NONE')
})
