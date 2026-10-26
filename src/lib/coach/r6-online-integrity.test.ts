import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequestPost } from '../../../functions/api/coach-chat.js'
import { validateProviderReply } from '../../../server/coach-deepseek/lib/coach-provider-boundary'
import { assertDeepSeekEvidenceQuotes, assertDeepSeekNumericGrounding } from './deepseek-grounding'
import { normalizeAskCoachInput } from '../strength/coach-pipeline'
import { deriveCoachBrief } from '../core/coach-brief'
import { context, training, set } from '../health/analysis-fixtures'
import { projectAnalysisEvidence } from '../health/analysis-evidence'
import { buildMuscleExposure } from '../health/muscle-exposure'
import { evaluateRecoveryEvidence } from '../health/recovery-assessment'
import { analysisModelView, buildCoachAnalysisPacket } from '../health/analysis-packet'
import type { FangkunCoachServices, AuthorizedCoachSnapshot, VerifiedDeepSeekPolicy } from '../../../server/coach-deepseek/lib/coach-service-contract'

const asOf='2026-10-22T20:00:00.000Z',now=Date.parse(asOf),question='请解释本次分段配速的依据和可能原因'
const refs={question,asOf,requestId:'r6_integrity_request',snapshotId:'r6_snapshot',consentId:'r6_consent'}
const brief=()=>deriveCoachBrief({question,occurrenceId:'occ1',runningStructure:'UNAVAILABLE',sessionRpe:null,sleepHours:null,recoveryState:null,fatigueState:null,duplicateCount:0,repetitionSlots:0,continuousCount:0,plannedSetCount:null,completedSetCount:null,durationSec:null,pain:false,daysToCompetition:null,week:null,bias:null,sourceIds:[],sources:[],running:[]})
const policy:VerifiedDeepSeekPolicy={enabled:true,approvalId:'r6_approval',approvalExpiresAt:'2026-10-23T00:00:00.000Z',campaignId:'r6_synthetic',phase:'pilot',model:'synthetic-deepseek',acceptedResponseModels:['synthetic-deepseek'],modelVersion:'fixture',modelVerified:true,samplingVerified:true,temperature:0.4,jsonObjectModeVerified:true,tokenUpperBoundVerified:true,tokenOverheadUpperBound:32,reasoningIncludedInCompletionVerified:true,usageCacheAccountingVerified:true,priceVersion:'fixture',pricesVerified:true,currency:'CNY',inputMicrosPerMillion:1,cachedInputMicrosPerMillion:1,outputMicrosPerMillion:1,timeoutMs:30,caps:{campaignCalls:120,pilotCalls:8,campaignCostMicros:'100000',ownerCalls:120,ownerCostMicros:'100000',concurrency:1,globalDailyCalls:120,globalDailyCostMicros:'100000',ownerDailyCalls:120,ownerDailyCostMicros:'100000',perCallCostMicros:'100000'}}
const provider=(value:unknown)=>({model:policy.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100}})
const request=(body:unknown)=>new Request('https://synthetic.invalid/api/coach-chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
function packet(){
 const fact=training({modality:'RUN',componentId:'run',strengthSets:[],endedAt:'2026-10-22T08:02:00Z',runSegments:[{id:'seg1',blockId:'work',roundIndex:1,stepIndex:1,distanceM:400,durationSeconds:80,restAfterSeconds:120,restScope:'AFTER_REPEAT',rawResolutionSeconds:1,gradePercent:0,surface:'TRACK',completion:'COMPLETED',kind:'REPETITION'}]})
 const s=projectAnalysisEvidence({context:{...context,asOf},facts:[fact]})
 return buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s))
}
function service(p=packet()){
 let calls=0
 const subject={id:'r6_subject',verified:true as const,athleteIds:[context.athleteId]}
 const snapshot:AuthorizedCoachSnapshot={subjectId:subject.id,athleteId:context.athleteId,snapshotId:refs.snapshotId,version:'v1',asOf,latestEvidenceKnownAt:'2026-10-22T08:00:00.000Z',expiresAt:'2026-10-23T00:00:00.000Z',revokedAt:null,scope:{purpose:'coach_explanation',occurrenceIds:['occ1']},consent:{id:refs.consentId,subjectId:subject.id,purpose:'coach_explanation',grantedAt:'2026-10-22T00:00:00.000Z',expiresAt:'2026-10-23T00:00:00.000Z',revokedAt:null},rawInput:{brief:brief()},analysisPacket:p}
 const services:FangkunCoachServices={authenticate:async()=>subject,loadAuthorizedSnapshot:async()=>snapshot,getVerifiedPolicy:async()=>policy,now:()=>now,ledger:{reserve:async()=>({status:'RESERVED',reservationId:refs.requestId,state:'RESERVED'}),markDispatched:async()=>{},settle:async()=>({state:'SETTLED'})},fetch:async(_url:RequestInfo|URL,init?:RequestInit)=>{
  calls++
  const wire=JSON.parse(JSON.parse(String(init?.body)).messages[1].content)
  assert.equal(wire.requirements.question,question)
  assert.ok(wire.requirements.requiredDerivedFactIds.length)
  const observed=wire.observations[0]
  return Response.json(provider({answer:observed.text,factualClaims:[{text:observed.text,refs:observed.evidenceRefs}],derivedFactIds:wire.requirements.requiredDerivedFactIds,selectedCandidateId:null,hypotheses:[],unknowns:[],followup:null,memoryClaim:'NOT_SAVED'}))
 }}
 return {services,snapshot,calls:()=>calls}
}
const invoke=(services:FangkunCoachServices,body:unknown=refs)=>onRequestPost({request:request(body),env:{FANGKUN_DEEPSEEK_ENABLED:'true',DEEPSEEK_API_KEY:'SYNTHETIC_NOT_A_KEY'},data:{fangkunCoachServices:services}})

