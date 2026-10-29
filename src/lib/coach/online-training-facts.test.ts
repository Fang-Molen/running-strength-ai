import test from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend,writeEnvelope} from '../core/storage.ts'
import {currentAthleteId,setEventContext,dispatchEvent,loadCommittedEventRecords,EVENTS_KEY,EVENT_JOURNAL_PREFIX} from '../core/events.ts'
import {startTraining,completeTraining} from '../core/training-decision.ts'
import {bindTrainingStart,closeTrainingOccurrence} from '../core/occurrence.ts'
import {emptySets,recordSet} from '../core/execution.ts'
import {appendCorrection} from '../core/training-correction.ts'
import {createTrainingImportDraft,confirmTrainingImport,type TrainingImportCandidate} from '../core/training-import.ts'
import {saveRunningPlan} from '../core/running-plan.ts'
import {startTrackSession,commitTrackContinuous,finishTrackSession} from '../ui/running-workouts.ts'
import {onlineTrainingFacts} from './online-training-facts.ts'
import {logSession,type Session,type Plan} from '../strength/model.ts'
import {garminViewKey} from '../health/garmin-view-scope.ts'
import {readCurrentImportConflicts} from '../core/current-import-conflicts.ts'

const day='2026-10-22',asOf='2026-10-22T12:00:00.000Z',owner='synthetic-online-training'
function fixture(t:test.TestContext){
 t.mock.timers.enable({apis:['Date'],now:new Date(asOf)})
 const previousOwner=currentAthleteId(),oldLocal=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldFetch=globalThis.fetch
 const data=new Map<string,string>(),store={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)},keys:()=>[...data.keys()]}
 Object.defineProperty(globalThis,'localStorage',{value:store,configurable:true});Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true})
 globalThis.fetch=()=>{throw Error('SYNTHETIC_TEST_NO_NETWORK')};setStoreBackend(store);setEventContext({athleteId:owner})
 t.after(()=>{setStoreBackend(null);setEventContext({athleteId:previousOwner});globalThis.fetch=oldFetch;for(const [key,old]of [['localStorage',oldLocal],['window',oldWindow]] as const){if(old)Object.defineProperty(globalThis,key,old);else Reflect.deleteProperty(globalThis,key)}})
 return{data,store}
}
const session=(id='lift',timed=false):Session=>({id,name:'PRIVATE_LOCATION_ACCOUNT_AND_NOTES',moves:[{id:'move',catalogId:timed?'plank':'back-squat',customName:'PRIVATE_CUSTOM_NAME',sets:1,mode:timed?'seconds':'reps',amount:timed?45:8,restSec:60,weightKg:40}]})
function strength(t:test.TestContext,id='lift',finished=true,timed=false){
 const plan=session(id,timed),decisionId='decision-'+id,event=startTraining({decisionId,sessionId:id,action:'ORIGINAL_PLAN'});assert.ok(event)
 assert.ok(bindTrainingStart({startEventId:event.event_id,startedAt:event.timestamp,sessionId:id,planSlotId:id,plan}))
 assert.ok(recordSet(id,decisionId,{...emptySets(plan)[0],actualWeight:40,actualAmount:timed?45:8,completed:true,source:'user_entered',timestamp:new Date().toISOString()}))
 if(finished){t.mock.timers.tick(60_000);const close=completeTraining({decisionId,sessionId:id,planned:null,actualSets:1,actualAmount:timed?45:8,actualWeightKg:40,rpe:6,pain:false,modified:false,interrupted:false});assert.ok(close);assert.ok(closeTrainingOccurrence(close))}
 return event.event_id
}
const text=(f:ReturnType<typeof onlineTrainingFacts>)=>[...f.summary,...f.details].join('\n')
const recorded=<T>(value:T)=>({status:'RECORDED' as const,value,sourceIds:['user-confirmed']})
function imported(patch:Partial<TrainingImportCandidate>={}){
 const draft=createTrainingImportDraft({sport:'RUNNING',occurredAt:recorded(`${day}T09:00:00.000Z`),title:recorded('PRIVATE_IMPORT_LOCATION'),totalDistanceMeters:recorded(5000),durationSeconds:recorded(1800),sessionRpe:recorded(7),...patch},'TEXT',['user-confirmed'])
 const result=confirmTrainingImport(draft);assert.ok(result.ok,JSON.stringify(result))
 return result.record
}

