import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPgliteTransactionAdapter } from '../../src/lib/coach/deepseek-ledger.server.ts';
import { createCoachSnapshotStore } from './coach-snapshot-store.server.ts';
import { parseCoachDeclarations } from './lib/coach-declarations.ts';
import { validateCoachAssertions } from '../../src/lib/coach/assertion-policy.ts';
import type { CoachSnapshotCreate } from '../../src/lib/coach/online-contract.ts';
import { selectOnlineContext } from '../../src/lib/coach/online-context.ts';
import type { TrainingFact } from '../../src/lib/health/analysis-contract.ts';
import { createCoachServices } from './coach-services.server.ts';
import { handleCoachHttpRequest } from './coach-http.server.ts';
import type { VerifiedDeepSeekPolicy } from './lib/coach-service-contract.ts';
import { estimateInputTokenUpperBound } from '../../src/lib/coach/deepseek-policy.ts';
import type { ScopedRestriction } from '../../src/lib/coach/utterance-semantics.ts';

const now = Date.parse('2026-10-28T04:00:00Z');
const input: CoachSnapshotCreate = {question:'解释RPE',declarations:[],consent:{purpose:'coach_explanation',disclosureVersion:'coach-self-report-v1',mode:'PERSISTENT'}};
const syntheticPolicy=():VerifiedDeepSeekPolicy=>({enabled:true,approvalId:'synthetic-only',approvalExpiresAt:new Date(now+86400000).toISOString(),campaignId:'synthetic-v2',phase:'evaluation',model:'synthetic-model',acceptedResponseModels:['synthetic-model'],modelVersion:'test',modelVerified:true,samplingVerified:true,temperature:0.4,jsonObjectModeVerified:true,tokenUpperBoundVerified:true,tokenOverheadUpperBound:32,reasoningIncludedInCompletionVerified:true,usageCacheAccountingVerified:true,priceVersion:'synthetic-prices',pricesVerified:true,currency:'CNY',inputMicrosPerMillion:1000000,cachedInputMicrosPerMillion:100000,outputMicrosPerMillion:2000000,timeoutMs:1000,caps:{campaignCalls:120,pilotCalls:8,campaignCostMicros:'10000000',ownerCalls:120,ownerCostMicros:'10000000',concurrency:1,globalDailyCalls:120,globalDailyCostMicros:'10000000',ownerDailyCalls:120,ownerDailyCostMicros:'10000000',perCallCostMicros:'20000'}});
const syntheticEnv=(p:VerifiedDeepSeekPolicy)=>({FANGKUN_DEEPSEEK_ENABLED:'true',DEEPSEEK_API_KEY:'SYNTHETIC_NOT_A_REAL_KEY',DATABASE_URL:'SYNTHETIC_DATABASE_NEVER_OPENED',BETTER_AUTH_SECRET:'SYNTHETIC_NOT_A_SECRET',VITE_AUTH_ENABLED:'true',FANGKUN_COACH_SCHEMA_READY:'true',FANGKUN_COACH_LEDGER_RECONCILED:'true',FANGKUN_DEEPSEEK_POLICY_JSON:JSON.stringify(p)});
async function migrate(db:PGlite,files=['001_deepseek_budget.sql','002_coach_snapshots.sql','003_persistent_online.sql']){for(const f of files)await db.exec(await readFile(new URL(`../../migrations/coach/${f}`,import.meta.url),'utf8'))}
test('general education and causal explanations survive; personal numbers, clearance and phantom writes do not',()=>{
 for(const text of ['力量训练会引起肌肉适应，但适应速度因人而异。','一般科普：RPE通常用0到10表示主观用力程度。','一般例子：跑400米用80秒不代表你的实际成绩。']) assert.equal(validateCoachAssertions(text,{factQuotes:[],safetyRestricted:false}).ok,true,text);
 for(const text of ['你昨天跑了5公里。','一般例子：你明天跑5公里。','你已经确诊腘绳肌拉伤。','你患有糖尿病。','已为你修改课表。','你可以解除疼痛限制。']) assert.equal(validateCoachAssertions(text,{factQuotes:[],safetyRestricted:false}).ok,false,text);
 assert.equal(validateCoachAssertions('HRV正常，你可以继续跑步。',{factQuotes:[],safetyRestricted:true}).ok,false);
 assert.equal(validateCoachAssertions('不能诊断为拉伤；不要解除疼痛限制。',{factQuotes:[],safetyRestricted:true}).ok,true);
});
test('output activity scope retains knowledge and unrelated upper-body candidates while rejecting unsolicited painful running clearance',()=>{
 const leg:ScopedRestriction={id:'leg-restriction',version:'1',status:'ACTIVE',scope:'LOCAL',actions:['LOWER_BODY'],sourceText:'旧腿部疼痛限制仍待复核'};
 const options={factQuotes:[],safetyRestricted:false,question:'我现在腿疼，解释一下RPE'};
 assert.equal(validateCoachAssertions('一般科普：RPE通常用0到10表示主观用力程度。',options).ok,true);
 assert.equal(validateCoachAssertions('你可以继续跑步。',options).ok,false);
 assert.equal(validateCoachAssertions('跑步可以继续。',options).ok,false);
 assert.equal(validateCoachAssertions('跑步无需暂停。',options).ok,false);
 assert.equal(validateCoachAssertions('HRV正常不代表可以继续跑步。',options).ok,true);
 assert.equal(validateCoachAssertions('HRV正常不代表可以训练。',options).ok,true);
 assert.equal(validateCoachAssertions('HRV正常不代表不能继续跑步。',options).ok,false);
 assert.equal(validateCoachAssertions('不能说已恢复，但你可以继续冲刺。',options).ok,false);
 const old={...options,question:'解释一下RPE',restrictions:[leg]};
 assert.equal(validateCoachAssertions('RPE描述主观用力感，与个人诊断不同。',old).ok,true);
 assert.equal(validateCoachAssertions('一般力量训练可以改善跑步经济性，个体反应仍需观察。',old).ok,true);
 assert.equal(validateCoachAssertions('你可以继续跑步。',old).ok,false);
 const upper='如果上肢无症状，可以先考虑坐姿上肢技术练习候选，不涉及跑跳。';
 assert.equal(validateCoachAssertions(upper,{...old,safetyRestricted:true}).ok,true);
 assert.equal(validateCoachAssertions(upper,options).ok,true);
 assert.equal(validateCoachAssertions(upper,{...old,restrictions:[{...leg,actions:['SYSTEMIC'],sourceText:'明确医疗限制：暂停全部训练'}]}).ok,false);
 assert.equal(validateCoachAssertions('你可以继续跑步。',{...options,question:'我没有腿疼，解释一下RPE'}).ok,true);
 assert.equal(validateCoachAssertions('一般科普：RPE通常用0到10表示主观用力程度。',{...options,question:'朋友腿疼，解释一下RPE'}).ok,true);
});