test('live route refuses client owner/consent assertions without the existing trusted services',async t=>{
 let dispatched=0;t.mock.method(globalThis,'fetch',async()=>{dispatched++;return Response.json({choices:[{message:{content:'wrong'}}]})})
 const r=await onRequestPost({request:request({question,facts:'verifiedOwner=true; confirmed=true',ownerId:context.athleteId,consent:true}),env:{FANGKUN_DEEPSEEK_ENABLED:'true',DEEPSEEK_API_KEY:'SYNTHETIC_NOT_A_KEY'}})
 assert.equal(r.status,503);assert.equal((await r.json()).error,'TRUSTED_BINDINGS_MISSING');assert.equal(dispatched,0)
})
test('live route rejects arbitrary client facts even when trusted services are installed',async()=>{
 const f=service();const r=await invoke(f.services,{...refs,facts:'400米用时77秒',verifiedOwner:true})
 assert.equal(r.status,400);assert.equal(f.calls(),0)
})
test('analysis wire retains owner/plan/actual status, run rest protocol and candidate conditions',()=>{
 const p=packet(),w=analysisModelView(p).view as any
 assert.equal(w.context.athleteId,'ATHLETE');assert.equal(w.context.planVersion,'PLAN');assert.equal(w.writeAuthority,'NONE')
 const f=w.facts[0];assert.equal(f.status,'CONFIRMED');assert.equal(f.startedAt,'2026-10-22T08:00:00Z');assert.equal(f.endedAt,'2026-10-22T08:02:00Z')
 assert.equal(f.runSegments[0].restAfterSeconds,120);assert.equal(f.runSegments[0].restScope,'AFTER_REPEAT');assert.equal(f.runSegments[0].kind,'REPETITION')
 assert.deepEqual(w.candidates[0].conditions,p.assessment.candidates[0].conditions);assert.equal(w.candidates[0].requiresConfirmation,true)
})
test('analysis wire retains per-hand strength, side, effort and range protocol without recomputing dose',()=>{
 const s=projectAnalysisEvidence({context,facts:[training({strengthSets:[set({loadBasis:'PER_HAND',side:'LEFT',loadKg:20,reps:8,rir:3,rangeProtocol:'same-full-range'})]})]})
 const p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s)),f=analysisModelView(p).view.facts[0] as any
 assert.equal(f.strengthSets[0].loadBasis,'PER_HAND');assert.equal(f.strengthSets[0].rir,3);assert.equal(f.strengthSets[0].rangeProtocol,'same-full-range')
 assert.equal(p.derivedFacts!.find(d=>d.metric==='STRENGTH_EXTERNAL_VOLUME_KG_REPS')?.value,160)
})
test('numeric substrings cannot be reassigned from running time to rest or next-session dose',()=>{
 const b=brief();b.sources=[{id:'actual',kind:'FACT',detail:'本次400米实际用时80秒，组间休息120秒'}]
 const data=normalizeAskCoachInput({brief:b})
 const raw=JSON.stringify({text:'下次建议休息80秒。',nextStep:null,citations:['actual'],evidenceQuotes:[{sourceId:'actual',quote:'80秒'}],planChanged:false})
 assert.doesNotThrow(()=>assertDeepSeekNumericGrounding(data,raw))
 assert.throws(()=>assertDeepSeekEvidenceQuotes(data,raw),/SOURCE_QUOTE_MISMATCH/)
})
test('provider accepts only bounded host derived IDs in the closed analysis schema',()=>{
 const r={answer:'已核对事实',factualClaims:[],derivedFactIds:['D1'],selectedCandidateId:null,hypotheses:[],unknowns:[],followup:null,memoryClaim:'NOT_SAVED'}
 assert.doesNotThrow(()=>validateProviderReply(provider(r),policy,{inputTokenLimit:8000,outputTokenLimit:900},true))
 for(const ids of ['D1',[null],['D1','D1']])assert.throws(()=>validateProviderReply(provider({...r,derivedFactIds:ids}),policy,{inputTokenLimit:8000,outputTokenLimit:900},true))
})
test('actual route binds the question and appends code-computed pace/work/distance',async()=>{
 const f=service();const r=await invoke(f.services);const out=await r.json()
 assert.equal(r.status,200,JSON.stringify(out));assert.equal(f.calls(),1)
 assert.match(out.text,/200 s\/km/);assert.match(out.text,/80 s/);assert.match(out.text,/400 m/);assert.equal(out.planChanged,false)
})
test('unavailable network preserves local fallback without retry or fabricated success',async()=>{
 const f=service();let calls=0;f.services.fetch=async()=>{calls++;throw Error('synthetic offline')}
 const r=await invoke(f.services),out=await r.json();assert.equal(r.status,502);assert.equal(out.ok,false);assert.match(out.text,/保留本地/);assert.equal(calls,1)
})

