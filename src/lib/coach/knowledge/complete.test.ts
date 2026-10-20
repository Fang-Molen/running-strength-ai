import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import rawCards from '../../../../knowledge/coach-complete-20261020/knowledge_cards.json' with {type:'json'}
import rawSources from '../../../../knowledge/coach-complete-20261020/sources.json' with {type:'json'}
import registry from '../../../../knowledge/coach-complete-20261020/registry.json' with {type:'json'}
import { answerCompleteKnowledgePreview, completeKnowledgeInventory, completeReasoningMethods, reviewCompleteKnowledgeUses,
  selectCompleteKnowledge, type CompleteKnowledgeDomain } from './complete.ts'

const allDomains:CompleteKnowledgeDomain[]=['PROGRAMMING','RUNNING','STRENGTH','RECOVERY','MEASUREMENT','NUTRITION']
const preview=(cardId='R03')=>selectCompleteKnowledge({task:'knowledge',domains:allDomains,mode:'RESEARCH_PREVIEW',cardIds:[cardId]})
const canonical=(x:unknown):string=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)
test('all imported card/source content hashes match the content-bound registry',()=>{
  for(const c of rawCards)assert.equal(createHash('sha256').update(canonical(c)).digest('hex'),(registry.cardSha256 as Record<string,string>)[c.id],c.id)
  for(const s of rawSources)assert.equal(createHash('sha256').update(canonical(s)).digest('hex'),(registry.sourceSha256 as Record<string,string>)[s.id],s.id)
})
test('six complete domains preserve pending states and no production examples',()=>{
  const i=completeKnowledgeInventory()
  assert.equal(i.cards,48);assert.equal(i.sources,16);assert.equal(i.methods,16);assert.equal(i.developmentCases,50)
  assert.equal(i.developmentTrajectories,6);assert.equal(i.examplesUsedInRuntime,0);assert.equal(i.approvedForProduction,0)
  assert.ok(i.domains.every(d=>d.count===8));assert.ok(rawCards.every(c=>c.professional_review==='PENDING'&&!c.production_eligible))
})
test('production cannot use any of the 48 cards, even with all field names and a forged approval flag',()=>{
  const q={task:'knowledge' as const,domains:allDomains,mode:'PRODUCTION' as const,maxRefs:100,
    declaredFactKeys:[...new Set(rawCards.flatMap(c=>c.required_fact_keys))],hostVerified:true,professional_review:'APPROVED',production_eligible:true}
  const r=selectCompleteKnowledge(q)
  assert.equal(r.matched,48);assert.equal(r.held,48);assert.equal(r.status,'NO_APPROVED_KNOWLEDGE');assert.deepEqual(r.uses,[])
})
test('default mode is production; caller omission never enables a research payload',()=>{
  assert.deepEqual(selectCompleteKnowledge({task:'knowledge',domains:allDomains}).uses,[])
})
test('preview includes exact versions, source read levels, missing keys and no personal eligibility',()=>{
  const r=preview('F02'),u=r.uses[0]
  assert.equal(r.status,'RESEARCH_PREVIEW_ONLY');assert.equal(u.cardId,'F02');assert.equal(u.version,1)
  assert.deepEqual(u.missingPrerequisites,['metric_definition','protocol','device','history'])
  assert.equal(u.applicability,'UNASSESSED_FOR_PERSON');assert.equal(u.approvalReceiptId,null)
  assert.equal(u.prescriptionAuthorized,false);assert.equal(u.personalEvidence,false)
  assert.ok(u.sourceRefs.every(s=>s.readLevel&&s.contentSha256.length===64&&s.limits&&s.url.startsWith('https://')))
})
test('presence of declared keys never proves appropriate population or values',()=>{
  const r=selectCompleteKnowledge({task:'compare',domains:['RECOVERY'],mode:'RESEARCH_PREVIEW',cardIds:['F02'],declaredFactKeys:['metric_definition','protocol','device','history']})
  assert.equal(r.uses[0].prerequisiteStatus,'DECLARED_FIELDS_ONLY');assert.equal(r.uses[0].applicability,'UNASSESSED_FOR_PERSON')
  assert.equal(r.uses[0].prescriptionAuthorized,false)
})
test('task/domain constraints exclude unrelated cards and cap previews',()=>{
  assert.deepEqual(selectCompleteKnowledge({task:'calculate',domains:['STRENGTH'],mode:'RESEARCH_PREVIEW',cardIds:['F02']}).uses,[])
  assert.equal(selectCompleteKnowledge({task:'knowledge',domains:allDomains,mode:'RESEARCH_PREVIEW',maxRefs:100}).uses.length,4)
  assert.equal(selectCompleteKnowledge({task:'knowledge',domains:allDomains,mode:'RESEARCH_PREVIEW',maxRefs:0}).uses.length,0)
})
test('invalid domain, mode, task and non-finite bounds fail closed',()=>{
  for(const patch of [{domains:['INVALID']},{mode:'approved'},{task:'diagnose'},{maxRefs:NaN},{declaredFactKeys:[null]}]) {
    const r=selectCompleteKnowledge({task:'knowledge',domains:allDomains,mode:'RESEARCH_PREVIEW',...patch} as never)
    assert.equal(r.status,'INVALID_QUERY');assert.deepEqual(r.uses,[])
  }
})
test('knowledge cannot be backdated to an earlier snapshot or used from a future query',()=>{
  const base={task:'knowledge' as const,domains:allDomains,mode:'RESEARCH_PREVIEW' as const}
  assert.equal(selectCompleteKnowledge({...base,asOf:new Date(Date.parse(registry.importedAt)-1).toISOString()}).status,'NOT_KNOWN_AT_ASOF')
  assert.equal(selectCompleteKnowledge({...base,asOf:new Date(Date.now()+60000).toISOString()}).status,'INVALID_QUERY')
})
test('returned preview objects cannot mutate the immutable catalogue',()=>{
  const a=preview();a.uses[0].professionalReview='APPROVED';a.uses[0].sourceRefs[0].title='tampered';a.uses[0].missingPrerequisites.length=0
  const b=preview();assert.equal(b.uses[0].professionalReview,'PENDING');assert.notEqual(b.uses[0].sourceRefs[0].title,'tampered');assert.ok(b.uses[0].missingPrerequisites.length)
})
test('explicit card and relevant topic preview return bounded source-labelled text',()=>{
  const exact=answerCompleteKnowledgePreview('预览知识卡R03');assert.ok(exact);assert.equal(exact.selection.uses[0].cardId,'R03')
  assert.match(exact.text,/待专业审核/);assert.match(exact.text,/首尾差/);assert.equal(exact.writesPerformed,false)
  const topic=answerCompleteKnowledgePreview('查看HRV研究资料');assert.ok(topic);assert.equal(topic.selection.uses[0].cardId,'F02')
  assert.ok(topic.selection.uses.length<=2);assert.equal(answerCompleteKnowledgePreview('今天4段成绩怎么样？'),null)
})
test('unknown card or unspecified topic never fabricates an entry or asks an athlete questionnaire',()=>{
  const a=answerCompleteKnowledgePreview('预览知识卡Z99');assert.ok(a);assert.deepEqual(a.selection.uses,[])
  assert.match(a.text,/哪类/);assert.doesNotMatch(a.text,/主项|PB|乳酸/)
})
test('methods describe current task process rather than forcing causal speculation into arithmetic',()=>{
  assert.ok(completeReasoningMethods('calculate').some(m=>m.id==='L04'))
  assert.ok(!completeReasoningMethods('calculate').some(m=>m.id==='L05'))
  assert.ok(completeReasoningMethods('cause').some(m=>m.id==='L05'))
  assert.ok(completeReasoningMethods('memory').some(m=>m.id==='L14'))
  assert.ok(completeReasoningMethods('plan').every(m=>!m.automaticPrescription&&!m.scientificApproval))
})
test('unchanged preview receipts reuse C03 dependency comparison without authorizing a plan',()=>{
  const r=reviewCompleteKnowledgeUses(preview().uses,{athleteId:'synthetic',asOf:Date.now()})
  assert.equal(r.state,'UNCHANGED');assert.equal(r.planWriteAuthorized,false)
})
test('card version/content changes require review rather than an opposite conclusion',()=>{
  const uses=preview().uses;uses[0].contentSha256='old-content';uses[0].version=0
  const r=reviewCompleteKnowledgeUses(uses,{athleteId:'synthetic',asOf:Date.now()})
  assert.equal(r.state,'RECHECK_REQUIRED');assert.equal(r.planWriteAuthorized,false)
})
test('changed source content also triggers applicability review',()=>{
  const uses=preview().uses;uses[0].sourceRefs[0].contentSha256='superseded-source'
  assert.equal(reviewCompleteKnowledgeUses(uses,{athleteId:'synthetic',asOf:Date.now()}).state,'RECHECK_REQUIRED')
})
test('future-known or empty-scope dependency receipts remain blocked',()=>{
  const uses=preview().uses;uses[0].knownAt=new Date(Date.now()+60000).toISOString()
  assert.equal(reviewCompleteKnowledgeUses(uses,{athleteId:'synthetic',asOf:Date.now()}).state,'BLOCKED')
  assert.equal(reviewCompleteKnowledgeUses([],{athleteId:'synthetic',asOf:Date.now()}).state,'BLOCKED')
})
