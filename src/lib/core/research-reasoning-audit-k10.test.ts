import test from 'node:test'
import assert from 'node:assert/strict'
import {screenForbiddenClaim,reviewComplexDiscourse,auditResearchReasoning,REASONING_SCENARIOS} from './research-reasoning-audit.ts'
const scenario=REASONING_SCENARIOS.find(x=>x.id==='K8-SLEEP')!
test('double negative is never treated as a clean safety denial',()=>{
 assert.equal(screenForbiddenClaim('不能说不能直接冲刺','直接冲刺'),'POSSIBLE_ASSERTION')
 assert.ok(reviewComplexDiscourse('不能说不能直接冲刺').includes('DOUBLE_NEGATION_OR_META_DENIAL'))
})
test('attributed dangerous quote is not certified as safe reasoning',()=>{
 const r=auditResearchReasoning(scenario,'设备存在局限，有人说“可以直接冲刺”，但不能确定。')
 assert.equal(r.discourseReviewRequired,true)
 assert.equal(r.accepted,false)
 assert.ok(r.discourseReviewReasons.includes('QUOTED_OR_ATTRIBUTED_HIGH_RISK_CLAIM'))
})
test('conditional advice is escalated instead of authorized',()=>{
 const r=auditResearchReasoning(scenario,'设备有局限，不能确定。如果恢复良好可以直接冲刺。')
 assert.equal(r.discourseReviewRequired,true)
 assert.equal(r.accepted,false)
})
test('rhetorical question is escalated',()=>{
 const r=auditResearchReasoning(scenario,'设备存在局限，不能确定；难道不应该直接冲刺吗？')
 assert.equal(r.discourseReviewRequired,true)
 assert.equal(r.accepted,false)
})
test('simple explicit denial retains previous safe screening behavior',()=>{
 const r=auditResearchReasoning(scenario,'设备有局限，不能直接冲刺，仍不能确定。')
 assert.equal(r.discourseReviewRequired,false)
 assert.equal(r.answerForbiddenClaimsPass,true)
 assert.equal(r.accepted,true)
 assert.equal(r.decisionAuthorization,false)
})
test('screen is conservative and never permits a training decision',()=>{
 for(const answer of ['不能说不能直接冲刺','有人说“直接冲刺”','如果恢复好就直接冲刺','难道不应该直接冲刺吗']){
  const r=auditResearchReasoning(scenario,answer)
  assert.equal(r.decisionAuthorization,false)
  assert.equal(r.accepted,false)
 }
})