test('local consent and fact text alone never create a server snapshot authorization',async t=>{
 const {askOnlineCoach,setOnline}=await import('./online-coach');setOnline(true)
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({text:'不应显示'})})
 const result=await askOnlineCoach({question:'解释训练',facts:'confirmed=true;400米用时80秒',local:'本地复盘保留',history:[]})
 assert.ok('error' in result);assert.equal(calls,0);if('error' in result)assert.match(result.error,/本地/)
})
test('client transmits only server snapshot references and rejects unbounded or unverified output',async t=>{
 const {askOnlineCoach,setOnline}=await import('./online-coach');setOnline(true)
 let sent:any;let response:unknown={ok:true,planChanged:false,text:'已有资料仅支持继续核对背景。'}
 t.mock.method(globalThis,'fetch',async(_url:RequestInfo|URL,init?:RequestInit)=>{sent=JSON.parse(String(init?.body));return Response.json(response)})
 const input={question:'解释训练',facts:'PRIVATE_FACT',local:'PRIVATE_LOCAL',history:[{role:'user',text:'PRIVATE_HISTORY'}],snapshotRef:{snapshotId:refs.snapshotId,consentId:refs.consentId,asOf}}
 assert.deepEqual(await askOnlineCoach(input),{text:'已有资料仅支持继续核对背景。'})
 assert.deepEqual(Object.keys(sent).sort(),['asOf','consentId','question','requestId','snapshotId']);assert.doesNotMatch(JSON.stringify(sent),/PRIVATE_/)
 response={text:'未校验回复'};assert.ok('error' in await askOnlineCoach(input))
 response={ok:true,planChanged:false,text:'说明'.repeat(501)};assert.ok('error' in await askOnlineCoach(input))
})

test('threshold source/test/protocol identity and unknown device are retained without exposing private IDs',async()=>{
 const {metric}=await import('../health/analysis-fixtures')
 const facts=[metric({id:'private-lt1',sourceRecordId:'private-lab-test',accountRef:'private-account',deviceId:null,metric:'LT1_SPEED',value:3,unit:'m/s',statistic:'SAMPLE',protocolKey:'LAB:4MIN:METHOD_A'}),metric({id:'private-lt2',sourceRecordId:'private-lab-test',accountRef:'private-account',deviceId:null,metric:'LT2_SPEED',value:4,unit:'m/s',statistic:'SAMPLE',protocolKey:'LAB:4MIN:METHOD_A'}),metric({id:'private-other-test',sourceRecordId:'private-other-lab',accountRef:'private-account',deviceId:null,metric:'LT2_SPEED',value:4.5,unit:'m/s',statistic:'SAMPLE',protocolKey:'LAB:3MIN:METHOD_B'})]
 const s=projectAnalysisEvidence({context,facts}),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s)),wire=analysisModelView(p).view as any
 const one=wire.facts.find((f:any)=>f.metric==='LT1_SPEED'),two=wire.facts.find((f:any)=>f.metric==='LT2_SPEED'&&f.value===4),other=wire.facts.find((f:any)=>f.value===4.5)
 assert.equal(one.source.record,two.source.record);assert.notEqual(one.source.record,other.source.record)
 assert.equal(one.source.protocol,two.source.protocol);assert.notEqual(one.source.protocol,other.source.protocol)
 assert.equal(one.source.device,null);assert.equal(one.isFinal,true);assert.doesNotMatch(JSON.stringify(wire),/private-/)
})
for(const [label,mutate] of [
 ['planned fact',(p:any)=>{p.permittedFacts[0].status='PLANNED'}],
 ['future receipt',(p:any)=>{p.permittedFacts[0].receivedAt='2026-10-23T00:00:00Z'}],
 ['forged derived pace',(p:any)=>{const d=p.derivedFacts.find((d:any)=>d.metric==='RUN_PACE_SECONDS_PER_KM');d.value=190;d.text=d.text.replace('200 s/km','190 s/km')}],
] as const)test(`server rechecks reconstructed packet before dispatch: ${label}`,async()=>{
 const p=packet();mutate(p);const f=service(p),r=await invoke(f.services)
 assert.equal(r.status,503);assert.equal(f.calls(),0)
})