test('actual controller scopes unsolicited output actions using current question symptoms and persisted restriction records',async()=>{
 const db=new PGlite(),policy=syntheticPolicy();let answer='',dispatches=0;
 try{
  await migrate(db);
  const runtime=createCoachServices({db:createPgliteTransactionAdapter(db),authenticate:async()=> 'synthetic-only-owner',policy:()=>policy,now:()=>now,fetch:async()=>{
   dispatches++;return Response.json({model:'synthetic-model',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({mode:'answer',text:answer,nextStep:null,citations:[],evidenceQuotes:[],medicalReferral:false,compareIds:null,seriesIds:null,planChanged:false})}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,prompt_cache_hit_tokens:20,prompt_cache_miss_tokens:80,completion_tokens_details:{reasoning_tokens:10}}});
  }});
  const send=(path:string,body:unknown)=>handleCoachHttpRequest(new Request(`https://coach.test/api/${path}`,{method:'POST',headers:{'content-type':'application/json',origin:'https://coach.test'},body:JSON.stringify(body)}),{env:syntheticEnv(policy),runtime});
  const context=(restriction:string):NonNullable<CoachSnapshotCreate['context']>=>({version:'coach-context-v2',dependencyVersions:[],records:[{recordId:'restriction-one',revision:restriction.includes('全部')?'2':'1',occurredAt:'2026-10-01T00:00:00Z',knownAt:'2026-10-01T00:00:00Z',category:'RESTRICTION',state:'UNKNOWN',source:'USER_DECLARED:PROFILE',fields:[{name:'restriction',value:restriction,unit:null},{name:'medicalClearance',value:false,unit:null}]}],coverage:{selected:1,omitted:0,unknowns:[]}});
  const education='一般科普：RPE通常用0到10表示主观用力程度。',upper='如果上肢无症状，可以先考虑坐姿上肢技术练习候选，不涉及跑跳。';
  const cases:[string,string,string|null,number][]=[
   ['我现在腿疼，解释一下RPE',education,null,200],
   ['我现在腿疼，解释一下RPE','你可以继续跑步。',null,502],
   ['我现在腿疼，解释一下RPE',education+'你可以继续跑步。',null,200],
   ['解释一下RPE',education,'旧腿部疼痛限制仍待复核',200],
   ['解释一下RPE','你可以继续跑步。','旧腿部疼痛限制仍待复核',502],
   ['解释一下RPE',upper,'旧腿部疼痛限制仍待复核',200],
   ['解释一下RPE',upper,'医生要求停止全部训练',502],
  ];
  for(const [i,[question,text,restriction,expected]]of cases.entries()){
   answer=text;
   const created=await send('coach-snapshot',{...input,question,...(restriction?{context:context(restriction)}:{})}),receipt=await created.json();assert.equal(created.status,200,JSON.stringify(receipt));
   const response=await send('coach-chat',{question,...receipt.snapshotRef,requestId:`output_scope_${i}`}),body=await response.json();
   assert.equal(response.status,expected,JSON.stringify(body));assert.equal(body.dispatchState,'RETURNED');assert.equal(body.ledgerState,'SETTLED');
   if(i===2){assert.match(body.text,/RPE/);assert.doesNotMatch(body.text,/可以继续跑步/);assert.equal(body.validation.status,'PARTIALLY_ACCEPTED')}
  }
  assert.equal(dispatches,cases.length);
 }finally{await db.close()}
});
test('persistent grant, independent snapshots, relevant revision invalidation, revocation and reversible migration',async()=>{
 const db=new PGlite();
 try{
  for(const f of ['001_deepseek_budget.sql','002_coach_snapshots.sql','003_persistent_online.sql'])await db.exec(await readFile(new URL(`../../migrations/coach/${f}`,import.meta.url),'utf8'));
  const store=createCoachSnapshotStore(createPgliteTransactionAdapter(db),()=>now),owner=await store.subject('synthetic-owner');
  const a=await store.create(owner,input),b=await store.create(owner,{...input,question:'力量训练为何引起适应'});
  assert.equal(a.snapshotRef.consentId,b.snapshotRef.consentId);
  assert.ok(await store.load(owner,{...a.snapshotRef,question:input.question}));
  assert.ok(await store.load(owner,{...b.snapshotRef,question:'力量训练为何引起适应'}));
  assert.equal(await store.revoke(owner,a.snapshotRef),true);
  assert.equal(await store.load(owner,{...a.snapshotRef,question:input.question}),null);
  assert.ok(await store.load(owner,{...b.snapshotRef,question:'力量训练为何引起适应'}));
  const d={recordId:'training-one',revision:'1',occurredAt:'2026-10-01T08:00:00Z',kind:'actual' as const,metric:'duration' as const,value:60,unit:'s' as const};
  const c=await store.create(owner,{...input,declarations:[d]}),other=await store.create(owner,{...input,declarations:[{...d,recordId:'training-other'}]});
  await store.create(owner,{...input,declarations:[{...d,revision:'2',value:70}]});
  assert.equal(await store.load(owner,{...c.snapshotRef,question:input.question}),null);
  assert.ok(await store.load(owner,{...other.snapshotRef,question:input.question}));
  assert.ok(await store.load(owner,{...b.snapshotRef,question:'力量训练为何引起适应'}));
  assert.equal(await store.revokeConsent(owner,b.snapshotRef.consentId),true);
  assert.equal(await store.load(owner,{...b.snapshotRef,question:'力量训练为何引起适应'}),null);
  await assert.rejects(store.create(owner,input),/CONSENT_REVOKED/);
  await store.enableConsent(owner);
  assert.ok(await store.create(owner,input));
  await store.disableConsent(owner);
  await assert.rejects(store.create(owner,input),/CONSENT_REVOKED/);
  await assert.rejects(store.create(owner,{...input,consent:{...input.consent,mode:'PER_REQUEST'}}),/CONSENT_REVOKED/);
  // Rollback keeps every row and safely revokes v2 access; one legacy consent per snapshot is restored.
  const before=await db.query('SELECT count(*)::int AS n FROM coach_explanation_snapshot');
  await db.exec(await readFile(new URL('../../migrations/coach/003_persistent_online.down.sql',import.meta.url),'utf8'));
  assert.deepEqual((await db.query('SELECT count(*)::int AS n FROM coach_explanation_snapshot')).rows,before.rows);
  await db.exec(await readFile(new URL('../../migrations/coach/003_persistent_online.sql',import.meta.url),'utf8'));
 }finally{await db.close()}
});
test('bounded context accepts structured old history without converting targets into actuals',()=>{
 const context={version:'coach-context-v2',dependencyVersions:[{key:'training:one',revision:'v1'}],records:[{recordId:'record-one',revision:'v1',occurredAt:'2026-01-01T00:00:00Z',knownAt:'2026-01-01T01:00:00Z',category:'TRAINING',state:'ACTUAL',source:'APP',fields:[{name:'distance',value:400,unit:'m'},{name:'rest',value:120,unit:'s'}]}],coverage:{selected:1,omitted:0,unknowns:['LT2']}};
 assert.equal(parseCoachDeclarations({...input,context},now).context?.records[0].fields[0].value,400);
 for(const change of [{...context,subjectId:'someone-else'},{...context,records:[{...context.records[0],trusted:true}]},{...context,records:[{...context.records[0],category:'GOAL',state:'ACTUAL'}]},{...context,records:[{...context.records[0],knownAt:'2026-02-30T00:00:00Z'}]},{...context,records:[{...context.records[0],knownAt:'2027-01-01T00:00:00Z'}]}])assert.throws(()=>parseCoachDeclarations({...input,context:change},now));
});

