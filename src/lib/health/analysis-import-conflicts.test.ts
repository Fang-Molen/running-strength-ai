import test from 'node:test'
import assert from 'node:assert/strict'
import { currentAthleteId, setEventContext } from '../core/events'
import { setStoreBackend } from '../core/storage'
import { createTrainingImportDraft, confirmTrainingImport } from '../core/training-import'
import { appendCorrection } from '../core/training-correction'
import { readCurrentImportConflicts } from '../core/current-import-conflicts'
import type { CoachBrief } from '../core/coach-brief'
import { readOnlineContext } from '../coach/online-context'
import { readAnalysis } from './analysis-host'
import { readCoachData, assertCoachData, answerFromAppData } from './coach-data'
import { garminViewKey } from './garmin-view-scope'
import type { TrainingFact } from './analysis-contract'

const day='2026-10-22',asOf='2026-10-22T12:00:00.000Z',owner='synthetic-analysis-conflicts'
const identity='garmin:synthetic-account:activity-A'
const recorded=<T>(value:T)=>({status:'RECORDED' as const,value,sourceIds:['user-confirmed']})
function fixture(t:test.TestContext){
 t.mock.timers.enable({apis:['Date'],now:new Date(asOf)})
 const previousOwner=currentAthleteId(),oldFetch=globalThis.fetch,originals=['localStorage','window'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const)
 const data=new Map<string,string>(),store={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)},keys:()=>[...data.keys()]}
 Object.defineProperty(globalThis,'localStorage',{value:store,configurable:true});Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true})
 globalThis.fetch=()=>{throw Error('SYNTHETIC_CONFLICT_TEST_NO_NETWORK')};setStoreBackend(store);setEventContext({athleteId:owner})
 t.after(()=>{setStoreBackend(null);setEventContext({athleteId:previousOwner});globalThis.fetch=oldFetch;for(const [key,old]of originals){if(old)Object.defineProperty(globalThis,key,old);else Reflect.deleteProperty(globalThis,key)}})
 const draft=createTrainingImportDraft({sport:'RUNNING',occurredAt:recorded(`${day}T09:00:00.000Z`),title:recorded('合成独立活动'),totalDistanceMeters:recorded(5000),durationSeconds:recorded(1800),
  runningSegments:[{id:'segment-A',kind:'REPETITION',distanceMeters:recorded(300),durationSeconds:recorded(50),completion:'COMPLETED',sourceIds:['user-confirmed']}]},'TEXT',['user-confirmed'])
 draft.sourceRecordIdentity=identity
 const saved=confirmTrainingImport(draft);assert.ok(saved.ok)
 const cache=(patch:Record<string,unknown>={})=>store.setItem(garminViewKey('fk-garmin-acts-v1'),JSON.stringify({A:{athleteId:owner,id:123,sourceIdentity:identity,start:`${day}T09:00:00.000Z`,type:'running',dist:5000,dur:1900,...patch}}))
 return{data,store,cache,record:saved.record}
}
const training=(analysis:ReturnType<typeof readAnalysis>)=>analysis.snapshot.facts.filter((f):f is TrainingFact=>f.kind==='TRAINING')
const read=()=>readAnalysis(day,asOf,'分析我的跑步训练')
const context=()=>readOnlineContext('分析我的跑步训练',day,asOf).context

test('1A real analysis and online entry withdraw a conflicted total while retaining reliable segments and provenance',t=>{
 const f=fixture(t);f.cache();const before=JSON.stringify([...f.data]),a=read(),facts=training(a)
 assert.equal(facts.length,1);assert.equal(facts[0].actualDurationSeconds,null);assert.equal(facts[0].endedAt,null)
 assert.deepEqual(facts[0].runSegments.map(s=>[s.distanceM,s.durationSeconds]),[[300,50]])
 assert.equal(facts[0].knownAt,f.record.confirmedAt);assert.equal(facts[0].receivedAt,f.record.confirmedAt)
 assert.match(a.snapshot.gaps.join('\n'),/当前.*冲突.*缓存录入时间未知.*不作为历史事实/)
 assert.match(a.muscle.sources[0].detail,/5\.00 km/);assert.doesNotMatch(a.muscle.sources[0].detail,/30:00|31:40/)
 const c=context(),parent=c.records.find(r=>r.fields.some(field=>field.name==='actualDuration'))
 assert.ok(parent);assert.equal(parent.fields.find(field=>field.name==='actualDuration')?.value,null)
 assert.ok(c.records.some(r=>r.fields.some(field=>field.name==='duration'&&field.value===50)))
 assert.match(c.coverage.unknowns.join('\n'),/当前.*冲突.*录入时间未知.*不作为历史事实/)
 assert.doesNotMatch(JSON.stringify(c),/1900|synthetic-account|activity-A/)
 assert.equal(JSON.stringify([...f.data]),before)
})

test('1A distance-only conflict hides aggregate distance and pace without withdrawing reliable total time',t=>{
 const f=fixture(t);f.cache({dist:5100,dur:1800});const a=read(),fact=training(a)[0]
 assert.equal(fact.actualDurationSeconds,1800);assert.equal(fact.endedAt,`${day}T09:30:00.000Z`)
 assert.deepEqual(fact.runSegments.map(s=>[s.distanceM,s.durationSeconds]),[[300,50]])
 assert.match(a.muscle.sources[0].detail,/30:00/);assert.doesNotMatch(a.muscle.sources[0].detail,/5\.00|5\.10|配速/)
 assert.match(context().coverage.unknowns.join('\n'),/当前.*冲突/)
 assert.doesNotMatch(JSON.stringify(a),/5100/)
})

