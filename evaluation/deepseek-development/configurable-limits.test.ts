import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {modelFixtures,PAID_SUBSET} from './model-fixtures'
import {prepareAB} from './prepare-chain-ab'

const model='deepseek-flash'
const legacy=()=>prepareAB(modelFixtures(),model,{caseIds:PAID_SUBSET})
const manifestHash=(requests:unknown)=>createHash('sha256').update(JSON.stringify(requests)).digest('hex')

test('default token limits preserve the frozen 26-request manifest exactly',()=>{
 const result=legacy()
 assert.equal(result.requests.length,26)
 assert.deepEqual(result.blocked,[])
 assert.equal(manifestHash(result.requests),'e66259ee2ffc3f179d0619950f6fa13fcad02b2d12675ec27094170f502f456b')
 assert.deepEqual(prepareAB(modelFixtures(),model,{caseIds:PAID_SUBSET,inputTokenLimit:8000,outputTokenLimit:900}),result)
})

test('expanded limits change only output caps and keep both arms comparable',()=>{
 const original=legacy(),expanded=prepareAB(modelFixtures(),model,{caseIds:PAID_SUBSET,inputTokenLimit:32768,outputTokenLimit:8192})
 assert.equal(expanded.requests.length,26)
 assert.deepEqual(expanded.blocked,[])
 for(let i=0;i<expanded.requests.length;i++){
  const request=expanded.requests[i],before=original.requests[i]
  assert.equal(request.maxOutputTokens,8192)
  assert.equal(request.generation.max_tokens,8192)
  assert.equal(request.providerRequest.max_tokens,8192)
  assert.ok(request.inputTokenUpperBound<=32768)
  assert.equal(request.retries,0)
  assert.equal(request.generation.retries,0)
  assert.deepEqual(request.commonFacts,before.commonFacts)
  assert.deepEqual({...request,maxOutputTokens:900,generation:{...request.generation,max_tokens:900},providerRequest:{...request.providerRequest,max_tokens:900}},before)
  if(i%2===0){
   const paired=expanded.requests[i+1]
   assert.deepEqual(request.generation,paired.generation)
   assert.equal(request.coverageHash,paired.coverageHash)
   assert.deepEqual(request.commonFacts,paired.commonFacts)
  }
 }
})

test('input limit blocks the whole pair without trimming and accepts the exact bound',()=>{
 const fixtures=modelFixtures(),pair=prepareAB(fixtures,model,{caseIds:['A03']}).requests
 const cap=pair[1].inputTokenUpperBound-1
 assert.ok(pair[0].inputTokenUpperBound<=cap)
 const blocked=prepareAB(fixtures,model,{caseIds:['A03'],inputTokenLimit:cap})
 assert.equal(blocked.requests.length,0)
 assert.deepEqual(blocked.blocked,[{caseId:'A03',reason:`PAIRED_CONTEXT_CAP_${cap}_NO_TRIMMING`,inputUpperBounds:pair.map(x=>x.inputTokenUpperBound)}])
 assert.deepEqual(prepareAB(fixtures,model,{caseIds:['A03'],inputTokenLimit:pair[1].inputTokenUpperBound}).requests,pair)
 const oversized=fixtures.map(f=>f.caseId==='A03'?{...f,coachContext:{...f.coachContext,padding:'x'.repeat(12000)}}:f)
 const defaultBlocked=prepareAB(oversized,model,{caseIds:['A03']})
 assert.equal(defaultBlocked.requests.length,0)
 assert.equal(defaultBlocked.blocked[0].reason,'PAIRED_CONTEXT_CAP_8000_NO_TRIMMING')
 const expanded=prepareAB(oversized,model,{caseIds:['A03'],inputTokenLimit:32768,outputTokenLimit:8192})
 assert.equal(expanded.requests.length,2)
 assert.deepEqual(expanded.blocked,[])
 assert.equal(expanded.requests[0].commonFacts.coachContext.padding,'x'.repeat(12000))
})

test('both token limits require positive safe integers',()=>{
 for(const key of ['inputTokenLimit','outputTokenLimit'] as const){
  for(const value of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,null,'8192',true]){
   assert.throws(()=>prepareAB(modelFixtures(),model,{caseIds:PAID_SUBSET,[key]:value} as any),new RegExp(key==='inputTokenLimit'?'INVALID_AB_INPUT_TOKEN_LIMIT':'INVALID_AB_OUTPUT_TOKEN_LIMIT'))
  }
 }
})
