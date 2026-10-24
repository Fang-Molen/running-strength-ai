import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareAB} from './prepare-chain-ab'
import {context,training,metric} from '../../src/lib/health/analysis-fixtures'
const fixture = {caseId:'A01',context,facts:[training()],provenance:'PUBLIC_SYNTHETIC' as const,frozenVersion:'synthetic-v1'}
test('A/B preparation uses one model and facts, never sends answer keys or makes calls',()=>{const r=prepareAB([fixture],'same-approved-model');assert.equal(r.actualApiCalls,0);assert.equal(r.requests.length,2);assert.equal(r.blocked.length,59);assert.equal(r.requests[0].model,r.requests[1].model);assert.equal(r.requests[0].snapshotId,r.requests[1].snapshotId);assert.doesNotMatch(JSON.stringify(r.requests),/expectedMetrics|sourceRecordId|SYN-A/);assert.equal(r.requests[0].inputTokens,null)})
test('Concept-only cases remain BLOCKED instead of pretending all 60 requests are ready',()=>{const r=prepareAB([],'same-model');assert.equal(r.plannedCalls,0);assert.equal(r.blocked.length,60);assert.equal(r.actualProviderTokens,0)})
test('both arms expose identical source coverage, nulls, units and provenance, plus identical generation settings',()=>{
 const f={...fixture,caseId:'D01',facts:[training({id:'run',sourceRecordId:'run',modality:'RUN',runSegments:[],strengthSets:[]}),metric({id:'missing-hrv',metric:'hrv',value:null,unit:'ms',quality:'NOT_RECORDED'})]}
 const r=prepareAB([f],'same-model'),[a,b]=r.requests
 assert.equal(a.coverageHash,b.coverageHash);assert.deepEqual(a.commonFacts,b.commonFacts)
 assert.ok(JSON.stringify(a.request.context).includes('NOT_RECORDED'));assert.ok(JSON.stringify(a.request.context).includes('null'))
 assert.deepEqual(a.generation,b.generation);assert.equal(a.inputTokens,null);assert.equal(a.requiresCostApproval,true)
 assert.ok(a.inputTokenUpperBound<=8000);assert.ok(b.inputTokenUpperBound<=8000)
})
test('the same missing provenance or oversized packet blocks BOTH arms without trimming',()=>{
 for(const f of [{...fixture,provenance:'REAL' as any},{...fixture,facts:[training({plannedPurpose:'x'.repeat(9000)})]}]){
  const r=prepareAB([f],'same-model');assert.equal(r.requests.length,0)
 }
})
test('future facts never enter either arm',()=>{
 const r=prepareAB([{...fixture,facts:[training(),metric({id:'future',knownAt:'2027-01-01T00:00:00Z',value:987654321})]}],'same-model')
 assert.equal(r.requests.length,2);assert.ok(!JSON.stringify(r.requests).includes('987654321'))
})
test('all thirteen non-local catalogue cases have frozen synthetic bindings; both arms stay within budget',async()=>{
 const {modelFixtures}=await import('./model-fixtures')
 const fixtures=modelFixtures(),r=prepareAB(fixtures,'UNAPPROVED_MODEL_SELECTION_REQUIRED',{routeAware:true})
 assert.equal(fixtures.length,15);assert.equal(r.localOnly.length,47);assert.deepEqual(r.blocked,[]);assert.equal(r.requests.length,26)
 for(let i=0;i<r.requests.length;i+=2){assert.equal(r.requests[i].coverageHash,r.requests[i+1].coverageHash);assert.equal(r.requests[i].model,r.requests[i+1].model);assert.deepEqual(r.requests[i].generation,r.requests[i+1].generation)}
 const future=r.requests.filter(x=>x.caseId==='E06');assert.ok(!JSON.stringify(future).includes('future-result'));assert.ok(!JSON.stringify(future.map(x=>x.providerRequest)).includes('late-correction'))
})
test('evaluator-only metadata in a fixture context cannot leak into either prompt',()=>{
 const r=prepareAB([{...fixture,coachContext:{expected:'DO_NOT_SEND_ANSWER_KEY'}}],'same-model')
 assert.equal(r.requests.length,0);assert.ok(r.blocked.some(x=>x.reason==='EVALUATOR_METADATA_IN_CONTEXT'))
})