test('unlinked chat includes completed native strength actual values and completion RPE without private labels',t=>{
 fixture(t);strength(t)
 const facts=onlineTrainingFacts(day,new Date().toISOString()),out=text(facts)
 assert.match(out,/力量/);assert.match(out,/40\s*kg/);assert.match(out,/8\s*次/);assert.match(out,/整课RPE\s*6/);assert.match(out,/已完成/)
 assert.doesNotMatch(out,/PRIVATE_|synthetic-online-training|decision-lift/)
 assert.ok(facts.summary.every(x=>x.length<=500));assert.ok(facts.details.length<=8&&facts.details.every(x=>x.length<=350))
})
test('an open session retains recorded timed sets while its whole-session status remains unfinished',t=>{
 fixture(t);strength(t,'timed',false,true)
 const out=text(onlineTrainingFacts(day,asOf))
 assert.match(out,/45\s*秒/);assert.match(out,/未完成|进行中/);assert.match(out,/整课RPE未记录/)
 assert.doesNotMatch(out,/整课已完成|力量已完成1次/)
})
test('weight corrections and deletion are reflected on each read, with prior asOf preserving the earlier value',t=>{
 fixture(t);const id=strength(t),before=new Date().toISOString();t.mock.timers.tick(1000)
 assert.ok(appendCorrection({trainingOccurrenceId:id,kind:'FIELD',field:'weight',setKey:'move:1',originalValue:'40',newValue:'55',reason:'PRIVATE_CORRECTION_NOTE'}))
 const current=text(onlineTrainingFacts(day,new Date().toISOString()));assert.match(current,/55\s*kg/);assert.doesNotMatch(current,/40\s*kg|PRIVATE_/)
 assert.match(text(onlineTrainingFacts(day,before)),/40\s*kg/)
 t.mock.timers.tick(1000);assert.ok(appendCorrection({trainingOccurrenceId:id,kind:'VOID',reason:'PRIVATE_DELETE_NOTE'}))
 assert.doesNotMatch(text(onlineTrainingFacts(day,new Date().toISOString())),/55\s*kg|40\s*kg/)
})
test('future committed work and another athlete never enter the current request even when selected',t=>{
 fixture(t);const id=strength(t),now=new Date().toISOString()
 assert.doesNotMatch(text(onlineTrainingFacts(day,'2026-10-22T11:59:00.000Z',{selectedOccurrenceId:id})),/40\s*kg|8\s*次/)
 setEventContext({athleteId:'another-athlete'});assert.doesNotMatch(text(onlineTrainingFacts(day,now,{selectedOccurrenceId:id})),/40\s*kg|8\s*次/)
})
test('completed native running stays separate from strength and carries actual distance and duration',t=>{
 fixture(t);strength(t)
 assert.ok(saveRunningPlan({planId:'trace-run',planSlotId:'trace-run',components:[{componentId:'run',modality:'RUNNING',purpose:'UNSPECIFIED',structure:{kind:'CONTINUOUS',plannedDistanceMeters:400,plannedDurationSeconds:null}}]}).ok)
 const start=startTrackSession('trace-run');assert.ok(start.ok,JSON.stringify(start))
 assert.ok(commitTrackContinuous(start.trainingOccurrenceId,'run','90.1','400').ok);assert.ok(finishTrackSession(start.trainingOccurrenceId,'COMPLETED',7,0).ok)
 const out=text(onlineTrainingFacts(day,new Date().toISOString()))
 assert.match(out,/跑步/);assert.match(out,/400\s*米/);assert.match(out,/90\.1\s*秒/);assert.match(out,/整课RPE\s*7/);assert.match(out,/40\s*kg/)
})
test('selected older native training gets detail priority while the day summary stays on the requested date',t=>{
 fixture(t);const old=strength(t,'old');t.mock.timers.tick(86400000)
 for(let i=0;i<9;i++)strength(t,'new-'+i)
 const facts=onlineTrainingFacts('2026-10-23',new Date().toISOString(),{selectedOccurrenceId:old})
 assert.match(facts.summary.join('\n'),/2026-10-23/);assert.match(facts.details[0],/2026-10-22/)
 assert.ok(facts.details.length<=8);assert.match(text(facts),/省略|摘要|选定/)
})
test('conflicting whole-session RPE is not averaged or replaced by the completion value',t=>{
 fixture(t);const id=strength(t)
 assert.ok(dispatchEvent('RPE_RECORDED',{trainingOccurrenceId:id,evidenceType:'SESSION_RPE',value:9}))
 const out=text(onlineTrainingFacts(day,new Date().toISOString()))
 assert.match(out,/RPE.*冲突/);assert.doesNotMatch(out,/整课RPE\s*(?:6|9)(?:\/10|[；。])/)
})
test('unreadable training containers differ from a clean empty history',t=>{
 const f=fixture(t);assert.match(text(onlineTrainingFacts(day,asOf)),/无.*记录|未.*记录/)
 f.data.set('fr255-training-occurrence-v1','{BROKEN')
 assert.match(text(onlineTrainingFacts(day,asOf)),/读取失败|无法读取/)
})
test('a malformed running transaction is reported instead of an empty training history',t=>{
 const f=fixture(t);f.data.set('fr255-running-tx-r3:corrupt','{BROKEN')
 assert.match(text(onlineTrainingFacts(day,asOf)),/读取失败|无法读取/)
})
test('reading a mixed native training history is storage read-only',t=>{
 const f=fixture(t);strength(t)
 const before=JSON.stringify([...f.data]);onlineTrainingFacts(day,new Date().toISOString())
 assert.equal(JSON.stringify([...f.data]),before)
})
test('confirmed totals-only running remains a dated actual import without invented segments or whole-session completion',t=>{
 fixture(t);const record=imported(),facts=onlineTrainingFacts(day,asOf),out=text(facts)
 assert.match(out,/总距离\s*5000\s*米/);assert.match(out,/总时长\s*1800\s*秒/);assert.match(out,/已确认导入\s*1/)
 assert.match(out,/逐组.*逐段.*已确认导入/);assert.match(out,/整课完成状态.*未知|整课完成状态.*未.*记录/)
 assert.doesNotMatch(out,/第1段|整课已完成|PRIVATE_|synthetic-online-training/)
 assert.doesNotMatch(text(onlineTrainingFacts(day,'2026-10-22T11:59:59.000Z',{selectedOccurrenceId:record.confirmedImportId})),/5000|1800/)
 setEventContext({athleteId:'other'});assert.doesNotMatch(text(onlineTrainingFacts(day,asOf,{selectedOccurrenceId:record.confirmedImportId})),/5000|1800/)
})
test('a confirmed duration-only strength import has actual seconds and does not fabricate sets or running distance',t=>{
 fixture(t);imported({sport:'STRENGTH',totalDistanceMeters:{status:'ABSENT',value:null,sourceIds:[]},durationSeconds:recorded(1500)})
 const out=text(onlineTrainingFacts(day,asOf));assert.match(out,/力量1次|力量\s*1/);assert.match(out,/总时长\s*1500\s*秒/);assert.match(out,/总距离.*未知|总距离.*未记录/)
 assert.doesNotMatch(out,/第1组|第1段|5000\s*米|无截至分析时点可确认的实际记录/)
})
test('visible import total corrections withdraw old totals and preserve their historical asOf values',t=>{
 fixture(t);const record=imported();t.mock.timers.tick(1000)
 assert.ok(appendCorrection({trainingOccurrenceId:record.confirmedImportId,kind:'FIELD',field:'distance',originalValue:'5000',newValue:'6000',reason:'PRIVATE_TOTAL_CORRECTION'}))
 let out=text(onlineTrainingFacts(day,new Date().toISOString()));assert.match(out,/总距离.*更正.*未知|总距离.*未知.*更正/);assert.match(out,/总时长\s*1800\s*秒/);assert.doesNotMatch(out,/5000|6000|PRIVATE_/)
 t.mock.timers.tick(1000);assert.ok(appendCorrection({trainingOccurrenceId:record.confirmedImportId,kind:'FIELD',field:'duration',originalValue:'1800',newValue:'1700',reason:'撤回未核准总时长'}))
 out=text(onlineTrainingFacts(day,new Date().toISOString()));assert.match(out,/总时长.*更正.*未知|总时长.*未知.*更正/);assert.match(out,/已确认导入\s*1/);assert.doesNotMatch(out,/1800|1700/)
 const historical=text(onlineTrainingFacts(day,asOf));assert.match(historical,/总距离\s*5000\s*米/);assert.match(historical,/总时长\s*1800\s*秒/)
})
test('corrected import segments remain segment values while aggregate distance and duration are withdrawn',t=>{
 fixture(t);const record=imported({runningSegments:[{id:'only-segment',kind:'CONTINUOUS',round:{status:'ABSENT',value:null,sourceIds:[]},repeat:{status:'ABSENT',value:null,sourceIds:[]},distanceMeters:recorded(300),durationSeconds:recorded(50),recoverySeconds:{status:'ABSENT',value:null,sourceIds:[]},completion:'COMPLETED',sourceIds:['user-confirmed']}]})
 t.mock.timers.tick(1000)
 assert.ok(appendCorrection({trainingOccurrenceId:record.confirmedImportId,kind:'FIELD',field:'distance',setKey:'only-segment',originalValue:'300',newValue:'400',reason:'合成分段更正'}))
 assert.ok(appendCorrection({trainingOccurrenceId:record.confirmedImportId,kind:'FIELD',field:'duration',setKey:'only-segment',originalValue:'50',newValue:'55',reason:'合成分段更正'}))
 const out=text(onlineTrainingFacts(day,new Date().toISOString()));assert.match(out,/第1段\s*400米，55秒/);assert.match(out,/总距离.*未知/);assert.match(out,/总时长.*未知/)
 assert.doesNotMatch(out,/总距离\s*400\s*米|总时长\s*55\s*秒|5000|1800/)
})
test('a legitimate import feedback withdrawal supersedes RPE without being mislabelled a source conflict',t=>{
 fixture(t);const record=imported();t.mock.timers.tick(1000)
 assert.ok(appendCorrection({trainingOccurrenceId:record.confirmedImportId,kind:'FIELD',field:'feedback',originalValue:'7',newValue:'6',reason:'整课评分待核对'}))
 const out=text(onlineTrainingFacts(day,new Date().toISOString()));assert.match(out,/整课RPE.*未记录|整课RPE.*未知|整课RPE.*撤回/);assert.doesNotMatch(out,/RPE.*冲突|整课RPE\s*[67]/)
 assert.match(text(onlineTrainingFacts(day,asOf)),/整课RPE\s*7/)
})

