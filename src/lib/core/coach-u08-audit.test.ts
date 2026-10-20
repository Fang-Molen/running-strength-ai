import test from 'node:test'
import assert from 'node:assert/strict'
import { selectCompleteKnowledge } from '../coach/knowledge/complete.ts'
import { auditU08Answer, auditU08Pair, type U08AnswerDraft } from './coach-u08-audit.ts'
import type { C03MetricBrief } from './coach-c03-evidence.ts'
import type { C03ArgumentReview } from './coach-c03-argument.ts'

/** V87 C03-shaped synthetic host fixtures. These tests do not run the C03
 * compiler, nor do they prove a model can write the required structured draft. */
function fixture(values=[30,33]) {
 const brief={version:'FK-APP-C03-1',athleteId:'synthetic',asOf:'2026-10-18T12:00:00Z',
  observedOccurrenceId:'observed',targetOccurrenceId:'future',revisionReceipt:JSON.stringify(values),
  state:'PARTIAL',numbers:[
   {handle:'s0',metric:'SPLIT_SECONDS',value:values[0],unit:'s',kind:'SOURCE',basisIds:['s0'],sourceIds:['synthetic-event:0']},
   {handle:'s1',metric:'SPLIT_SECONDS',value:values[1],unit:'s',kind:'SOURCE',basisIds:['s1'],sourceIds:['synthetic-event:1']},
   {handle:'C03:MEAN',metric:'OBSERVED_SEGMENT_MEAN',value:(values[0]+values[1])/2,unit:'s',kind:'DERIVED',basisIds:['s0','s1'],sourceIds:['synthetic-event:0','synthetic-event:1']},
   {handle:'C03:LAST_FIRST',metric:'LAST_MINUS_FIRST_SECONDS',value:values[1]-values[0],unit:'s',kind:'DERIVED',basisIds:['s0','s1'],sourceIds:['synthetic-event:0','synthetic-event:1']}
  ],groups:[],bindings:[],reasons:[],missing:['WORK_ROLE_UNKNOWN'],r13Status:'READY_FOR_QUALIFIED_COACH_REVIEW',
  planMutationAuthorized:false,medicalClearance:'UNKNOWN',semanticCorrectnessEvaluated:false,didWrite:false,didCallModel:false
 } as unknown as C03MetricBrief
 const review={state:'STRUCTURAL_REVIEW_ONLY',reasons:['NUMERICAL_STRUCTURE_ONLY_PROFESSIONAL_SEMANTICS_NOT_VERIFIED'],
  checkedNumbers:brief.numbers,candidateTable:[{id:'hold',kind:'HOLD',changes:[]},{id:'ask',kind:'ASK_FOR_CONTEXT',changes:[]}],
  selectedOptionId:'hold',semanticCorrectnessEvaluated:false,trainingBenefitProven:false,professionalReviewRequired:true,
  planMutationAuthorized:false,didWrite:false,didCallModel:false} as C03ArgumentReview
 const required=['s0','s1','C03:MEAN','C03:LAST_FIRST']
 const answer:U08AnswerDraft={schema:'FK-U08-ANSWER-1',revisionReceipt:brief.revisionReceipt,selectedOptionId:'hold',
  evidenceUses:brief.numbers.map(n=>({handle:n.handle,value:n.value,unit:n.unit,role:'DECISION'})),
  knowledgeUses:[],missingAcknowledged:[...brief.missing]}
 return {brief,review,answer,required}
}
const audit=(f:ReturnType<typeof fixture>,answer:unknown=f.answer,task:'FACT'|'EXPLAIN'|'COMPARE'='EXPLAIN')=>auditU08Answer(f.brief,f.review,answer,task,f.required)
test('baseline proof uses actual numbers in decision; does not claim semantic correctness or writing',()=>{
 const f=fixture();assert.equal(f.review.state,'STRUCTURAL_REVIEW_ONLY');const r=audit(f)
 assert.equal(r.status,'STRUCTURAL_PASS_SEMANTICS_UNVERIFIED');assert.equal(r.semanticCorrectnessEvaluated,false)
 assert.equal(r.planMutationAuthorized,false);assert.equal(r.didCallModel,false);assert.equal(r.trainingBenefitProven,false)
})
test('numbers only in background do not satisfy decision requirements',()=>{
 const f=fixture();const d={...f.answer,evidenceUses:f.answer.evidenceUses.map(x=>({...x,role:'FACT' as const}))}
 assert.equal(audit(f,d).status,'BLOCKED');assert.ok(audit(f,d).reasons.some(x=>x.startsWith('KEY_NUMBER_NOT_USED_FOR_EXPLAIN')))
})
test('arithmetic FACT task accepts factual citation without forced two causes at U08 layer',()=>{
 const f=fixture();const d={...f.answer,evidenceUses:f.answer.evidenceUses.map(x=>({...x,role:'FACT' as const}))}
 assert.equal(audit(f,d,'FACT').status,'STRUCTURAL_PASS_SEMANTICS_UNVERIFIED')
})
test('foreign value, unit and handle are rejected',()=>{
 const f=fixture();for(const change of [(x:any)=>{x.value=99},(x:any)=>{x.unit='ms'},(x:any)=>{x.handle='foreign'}]){
 const d=structuredClone(f.answer);change(d.evidenceUses[0]);assert.ok(audit(f,d).reasons.includes('STALE_FOREIGN_OR_INVENTED_NUMBER'))
 }
})
test('stale revision and other host option are blocked',()=>{
 const f=fixture();for(const patch of [{revisionReceipt:'old'},{selectedOptionId:'ask'}]){
 const d={...f.answer,...patch};assert.equal(audit(f,d).status,'BLOCKED')
 }
})
test('model cannot add unapproved research citation in production',()=>{
 const f=fixture();const d={...f.answer,knowledgeUses:[{cardId:'R03',version:1,contentSha256:'forged',role:'GENERAL_EXPLANATION'}]}
 assert.ok(audit(f,d).reasons.includes('UNAPPROVED_OR_FOREIGN_KNOWLEDGE'))
})
test('research preview card is never promoted to production',()=>{
 const f=fixture();const k=selectCompleteKnowledge({task:'knowledge',domains:['RUNNING'],mode:'RESEARCH_PREVIEW',cardIds:['R03']})
 const use=k.uses[0];assert.ok(use)
 const d={...f.answer,knowledgeUses:[{cardId:use.cardId,version:use.version,contentSha256:use.contentSha256,role:'GENERAL_EXPLANATION'}]}
 assert.ok(auditU08Answer(f.brief,f.review,d,'EXPLAIN',f.required).reasons.includes('UNAPPROVED_OR_FOREIGN_KNOWLEDGE'))
})
test('even an approved general knowledge citation cannot be a personal prescription',()=>{
 const f=fixture();const d={...f.answer,knowledgeUses:[{cardId:'R03',version:1,contentSha256:'x',role:'PERSONAL_PRESCRIPTION'}]}
 assert.ok(audit(f,d).reasons.includes('GENERAL_KNOWLEDGE_CANNOT_PRESCRIBE'))
})
test('missing known limitations must be acknowledged',()=>{
 const f=fixture();if(!f.brief.missing.length) return
 const d={...f.answer,missingAcknowledged:[]};assert.ok(audit(f,d).reasons.includes('KNOWN_MISSING_NOT_ACKNOWLEDGED'))
})
test('invented missing items cannot replace real missing fields',()=>{
 const f=fixture();const d={...f.answer,missingAcknowledged:['NOT_REAL']}
 assert.ok(audit(f,d).reasons.includes('INVALID_OR_DUPLICATE_MISSING_ACK'))
})
test('schema rejects extra fields (model dose, fake approval) and excessive arrays',()=>{
 const f=fixture();assert.ok(audit(f,{...f.answer,dose:'8x400'}).reasons.includes('ANSWER_SCHEMA'))
 assert.ok(audit(f,{...f.answer,knowledgeUses:Array.from({length:33},()=>({}))}).reasons.includes('ANSWER_ARRAY_BOUNDS'))
})
test('C03 not ready cannot be bypassed by a U08 draft',()=>{
 const f=fixture();const blocked={...f.review,state:'BLOCKED' as const}
 assert.ok(auditU08Answer(f.brief,blocked,f.answer,'EXPLAIN',f.required).reasons.includes('HOST_C03_REVIEW_NOT_READY'))
})
test('host required handles must be present in trusted brief',()=>{
 const f=fixture();assert.ok(auditU08Answer(f.brief,f.review,f.answer,'EXPLAIN',['invented']).reasons.includes('HOST_REQUIRED_HANDLE_NOT_IN_BRIEF'))
})
test('same action HOLD is acceptable after changed time if cited value updates',()=>{
 const a=fixture([30,33]),b=fixture([30,34])
 const r=auditU08Pair({baselineBrief:a.brief,changedBrief:b.brief,baseline:a.answer,changed:b.answer,relevantHandles:['s1']})
 assert.equal(r.state,'STRUCTURAL_CHANGE_OBSERVED');assert.equal(a.answer.selectedOptionId,b.answer.selectedOptionId)
})
test('unchanged generic answer with stale numeric fact fails counterfactual',()=>{
 const a=fixture([30,33]),b=fixture([30,34])
 const r=auditU08Pair({baselineBrief:a.brief,changedBrief:b.brief,baseline:a.answer,changed:{...a.answer,revisionReceipt:b.brief.revisionReceipt},relevantHandles:['s1']})
 assert.equal(r.state,'BLOCKED');assert.ok(r.reasons.some(x=>x.startsWith('PAIR_STALE_OR_WRONG_VALUE')))
})
test('changed relevant fact omitted in counterfactual fails, not counted as model success',()=>{
 const a=fixture([30,33]),b=fixture([30,34])
 const d={...b.answer,evidenceUses:b.answer.evidenceUses.filter(x=>x.handle!=='s1')}
 const r=auditU08Pair({baselineBrief:a.brief,changedBrief:b.brief,baseline:a.answer,changed:d,relevantHandles:['s1']})
 assert.equal(r.state,'BLOCKED');assert.ok(r.reasons.includes('PAIR_CHANGED_FACT_NOT_USED:s1'))
})
test('unchanged irrelevant handle does not require answer change',()=>{
 const a=fixture([30,33]),b=fixture([30,34])
 const r=auditU08Pair({baselineBrief:a.brief,changedBrief:b.brief,baseline:a.answer,changed:b.answer,relevantHandles:['s0']})
 assert.equal(r.state,'NOT_APPLICABLE')
})
test('cross-athlete or cross-occurrence pair cannot be treated as same-case contrast',()=>{
 const a=fixture(),b=fixture([30,34]);const other={...b.brief,athleteId:'other'}
 assert.ok(auditU08Pair({baselineBrief:a.brief,changedBrief:other,baseline:a.answer,changed:b.answer,relevantHandles:['s1']}).reasons.includes('PAIR_SCOPE_INVALID'))
})
test('no fake professional accuracy grade from this test harness',()=>{
 const f=fixture();const r=audit(f)
 assert.equal('professionalScore' in r,false);assert.equal('safeToTrain' in r,false);assert.equal('approvalReceipt' in r,false)
})
test('malformed host obligations and pair handle lists fail closed without throwing',()=>{
 const a=fixture(),b=fixture([30,34])
 assert.equal(auditU08Answer(a.brief,a.review,a.answer,'EXPLAIN',null as never).status,'BLOCKED')
 assert.equal(auditU08Pair({baselineBrief:a.brief,changedBrief:b.brief,baseline:a.answer,changed:b.answer,relevantHandles:null as never}).state,'BLOCKED')
})
