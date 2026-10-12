import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assessCoachQuestion } from './coach-question-reasoning.ts'
test('strength transfer generates distinct hypotheses and source card', () => { const r=assessCoachQuestion('100米停滞，深蹲从120kg涨到150kg为什么成绩没变？'); assert.equal(r.intent,'PERFORMANCE_TRANSFER'); assert.ok(r.hypotheses.length>=2); assert.ok(r.knowledge.some(x=>x.id==='knowledge:strength')); assert.equal(r.decisionAuthorization,false) })
test('HRV asks for personal trend, does not diagnose',()=>{ const r=assessCoachQuestion('HRV比基线低20%要减量吗'); assert.equal(r.intent,'DATA_INTERPRETATION'); assert.ok(r.nextQuestion?.includes('基线')); assert.equal(r.diagnosis,null) })
test('chest pain is urgent but persistent fatigue is not',()=>{ assert.equal(assessCoachQuestion('跑步胸痛还可以跑吗').safety,'EMERGENCY'); assert.notEqual(assessCoachQuestion('最近总是疲劳，是贫血吗').safety,'EMERGENCY') })
test('bone stress injury needs medical review, not emergency by default',()=>{ assert.equal(assessCoachQuestion('胫骨应力性骨折六周可以慢跑吗').safety,'MEDICAL_REVIEW') })
test('knowledge citations are explicitly unverified',()=>{ const r=assessCoachQuestion('力量训练会让跑者变慢吗'); assert.ok(r.knowledge.every(k=>k.verification==='CURATED_NOT_INDEPENDENTLY_VERIFIED')) })
test('race, environment, nutrition and psychology have distinct intents',()=>{
 assert.equal(assessCoachQuestion('800m比赛第一圈应该跑多快？').intent,'RACE_STRATEGY')
 assert.equal(assessCoachQuestion('新加坡35度比赛需要热适应吗？').intent,'ENVIRONMENT')
 assert.equal(assessCoachQuestion('每天跑15km蛋白质需要多少？').intent,'NUTRITION')
 assert.equal(assessCoachQuestion('赛前特别紧张怎么办？').intent,'PSYCHOLOGY')
})
test('safety grading separates chronic fatigue from emergency',()=>{
 assert.equal(assessCoachQuestion('最近总是疲劳，是贫血吗').safety,'MEDICAL_REVIEW')
 assert.equal(assessCoachQuestion('运动时胸痛').safety,'EMERGENCY')
 assert.equal(assessCoachQuestion('胫骨应力性骨折后六周能跑吗').safety,'MEDICAL_REVIEW')
})
test('no automatic authorization and specific evidence gaps',()=>{
 for(const q of ['HRV低20%怎么办','400米比赛如何配速','去高原训练多久','我对你的回答有多确定']){
  const r=assessCoachQuestion(q);assert.equal(r.decisionAuthorization,false);assert.equal(r.diagnosis,null);assert.ok(r.nextQuestion);assert.ok(r.evidenceGap!=='NONE')
 }
})
