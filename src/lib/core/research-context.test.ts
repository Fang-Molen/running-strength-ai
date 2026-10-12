import test from 'node:test'
import assert from 'node:assert/strict'
import { retrieveResearchContext,buildResearchModelContext,RESEARCH_HISTORICAL_COUNTS } from './research-context.ts'
import { buildCurriculumModelContext } from './coach-curriculum.ts'
test('historical ledger is imported without claiming independent reverification',()=>{
 assert.equal(RESEARCH_HISTORICAL_COUNTS.r4r7,29)
 assert.equal(RESEARCH_HISTORICAL_COUNTS.independentlyReverifiedInImport,0)
})
test('hurdles retrieval is scoped and never grants prescription permission',()=>{
 const items=retrieveResearchContext('女子400米栏后半程掉速')
 assert.ok(items.some(x=>x.id==='R5-001'))
 assert.ok(items.every(x=>!x.decisionAuthorization&&!x.personalFact&&!x.verificationIndependentThisRun))
 assert.equal(retrieveResearchContext('翻译一首诗').length,0)
})
test('ACWR review and critique travel together',()=>{
 const ids=retrieveResearchContext('ACWR 0.8-1.3安全吗').map(x=>x.id)
 assert.deepEqual(ids,['R7-004','R7-005'])
})
test('actual model context includes only bounded research candidates',()=>{
 const context=buildCurriculumModelContext('ACWR急慢性负荷比能决定是否安全吗')
 assert.equal(context.researchEvidence.status,'RESEARCH_REFERENCE_ONLY')
 assert.equal(context.researchEvidence.entries.length,2)
 assert.ok(context.researchEvidence.entries.every(x=>!x.decisionAuthorization))
 assert.equal(buildCurriculumModelContext('无关文字').researchEvidence.entries.length,0)
})
test('research context caps length and does not include personal data',()=>{
 const x=buildResearchModelContext('RED-S和低能量可用性',650)
 assert.ok(JSON.stringify(x).length<=650)
 assert.equal(x.personalFact,false)
 assert.equal(x.decisionAuthorization,false)
})
