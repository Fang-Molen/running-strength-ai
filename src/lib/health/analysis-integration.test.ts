import test from 'node:test'
import assert from 'node:assert/strict'
import {currentAthleteId,setEventContext,EVENT_JOURNAL_PREFIX} from '../core/events'
import {setStoreBackend} from '../core/storage'
import {bindTrainingStart} from '../core/occurrence'
import {saveRunningPlan,freezeRunningPlanOnStart} from '../core/running-plan'
import {appendCorrection} from '../core/training-correction'
import {readRecoveryProjection,recoveryExplanation} from './recovery-host-u11'
import {readAnalysis,analysisText} from './analysis-host'
import {readCoachData} from './coach-data'
import {refreshCorosHealth,setCorosMcpLinked,loadCorosHealth} from './coros-mcp-client'
import {answerLocally} from '../core/coach-local-first'
import {deriveCoachBrief} from '../core/coach-brief'
import {emptyDialogue} from '../core/coach-dialogue'
import {buildParts} from '../../../evaluation/k12/fixtures'
import {context} from './analysis-fixtures'
const day='2026-10-22',asOf='2026-10-22T23:59:59Z'
function fixture(t:test.TestContext){t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-22T12:00:00Z')});const previous=currentAthleteId(),ls=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),fetch=globalThis.fetch,map=new Map<string,string>(),box={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>map.delete(k),keys:()=>[...map.keys()]};setEventContext({athleteId:'SYN-A'});setStoreBackend(box);Object.defineProperty(globalThis,'localStorage',{value:box,configurable:true});t.after(()=>{setEventContext({athleteId:previous});setStoreBackend(null);globalThis.fetch=fetch;if(ls)Object.defineProperty(globalThis,'localStorage',ls);else Reflect.deleteProperty(globalThis,'localStorage')});return {map,box}}
function mixed(f:ReturnType<typeof fixture>,id='mixed'){
 const at='2026-10-22T01:00:00Z'
 assert.equal(saveRunningPlan({planId:'run',planSlotId:id,components:[{componentId:'run',modality:'RUNNING',purpose:'OTHER',structure:{kind:'CONTINUOUS',plannedDistanceMeters:1000,plannedDistanceMaxMeters:null,plannedDurationSeconds:null}}]}).ok,true)
 bindTrainingStart({startEventId:id,startedAt:at,sessionId:id,planSlotId:id,plan:{id,name:'合成混合课',moves:[{id:'rdl',catalogId:'rdl',customName:'',sets:4,mode:'reps',amount:6,restSec:120,weightKg:60}]}})
 const p=freezeRunningPlanOnStart({trainingOccurrenceId:id,planSlotId:id,runningPlanId:'run',capturedAt:at})!
 const events=[{event_id:id,event_type:'TRAINING_STARTED',timestamp:at,payload:{sessionId:id,trainingOccurrenceId:id}}, {event_id:'set',event_type:'TRAINING_SET_COMPLETED',timestamp:'2026-10-22T01:01:00Z',payload:{sessionId:id,trainingOccurrenceId:id,moveId:'rdl',catalogId:'rdl',setIndex:1,completed:true,skipped:false,actualAmount:6,actualWeight:40,loadBasis:'TOTAL_EXTERNAL',side:'BILATERAL'}}, {event_id:'run-actual',event_type:'RUNNING_CONTINUOUS_COMPLETED',timestamp:'2026-10-22T01:02:00Z',payload:{trainingOccurrenceId:id,runningSnapshotId:p.runningSnapshotId,componentId:'run',actualDistanceMeters:200,actualDurationSeconds:28.4}}]
 for(const e of events)f.map.set(EVENT_JOURNAL_PREFIX+e.event_id,JSON.stringify({schemaVersion:1,id:e.event_id,order:Date.parse(e.timestamp),data:{...e,athlete_id:'SYN-A'},recordedAt:e.timestamp}))
}
test('A08 live U11 host retains mixed run plus strength and detailed actuals',t=>{const f=fixture(t);mixed(f);const v=readRecoveryProjection(day,asOf);assert.deepEqual(v.parts.map(p=>p.modality).sort(),['RUN','STRENGTH']);assert.equal(v.exposure.training.length,2);assert.match(recoveryExplanation(v),/200 m \/ 28.4 s/);assert.equal(v.parts.find(p=>p.modality==='STRENGTH')!.strengthSets![0].loadKg,40);assert.equal(v.parts.find(p=>p.modality==='RUN')!.runType,'UNKNOWN')})
test('A23 source correction updates health and coach while frozen earlier view stays unchanged',t=>{
 const f=fixture(t);mixed(f);const a=readAnalysis(day,asOf),frozen=readRecoveryProjection(day,'2026-10-22T01:03:00Z')
 assert.ok(appendCorrection({trainingOccurrenceId:'mixed',kind:'FIELD',field:'weight',setKey:'rdl:1',originalValue:'40',newValue:'30',reason:'合成更正'}))
 const b=readAnalysis(day,asOf);assert.notEqual(a.revision,b.revision);assert.equal(b.snapshot.facts.find(f=>f.kind==='TRAINING'&&f.modality==='STRENGTH')?.kind,'TRAINING');assert.equal(readRecoveryProjection(day,'2026-10-22T01:03:00Z').parts.find(p=>p.modality==='STRENGTH')!.strengthSets![0].loadKg,frozen.parts.find(p=>p.modality==='STRENGTH')!.strengthSets![0].loadKg)
 assert.match(readCoachData(day).decision!.text,/实际完成/)
})
test('A14 medical hold retains numeric recovery facts instead of stale warning only',t=>{fixture(t);const q='那你觉得我今天恢复怎么样？',brief=deriveCoachBrief(buildParts(q,{}));brief.sleepHours=6;brief.subjectiveRecovery=3;const state=emptyDialogue('SYN-A');state.medicalHold={level:'MEDICAL_REVIEW',classes:['PAIN'],evidence:['既有疼痛'],immediate:[]} as any;const r=answerLocally(brief,undefined,[],undefined,state);assert.match(r.text,/6 小时/);assert.match(r.text,/恢复 3/);assert.match(r.text,/限制|许可/);assert.ok(r.dialogue?.medicalHold)})
test('A27 partial food entry is logged energy, never full-day deficit; analysis read does not write',t=>{const f=fixture(t);f.map.set('fr255-food-log-v1',JSON.stringify([{id:'breakfast',athleteId:'SYN-A',date:day,meal:'早餐',name:'合成餐',kcal:600,recordedAt:'2026-10-22T01:00:00Z'}]));const before=[...f.map],a=readAnalysis(day,asOf);assert.equal(a.nutrition.loggedKcal,600);assert.equal(a.nutrition.dayComplete,false);assert.equal(a.nutrition.energyDeficitKcal,null);assert.deepEqual([...f.map],before);assert.match(analysisText(a),/600 kcal/)})
test('A31 late COROS response is dropped after athlete switch, no cache contamination',async t=>{
 fixture(t);let healthResolve!:(r:Response)=>void;let started!:(v:void)=>void;const wait=new Promise<void>(r=>started=r)
 globalThis.fetch=async url=>String(url).endsWith('status')?Response.json({ok:true,connected:true,sessionScope:'scopeA'}):new Promise<Response>(r=>{healthResolve=r;started()})
 const pending=refreshCorosHealth('SYN-A');await wait;setEventContext({athleteId:'SYN-B'});healthResolve(Response.json({ok:true,sessionScope:'scopeA',fetchedAt:asOf,days:[],stress:[],recovery:null,issues:[],raw:{}}));await assert.rejects(pending,/运动员/);assert.equal(loadCorosHealth('SYN-A'),null);assert.equal(loadCorosHealth('SYN-B'),null)
})
test('A31 revocation during request rejects response even if server response arrives',async t=>{
 fixture(t);let resolve!:(r:Response)=>void,ready!:(v:void)=>void;const wait=new Promise<void>(r=>ready=r);globalThis.fetch=async u=>String(u).endsWith('status')?Response.json({ok:true,connected:true,sessionScope:'scopeA'}):new Promise<Response>(r=>{resolve=r;ready()});const p=refreshCorosHealth('SYN-A');await wait;setCorosMcpLinked('SYN-A',false);resolve(Response.json({ok:true,sessionScope:'scopeA',fetchedAt:asOf,days:[],stress:[],recovery:null,issues:[],raw:{}}));await assert.rejects(p,/改变/);assert.equal(loadCorosHealth('SYN-A'),null)
})

test('analysis material revision stays stable across rereads to prevent history refresh loops',t=>{fixture(t);assert.equal(readAnalysis(day,'2026-10-22T10:00:00Z').revision,readAnalysis(day,'2026-10-22T10:01:00Z').revision)})

test('legacy event without commit time stays outside frozen analysis and records a gap',t=>{
 const f=fixture(t);mixed(f)
 const key=EVENT_JOURNAL_PREFIX+'set',raw=JSON.parse(f.map.get(key)!);delete raw.recordedAt;f.map.set(key,JSON.stringify(raw))
 const before=[...f.map],v=readRecoveryProjection(day,asOf)
 assert.equal(v.parts.some(p=>p.modality==='STRENGTH'),false)
 assert.equal(v.parts.some(p=>p.modality==='RUN'),true)
 assert.ok(v.review.gaps.some(g=>/入库时间/.test(g)));assert.deepEqual([...f.map],before)
})

test('C27 V4 mixed host keeps actual occurrence, not plan date alias',t=>{const f=fixture(t),id='plan400:2026-10-22:strength';mixed(f,id);const a=readAnalysis(day,asOf);const rows=a.snapshot.facts.filter(f=>f.kind==='TRAINING');assert.equal(rows.length,2);assert.deepEqual(rows.map(f=>f.kind==='TRAINING'?f.occurrenceId:null),[id,id]);assert.equal(rows.filter(f=>f.kind==='TRAINING'&&f.modality==='RUN').length,1)})
test('C28 VOID immediately invalidates host projections without deleting stored events',t=>{const f=fixture(t);mixed(f);const count=f.map.size;assert.ok(appendCorrection({trainingOccurrenceId:'mixed',kind:'VOID',reason:'合成作废'}));assert.equal(readAnalysis(day,asOf).snapshot.facts.filter(f=>f.kind==='TRAINING').length,0);assert.ok(f.map.size>=count);assert.equal(readAnalysis(day,'2026-10-22T01:03:00Z').snapshot.facts.filter(f=>f.kind==='TRAINING').length,2)})
test('C29 pain with unknown muscle location is still a safety hold',t=>{const f=fixture(t);f.map.set('fk-pain-log-v1',JSON.stringify([{id:'p',athleteId:'SYN-A',date:day,part:'膝盖',score:3,occurredAt:'2026-10-22T08:00:00Z',recordedAt:'2026-10-22T09:00:00Z'}]));const a=readAnalysis(day,asOf);assert.equal(a.assessment.safetyState,'HOLD_ACTIVE');assert.equal(a.assessment.candidates[0].action,'SKIP')})