test('the real strength-page completion feedback is readable without inventing plan sets or load',t=>{
 const f=fixture(t),plan:Plan={name:'PRIVATE_PLAN',sessions:[session('feedback-only')]}
 const saved=logSession(plan,'feedback-only','hard',[],'PRIVATE_NOTE_ACCOUNT_LOCATION')
 assert.equal(saved.cycle?.logs[0].feel,'hard')
 const before=JSON.stringify([...f.data]),facts=onlineTrainingFacts(day,asOf),out=text(facts)
 assert.match(out,/完成自报|自报完成/);assert.match(out,/反馈[：:]?\s*偏重/)
 assert.match(out,/实际组数.*未记录|实际组.*未知/);assert.match(out,/未据此计算.*次数.*训练量/)
 assert.doesNotMatch(out,/40\s*kg|8\s*次|第1组|PRIVATE_|本机已完成1次/)
 assert.equal(JSON.stringify([...f.data]),before)
})

test('editing strength feedback keeps one dated report and a later skip withdraws its completion claim',t=>{
 fixture(t);let plan:Plan={name:'PRIVATE_PLAN',sessions:[session('feedback-edit')]}
 plan=logSession(plan,'feedback-edit','hard',[],'');t.mock.timers.tick(1000)
 plan=logSession(plan,'feedback-edit','easy',[],'')
 let facts=onlineTrainingFacts(day,new Date().toISOString()),out=text(facts)
 assert.equal(facts.details.length,1);assert.match(out,/反馈[：:]?\s*太轻松/);assert.doesNotMatch(out,/偏重/)
 assert.match(out,/完成自报1条|自报完成1条/);assert.doesNotMatch(out,/本机已完成[12]次/)
 t.mock.timers.tick(1000);logSession(plan,'feedback-edit','skip',[],'')
 out=text(onlineTrainingFacts(day,new Date().toISOString()))
 assert.match(out,/未完成|中断|未练/);assert.doesNotMatch(out,/完成自报1条|自报完成1条|本机已完成1次/)
 assert.match(text(onlineTrainingFacts(day,asOf)),/反馈[：:]?\s*偏重/)
})