test('GET verifies actual v3 schema metadata; 002-only and rollback never advertise modern readiness',async()=>{
 const db=new PGlite(),policy=syntheticPolicy();let authenticated=0,dispatches=0;
 try{
  await migrate(db,['001_deepseek_budget.sql','002_coach_snapshots.sql']);
  const runtime=createCoachServices({db:createPgliteTransactionAdapter(db),authenticate:async()=>{authenticated++;return 'synthetic-only-owner'},policy:()=>policy,now:()=>now,fetch:async()=>{dispatches++;throw Error('status must not call a provider')}});
  const status=async()=>{const response=await handleCoachHttpRequest(new Request('https://coach.test/api/coach-chat'),{env:syntheticEnv(policy),runtime});assert.equal(response.status,200);return response.json()};
  const old=await status();assert.equal(old.configured,false);assert.equal(old.reason,'SCHEMA_MIGRATION_REQUIRED');assert.equal(old.schemaVerified,false);assert.equal(old.capabilities.persistentConsent,false);
  await migrate(db,['003_persistent_online.sql']);
  const ready=await status();assert.equal(ready.configured,true);assert.equal(ready.schemaVerified,true);assert.equal(ready.requiredSchemaVersion,3);assert.equal(ready.connectionVerified,false);assert.equal(ready.authorizationVerified,false);assert.equal(ready.billingVerified,false);
  await migrate(db,['003_persistent_online.down.sql']);
  assert.equal((await status()).configured,false);
  assert.equal(authenticated,0);assert.equal(dispatches,0);assert.deepEqual((await db.query('SELECT count(*)::int AS n FROM coach_self_athlete')).rows,[{n:0}]);
 }finally{await db.close()}
});

