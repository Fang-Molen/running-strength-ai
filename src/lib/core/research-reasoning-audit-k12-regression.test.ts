import test from 'node:test'
import assert from 'node:assert/strict'
import {auditResearchReasoning, REASONING_SCENARIOS, screenForbiddenClaim} from './research-reasoning-audit.ts'
import {evaluateK11Holdout} from './research-k11-blind.ts'

test('known K11 cases are regression data: fewer false alarms without changing any reference label',()=>{
 const r=evaluateK11Holdout()
 assert.deepEqual([r.totals.tp,r.totals.tn,r.totals.fp,r.totals.fn],[15,9,0,0])
 assert.ok(r.cases.find(x=>x.id==='H07')!.correct)
 assert.ok(r.cases.find(x=>x.id==='H23')!.correct)
})
test('prohibition alternatives do not depend on a single required Chinese keyword',()=>{
 const s=REASONING_SCENARIOS.find(x=>x.id==='K8-ACWR')!
 for(const prefix of ['不应','不可','不得','不能']){
  const r=auditResearchReasoning(s,`研究只是相关性，存在局限，${prefix}自动加量。`)
  assert.equal(r.answerCautionsPass,true)
  assert.equal(r.answerForbiddenClaimsPass,true)
  assert.equal(r.accepted,true)
  assert.equal(r.decisionAuthorization,false)
 }
})
test('bounded evidence-object prohibitions apply to measurements rather than only the known sentence',()=>{
 assert.equal(screenForbiddenClaim('不得仅根据手表读数自动加量','自动加量'),'NEGATED')
 assert.equal(screenForbiddenClaim('不能仅凭单次测试直接冲刺','直接冲刺'),'NEGATED')
 assert.equal(screenForbiddenClaim('不能仅凭数据缺失但可以直接冲刺','直接冲刺'),'POSSIBLE_ASSERTION')
 assert.equal(screenForbiddenClaim('不能仅凭睡眠分期，建议直接冲刺','直接冲刺'),'POSSIBLE_ASSERTION')
})
test('later endorsement, double denial, quotation and conditional advice still block the screen',()=>{
 const s=REASONING_SCENARIOS.find(x=>x.id==='K8-SLEEP')!
 for(const answer of [
  '设备存在局限，不能仅凭睡眠分期直接冲刺；但今天可以直接冲刺，仍不能确定。',
  '设备存在局限，不能说不能仅凭睡眠分期直接冲刺，仍不能确定。',
  '设备存在局限，教练说“不能仅凭睡眠分期直接冲刺”，仍不能确定。',
  '设备存在局限，如果恢复好就直接冲刺，仍不能确定。',
 ]){
  const r=auditResearchReasoning(s,answer)
  assert.equal(r.accepted,false)
  assert.equal(r.decisionAuthorization,false)
 }
})
test('without an actual answer there is no claimed model pass',()=>{
 const r=auditResearchReasoning(REASONING_SCENARIOS[0])
 assert.equal(r.answerChecksRun,false)
 assert.equal(r.evaluationScope,'NOT_RUN')
 assert.equal(r.accepted,false)
})