test('1A legacy daily context withdraws both conflicting totals and surfaces their current limitation',t=>{
 const f=fixture(t);f.cache({dist:5100});const before=JSON.stringify([...f.data]),legacy=readCoachData(day)
 assertCoachData(legacy);assert.equal(legacy.imports.count,1)
 assert.equal(legacy.imports.latest[0].durationSec,null);assert.equal(legacy.imports.latest[0].distanceM,null)
 assert.match(legacy.warnings.join('\n'),/当前.*冲突.*录入时间未知.*不作为历史事实/)
 assert.doesNotMatch(JSON.stringify(legacy),/1900|5100|5\.00 km|30:00/)
 for(const question of ['最近导入训练记录','最近手表跑步数据']){
  const answer=answerFromAppData({question,appData:legacy} as CoachBrief)
  assert.ok(answer);assert.match(answer,/当前.*冲突.*录入时间未知.*不作为历史事实/)
  assert.doesNotMatch(answer,/1800|1900|5000|5100|5\.00 km|30:00/)
 }
 assert.equal(JSON.stringify([...f.data]),before)
})

test('1A historical asOf receives only a present uncertainty note, never cache observations or future imports',t=>{
 const f=fixture(t);t.mock.timers.tick(86_400_000);f.cache()
 const a=read(),fact=training(a)[0],diagnostic=readCurrentImportConflicts([f.record]).get(f.record.confirmedImportId)!
 assert.equal(fact.actualDurationSeconds,null);assert.equal(fact.knownAt,asOf);assert.equal(fact.receivedAt,asOf)
 assert.equal(diagnostic.cacheKnownAt,null);assert.equal(diagnostic.usableAsHistoricalEvidence,false);assert.equal(diagnostic.observedAt,'2026-10-23T12:00:00.000Z')
 assert.ok(a.snapshot.facts.every(row=>Date.parse(row.knownAt)<=Date.parse(asOf)))
 assert.match(context().coverage.unknowns.join('\n'),/当前.*冲突.*不作为历史事实/)
 assert.doesNotMatch(JSON.stringify(a.snapshot),/1900|2026-10-23/)
 const prior=readAnalysis(day,'2026-10-22T11:59:59.000Z','分析我的跑步训练')
 assert.equal(training(prior).length,0);assert.doesNotMatch(prior.snapshot.gaps.join('\n'),/缓存.*冲突/)
})

test('1A same day and distance do not bridge identities, missing cache fields or another owner',t=>{
 const f=fixture(t)
 for(const patch of [{sourceIdentity:'garmin:synthetic-account:activity-B'},{dur:null,dist:null},{athleteId:'other-athlete'}]){
  f.cache(patch);const a=read()
  assert.equal(training(a)[0].actualDurationSeconds,1800);assert.doesNotMatch(a.snapshot.gaps.join('\n'),/缓存.*冲突/)
  assert.equal(readCoachData(day).imports.latest[0].durationSec,1800)
 }
 f.cache();setEventContext({athleteId:'other-athlete'})
 assert.equal(training(read()).length,0);assert.equal(readCoachData(day).imports.count,0)
 assert.doesNotMatch(context().coverage.unknowns.join('\n'),/缓存.*冲突/)
})

test('1A a reloaded cache remains transient and clearing it restores only the unchanged confirmed total',t=>{
 const f=fixture(t);f.cache();const raw=JSON.stringify([...f.data]),disk=new Map<string,string>(JSON.parse(raw))
 setStoreBackend({getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value)},keys:()=>[...disk.keys()]})
 assert.equal(training(read())[0].actualDurationSeconds,null);assert.equal(readCoachData(day).imports.latest[0].durationSec,null)
 assert.equal(JSON.stringify([...disk]),raw);disk.delete(garminViewKey('fk-garmin-acts-v1'))
 assert.equal(training(read())[0].actualDurationSeconds,1800);assert.equal(readCoachData(day).imports.latest[0].durationSec,1800)
 assert.doesNotMatch(context().coverage.unknowns.join('\n'),/缓存.*冲突/)
})

test('1A the modern entry does not restore stale aggregate totals after a confirmed segment correction',t=>{
 const f=fixture(t);t.mock.timers.tick(1000)
 assert.ok(appendCorrection({trainingOccurrenceId:f.record.confirmedImportId,kind:'FIELD',field:'duration',setKey:'segment-A',originalValue:'50',newValue:'55',reason:'合成分段更正'}))
 assert.ok(appendCorrection({trainingOccurrenceId:f.record.confirmedImportId,kind:'FIELD',field:'distance',setKey:'segment-A',originalValue:'300',newValue:'400',reason:'合成分段更正'}))
 const a=readAnalysis(day,new Date().toISOString(),'分析我的跑步训练'),fact=training(a)[0]
 assert.equal(fact.actualDurationSeconds,null);assert.equal(fact.endedAt,null)
 assert.deepEqual(fact.runSegments.map(s=>[s.distanceM,s.durationSeconds]),[[400,55]])
 assert.doesNotMatch(a.muscle.sources[0].detail,/5\.00 km|30:00|配速/)
 assert.equal(training(read())[0].actualDurationSeconds,1800)
})