test('strength completion feedback requires current owner and a reliable journal time at the cutoff',t=>{
 const f=fixture(t),plan:Plan={name:'PRIVATE_PLAN',sessions:[session('feedback-scope')]}
 logSession(plan,'feedback-scope','hard',[],'')
 assert.match(text(onlineTrainingFacts(day,asOf)),/偏重/)
 assert.doesNotMatch(text(onlineTrainingFacts(day,'2026-10-22T11:59:59.000Z')),/偏重|完成自报1条|自报完成1条/)
 setEventContext({athleteId:'another-athlete'});assert.doesNotMatch(text(onlineTrainingFacts(day,asOf)),/偏重|完成自报1条|自报完成1条/)
 setEventContext({athleteId:owner})
 const event=loadCommittedEventRecords().find(r=>r.event.event_type==='TRAINING_COMPLETED')!.event
 for(const key of f.data.keys())if(key.startsWith(EVENT_JOURNAL_PREFIX))f.data.delete(key)
 assert.ok(writeEnvelope(EVENTS_KEY,[event]))
 const out=text(onlineTrainingFacts(day,asOf));assert.doesNotMatch(out,/偏重|完成自报1条|自报完成1条/)
 assert.match(out,/缺少可靠录入时间|录入时间.*未知/)
})

