/** Control-plane bootstrap. Free GET /models only; never sends a generation POST. */
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {initializeOperator,loadOperator} from '../../server/coach-deepseek/evaluation-operator'
import {sha,type EvaluationApproval} from '../../server/coach-deepseek/evaluation-service'
import {boundedResponseJson} from '../../server/coach-deepseek/lib/coach-provider-boundary'
import {prepareAB} from './prepare-chain-ab'
import {modelFixtures,PAID_SUBSET} from './model-fixtures'
const arg=(flag:string)=>{const i=process.argv.indexOf(flag);if(i<0||!process.argv[i+1])throw Error(flag+' required');return process.argv[i+1]}
const key=process.env.DEEPSEEK_API_KEY;if(!key)throw Error('SERVER_DEEPSEEK_KEY_NOT_ATTACHED')
// Actual free authentication/availability check, not a paid coaching evaluation.
const response=await fetch('https://api.deepseek.com/models',{headers:{authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(15000)})
if(!response.ok)throw Error('FREE_MODEL_LIST_AUTH_HTTP_'+response.status)
const list=await boundedResponseJson(response) as any
if(!Array.isArray(list?.data)||!list.data.some((m:any)=>m.id==='deepseek-flash'))throw Error('APPROVED_MODEL_NOT_AVAILABLE')
if(process.argv.includes('--check-key-only')){console.log(JSON.stringify({freeModelListHTTP:response.status,model:'deepseek-flash',available:true,generationCalls:0}));process.exit(0)}
const state=resolve(arg('--state-dir')),registry=resolve(arg('--registry-dir')),auth=JSON.parse(readFileSync(arg('--authorization'),'utf8'))
if(auth.currency!=='USD'||auth.pilotCallsMax!==4||auth.pilotCostMax!=='0.02'||auth.campaignCallsMax!==26||auth.campaignCostMax!=='0.10'||auth.automaticRetries!==0||auth.pilotIncludedIn26!==true)throw Error('ORIGINAL_AUTHORIZATION_REQUIRED')
if(!process.argv.includes('--confirm-current-price'))throw Error('VERIFY_CURRENT_OFFICIAL_PRICE_BEFORE_INITIALIZING')
const rubricBytes=readFileSync(new URL('./scoring-frozen.json',import.meta.url));if(createHash('sha256').update(rubricBytes).digest('hex')!==readFileSync(new URL('./scoring-frozen.sha256',import.meta.url),'utf8').trim()||createHash('sha256').update(readFileSync(new URL('./cases-60.json',import.meta.url))).digest('hex')!=='09e58ed82559f288e6229e2539bb4a75a96858263c1876da9d92732fb698d393')throw Error('FROZEN_SCORING_OR_CATALOG_CHANGED')
const requests=prepareAB(modelFixtures(),'deepseek-flash',{caseIds:PAID_SUBSET}),rubric=JSON.parse(readFileSync(new URL('./scoring-frozen.json',import.meta.url),'utf8'))
if(requests.blocked.length||requests.requests.length!==26)throw Error('FROZEN_PAIRS_NOT_READY')
let grant
if(process.argv.includes('--resume')){grant=loadOperator(state,registry)}else{
 if(!process.argv.includes('--confirm-first-run'))throw Error('EXPLICIT_FIRST_RUN_ATTESTATION_REQUIRED')
 const evidence=JSON.parse(readFileSync(arg('--history-evidence'),'utf8'))
 grant=initializeOperator(state,registry,{campaignId:'v891016-public26',manifestHash:sha(requests.requests),rubricHash:sha(rubric),expiresAt:new Date(Date.now()+6*3600000).toISOString(),history:evidence})
}
if(grant.manifestHash!==sha(requests.requests)||grant.rubricHash!==sha(rubric))throw Error('REGISTERED_FROZEN_INPUT_CHANGED')
const approval:EvaluationApproval={ownerId:grant.ownerId,campaignId:grant.campaignId,manifestHash:grant.manifestHash,rubricHash:grant.rubricHash,expiresAt:grant.expiresAt,pilotCostMicros:'20000',syntheticOnly:true,policy:{enabled:true,approvalId:'user-authorized-public26-20261023',approvalExpiresAt:grant.expiresAt,campaignId:grant.campaignId,phase:'pilot',model:'deepseek-flash',acceptedResponseModels:['deepseek-flash'],modelVersion:'DeepSeek-V4.1-Flash-1017',modelVerified:true,samplingVerified:true,temperature:.4,jsonObjectModeVerified:true,tokenUpperBoundVerified:true,tokenOverheadUpperBound:256,reasoningIncludedInCompletionVerified:true,usageCacheAccountingVerified:true,priceVersion:'official-20261023-peak',pricesVerified:true,currency:'USD',inputMicrosPerMillion:300000,cachedInputMicrosPerMillion:6000,outputMicrosPerMillion:1200000,timeoutMs:30000,caps:{campaignCalls:26,pilotCalls:4,campaignCostMicros:'100000',ownerCalls:26,ownerCostMicros:'100000',concurrency:1,globalDailyCalls:26,globalDailyCostMicros:'100000',ownerDailyCalls:26,ownerDailyCostMicros:'100000',perCallCostMicros:'3480'}}}
const path=join(state,'approved.json'),body=JSON.stringify(approval,null,2)
if(existsSync(path)){if(readFileSync(path,'utf8')!==body)throw Error('EXISTING_APPROVAL_CONFLICT_DO_NOT_OVERWRITE')}else writeFileSync(path,body,{flag:'wx',mode:0o600})
console.log(JSON.stringify({status:'LOCAL_SYNTHETIC_OPERATOR_PREPARED',freeModelListHTTP:response.status,model:'deepseek-flash',stateDir:state,registryDir:registry,scope:grant.scope,owner:grant.ownerId,historyBasis:grant.history.source,generationCallsByBootstrap:0,budgetsUSD:{pilot:.02,campaign:.10},note:'Serve via authenticated local evaluation service. No App user was created; no provider key or capability is printed.'}))
