import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {createDeepSeekLedger,createPgliteTransactionAdapter} from '../../src/lib/coach/deepseek-ledger.server'
import {prepareAB} from './prepare-chain-ab'
import {modelFixtures,PAID_SUBSET,PILOT_CASES} from './model-fixtures'
import * as evaluation from '../../server/coach-deepseek/evaluation-service'

const {createEvaluationStore,createEvaluationService,evaluationSchema,sha}=evaluation
const legacyPairs=prepareAB(modelFixtures(),'deepseek-flash',{caseIds:PAID_SUBSET}).requests
const expandedPairs=legacyPairs.filter(r=>r.caseId!=='E02').map(r=>({...r,maxOutputTokens:8192,generation:{...r.generation,max_tokens:8192},providerRequest:{...r.providerRequest,max_tokens:8192}}))
const runtimeLimits={inputTokens:32768,outputTokens:8192,timeoutMs:180000,responseBytes:1048576}
function approval(expanded=true){
 const campaignId=expanded?'expanded24':'original26',expiresAt=new Date(Date.now()+3600000).toISOString()
 return {ownerId:'synthetic-reviewer',campaignId,manifestHash:sha(expanded?expandedPairs:legacyPairs),rubricHash:'a'.repeat(64),expiresAt,pilotCostMicros:'20000',syntheticOnly:true as const,
  ...(expanded?{runtimeLimits,budgetCampaignId:'original26',plannedCalls:24,pilotCaseIds:['A03']}:{}),
  policy:{enabled:true as const,approvalId:'explicit-expanded-test',approvalExpiresAt:expiresAt,campaignId,phase:'pilot' as const,model:'deepseek-flash',acceptedResponseModels:['deepseek-flash'],modelVersion:'DeepSeek-V4.1-Flash-1017',modelVerified:true as const,samplingVerified:true as const,temperature:.4 as const,jsonObjectModeVerified:true as const,tokenUpperBoundVerified:true as const,tokenOverheadUpperBound:256,reasoningIncludedInCompletionVerified:true as const,usageCacheAccountingVerified:true as const,priceVersion:'official-20261023',pricesVerified:true as const,currency:'USD',inputMicrosPerMillion:300000,cachedInputMicrosPerMillion:6000,outputMicrosPerMillion:1200000,timeoutMs:30000,caps:{campaignCalls:26,pilotCalls:4,campaignCostMicros:'1000000',ownerCalls:26,ownerCostMicros:'1000000',concurrency:1,globalDailyCalls:26,globalDailyCostMicros:'1000000',ownerDailyCalls:26,ownerDailyCostMicros:'1000000',perCallCostMicros:'19661'}}}
}
const request=(sampleId:string)=>new Request('http://localhost/evaluation/dispatch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sampleId})})
const providerReply=(content='raw provider answer',completionTokens=1500,finishReason='stop')=>({model:'deepseek-flash',choices:[{finish_reason:finishReason,message:{role:'assistant',content}}],usage:{prompt_tokens:100,completion_tokens:completionTokens,total_tokens:100+completionTokens,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100}})
async function setup(expanded=true){
 const pg=new PGlite(),db=createPgliteTransactionAdapter(pg)
 await pg.exec(await readFile('migrations/coach/001_deepseek_budget.sql','utf8'));await pg.exec(evaluationSchema)
 const store=createEvaluationStore(db),a=approval(expanded)
 await store.install(a,expanded?expandedPairs:legacyPairs,expanded?['A03']:PILOT_CASES)
 const service=(transport:typeof fetch)=>createEvaluationService({store,db,apiKey:'synthetic-test-only',operatorAuthenticate:async()=>({sub:a.ownerId,scope:'PUBLIC_SYNTHETIC_EVALUATION',campaignId:a.campaignId,manifestHash:a.manifestHash,rubricHash:a.rubricHash}),fetch:transport})
 return {pg,db,store,a,service,samples:await store.samples(a.campaignId)}
}
async function seedPreviousCalls(x:Awaited<ReturnType<typeof setup>>,count=2,cost='150'){
 const ledger=createDeepSeekLedger(x.db)
 for(let i=0;i<count;i++){
  const binding={requestId:'previous-'+i,ownerId:x.a.ownerId,contextHash:'b'.repeat(64),modelHash:'c'.repeat(64),configHash:'d'.repeat(64)}
  await ledger.reserve({...binding,campaignId:'original26',phase:'pilot',day:new Date().toISOString().slice(0,10),worstCostMicros:cost,caps:x.a.policy.caps})
  await ledger.markDispatched(binding);await ledger.settle({...binding,outcome:'SUCCESS',actualCostMicros:cost,usageHash:'e'.repeat(64)})
 }
}

test('legacy limits, fixed reservation and configuration hash remain compatible',async()=>{
 const x=await setup(false)
 try{
  assert.equal(typeof evaluation.resolvedEvaluationLimits,'function')
  assert.deepEqual(evaluation.resolvedEvaluationLimits(x.a),{inputTokens:8000,outputTokens:900,timeoutMs:30000,responseBytes:65536})
  const s=x.samples.find(s=>s.phase==='pilot')!,response=await x.service((async()=>Response.json(providerReply('legacy',100))) as typeof fetch)(request(s.sampleId))
  assert.equal(response.status,200,await response.text())
  const {rows}=await x.pg.query<any>('SELECT worst_micros::text,config_hash,campaign_id FROM coach_model_reservation')
  assert.equal(rows[0].worst_micros,'3480');assert.equal(rows[0].config_hash,sha([x.a.policy,x.a.manifestHash,x.a.rubricHash]));assert.equal(rows[0].campaign_id,'original26')
 }finally{await x.pg.close()}
})

test('expanded reply above 900 tokens and 64 KiB settles once against cumulative parent budgets',async(t)=>{
 const x=await setup()
 try{
  await seedPreviousCalls(x)
  const timeout=t.mock.method(AbortSignal,'timeout'),raw='x'.repeat(70000),pilot=x.samples.filter(s=>s.phase==='pilot');let calls=0
  const service=x.service((async(_url,init)=>{calls++;assert.equal(JSON.parse(init!.body as string).max_tokens,8192);return Response.json(providerReply(raw))}) as typeof fetch)
  assert.equal(pilot.length,2)
  const response=await service(request(pilot[0].sampleId));assert.equal(response.status,200,await response.text())
  assert.equal(timeout.mock.calls[0].arguments[0],180000)
  assert.equal((await service(request(pilot[0].sampleId))).status,409);assert.equal(calls,1)
  const [receipt]=await x.store.receipts(x.a.campaignId);assert.equal(receipt.state,'SETTLED');assert.equal(receipt.rawAnswer,raw);assert.equal(receipt.usage.completionTokens,1500);assert.deepEqual(receipt.transportErrors,[])
  const {rows}=await x.pg.query<any>('SELECT account_key,calls,charged_micros::text FROM coach_model_budget_account ORDER BY account_key')
  assert.equal(rows.length,5);for(const row of rows){assert.equal(row.calls,3);assert.equal(row.charged_micros,'2130')}
  const reservation=await x.pg.query<any>('SELECT campaign_id,worst_micros::text,config_hash FROM coach_model_reservation WHERE request_id=$1',['eval-'+pilot[0].sampleId])
  assert.equal(reservation.rows[0].campaign_id,'original26');assert.notEqual(reservation.rows[0].config_hash,sha([x.a.policy,x.a.manifestHash,x.a.rubricHash]));assert.ok(Number(reservation.rows[0].worst_micros)<19661)
  assert.equal((await service(request(pilot[1].sampleId))).status,200)
  await x.store.reviewPilot(x.a.campaignId,x.a.ownerId,sha(await x.store.receipts(x.a.campaignId)))
  assert.equal((await x.store.campaign(x.a.campaignId))?.reviewed,true)
 }finally{await x.pg.close()}
})

test('expanded pilot rejects insufficient cumulative pilot money before transport',async()=>{
 const x=await setup()
 try{
  await seedPreviousCalls(x,2,'7000');let calls=0
  const service=x.service((async()=>{calls++;return Response.json(providerReply())}) as typeof fetch)
  const response=await service(request(x.samples.find(s=>s.phase==='pilot')!.sampleId))
  assert.equal(response.status,409);assert.equal((await response.json()).error,'MONEY_BUDGET_EXCEEDED');assert.equal(calls,0)
  assert.equal((await x.pg.query<any>('SELECT count(*)::int AS n FROM coach_model_reservation')).rows[0].n,2)
 }finally{await x.pg.close()}
})

test('expanded total call and money limits block new transport while preserving prior usage',async()=>{
 const x=await setup()
 try{
  await seedPreviousCalls(x);let calls=0
  const service=x.service((async()=>{calls++;return Response.json(providerReply())}) as typeof fetch),sample=x.samples.find(s=>s.phase==='pilot')!
  await x.pg.query('UPDATE coach_model_budget_account SET charged_micros=999999 WHERE account_key=$1',[JSON.stringify(['campaign','original26'])])
  let response=await service(request(sample.sampleId));assert.equal(response.status,409);assert.equal((await response.json()).error,'MONEY_BUDGET_EXCEEDED')
  await x.pg.query('UPDATE coach_model_budget_account SET charged_micros=300,calls=26 WHERE account_key=$1',[JSON.stringify(['campaign','original26'])])
  response=await service(request(sample.sampleId));assert.equal(response.status,409);assert.equal((await response.json()).error,'CALL_BUDGET_EXCEEDED');assert.equal(calls,0)
  assert.equal((await x.pg.query<any>('SELECT count(*)::int AS n FROM coach_model_reservation')).rows[0].n,2)
 }finally{await x.pg.close()}
})

test('length completion returns explicit truncation and preserves settled raw receipt after revocation',async()=>{
 const x=await setup()
 try{
  const raw='unfinished JSON {',sample=x.samples.find(s=>s.phase==='pilot')!;let calls=0
  const service=x.service((async()=>{calls++;return Response.json(providerReply(raw,8192,'length'))}) as typeof fetch)
  const response=await service(request(sample.sampleId));assert.equal(response.status,502)
  const body=await response.json();assert.equal(body.state,'SETTLED');assert.ok(body.transportErrors.includes('OUTPUT_TRUNCATED'))
  const [receipt]=await x.store.receipts(x.a.campaignId);assert.equal(receipt.state,'SETTLED');assert.equal(receipt.rawAnswer,raw);assert.equal(receipt.providerResponse.choices[0].finish_reason,'length');assert.ok(receipt.transportErrors.includes('OUTPUT_TRUNCATED'))
  assert.equal((await x.store.campaign(x.a.campaignId))?.revoked,true)
  assert.equal((await x.pg.query<any>('SELECT state FROM coach_model_reservation')).rows[0].state,'SETTLED')
  assert.equal((await service(request(sample.sampleId))).status,403);assert.equal(calls,1)
 }finally{await x.pg.close()}
})

test('expanded limits reject unsafe manifest values and mismatched pairs before install',async()=>{
 const x=await setup()
 try{
  for(const patch of [{runtimeLimits:{...runtimeLimits,timeoutMs:0}},{plannedCalls:26},{pilotCaseIds:['D04']},{runtimeLimits:{...runtimeLimits,inputTokens:1}}]){
   await assert.rejects(x.store.install({...x.a,...patch},expandedPairs,['A03']))
  }
  const changed=structuredClone(expandedPairs);changed[1].coverageHash='f'.repeat(64)
  await assert.rejects(x.store.install({...x.a,manifestHash:sha(changed)},changed,['A03']),/PAIR_MISMATCH/)
 }finally{await x.pg.close()}
})
