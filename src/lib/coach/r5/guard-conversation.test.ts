import test from 'node:test'
import assert from 'node:assert/strict'
import { guardR5Reply } from './guard'
import { context, metric } from '../../health/analysis-fixtures'
import { projectAnalysisEvidence } from '../../health/analysis-evidence'
import { buildMuscleExposure } from '../../health/muscle-exposure'
import { evaluateRecoveryEvidence } from '../../health/recovery-assessment'
import { buildCoachAnalysisPacket } from '../../health/analysis-packet'
const snapshot=projectAnalysisEvidence({context,facts:[metric({metric:'SLEEP',value:6,unit:'h'}),metric({id:'hrv',metric:'HRV',value:40,unit:'ms'})]})
const exposure=buildMuscleExposure(snapshot)
const packet=buildCoachAnalysisPacket(snapshot,evaluateRecoveryEvidence(snapshot,exposure),exposure)
test('numbered explanation is formatting, not a fabricated measured value',()=>{
  assert.equal(guardR5Reply('1. 先看训练实际完成情况。\n2. 再看睡眠和主观感受。',packet).ok,true)
})
test('metric paraphrases still require full source binding',()=>{
  assert.equal(guardR5Reply('记录中的HRV为40 ms。',packet).ok,false)
  assert.equal(guardR5Reply('记录中的HRV为6 ms。',packet).ok,false)
  assert.equal(guardR5Reply('记录中的HRV为40 bpm。',packet).ok,false)
})
test('negated clearance must pass but a later affirmative release must still fail',()=>{
  const hold={...packet,assessment:{...packet.assessment,safetyState:'HOLD_ACTIVE' as const}}
  assert.equal(guardR5Reply('不能解除疼痛限制，不可以继续跑步。建议暂停相关训练。',hold).ok,true)
  assert.equal(guardR5Reply('不能解除疼痛限制。但是可以继续跑步。',hold).ok,false)
  assert.equal(guardR5Reply('我已经替你修改了计划。',packet).ok,false)
  assert.equal(guardR5Reply('不必担心可以继续跑步。',hold).ok,false)
  assert.equal(guardR5Reply('不能不解除疼痛限制。',hold).ok,false)
  assert.equal(guardR5Reply('1. 跑5公里。',packet).ok,false)
  assert.equal(guardR5Reply('不代表无法解除疼痛限制。',hold).ok,false)
})

const hold={...packet,assessment:{...packet.assessment,safetyState:'HOLD_ACTIVE' as const}}
for(const text of ['你目前不能解除疼痛限制。','HRV正常不代表可以继续跑步。','目前还不能解除疼痛限制。','我没有已经替你修改计划。','不能确诊为肌腱炎。'])test('scoped negative with subject or evidence stays usable: '+text,()=>{
 assert.equal(guardR5Reply(text,hold).ok,true)
})
for(const text of ['不能解除疼痛限制，但可以继续跑步。','不能解除疼痛限制,可以继续跑步。','不能解除疼痛限制\n可以继续跑步。','并不是不能解除疼痛限制。','不是不可以继续跑步。','不代表不能解除疼痛限制。','你不必担心，继续跑步。'])test('turns and double negation do not authorize release: '+text,()=>{
 assert.equal(guardR5Reply(text,hold).ok,false)
})
for(const text of ['1、先核对当前症状。\n2）再核对实际记录。','（1）先看睡眠。\n（2）再看日常活动。','- 1. 先核对当前症状。\n- 2. 再核对实际记录。'])test('list markers do not become factual numbers: '+text,()=>{
 assert.equal(guardR5Reply(text,packet).ok,true)
})
for(const text of ['1.5公里慢跑。','1、跑5公里。','1、HRV为40 bpm。','１、跑５公里。','两组冲刺。'])test('list normalization retains unbound quantities: '+text,()=>{
 assert.equal(guardR5Reply(text,packet).ok,false)
})

test('host-owned factual sentences retain exact full-width punctuation and binding',()=>{
 const texts=packet.assessment.observations.map(o=>o.text)
 assert.ok(texts.some(text=>/\d/.test(text)&&/（/.test(text)))
 for(const text of texts)assert.equal(guardR5Reply(text,packet).ok,true)
})