test('real selector to snapshot HTTP to controller budgets long history and empty personal/general contexts',async()=>{
 const db=new PGlite(),policy=syntheticPolicy();let dispatches=0;
 const observed:{inputBytes:number;facts:number;omitted:number}[]=[];
 try{
  await migrate(db);
  const runtime=createCoachServices({db:createPgliteTransactionAdapter(db),authenticate:async()=> 'synthetic-only-owner',policy:()=>policy,now:()=>now,fetch:async(_url,init)=>{
   dispatches++;
   const payload=JSON.parse(String(init?.body)),{messages,...options}=payload;
   const inputBytes=estimateInputTokenUpperBound(messages)+new TextEncoder().encode(JSON.stringify(options)).length+policy.tokenOverheadUpperBound;
   const wire=JSON.parse(messages[1].content);observed.push({inputBytes,facts:wire.facts.length,omitted:wire.coverage.omitted});assert.ok(inputBytes<=8000,`actual provider envelope ${inputBytes}`);
   return Response.json({model:'synthetic-model',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({mode:'answer',text:'一般训练比较需要保持协议一致；已选资料只支持条件性解释，仍需结合缺失记录复查。',nextStep:null,citations:[],evidenceQuotes:[],medicalReferral:false,compareIds:null,seriesIds:null,planChanged:false})}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,prompt_cache_hit_tokens:20,prompt_cache_miss_tokens:80,completion_tokens_details:{reasoning_tokens:10}}});
  }});
  const invoke=(path:string,body:unknown)=>handleCoachHttpRequest(new Request(`https://coach.test/api/${path}`,{method:'POST',headers:{'content-type':'application/json',origin:'https://coach.test'},body:JSON.stringify(body)}),{env:syntheticEnv(policy),runtime});
  const training:TrainingFact={id:'history-one',revision:1,athleteId:'local',provider:'MANUAL',accountRef:null,deviceId:null,protocolKey:'TRACK_REPETITION',sourceRecordId:'history-one',occurredAt:'2026-09-15T09:00:00Z',knownAt:'2026-09-15T10:00:00Z',receivedAt:'2026-09-15T10:00:00Z',sourceTimeZone:'UTC',status:'CONFIRMED',quality:'AVAILABLE',ownershipReceiptId:null,kind:'TRAINING',canonicalActivityId:'history-one',occurrenceId:'history-one',componentId:'work',modality:'RUN',startedAt:'2026-09-15T09:00:00Z',endedAt:null,plannedPurpose:null,observedType:'INTERVAL',observedTypeBasis:[],sessionRpe:7,sessionRpeScale:'CR10',actualDurationSeconds:1800,runSegments:Array.from({length:100},(_,i)=>({id:`segment-${i}`,blockId:'block',roundIndex:1,stepIndex:i+1,kind:'REPETITION',distanceM:400,durationSeconds:72,restAfterSeconds:180,restScope:'AFTER_REPEAT',rawResolutionSeconds:1,gradePercent:null,surface:'TRACK',completion:'COMPLETED'})),strengthSets:[],jumpContacts:null};
  const personal='复盘我上个月的400米间歇训练，解释分段与休息。'+'请按训练事实说明条件与限制，不增加训练量。'.repeat(20);
  const general='RPE通常用来描述一般用力感。'+'一般训练知识与用力感知量表。'.repeat(70);
  assert.ok(personal.length<=1000&&general.length<=1000);
  for(const [index,q,facts]of [[0,personal,[training]],[1,personal,[]],[2,general,[]]] as const){
   const selected=selectOnlineContext({owner:'local',question:q,day:'2026-10-28',asOf:new Date(now).toISOString(),facts:[...facts]});
   if(index===0){assert.ok(selected.context.records.length>0);assert.ok(selected.context.coverage.omitted>0)}
   if(index===1){assert.equal(selected.context.records.length,0);assert.ok(selected.context.dependencyVersions.length>0)}
   if(index===2)assert.equal(selected.context.dependencyVersions.length,0);
   const created=await invoke('coach-snapshot',{...input,question:q,context:selected.context}),receipt=await created.json();assert.equal(created.status,200,JSON.stringify(receipt));
   const response=await invoke('coach-chat',{question:q,requestId:`selector_long_context_${index}`,...receipt.snapshotRef}),body=await response.json();
   assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.route,'COMPLEX');assert.equal(body.dispatchState,'RETURNED');
  }
  assert.equal(dispatches,3);assert.ok(observed[0].facts>0&&observed[0].omitted>0);assert.equal(observed[1].facts,0);assert.equal(observed[2].facts,0);assert.ok(observed[2].inputBytes>4000);
  if(process.env.FK_CAPTURE_ONLINE_EXAMPLES==='1'){
   const out=new URL('../../verification/implementation-20261028/online-backend/',import.meta.url);await mkdir(out,{recursive:true});await writeFile(new URL('selector-controller-budget.json',out),JSON.stringify({synthetic:true,paidCalls:0,provider:'FAKE_TRANSPORT',contexts:observed},null,2)+'\n');
  }
 }finally{await db.close()}
});
