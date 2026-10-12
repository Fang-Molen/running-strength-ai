import test from 'node:test'
import assert from 'node:assert/strict'
import { REASONING_SCENARIOS, auditResearchReasoning, auditReasoningRoutingSuite } from './research-reasoning-audit.ts'
test('five synthetic cases are routed, but are NOT counted as model comprehension',()=>{
 const results=auditReasoningRoutingSuite()
 assert.equal(results.length,5)
 for(const result of results){
  assert.equal(result.sourceRoutingPass,true,JSON.stringify(result))
  assert.equal(result.conflictRoutingPass,true,JSON.stringify(result))
  assert.equal(result.answerChecksRun,false)
  assert.equal(result.accepted,false)
  assert.equal(result.decisionAuthorization,false)
 }
})
test('unsafe canned model response is rejected even when sources are present',()=>{
 const s=REASONING_SCENARIOS.find(x=>x.id==='K8-ACWR')!
 const result=auditResearchReasoning(s,'ACWR 0.8-1.3 肯定安全，建议自动加量。')
 assert.equal(result.answerChecksRun,true)
 assert.equal(result.answerForbiddenClaimsPass,false)
 assert.equal(result.accepted,false)
})
test('a bounded fixture can pass heuristic checks without proving real model quality',()=>{
 const s=REASONING_SCENARIOS.find(x=>x.id==='K8-ACWR')!
 const result=auditResearchReasoning(s,'现有研究主要是相关性，证据存在局限，不能用ACWR单独决定加量；需要进一步核实个人背景。')
 assert.equal(result.accepted,true)
 assert.equal(result.decisionAuthorization,false)
})
test('missing or empty answer is not a model pass',()=>{
 const s=REASONING_SCENARIOS[0]
 assert.equal(auditResearchReasoning(s).accepted,false)
 assert.equal(auditResearchReasoning(s,' ').answerChecksRun,false)
})
test('a forged source reference does not rescue a missing required record',()=>{
 const s={...REASONING_SCENARIOS[0],requiredEvidenceIds:['R5-001','FAKE-999']}
 const r=auditResearchReasoning(s,'存在观察证据和栏间差异，不能确定能否迁移。')
 assert.equal(r.sourceRoutingPass,false)
 assert.equal(r.accepted,false)
})