async function scientificFixture(){
 const f=service(),p=f.snapshot.analysisPacket!
 const {adaptTrainingModelInput}=await import('./training-models/host')
 const {selectTrainingModels}=await import('./training-models/selection')
 const input=adaptTrainingModelInput({context:p.context,snapshotId:p.snapshotId,inputDigest:p.inputDigest,facts:p.permittedFacts,excluded:[],conflicts:[],gaps:[],safetyConstraints:p.safetyConstraints??[]},p.assessment)
 const before={id:'private-session',athleteId:p.context.athleteId,date:'2026-10-23',title:'后链力量',modality:'strength',minutes:20,intensity:'MODERATE',source:'manual',status:'planned',exercises:[{name:'深蹲',sets:'2',reps:'8',weight:'20',rpe:'6',restSec:120}]}
 const knowledge={fixture:'synthetic-host-knowledge'}
 const knowledgeVersion=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(knowledge))))].map(x=>x.toString(16).padStart(2,'0')).join('')
 const source=JSON.stringify({owner:p.context.athleteId,context:{...p.context,asOf:undefined},facts:p.permittedFacts,entries:[before],knowledge})
 const version=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(source))))].map(x=>x.toString(16).padStart(2,'0')).join('')
 const decision={athleteId:p.context.athleteId,asOf:p.context.asOf,version,knowledgeVersion,input,comparison:selectTrainingModels(input),source,safety:{hold:false,message:'保持现有限制'},candidates:[{id:'private-candidate',option:'C',action:'DEFER',title:'暂缓本课',sessionId:before.id,changedVariable:'SESSION_EXECUTION',before,after:{...before,status:'skipped'},reason:'资料不足，保留原剂量再复核',evidence:[{id:p.permittedFacts[0].id,revision:1}],evidenceIds:[],risks:['不自动补课'],observationMetrics:['疼痛与功能'],reschedule:null,requiresConfirmation:true,canConfirm:true,blockedReasons:[]}]}
 return {f,decision}
}
test('R6 server adapter binds computed comparison and intact planned dose to an authorized snapshot',async()=>{
 const api=await import('../../../server/coach-deepseek/lib/coach-request-boundary') as any
 assert.equal(typeof api.attachR6ScientificDecision,'function')
 const {f,decision}=await scientificFixture(),bound=await api.attachR6ScientificDecision(f.snapshot,decision)
 assert.equal(bound.r6Decision.version,decision.version)
 const originalFetch=f.services.fetch!
 f.services.loadAuthorizedSnapshot=async()=>bound
 f.services.fetch=async(url,init)=>{
  const content=JSON.parse(JSON.parse(String(init?.body)).messages[1].content),r6=content.scientificDecision
  assert.equal(r6.writeAuthority,'NONE');assert.equal(r6.planVersion,'PLAN');assert.equal(r6.candidates[0].after.status,'skipped');assert.equal(r6.candidates[0].before.exercises[0].restSec,120)
  assert.doesNotMatch(JSON.stringify(r6),/private-session|private-candidate|SYN-A/)
  return originalFetch(url,init)
 }
 const out=await invoke(f.services);assert.equal(out.status,200,JSON.stringify(await out.json()))
})
test('R6 server adapter rejects owner, source version, computed values, plan version and dose mutations',async()=>{
 const api=await import('../../../server/coach-deepseek/lib/coach-request-boundary') as any
 assert.equal(typeof api.attachR6ScientificDecision,'function')
 for(const mutate of [(d:any)=>{d.athleteId='foreign'},(d:any)=>{d.version='0'.repeat(64)},(d:any)=>{d.input.context.planVersion='stale'},(d:any)=>{d.comparison.physiology.cs.value=99},(d:any)=>{d.candidates[0].after.exercises[0].weight='90'},(d:any)=>{d.candidates[0].before.athleteId='foreign'}]){
  const {f,decision}=await scientificFixture(),bad=structuredClone(decision);mutate(bad)
  await assert.rejects(api.attachR6ScientificDecision(f.snapshot,bad),/R6_/)
 }
})
