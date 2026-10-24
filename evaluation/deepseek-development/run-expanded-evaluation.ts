/** Explicitly authorized continuation: same persistent budget accounts, new protocol receipts. */
import {createServer} from 'node:http'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {createPgliteTransactionAdapter} from '../../src/lib/coach/deepseek-ledger.server'
import {createEvaluationStore,createEvaluationService,sha,type EvaluationApproval} from '../../server/coach-deepseek/evaluation-service'
import {loadOperator,operatorAuthenticator,readOperatorToken} from '../../server/coach-deepseek/evaluation-operator'
import {costMicros} from '../../server/coach-deepseek/lib/coach-request-boundary'
import {prepareAB} from './prepare-chain-ab'
import {modelFixtures,PAID_SUBSET} from './model-fixtures'
import {blindExport} from './blind-export'

const state='/workspace/fk-evaluation/private',registry='/workspace/fk-evaluation/registry'
const output=state+'/expanded-run',parent='v891016-public26',run=parent+'-expanded-v2'
const mode=process.argv[2]
if(!['prepare','pilot','review','evaluation','export'].includes(mode))throw Error('MODE_REQUIRED')
const integerOption=(name:string,fallback:number)=>{const index=process.argv.indexOf(name);if(index<0)return fallback;const value=Number(process.argv[index+1]);if(!Number.isSafeInteger(value)||value<=0)throw Error('INVALID_RUNTIME_OPTION_'+name);return value}
const original=JSON.parse(readFileSync(state+'/approved.json','utf8')) as EvaluationApproval
const grant=loadOperator(state,registry)
if(grant.campaignId!==parent||grant.ownerId!==original.ownerId||!existsSync(state+'/ledger/PG_VERSION'))throw Error('EXISTING_CAMPAIGN_AND_DATABASE_REQUIRED')
mkdirSync(output,{mode:0o700,recursive:true})
const rubric=JSON.parse(readFileSync(new URL('./scoring-frozen.json',import.meta.url),'utf8'))
const caseIds=PAID_SUBSET.filter(id=>id!=='E02')
const path=output+'/approved.json'
const registered=existsSync(path)?JSON.parse(readFileSync(path,'utf8')) as EvaluationApproval:null
const priorLimits=registered?.runtimeLimits
const runtimeLimits={inputTokens:integerOption('--max-input-tokens',priorLimits?.inputTokens??32768),outputTokens:integerOption('--max-output-tokens',priorLimits?.outputTokens??8192),timeoutMs:integerOption('--timeout-ms',priorLimits?.timeoutMs??180000),responseBytes:integerOption('--response-bytes',priorLimits?.responseBytes??1048576)}
const prepared=prepareAB(modelFixtures(),'deepseek-flash',{caseIds,inputTokenLimit:runtimeLimits.inputTokens,outputTokenLimit:runtimeLimits.outputTokens})
if(prepared.blocked.length||prepared.requests.length!==24)throw Error('TWENTY_FOUR_FROZEN_FACT_REQUESTS_REQUIRED')
let approval:EvaluationApproval
if(registered)approval=registered
else{
 if(mode!=='prepare'||!process.argv.includes('--user-authorized-usd-1'))throw Error('EXPLICIT_REVISED_BUDGET_AUTHORIZATION_REQUIRED')
 approval={...original,campaignId:run,manifestHash:sha(prepared.requests),runtimeLimits,budgetCampaignId:parent,plannedCalls:24,pilotCaseIds:['A03'],policy:{...original.policy,campaignId:run,approvalId:'user-authorized-public26-expanded-usd1',caps:{...original.policy.caps,campaignCostMicros:'1000000',ownerCostMicros:'1000000',globalDailyCostMicros:'1000000',ownerDailyCostMicros:'1000000',perCallCostMicros:costMicros(runtimeLimits.inputTokens,runtimeLimits.outputTokens,original.policy)}}}
}
if(approval.budgetCampaignId!==parent||approval.campaignId!==run||approval.manifestHash!==sha(prepared.requests)||approval.rubricHash!==sha(rubric)||sha(approval.runtimeLimits)!==sha(runtimeLimits))throw Error('CONTINUATION_BINDING_MISMATCH')
const pg=new PGlite(state+'/ledger'),db=createPgliteTransactionAdapter(pg),store=createEvaluationStore(db)
let server:ReturnType<typeof createServer>|undefined
async function exportState(){
 const receipts=await store.receipts(run),samples=await store.samples(run)
 const blinded=blindExport(receipts,samples,rubric)
 writeFileSync(output+'/provider-receipts.json',JSON.stringify(receipts,null,2),{mode:0o600})
 writeFileSync(output+'/reviewer-only.json',JSON.stringify(blinded.reviewerSheets,null,2),{mode:0o600})
 writeFileSync(output+'/private-unblinding.json',JSON.stringify(blinded.privateMapping,null,2),{mode:0o600})
 const ledger:Record<string,unknown>={}
 for(const table of ['coach_model_budget_account','coach_model_reservation','coach_model_reservation_account','fk_eval_campaign','fk_eval_sample','fk_eval_receipt'])ledger[table]=(await pg.query('SELECT * FROM '+table)).rows
 writeFileSync(output+'/ledger-export.json',JSON.stringify(ledger,null,2),{mode:0o600})
}
try{
 if(mode==='prepare'){
  const previous=(await pg.query<any>('SELECT * FROM coach_model_reservation WHERE campaign_id=$1',[parent])).rows
  if(previous.some(r=>!['SETTLED','CANCELLED'].includes(r.state)))throw Error('RECONCILE_UNKNOWN_BEFORE_CONTINUATION')
  const accounts=(await pg.query<any>('SELECT * FROM coach_model_budget_account ORDER BY account_key')).rows
  // Validate and persist the new immutable manifest before changing any existing
  // monetary cap. An invalid new protocol must leave original budget caps intact.
  await store.install(approval,prepared.requests,['A03'])
  if(!existsSync(path)){
   if(previous.length!==2||accounts.length!==5||accounts.some(a=>a.calls!==2||a.active!==0||a.blocked||String(a.cap_micros)!=='100000'))throw Error('EXPECTED_SETTLED_PRIOR_TWO_CALLS_REQUIRED')
   writeFileSync(output+'/budget-before.json',JSON.stringify(accounts,null,2),{mode:0o600})
   await pg.exec('BEGIN')
   try{for(const a of accounts)await pg.query('UPDATE coach_model_budget_account SET cap_micros=1000000 WHERE account_key=$1',[a.account_key]);await pg.exec('COMMIT')}catch(e){await pg.exec('ROLLBACK');throw e}
   writeFileSync(path,JSON.stringify(approval,null,2),{flag:'wx',mode:0o600})
   writeFileSync(output+'/authorization.json',JSON.stringify({at:new Date().toISOString(),userAuthorization:'同时提高总预算至 US$1，调用仍最多26次',parentCampaignId:parent,newProtocolRunId:run,priorCalls:2,totalCallsMax:26,totalCostMicros:'1000000',pilotCallsMaxCumulative:4,pilotCostMicrosCumulative:'20000',automaticRetries:0,oldRecordsPreserved:true,omittedCase:'E02',omissionReason:'24 calls remain; repeat A03 under equal expanded parameters and retain the safety F03 case. No comparison of legacy and expanded arms.'},null,2),{flag:'wx',mode:0o600})
  }
  await store.install(approval,prepared.requests,['A03'])
  const samples=await store.samples(run)
  writeFileSync(output+'/dispatch-order.json',JSON.stringify(samples.map(({sampleId,caseId,arm,phase})=>({sampleId,caseId,arm,phase})),null,2),{mode:0o600})
  console.log(JSON.stringify({status:'PREPARED_WITH_PRIOR_LEDGER',priorCalls:2,newCallsMax:24,totalCallsMax:26,totalBudgetUSD:1,...runtimeLimits,generationCalls:0}))
 }else if(mode==='export'){await exportState()}
 else if(mode==='review'){
  const receipts=(await store.receipts(run)).filter(r=>r.phase==='pilot')
  if(receipts.length!==2||receipts.some(r=>r.state!=='SETTLED'||r.transportErrors.length))throw Error('PILOT_NOT_READY')
  for(const r of receipts)JSON.parse(r.rawAnswer)
  await store.reviewPilot(run,approval.ownerId,sha(receipts))
  console.log(JSON.stringify({status:'EXPANDED_PILOT_TECHNICAL_REVIEW_RECORDED',scientificExpertReview:'NOT_REVIEWED',calls:2}))
 }else{
  if(!process.env.DEEPSEEK_API_KEY)throw Error('SERVER_PROVIDER_KEY_MISSING')
  const authenticate=operatorAuthenticator(state,registry)
  const operatorAuthenticate=async(request:Request)=>{const identity=await authenticate(request);return identity?.sub===approval.ownerId&&identity.campaignId===parent?{...identity,campaignId:run,manifestHash:approval.manifestHash,rubricHash:approval.rubricHash}:null}
  const service=createEvaluationService({store,db,operatorAuthenticate,apiKey:process.env.DEEPSEEK_API_KEY})
  server=createServer(async(req,res)=>{
   if(req.method!=='POST'||req.url!=='/evaluation/dispatch'){res.writeHead(404);res.end();return}
   const parts:Buffer[]=[];let size=0
   for await(const part of req){size+=part.length;if(size>1024){res.writeHead(413);res.end();return}parts.push(part)}
   try{const result=await service(new Request('http://127.0.0.1:8795/evaluation/dispatch',{method:'POST',headers:{authorization:String(req.headers.authorization??''),'content-type':'application/json'},body:Buffer.concat(parts)}));res.writeHead(result.status,{'content-type':'application/json'});res.end(await result.text())}catch{res.writeHead(500);res.end('{"error":"SERVER_ERROR"}')}
  })
  server.requestTimeout=runtimeLimits.timeoutMs+15000
  await new Promise<void>(resolve=>server!.listen(8795,'127.0.0.1',resolve))
  const token=readOperatorToken(state),samples=(await store.samples(run)).filter(s=>s.phase===mode)
  const existing=new Set((await store.receipts(run)).map(r=>r.sampleId))
  if(samples.some(s=>existing.has(s.sampleId)))throw Error('PHASE_ALREADY_DISPATCHED_NO_AUTOMATIC_RETRY')
  const cases=[...new Set(samples.map(s=>s.caseId))]
  const queue=cases.flatMap((id,i)=>samples.filter(s=>s.caseId===id).sort((a,b)=>i%2?b.arm.localeCompare(a.arm):a.arm.localeCompare(b.arm)))
  const progress:any[]=[]
  for(const sample of queue){
   const startedAt=new Date().toISOString()
   try{
    const response=await fetch('http://127.0.0.1:8795/evaluation/dispatch',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({sampleId:sample.sampleId}),signal:AbortSignal.timeout(runtimeLimits.timeoutMs+10000),redirect:'error'})
    const result=await response.json()
    progress.push({sampleId:sample.sampleId,caseId:sample.caseId,arm:sample.arm,startedAt,endedAt:new Date().toISOString(),httpStatus:response.status,result})
    writeFileSync(output+'/'+mode+'-dispatch.json',JSON.stringify(progress,null,2),{mode:0o600})
    console.log(JSON.stringify({phase:mode,caseId:sample.caseId,arm:sample.arm,status:response.status,completed:progress.length,total:queue.length}))
    if(!response.ok){process.exitCode=1;break}
   }catch{
    progress.push({sampleId:sample.sampleId,caseId:sample.caseId,arm:sample.arm,startedAt,endedAt:new Date().toISOString(),error:'CLIENT_TRANSPORT_UNKNOWN',automaticRetries:0})
    writeFileSync(output+'/'+mode+'-dispatch.json',JSON.stringify(progress,null,2),{mode:0o600});process.exitCode=1;break
   }
  }
  await exportState()
 }
}finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await pg.close()}
