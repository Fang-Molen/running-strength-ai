import test, {type TestContext} from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend} from '../../core/storage'
import {currentAthleteId,setEventContext,dispatchEvent} from '../../core/events'
import {loadSchedule,saveSchedule} from '../../ui/day-schedule'
import type {ScheduleEntry} from '../../ui/day-schedule-rules'
import {savePersonalResponse} from '../../health/personal-response-store'
import type {ResponseFact} from '../../health/analysis-contract'
import {metric} from '../../health/analysis-fixtures'
import {emptyProfile,saveProfile} from '../../strength/profile'
import {readR6Decision,prepareR6Candidate,confirmR6Candidate,readR6History,recordR6Feedback,rejectR6Candidate,prepareR6Reschedule,R6_CONFIRMATION} from './runtime'
const at='2026-10-26T10:00:00.000Z',day='2026-10-26',owner='r6-test'
function entry(extra:Partial<ScheduleEntry>={}):ScheduleEntry{return {athleteId:owner,id:'course',date:'2026-10-27',kind:'run',modality:'run',title:'已保存轻松跑',focus:[],minutes:20,intensity:'EASY',lowerHeavy:false,source:'custom',refId:null,status:'planned',runComponents:[{componentId:'run',modality:'RUNNING',purpose:'EASY_AEROBIC',structure:{kind:'CONTINUOUS',plannedDistanceMeters:null,plannedDistanceMaxMeters:null,plannedDurationSeconds:1200}}],...extra}}
function setup(t:TestContext,entries:ScheduleEntry[]=[entry()]){
 t.mock.timers.enable({apis:['Date'],now:Date.parse(at)})
 const previous=currentAthleteId(),plan=Object.getOwnPropertyDescriptor(globalThis,'__FK_TEST_PLAN_DOC__')
 Reflect.deleteProperty(globalThis,'__FK_TEST_PLAN_DOC__')
 const data=new Map<string,string>([['fk-schedule-v1',JSON.stringify({entries,acks:[]})]])
 const box={keys:()=>[...data.keys()],getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)}}
 setStoreBackend(box);setEventContext({athleteId:owner})
 t.after(()=>{setStoreBackend(null);setEventContext({athleteId:previous});if(plan)Object.defineProperty(globalThis,'__FK_TEST_PLAN_DOC__',plan)})
 return {data,box}
}
function response(id:string,measure:ResponseFact['measure'],value:number,revision=1):ResponseFact{
 return {...metric({id,sourceRecordId:id,athleteId:owner,occurredAt:at,knownAt:at,receivedAt:at,protocolKey:'manual-local',revision}),kind:'RESPONSE',relatedTrainingRefs:[],region:'hamstrings',side:'BILATERAL',measure,value,scale:measure==='FUNCTION'?'FUNCTION_LIMITATION_0_1':'0-10_HIGH_WORSE',observationProtocol:'morning-local',elapsedHours:null,functionTaskId:measure==='FUNCTION'?'usual-warmup':null,notes:null}
}
async function defer(){const d=await readR6Decision(day,at),c=d.candidates.find(c=>c.action==='DEFER')!;assert.ok(c);return prepareR6Candidate(c.id,day,at)}
test('empty facts keep unknown and offer two meaningful saved-course alternatives without write',async t=>{
 const {data}=setup(t),before=data.get('fk-schedule-v1'),d=await readR6Decision(day,at)
 assert.equal(d.candidates.length,2);assert.equal(d.candidates[0].action,'KEEP');assert.equal(d.candidates[0].canConfirm,false)
 assert.equal(d.candidates[1].changedVariable,'SESSION_EXECUTION');assert.equal(d.input.profile.eventMeters,null)
 assert.equal(data.get('fk-schedule-v1'),before);assert.equal(d.candidates[1].before.minutes,d.candidates[1].after.minutes)
})
test('C explicit confirmation atomically defers without writing actuals or adding volume',async t=>{
 setup(t);const p=await defer();assert.equal(loadSchedule().entries[0].status,'planned')
 assert.equal((await confirmR6Candidate(p,R6_CONFIRMATION,at)).ok,true)
 const e=loadSchedule().entries[0];assert.equal(e.status,'skipped');assert.equal(e.actual,undefined);assert.equal(e.minutes,20)
 assert.deepEqual(e.runComponents,p.candidate.before.runComponents);assert.equal(loadSchedule().entries.length,1)
 assert.equal((await readR6History(day,at))[0].execution.state,'DEFERRED')
 assert.equal((await confirmR6Candidate(p,R6_CONFIRMATION,at)).ok,false)
})
test('confirmation is mandatory and a tampered preview never changes the calendar',async t=>{
 setup(t);const p=await defer()
 assert.equal((await confirmR6Candidate(p,'yes' as typeof R6_CONFIRMATION,at)).ok,false)
 const tampered=structuredClone(p);tampered.candidate.after.minutes=30
 assert.equal((await confirmR6Candidate(tampered,R6_CONFIRMATION,at)).ok,false);assert.equal(loadSchedule().entries[0].minutes,20)
})
test('candidate IDs survive clock seconds but current facts invalidate stale IDs',async t=>{
 setup(t);const d=await readR6Decision(day,at);t.mock.timers.tick(1000)
 const next=await readR6Decision(day,new Date().toISOString());assert.equal(next.candidates[1].id,d.candidates[1].id)
 assert.equal(savePersonalResponse(response('pain','PAIN',0)).ok,true)
 await assert.rejects(prepareR6Candidate(d.candidates[1].id,day,new Date().toISOString()))
})
test('committed training start between preview and confirmation blocks schedule mutation',async t=>{
 setup(t);const p=await defer();assert.ok(dispatchEvent('TRAINING_STARTED',{sessionId:'scheduled:course:run'}))
 assert.equal((await confirmR6Candidate(p,R6_CONFIRMATION,at)).ok,false);assert.equal(loadSchedule().entries[0].status,'planned')
})
test('completed, actual-bearing, foreign, legacy and text-only courses cannot become executable candidates',async t=>{
 setup(t,[entry({id:'done',status:'done'}),entry({id:'actual',actual:{outcome:'different',minutes:5,intensity:'EASY',reasons:[],note:'',at}}),entry({id:'foreign',athleteId:'other'}),entry({id:'legacy',athleteId:undefined}),entry({id:'text',runComponents:undefined})])
 assert.equal((await readR6Decision(day,at)).candidates.length,0)
})
test('medical profile restriction blocks keep and move even with normal pain/function reports',async t=>{
 setup(t);saveProfile({...emptyProfile(),limit:'医生要求暂停负重跑跳'});savePersonalResponse(response('pain','PAIN',0));savePersonalResponse(response('function','FUNCTION',0))
 const d=await readR6Decision(day,at);assert.equal(d.safety.hold,true);assert.equal(d.candidates[0].canConfirm,false);assert.ok(d.candidates.every(c=>c.action!=='MOVE'))
 await assert.rejects(prepareR6Candidate(d.candidates[0].id,day,at));assert.equal(d.candidates.at(-1)?.canConfirm,true)
})
test('owner switch cannot read or confirm another athlete decision',async t=>{
 setup(t);const p=await defer();setEventContext({athleteId:'other'})
 assert.equal((await confirmR6Candidate(p,R6_CONFIRMATION,at)).ok,false);assert.deepEqual(await readR6History(day,at),[])
})
test('knowledge revision and expiry reject old previews without writing',async t=>{
 const {data}=setup(t);const p=await defer();data.set('fk-knowledge-approvals-v1','[]')
 assert.equal((await confirmR6Candidate(p,R6_CONFIRMATION,at)).ok,false)
 const p2=await defer();t.mock.timers.tick(16*60000)
 assert.equal((await confirmR6Candidate(p2,R6_CONFIRMATION,new Date().toISOString())).ok,false);assert.equal(loadSchedule().entries[0].status,'planned')
})
test('cancel is appended and blocks subsequent confirmation',async t=>{
 setup(t);const p=await defer();assert.equal((await rejectR6Candidate(p,at)).ok,true)
 assert.equal((await readR6History(day,at))[0].status,'REJECTED');assert.equal((await confirmR6Candidate(p,R6_CONFIRMATION,at)).ok,false)
})
test('new user counterevidence weakens decision without rewriting frozen explanation or actuals',async t=>{
 setup(t);const p=await defer();await confirmR6Candidate(p,R6_CONFIRMATION,at)
 const frozen=JSON.stringify(p.decision.input);assert.equal((await recordR6Feedback(p.id,{outcome:'WORSE',note:'局部感觉更差'},at)).ok,true)
 const h=(await readR6History(day,at))[0];assert.equal(h.reassessment.state,'WEAKENED');assert.equal(JSON.stringify(h.proposal.decision.input),frozen)
 assert.equal(loadSchedule().entries[0].actual,undefined);assert.ok(h.events.some(e=>e.action==='FEEDBACK'))
})
test('correction to a depended-on source withdraws applicability and preserves prior ledger',async t=>{
 setup(t);assert.equal(savePersonalResponse(response('pain','PAIN',0)).ok,true)
 const p=await defer();await confirmR6Candidate(p,R6_CONFIRMATION,at)
 assert.equal(savePersonalResponse(response('pain','PAIN',2,2)).ok,true)
 const h=(await readR6History(day,at))[0];assert.equal(h.reassessment.state,'WITHDRAWN')
 assert.equal(h.proposal.decision.input.snapshot.facts.find(f=>f.id==='pain')?.revision,1)
 assert.ok(h.reassessment.reasons.some(r=>r.includes('更正')))
})
test('new pain after confirmation flags reassessment rather than a causal diagnosis',async t=>{
 setup(t);const p=await defer();await confirmR6Candidate(p,R6_CONFIRMATION,at)
 savePersonalResponse(response('new-pain','PAIN',4));const h=(await readR6History(day,at))[0]
 assert.equal(h.reassessment.state,'WEAKENED');assert.match(h.reassessment.message,/反证/);assert.doesNotMatch(h.reassessment.message,/导致|诊断/)
})
test('invalid dates and future reads fail before preparing any writes',async t=>{
 setup(t);await assert.rejects(readR6Decision('2026-02-30',at));await assert.rejects(readR6Decision(day,'2026-10-27T10:00:00Z'))
})
test('B moves only a saved posterior-chain course around speed when local function and prior tolerance are known',async t=>{
 const strength=entry({id:'posterior',date:'2026-10-27',modality:'strength',kind:'strength',title:'后链力量',lowerHeavy:true,exercises:[{name:'罗马尼亚硬拉',sets:'3',reps:'6',weight:'40',rpe:'6',restSec:120}],runComponents:[{componentId:'strength',modality:'STRENGTH',strengthSessionId:'saved-strength'}]})
 const prior={...strength,id:'prior',date:'2026-10-24',status:'done' as const,actual:{outcome:'as_planned' as const,minutes:20,intensity:'EASY' as const,reasons:[],note:'',at:'2026-10-24T10:00:00.000Z'}}
 const fast=entry({id:'speed',date:'2026-10-28',runComponents:[{componentId:'speed',modality:'RUNNING',purpose:'REPETITION_SPEED',structure:{kind:'CONTINUOUS',plannedDistanceMeters:100,plannedDistanceMaxMeters:null,plannedDurationSeconds:15}}]})
 setup(t,[strength,fast,prior]);saveProfile({...emptyProfile(),trainingDays:[0,1,2,3,4,5,6],minutes:60});savePersonalResponse(response('pain','PAIN',0));savePersonalResponse(response('function','FUNCTION',0))
 const d=await readR6Decision(day,at),b=d.candidates.find(c=>c.action==='MOVE');assert.ok(b);assert.equal(b.changedVariable,'DATE');assert.equal(b.after.date,'2026-10-30')
 const p=await prepareR6Candidate(b.id,day,at);assert.equal((await confirmR6Candidate(p,R6_CONFIRMATION,at)).ok,true)
 const after=loadSchedule().entries.find(e=>e.id==='posterior')!;assert.deepEqual(after.exercises,strength.exercises);assert.equal(after.minutes,strength.minutes);assert.equal(loadSchedule().entries.find(e=>e.id==='speed')?.date,fast.date)
})
test('concurrent confirmation has exactly one winner under the shared schedule lock',async t=>{
 setup(t);const p=await defer(),results=await Promise.all([confirmR6Candidate(p,R6_CONFIRMATION,at),confirmR6Candidate(p,R6_CONFIRMATION,at)])
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(loadSchedule().entries.length,1)
})
test('accepted calendar receipt recovers history after ledger write fails',async t=>{
 const {box}=setup(t);const p=await defer(),set=box.setItem
 box.setItem=(key,value)=>{if(key.startsWith('fk-r6-ledger:')&&value.includes('"action":"ACCEPTED"'))throw Error('simulated quota');set(key,value)}
 assert.equal((await confirmR6Candidate(p,R6_CONFIRMATION,at)).ok,true)
 box.setItem=set
 assert.equal((await readR6History(day,at))[0].status,'ACCEPTED');assert.equal((await confirmR6Candidate(p,R6_CONFIRMATION,at)).ok,false)
})
test('A keeps a familiar easy course and recorded execution supports feasibility without claiming causation',async t=>{
 const prior=entry({id:'prior-easy',date:'2026-10-24',status:'done',actual:{outcome:'as_planned',minutes:20,intensity:'EASY',note:'',reasons:[],at:'2026-10-24T10:00:00.000Z'}})
 setup(t,[entry(),prior]);savePersonalResponse(response('pain','PAIN',0));savePersonalResponse(response('function','FUNCTION',0))
 const d=await readR6Decision(day,at),a=d.candidates.find(c=>c.action==='KEEP')!;assert.equal(a.canConfirm,true)
 const p=await prepareR6Candidate(a.id,day,at);assert.equal((await confirmR6Candidate(p,R6_CONFIRMATION,at)).ok,true)
 const schedule=loadSchedule();assert.equal(saveSchedule({...schedule,entries:schedule.entries.map(e=>e.id==='course'?{...e,status:'done',actual:{outcome:'as_planned',minutes:20,intensity:'EASY',note:'原结构完成',reasons:[],at}}:e)}),true)
 const h=(await readR6History(day,at))[0];assert.equal(h.reassessment.state,'SUPPORTED');assert.match(h.reassessment.message,/不能证明长期/);assert.equal(h.execution.state,'COMPLETED')
})
test('C later reschedule is a second explicit preview preserving the same course and dose',async t=>{
 const prior=entry({id:'prior-easy',date:'2026-10-24',status:'done',actual:{outcome:'as_planned',minutes:20,intensity:'EASY',note:'',reasons:[],at:'2026-10-24T10:00:00.000Z'}})
 setup(t,[entry(),prior]);saveProfile({...emptyProfile(),trainingDays:[0,1,2,3,4,5,6],minutes:60});savePersonalResponse(response('pain','PAIN',0));savePersonalResponse(response('function','FUNCTION',0))
 const p=await defer();await confirmR6Candidate(p,R6_CONFIRMATION,at)
 const next=await prepareR6Reschedule(p.id,'2026-10-30',at);assert.equal(loadSchedule().entries.find(e=>e.id==='course')?.status,'skipped')
 assert.equal((await confirmR6Candidate(next,R6_CONFIRMATION,at)).ok,true)
 const e=loadSchedule().entries.find(e=>e.id==='course')!;assert.equal(e.date,'2026-10-30');assert.equal(e.status,'planned');assert.equal(e.minutes,20);assert.equal(e.actual,undefined);assert.equal(loadSchedule().entries.length,2)
 assert.deepEqual(e.runComponents,p.candidate.before.runComponents)
})