test('voiding and restoring a dated strength completion report obey their known-time boundary',t=>{
 fixture(t);logSession({name:'PRIVATE_PLAN',sessions:[session('feedback-void')]},'feedback-void','hard',[],'')
 const id=`sets:feedback-void:${day}`
 t.mock.timers.tick(1000);assert.ok(appendCorrection({trainingOccurrenceId:id,kind:'VOID',reason:'合成撤销反馈'}))
 assert.doesNotMatch(text(onlineTrainingFacts(day,new Date().toISOString())),/偏重|完成自报1条|自报完成1条/)
 assert.match(text(onlineTrainingFacts(day,asOf)),/偏重/)
 t.mock.timers.tick(1000);assert.ok(appendCorrection({trainingOccurrenceId:id,kind:'RESTORE',reason:'合成恢复反馈'}))
 assert.match(text(onlineTrainingFacts(day,new Date().toISOString())),/偏重/)
 t.mock.timers.tick(1000);assert.ok(appendCorrection({trainingOccurrenceId:id,kind:'FIELD',field:'feedback',originalValue:'hard',newValue:'easy',reason:'原反馈待核对'}))
 const out=text(onlineTrainingFacts(day,new Date().toISOString()))
 assert.match(out,/反馈.*(?:撤回|未知|待核对)/);assert.doesNotMatch(out,/偏重|太轻松/)
})

