import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createPgliteTransactionAdapter} from '../../src/lib/coach/deepseek-ledger.server';
import {createCoachServices} from '../../server/coach-deepseek/coach-services.server';
import {handleCoachHttpRequest} from '../../server/coach-deepseek/coach-http.server';
import {selectOnlineContext} from '../../src/lib/coach/online-context';
import {projectAnalysisEvidence} from '../../src/lib/health/analysis-evidence';
import {buildLoadSummary} from '../../src/lib/health/load-evidence';
import {training,set} from '../../src/lib/health/analysis-fixtures';
const base='verification/new-questions-20261029',out='work/campaign',args=process.argv.slice(2),paid=args.includes('--paid');
const start=Number(args[args.indexOf('--start')+1]||0), count=Number(args[args.indexOf('--count')+1]||2);
const schedule=JSON.parse(readFileSync(base+'/dispatch-order.json','utf8')).schedule;
const asOf='2026-10-29T12:00:00.000Z',now=Date.parse(asOf)+1000;
const hash=(x:any)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const rows=(name:string)=>readFileSync(base+'/input-package/'+name,'utf8').trim().split('\n').map(x=>JSON.parse(x));
const db=new PGlite();
for(const f of ['001_deepseek_budget.sql','002_coach_snapshots.sql','003_persistent_online.sql'])await db.exec(readFileSync('migrations/coach/'+f,'utf8'));
await db.exec('CREATE TABLE synthetic_test_facts(owner text,id text,revision int,raw jsonb, PRIMARY KEY(owner,id))');
const history=rows('03_合成历史_245条.jsonl');
for(const r of history)await db.query('INSERT INTO synthetic_test_facts VALUES($1,$2,$3,$4)',[r.athlete,r.id,r.revision,JSON.stringify(r)]);
const owned=(await db.query("SELECT raw FROM synthetic_test_facts WHERE owner='SYN-A' ORDER BY id")).rows.map((r:any)=>r.raw);
if(owned.length!==244||owned.some((r:any)=>r.athlete!=='SYN-A'))throw Error('OWNER_IMPORT_FAILED');
writeFileSync(out+'/import-receipt.json',JSON.stringify({synthetic:true,rows:245,owners:{'SYN-A':244,'SYN-B':1},duplicates:0,readOwner:'SYN-A',readRows:owned.length,timeZone:'Asia/Shanghai',asOf,sourceHash:hash(history),mapping:'Original rows retained in isolated in-memory PGlite. Training -> AnalysisFact with original IDs/revision, 08:00 local occurrence, duration/distance converted to SI. No invented session RPE; no pain severity inferred.'},null,2));
function fact(r:any){
 const t=r.day+'T00:00:00.000Z',common={id:r.id,athleteId:r.athlete,sourceRecordId:r.id,revision:r.revision,occurredAt:t,knownAt:t,receivedAt:t,sourceTimeZone:'Asia/Shanghai'};
 if(r.kind==='feedback')return {...training(common),kind:'RESPONSE',relatedTrainingRefs:[],region:'CALF',side:'RIGHT',measure:'PAIN',value:null,scale:'UNKNOWN',observationProtocol:null,elapsedHours:null,functionTaskId:null,notes:r.note+'；睡眠'+r.sleep};
 return training({...common,canonicalActivityId:r.id,occurrenceId:r.id,componentId:r.id,modality:r.kind==='strength'?'STRENGTH':'RUN',startedAt:t,endedAt:r.minutes?new Date(Date.parse(t)+r.minutes*60000).toISOString():null,actualDurationSeconds:r.minutes?r.minutes*60:null,sessionRpe:r.rpe??null,sessionRpeScale:r.rpe!=null?'CR10':null,strengthSets:r.kind==='strength'?Array.from({length:r.sets},(_,i)=>set({id:r.id+'-s'+i,catalogId:'squat',loadKg:r.load_kg,reps:r.reps,loadBasis:'UNKNOWN',side:'UNSPECIFIED',catalogVersion:null})):[],runSegments:r.distance_km?[{id:r.id+'-run',blockId:r.id,roundIndex:null,stepIndex:1,kind:'CONTINUOUS',distanceM:r.distance_km*1000,durationSeconds:r.minutes*60,completion:'COMPLETED',restAfterSeconds:null,rawResolutionSeconds:null,gradePercent:null,surface:null}]:[]});
}
const facts=owned.map(fact);
for(const r of owned.filter((r:any)=>r.kind==='run'))facts.push({...fact({...r,kind:'feedback',sleep:'未记录'}),id:r.id+'-feedback',sourceRecordId:r.id,measure:'SORENESS',side:'UNSPECIFIED',notes:r.note} as any);
const policy:any={enabled:true,approvalId:'user-new-questions-20261029',approvalExpiresAt:new Date(Math.max(Date.now(),now)+86400000).toISOString(),campaignId:'new-questions-20261029',phase:'evaluation',model:paid?'deepseek-flash':'synthetic-model',acceptedResponseModels:paid?['deepseek-flash']:['synthetic-model'],modelVersion:paid?'alias-model-list-20261029':'fake',modelVerified:true,samplingVerified:true,temperature:.4,jsonObjectModeVerified:true,tokenUpperBoundVerified:true,tokenOverheadUpperBound:256,reasoningIncludedInCompletionVerified:true,usageCacheAccountingVerified:true,priceVersion:'estimate-only-handoff-20261023',pricesVerified:true,currency:'USD',inputMicrosPerMillion:300000,cachedInputMicrosPerMillion:6000,outputMicrosPerMillion:1200000,timeoutMs:29000,caps:{campaignCalls:40,pilotCalls:3,campaignCostMicros:'200000',ownerCalls:40,ownerCostMicros:'200000',concurrency:1,globalDailyCalls:40,globalDailyCostMicros:'200000',ownerDailyCalls:40,ownerDailyCostMicros:'200000',perCallCostMicros:'20000'}};
let active:any,provider:any=null,payload:any=null;
const callLog=out+'/calls.jsonl',resultLog=out+(paid?'/results.jsonl':'/offline.jsonl');
const existing=existsSync(callLog)?readFileSync(callLog,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
let totalCalls=existing.length,totalTokens=existing.reduce((s,r)=>s+(r.reply?.usage?.total_tokens||0),0);
function dispatchReal(){
 if(totalCalls>=40||totalTokens>=300000)throw Error('CAMPAIGN_STOP_CAP');
 const requestId=active.path_id+'-'+active.turn;
 if(existing.some(r=>r.requestId===requestId))throw Error('NO_DUPLICATE_PAID_CALL');
 totalCalls++;const started=Date.now();
 appendFileSync(out+'/dispatches.jsonl',JSON.stringify({requestId,startedAt:new Date().toISOString(),payload,payloadHash:hash(payload)})+'\n');
 const r=spawnSync('python3',[out+'/provider.py'],{input:JSON.stringify(payload),encoding:'utf8',timeout:28000,maxBuffer:2*1024*1024});
 try{provider=JSON.parse(r.stdout)}catch{provider={transport_error:'NO_JSON',status:r.status}}
 appendFileSync(callLog,JSON.stringify({requestId,reply:provider,latencyMs:Date.now()-started,exitCode:r.status})+'\n');
 totalTokens+=provider.usage?.total_tokens??0;
 console.log(JSON.stringify({event:'provider',requestId,totalCalls,totalTokens,usage:provider.usage??null}));
 if(r.status!==0||!provider.usage)throw Error('PROVIDER_UNKNOWN_STOP');
 return Response.json(provider);
}
const runtime=createCoachServices({db:createPgliteTransactionAdapter(db),authenticate:async()=> 'synthetic-campaign-owner',policy:()=>policy,now:()=>now,fetch:async(_url,init)=>{
 payload=JSON.parse(String(init?.body));
 if(active.mode==='ALL_HISTORY'){const wire=JSON.parse(payload.messages[1].content);wire.facts=owned.map((r:any,i:number)=>({id:'history-'+i,kind:'FACT',detail:JSON.stringify(r)}));wire.coverage={selected:244,omitted:0,unknowns:['记录完整性未确认；缺失不补零；全量历史为测试适配器对照，不是旧版实测']};payload.messages[1].content=JSON.stringify(wire);if(Buffer.byteLength(JSON.stringify(payload))>100000)throw Error('TEST_BASELINE_INPUT_CAP');}

 if(JSON.stringify(payload).includes('OTHER-1')||JSON.stringify(payload).includes('发烧')&&active.kind==='ISOLATED_STORED_HISTORY')throw Error('FOREIGN_FACT');
 if(!paid||active.mode==='ALL_HISTORY'){provider={model:'synthetic-model',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({mode:'answer',text:'一般训练解释须结合记录与缺失信息核对。',nextStep:null,citations:[],evidenceQuotes:[],medicalReferral:false,compareIds:null,seriesIds:null,planChanged:false})}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100}};return Response.json(provider)}
 return dispatchReal();
}});
const env:any={FANGKUN_DEEPSEEK_ENABLED:'true',DEEPSEEK_API_KEY:paid?process.env.DEEPSEEK_API_KEY:'SYNTHETIC',DATABASE_URL:'SYNTHETIC_NOT_OPENED',BETTER_AUTH_SECRET:'SYNTHETIC',VITE_AUTH_ENABLED:'true',FANGKUN_COACH_SCHEMA_READY:'true',FANGKUN_COACH_LEDGER_RECONCILED:'true',FANGKUN_DEEPSEEK_POLICY_JSON:JSON.stringify(policy)};
const invoke=async(path:string,body:any)=>{const r=await handleCoachHttpRequest(new Request('https://coach.test/api/'+path,{method:'POST',headers:{'content-type':'application/json',origin:'https://coach.test'},body:JSON.stringify(body)}),{env,runtime});return {http:r.status,body:await r.json()}};
const conversations=new Map<string,any[]>();
if(paid&&existsSync(resultLog))for(const r of readFileSync(resultLog,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x))){const list=conversations.get(r.path_id)??[];list.push({role:'user',text:r.question},{role:'coach',text:r.result?.body?.text??''});conversations.set(r.path_id,list)}
for(let i=start;i<Math.min(start+count,schedule.length);i++){
 active=schedule[i];payload=null;provider=null;const began=Date.now();
 const historyMode=active.kind==='ISOLATED_STORED_HISTORY',conversation=conversations.get(active.path_id)??[];
 const summary=historyMode?buildLoadSummary(projectAnalysisEvidence({context:{athleteId:'SYN-A',asOf,timeZone:'Asia/Shanghai',planVersion:null,consentVersion:'synthetic',analysisVersion:'test'},facts:facts as any}),active.case_id==='T01'?'2025-01-01':'2026-10-25',active.case_id==='T01'?'2025-12-31':'2026-10-29'):undefined;
 const selected=selectOnlineContext({owner:'SYN-A',question:active.question,day:'2026-10-29',asOf,timeZone:'Asia/Shanghai',facts:historyMode?facts as any:[],loadSummary:summary,conversation,unknowns:historyMode?['完整性未确认；训练与睡眠存在未记录字段。']:[]});
 const created=await invoke('coach-snapshot',{question:active.question,declarations:[],context:selected.context,consent:{purpose:'coach_explanation',disclosureVersion:'coach-self-report-v1',mode:'PERSISTENT'}});
 let result=created.http===200?await invoke('coach-chat',{question:active.question,requestId:'campaign-'+active.path_id+'-'+active.turn,...created.body.snapshotRef}):created;
 if(active.mode==='ALL_HISTORY'&&paid&&payload){dispatchReal();const choice=provider?.choices?.[0];let decoded:any=null;try{decoded=JSON.parse(choice?.message?.content??'')}catch{}result={http:200,body:{ok:choice?.finish_reason==='stop'&&!!decoded,text:decoded?.text??'',error:choice?.finish_reason==='stop'&&decoded?null:'BASELINE_INCOMPLETE_OUTPUT',validation:'TEST_MODE_PROVIDER_ONLY_NOT_APP_VALIDATED',finishReason:choice?.finish_reason}};}
 const record={...active,paid,transport:active.mode==='ALL_HISTORY'?'TEST_MODE_FULL_HISTORY_TRANSPORT_EXTENSION_NOT_OLD_APP':'IN_PROCESS_REAL_HTTP_CONTROLLER_NO_BROWSER',sourceVersion:selected.sourceVersion,context:selected.context,selectedFacts:selected.selectedFacts.map((f:any)=>f.id),payloadHash:payload?hash(payload):null,result,providerUsage:paid?provider?.usage??null:null,latencyMs:Date.now()-began};
 appendFileSync(resultLog,JSON.stringify(record)+'\n');
 conversation.push({role:'user',text:active.question},{role:'coach',text:result.body.text??''});conversations.set(active.path_id,conversation);
 console.log(JSON.stringify({index:i,path:active.path_id,http:result.http,error:result.body.error??null,dispatched:!!provider,paid,totalCalls,totalTokens}));
 if(paid&&provider&&!provider.usage)break;
}
await db.close();
