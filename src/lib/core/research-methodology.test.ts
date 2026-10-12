import test from 'node:test'
import assert from 'node:assert/strict'
import {retrieveMethodGuidance,buildMethodGuidanceContext,RESEARCH_METHOD_COUNTS} from './research-methodology.ts'
import {buildCurriculumModelContext} from './coach-curriculum.ts'
test('historical methods are not falsely promoted to paper evidence',()=>{
 assert.equal(RESEARCH_METHOD_COUNTS.historicalMethodCandidates,4)
 assert.equal(RESEARCH_METHOD_COUNTS.independentlyReverified,0)
 assert.ok(retrieveMethodGuidance('赛季预测').every(x=>!x.decisionAuthorization&&!x.personalFact&&x.status==='HISTORICAL_AUTHOR_SYNTHESIS_UNVERIFIED'))
})
test('prediction time leakage warning is actually routed into model context',()=>{
 const c=buildCurriculumModelContext('赛季初预测成绩时能否用年底缺赛模式？')
 assert.ok(c.methodology.entries.some(x=>x.id==='R3-M26-TIME'))
 assert.equal(c.methodology.decisionAuthorization,false)
})
test('clinical constraints cannot be overridden by monitoring candidate',()=>{
 const c=buildMethodGuidanceContext('HRV好转但伤后康复还没获准冲刺',2500)
 assert.ok(c.entries.some(x=>x.id==='R3-M1-CONFLICT'))
 assert.ok(c.entries.every(x=>x.decisionAuthorization===false))
})
test('unrelated requests and extreme limits do not leak guidance',()=>{
 assert.equal(retrieveMethodGuidance('翻译一首诗').length,0)
 for(const n of [350,500,900,1400]){
  const c=buildMethodGuidanceContext('赛季预测监测HRV伤后康复更正训练记录',n)
  assert.ok(JSON.stringify(c).length<=n)
 }
})
test('retrieval results cannot mutate catalog',()=>{
 const a=retrieveMethodGuidance('赛季预测')
 Reflect.set(a[0].topics,0,'poisoned')
 assert.notEqual(retrieveMethodGuidance('赛季预测')[0].topics[0],'poisoned')
})
test('model context remains bounded even when curriculum has no matching lesson',()=>{
 for(const q of ['ACWR急慢性负荷比能决定是否安全吗','赛季初预测成绩时能否用年底缺赛模式？']){
  for(const budget of [1000,3000])assert.ok(JSON.stringify(buildCurriculumModelContext(q,budget)).length<=budget)
 }
})