test('an occurrence-bound completion and an unbound event used as its close never create extra reports',t=>{
 fixture(t);strength(t,'bound-close')
 strength(t,'legacy-close',false)
 const close=dispatchEvent('TRAINING_COMPLETED',{sessionId:'legacy-close',actual:{sets:1},setsCompleted:1,rpe:6,completion:true});assert.ok(close)
 assert.ok(closeTrainingOccurrence(close))
 const facts=onlineTrainingFacts(day,new Date().toISOString()),out=text(facts)
 assert.equal(facts.details.length,2);assert.match(out,/本机已完成2次/)
 assert.doesNotMatch(out,/完成自报[1-9]条|自报完成[1-9]条/)
})

test('a real confirmed Garmin import is readable without an optional watch cache and retains owner/asOf/void boundaries',t=>{
 const f=fixture(t),draft=createTrainingImportDraft({sport:'RUNNING',occurredAt:recorded(`${day}T09:00:00.000Z`),title:recorded('PRIVATE_GARMIN_TITLE'),totalDistanceMeters:recorded(5321),durationSeconds:recorded(1845),sessionRpe:recorded(7)},'TEXT',['user-confirmed'])
 draft.sourceRecordIdentity='garmin:PRIVATE_ACCOUNT:12345'
 const result=confirmTrainingImport(draft);assert.ok(result.ok,JSON.stringify(result))
 assert.ok([...f.data.keys()].every(k=>!k.includes('garmin-acts')))
 const out=text(onlineTrainingFacts(day,asOf))
 assert.match(out,/总距离\s*5321\s*米/);assert.match(out,/总时长\s*1845\s*秒/);assert.match(out,/已确认导入1条/);assert.match(out,/整课RPE\s*7/)
 assert.doesNotMatch(out,/PRIVATE_|整课已完成|第1段/)
 assert.doesNotMatch(text(onlineTrainingFacts(day,'2026-10-22T11:59:59.000Z')),/5321|1845/)
 setEventContext({athleteId:'another-athlete'});assert.doesNotMatch(text(onlineTrainingFacts(day,asOf)),/5321|1845/);setEventContext({athleteId:owner})
 t.mock.timers.tick(1000);assert.ok(appendCorrection({trainingOccurrenceId:result.record.confirmedImportId,kind:'VOID',reason:'合成撤销导入'}))
 assert.doesNotMatch(text(onlineTrainingFacts(day,new Date().toISOString())),/5321|1845/)
 assert.match(text(onlineTrainingFacts(day,asOf)),/5321/)
})

function currentCacheFixture(t:test.TestContext){
 const f=fixture(t),identity='garmin:PRIVATE_ACCOUNT:activity-A'
 const draft=createTrainingImportDraft({sport:'RUNNING',occurredAt:recorded(`${day}T09:00:00.000Z`),title:recorded('PRIVATE_WATCH_TITLE'),totalDistanceMeters:recorded(5000),durationSeconds:recorded(1800),
  runningSegments:[{id:'segment-A',kind:'REPETITION',distanceMeters:recorded(300),durationSeconds:recorded(50),completion:'COMPLETED',sourceIds:['user-confirmed']}]},'TEXT',['user-confirmed'])
 draft.sourceRecordIdentity=identity
 const saved=confirmTrainingImport(draft);assert.ok(saved.ok)
 const cache=(patch:Record<string,unknown>={})=>f.store.setItem(garminViewKey('fk-garmin-acts-v1'),JSON.stringify({A:{athleteId:owner,id:123,sourceIdentity:identity,start:`${day}T09:00:00.000Z`,type:'running',dist:5000,dur:1900,...patch}}))
 return {...f,cache,record:saved.record}
}

test('1A current same-identity cache conflict withdraws only the ambiguous total and preserves reliable segments',t=>{
 const f=currentCacheFixture(t);f.cache()
 const before=JSON.stringify([...f.data]),out=text(onlineTrainingFacts(day,asOf))
 assert.match(out,/总时长未知.*当前.*冲突/)
 assert.match(out,/总距离\s*5000米/);assert.match(out,/第1段\s*300米，50秒/)
 assert.match(out,/缓存.*录入时间未知/);assert.match(out,/不作为历史事实/)
 assert.doesNotMatch(out,/总时长\s*1800秒|1900|PRIVATE_/)
 assert.equal(JSON.stringify([...f.data]),before)
})

