/** Public synthetic injection suite only. Does not read reviewer/rubrics or call
 * a supplier. Narrative contexts are mapped explicitly and logged; this adapter
 * is not a production importer, independent expert review or live generation. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {createHash} from 'node:crypto';import {mock} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {createPgliteTransactionAdapter} from '../../src/lib/coach/deepseek-ledger.server';
import {createCoachServices} from '../../server/coach-deepseek/coach-services.server';
import {handleCoachHttpRequest} from '../../server/coach-deepseek/coach-http.server';
import {contextModelQuote,type CoachContextRecord,type CoachRequestContext} from '../../src/lib/coach/online-contract';
import {questionEvidence,supportedEvidenceQuote} from '../../src/lib/coach/question-evidence';
const out='verification/validation-gates-v1-20261029',cases=readFileSync(out+'/input-package/candidate/cases.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l));
const candidateCommit=readFileSync('.git/HEAD','utf8').trim().replace(/^ref: (.+)$/,(_m,ref)=>readFileSync('.git/'+ref,'utf8').trim());
const sha=(v:any)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');const now=Date.parse('2026-10-29T12:00:01Z');mock.timers.enable({apis:['Date'],now});
const make=(id:string,category:CoachContextRecord['category'],fields:CoachContextRecord['fields'],state:CoachContextRecord['state']='ACTUAL'):CoachContextRecord=>({recordId:id,revision:'1',occurredAt:null,knownAt:'2026-10-29T12:00:00Z',category,state,source:'USER_DECLARED:SYNTHETIC_TEST',fields});
const field=(name:string,value:string|number|boolean|null,unit:string|null=null)=>({name,value,unit});
const summary=(text:string,id='scenario')=>make(id,'ANALYSIS',[field('summary',text)],'UNKNOWN');
const run=(label:string,km:number,minutes:number)=>make('run-'+sha(label).slice(0,16),'TRAINING',[field('modality','RUN'),field('comparisonLabel',label),field('knownDistance',km*1000,'m'),field('knownWorkTime',minutes*60,'s'),field('paceSecondsPerKm',minutes*60/km,'s/km'),field('distanceComplete',true)]);
const dialogue=(id:string,text:string)=>make(id,'DIALOGUE',[field('speaker','user'),field('text',text),field('factAuthority','NONE')],'UNKNOWN');
function mapping(c:any):CoachContextRecord[]{
 // Explicit test data construction, not production branches or evaluator answers.
 if(c.case_id==='G031')return [run('所选甲',4,20),run('所选乙',5,25)].map((r,i)=>({...r,fields:[...r.fields,field('subjectRole','SELF'),field('activityLineage','selected-'+i)]}));
 if(c.case_id==='G041'||c.case_id==='G042')return ['Garmin','another-platform'].map((source,i)=>make('same-activity-'+i,'TRAINING',[field('modality','RUN'),field('knownDistance',6010,'m'),field('distanceComplete',true),field('activityLineage','synthetic-activity-one'),field('subjectRole','SELF'),field('timerSeconds',1611.94,'s'),field('elapsedSeconds',3223.87,'s'),field('sourceLabel',source)]));
 if(c.case_id==='G001')return [run('昨天',5,25),run('今天',5,24),make('tomorrow','PLAN',[field('title','明天轻松跑'),field('plannedMinutes',30,'min')],'PLANNED')];
 if(c.case_id==='G002')return [make('tomorrow','PLAN',[field('title','明天轻松跑'),field('plannedMinutes',30,'min')],'PLANNED')];
 if(c.case_id==='G009'||c.case_id==='G035'||c.case_id==='G040')return [make('current-feedback','RECOVERY',[field('measure','PAIN'),field('notes','本人当前小腿酸痛；原因未知')])];
 if(c.case_id==='G010')return [make('declared-limit','RESTRICTION',[field('restriction','用户转述：医生限制冲刺到周五；今天周三，无解除记录')],'UNKNOWN')];
 if(c.case_id==='G011')return [run('甲',5,25),run('乙',5,25)];
 if(c.case_id==='G012')return [run('甲',5,24.99),run('乙',5,25)];
 if(c.case_id==='G013')return [dialogue('turn-1','我完成4组，每组200米，成绩是30、31、32、33秒。'),dialogue('turn-2','第2组实际是29秒，其他不变，请更新。')];
 if(c.case_id==='G017')return [summary('本人昨天已记录跑步5公里；朋友与今天的记录不在本轮所选范围。')];
 if(c.case_id==='G018')return [['本人',5],['朋友',10]].map(([label,km],i)=>make('distance-'+i,'TRAINING',[field('modality','RUN'),field('comparisonLabel',label),field('knownDistance',Number(km)*1000,'m'),field('distanceComplete',true)]));
 if(c.case_id==='G019')return [{...summary('本轮有效记录用时29秒；修订2取代修订1。'),revision:'2'}];
 if(c.case_id==='G020')return [summary('回放当轮仅修订1可用，用时30秒；后续修订不进入本轮上下文。')];
 if(c.case_id==='G025')return [summary('前提A、行动B与停止条件C属于同一依赖组；适用性未专业审核。')];
 if(c.case_id==='G026')return [summary('解除状态未知，没有解除记录。')];
 if(c.case_id==='G032')return Array.from({length:3},(_,i)=>summary('这是一条合成证据，仅用于重复和长度测试，不包含个体处方。'.repeat(2),'length-'+i));
 if(c.case_id==='G044')return [make('sleep','RECOVERY',[field('metric','SLEEP'),field('value',null,'h'),field('summary','睡眠没有同步，时长未知；缺失不是零。')])];
 if(c.case_id==='G047')return [run('第一次',4,20),run('第二次',4,18)];
 return [summary(c.context)];
}
const db=new PGlite();for(const f of ['001_deepseek_budget.sql','002_coach_snapshots.sql','003_persistent_online.sql'])await db.exec(readFileSync('migrations/coach/'+f,'utf8'));
const policy:any={enabled:true,approvalId:'OFFLINE_SYNTHETIC_NO_API',approvalExpiresAt:'2026-10-30T12:00:00Z',campaignId:'validation-offline',phase:'evaluation',model:'synthetic-model',acceptedResponseModels:['synthetic-model'],modelVersion:'offline',modelVerified:true,samplingVerified:true,temperature:.4,jsonObjectModeVerified:true,tokenUpperBoundVerified:true,tokenOverheadUpperBound:256,reasoningIncludedInCompletionVerified:true,usageCacheAccountingVerified:true,priceVersion:'offline-no-fee',pricesVerified:true,currency:'USD',inputMicrosPerMillion:1,cachedInputMicrosPerMillion:1,outputMicrosPerMillion:1,timeoutMs:1000,caps:{campaignCalls:120,pilotCalls:8,campaignCostMicros:'200000',ownerCalls:120,ownerCostMicros:'200000',concurrency:1,globalDailyCalls:120,globalDailyCostMicros:'200000',ownerDailyCalls:120,ownerDailyCostMicros:'200000',perCallCostMicros:'20000'}};
let active:any,payload:any,provider:any;let simulated=0;
const runtime=createCoachServices({db:createPgliteTransactionAdapter(db),authenticate:async()=> 'synthetic-gate-owner',policy:()=>policy,now:()=>now,lookupActionReceipt:async(_subject,snapshot)=>{if(!['G037','G038'].includes(active.case_id))return undefined;const intent={requestId:'synthetic-write-1',owner:snapshot.athleteId,date:'2026-10-29',target:'breakfast',item:'synthetic-milk',quantity:'250ml',idempotencyKey:'synthetic-idempotency-1'};return {intent,receipt:{...intent,status:active.case_id==='G037'?'SUCCEEDED':'UNKNOWN'},currentOwner:snapshot.athleteId,authorized:true,claimText:'已登记到指定早餐。'};},retrieve:async()=>{if(!['G021','G023','G046'].includes(active.case_id))throw Error('SYNTHETIC_RETRIEVAL_FAILED');return [{id:'synthetic-label',url:'https://example.test/synthetic-label',quote:active.case_id==='G023'?'配速是每单位距离用时。':'合成食品标签：每100毫升40千卡。',fetchedAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString()}];},fetch:async(_u,init)=>{
 payload=JSON.parse(String(init?.body));simulated++;const wire=JSON.parse(payload.messages[1].content);
 let claims=wire.facts.flatMap((s:any)=>s.kind==='FACT'?[s.detail,...s.detail.split(/[；;。]/)].filter(q=>q.length>=4&&active.candidate_reply.includes(q)&&supportedEvidenceQuote(s.detail,q)).slice(0,3).map(quote=>({sourceId:s.id,quote})):[]);
 if(active.case_id==='G032'&&wire.facts.length)claims=Array.from({length:48},()=>({sourceId:wire.facts[0].id,quote:wire.facts[0].detail}));
 let content=JSON.stringify({mode:'answer',text:active.candidate_reply,nextStep:null,citations:[...new Set(claims.map((c:any)=>c.sourceId))],evidenceQuotes:claims,medicalReferral:false,compareIds:null,seriesIds:null,planChanged:false});
 if(active.case_id==='G049'){const parsed=JSON.parse(content);parsed.schemaVersion='coach-gate-v1';parsed.blocks=[{id:'b1',kind:'CANDIDATE_ADVICE',text:active.candidate_reply,evidenceRefs:[],dependsOn:['b2'],groupId:'advice'},{id:'b2',kind:'OBSERVED_FACT',text:'证据已撤回。',evidenceRefs:[{id:'withdrawn',revision:'0'}],dependsOn:['b1'],groupId:'advice'}];content=JSON.stringify(parsed);}
 if(['G029','G030'].includes(active.case_id))content=active.candidate_reply;
 provider={model:'synthetic-model',choices:[{finish_reason:active.case_id==='G029'?'length':'stop',message:{role:'assistant',content}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100}};
 if(active.case_id==='G050')delete provider.usage;
 return Response.json(provider);
}});
const env={FANGKUN_DEEPSEEK_ENABLED:'true',DEEPSEEK_API_KEY:'SYNTHETIC_NOT_REAL',DATABASE_URL:'SYNTHETIC_NOT_OPENED',BETTER_AUTH_SECRET:'SYNTHETIC',VITE_AUTH_ENABLED:'true',FANGKUN_COACH_SCHEMA_READY:'true',FANGKUN_COACH_LEDGER_RECONCILED:'true',FANGKUN_DEEPSEEK_POLICY_JSON:JSON.stringify(policy)};
const send=async(path:string,body:any)=>{const r=await handleCoachHttpRequest(new Request('https://coach.test/api/'+path,{method:'POST',headers:{'content-type':'application/json',origin:'https://coach.test'},body:JSON.stringify(body)}),{env,runtime});return {http:r.status,body:await r.json()};};
const rows=[];
for(const c of cases){
 active=c;payload=null;provider=null;const records=mapping(c);const context:CoachRequestContext={version:'coach-context-v2',dependencyVersions:[],records,coverage:{selected:records.length,omitted:0,unknowns:['合成注入测试；未证明真实设备、外部服务或专业适用性。']}};
 const started=performance.now();const created=await send('coach-snapshot',{question:c.question,declarations:[],context,consent:{purpose:'coach_explanation',disclosureVersion:'coach-self-report-v1',mode:'PERSISTENT'}});
 if(c.case_id==='G039'&&created.http===200){const subject=await runtime.snapshots.subject('synthetic-gate-owner');await runtime.snapshots.disableConsent(subject);}
 const response=created.http===200?await send('coach-chat',{question:c.question,requestId:'offline-'+c.case_id,...created.body.snapshotRef}):created;
 const gate=response.body.answerGate;const reason=!gate?(c.case_id==='G029'?'TRUNCATED':response.body.error??'TECHNICAL_FAILURE'):null;
 rows.push({candidate_commit:candidateCommit,case_id:c.case_id,input_hash:c.input_hash,normalized_context_hash:sha(context),mode:'OFFLINE_CONTROLLER_INJECTION',run_scope:'SYNTHETIC_HARNESS_TEST',mapping:{context,notes:'Scenario narratives are synthetic fixtures, not production import. Explicit ID mapping is confined to this test adapter. G032 expands a length fixture; G047 instantiates unspecified complete runs with 4km20/18min. No rubric was read. G031 instantiates the narrative correct 9km as two selected runs of 4km+5km; G041/G042 instantiate explicit given distance/timer/elapsed/activity-lineage fields, not device ingestion. G049 injects the stated b1↔b2 dependency graph with a withdrawn reference. G037/G038 use read-only mock registration receipts (no registration is executed). Successful retrieval scenarios use a synthetic page receipt, not a real remote webpage. Unspecified label values are instantiated as 40kcal/100ml solely for the mock receipt.'},raw:c.candidate_reply,provider_reply:provider,provider_payload:payload,provider_payload_hash:payload?sha(payload):null,http:response.http,result:response.body,final_text:gate?.text??response.body.text??'本轮未完成，原输入保留。',decision:gate?.decision??(c.case_id==='G039'?'SAFE_REFUSAL':'FAILED_TECHNICAL'),reasonCodes:gate?.reasonCodes??[reason],latency_ms:performance.now()-started,new_paid_requests:0,new_provider_tokens:0,synthetic_usage:provider?.usage??null});
 if(c.case_id==='G039')await send('coach-snapshot',{onlineConsent:{enabled:true,disclosureVersion:'coach-self-report-v1'}});
 console.log(JSON.stringify({case:c.case_id,http:response.http,decision:gate?.decision??'FAILED_TECHNICAL',reasons:gate?.reasonCodes??[reason]}));
}
writeFileSync(out+'/injection-results.jsonl',rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
writeFileSync(out+'/USAGE.json',JSON.stringify({candidate_commit:candidateCommit,new_paid_requests:0,new_provider_tokens:0,synthetic_provider_dispatches:simulated,synthetic_usage_unknown:rows.filter(r=>r.provider_reply&&!r.synthetic_usage).length,synthetic_tokens_not_real_usage:true,model_generation_on_final_version:'NOT_PERFORMED_NO_NEW_BUDGET'},null,2)+'\n');
await db.close();mock.timers.reset();