test('1A current distance conflict leaves unconflicted time available and never fabricates corrected totals',t=>{
 const f=currentCacheFixture(t);f.cache({dist:5100,dur:1800})
 const out=text(onlineTrainingFacts(day,asOf))
 assert.match(out,/总距离未知.*当前.*冲突/);assert.match(out,/总时长\s*1800秒/)
 assert.doesNotMatch(out,/总距离\s*5000米|5100/)
})

test('1A cache conflicts are current diagnostics even for a historical cutoff and never introduce future import facts',t=>{
 const f=currentCacheFixture(t);t.mock.timers.tick(86_400_000);f.cache()
 const out=text(onlineTrainingFacts(day,asOf,{selectedOccurrenceId:f.record.confirmedImportId}))
 assert.match(out,/当前.*冲突/);assert.match(out,/录入时间未知/);assert.match(out,/不作为历史事实/)
 assert.match(out,/第1段\s*300米，50秒/)
 assert.doesNotMatch(out,/1900|截止.*存在冲突/)
 const earlier=text(onlineTrainingFacts(day,'2026-10-22T11:59:59.000Z',{selectedOccurrenceId:f.record.confirmedImportId}))
 assert.doesNotMatch(earlier,/冲突|5000|1800|300米/)
})

test('1A similar independent identity, missing cache fields, and other owner cache never invalidate confirmed totals',t=>{
 const f=currentCacheFixture(t)
 for(const patch of [{sourceIdentity:'garmin:PRIVATE_ACCOUNT:activity-B'},{dur:null,dist:null},{athleteId:'other-athlete'}]){
  f.cache(patch)
  const out=text(onlineTrainingFacts(day,asOf))
  assert.match(out,/总时长\s*1800秒/);assert.match(out,/总距离\s*5000米/);assert.doesNotMatch(out,/来源冲突|缓存.*冲突/)
 }
 f.cache();setEventContext({athleteId:'other-athlete'})
 assert.doesNotMatch(text(onlineTrainingFacts(day,asOf,{selectedOccurrenceId:f.record.confirmedImportId})),/冲突|5000|1800|300米/)
})

test('1A corrected or removed current cache clears only its transient conflict and leaves confirmed import intact',t=>{
 const f=currentCacheFixture(t);f.cache();assert.match(text(onlineTrainingFacts(day,asOf)),/当前.*冲突/)
 f.cache({dur:1800});assert.match(text(onlineTrainingFacts(day,asOf)),/总时长\s*1800秒/)
 f.store.removeItem(garminViewKey('fk-garmin-acts-v1'))
 assert.match(text(onlineTrainingFacts(day,asOf)),/总时长\s*1800秒/)
})

test('1A current conflict metadata survives a fresh storage backend without acquiring historical validity or cache values',t=>{
 const f=currentCacheFixture(t);f.cache();t.mock.timers.tick(1000)
 const stored=JSON.stringify([...f.data]),disk=new Map<string,string>(JSON.parse(stored))
 const restarted={getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value)},keys:()=>[...disk.keys()]}
 setStoreBackend(restarted)
 const conflict=readCurrentImportConflicts([f.record]).get(f.record.confirmedImportId)
 assert.ok(conflict)
 const {note,...metadata}=conflict
 assert.deepEqual(metadata,{occurrenceId:f.record.confirmedImportId,duration:true,distance:false,observedAt:'2026-10-22T12:00:01.000Z',cacheKnownAt:null,usableAsHistoricalEvidence:false})
 assert.match(note,/当前.*冲突/);assert.match(note,/录入时间未知.*不作为历史事实/)
 assert.equal(JSON.stringify([...disk]),stored)
 assert.doesNotMatch(JSON.stringify(conflict),/1900|PRIVATE_/)
 setEventContext({athleteId:'other-athlete'})
 assert.equal(readCurrentImportConflicts([f.record]).size,0)
})
