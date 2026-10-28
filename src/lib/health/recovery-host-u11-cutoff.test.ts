import test from 'node:test'
import assert from 'node:assert/strict'
import { currentAthleteId, setEventContext } from '../core/events'
import { setStoreBackend, writeEnvelope } from '../core/storage'
import { bindTrainingStart, closeTrainingOccurrence } from '../core/occurrence'
import { appendCorrection, TRAINING_CORRECTION_KEY } from '../core/training-correction'
import { startTraining, completeTraining } from '../core/training-decision'
import { emptySets, recordSet } from '../core/execution'
import { createTrainingImportDraft, confirmTrainingImport } from '../core/training-import'
import { saveRunningPlan } from '../core/running-plan'
import { startTrackSession, commitTrackContinuous, finishTrackSession } from '../ui/running-workouts'
import { onlineRecoveryFacts } from '../coach/online-recovery-facts'
import { onlineTrainingFacts } from '../coach/online-training-facts'
import { readRecoveryProjection } from './recovery-host-u11'

const day='2026-10-20',athlete='synthetic-recovery-cutoff'
function fixture(t:test.TestContext){
 const owner=currentAthleteId(),oldFetch=globalThis.fetch,originals=['localStorage','window'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const)
 const map=new Map<string,string>(),box={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)},keys:()=>[...map.keys()]}
 setStoreBackend(box);setEventContext({athleteId:athlete})
 Object.defineProperty(globalThis,'localStorage',{value:box,configurable:true});Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true})
 globalThis.fetch=()=>{throw Error('SYNTHETIC_CUTOFF_TEST_NO_NETWORK')}
 t.after(()=>{setStoreBackend(null);setEventContext({athleteId:owner});globalThis.fetch=oldFetch;for(const [key,old]of originals){if(old)Object.defineProperty(globalThis,key,old);else Reflect.deleteProperty(globalThis,key)}})
 return{map,box}
}

const cutoff='2026-10-20T10:00:00.000Z'
const flatten=(v:{summary:string[];details:string[]})=>[...v.summary,...v.details].join('\n')
function cutoffLift(){
  const plan={id:'cutoff-lift',name:'合成时点力量',moves:[{id:'move',catalogId:'back-squat',customName:'',sets:1,mode:'reps' as const,amount:8,restSec:60,weightKg:40}]}
  const start=startTraining({decisionId:'cutoff-decision',sessionId:plan.id,action:'ORIGINAL_PLAN'});assert.ok(start)
  assert.ok(bindTrainingStart({startEventId:start.event_id,startedAt:start.timestamp,sessionId:plan.id,planSlotId:plan.id,plan}))
  assert.ok(recordSet(plan.id,'cutoff-decision',{...emptySets(plan)[0],actualWeight:40,actualAmount:8,completed:true,source:'user_entered',timestamp:new Date().toISOString()}))
  const close=completeTraining({decisionId:'cutoff-decision',sessionId:plan.id,planned:null,actualSets:1,actualAmount:8,actualWeightKg:40,rpe:6,pain:false,modified:false,interrupted:false});assert.ok(close);assert.ok(closeTrainingOccurrence(close))
  return start.event_id
}
const importedField=<T>(value:T)=>({value,status:'RECORDED' as const,sourceIds:['user-confirmed']})
function cutoffImport(){
  const draft=createTrainingImportDraft({sport:'STRENGTH',occurredAt:importedField(`${day}T09:00:00.000Z`),title:importedField('合成时点导入'),strengthSets:[{id:'set-1',exerciseName:importedField('深蹲'),setOrdinal:importedField(1),weightKg:importedField(40),repetitions:importedField(8),completion:'COMPLETED',sourceIds:['user-confirmed']}]},'TEXT',['user-confirmed'])
  const saved=confirmTrainingImport(draft);assert.ok(saved.ok,JSON.stringify(saved))
  return saved.record.confirmedImportId
}
const quads=(at:string)=>readRecoveryProjection(day,at).review.regions.find(r=>r.region==='quads')!.state

test('chat training and recovery agree on the earlier cutoff after a later reps correction',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(cutoff)});const f=fixture(t),id=cutoffLift()
  const before=flatten(onlineRecoveryFacts(day,cutoff));assert.match(before,/股四头肌/)
  t.mock.timers.tick(3600000);assert.ok(appendCorrection({trainingOccurrenceId:id,kind:'FIELD',field:'reps',setKey:'move:1',originalValue:'8',newValue:'0',reason:'合成未来更正'}))
  const raw=[...f.map],historical=flatten(onlineRecoveryFacts(day,cutoff)),actual=flatten(onlineTrainingFacts(day,cutoff))
  assert.match(actual,/8次/);assert.equal(historical,before);assert.equal(quads(new Date().toISOString()),'UNKNOWN')
  assert.deepEqual([...f.map],raw)
})
test('future native void and restore affect only snapshots that know those corrections',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(cutoff)});fixture(t);const id=cutoffLift()
  t.mock.timers.tick(3600000);assert.ok(appendCorrection({trainingOccurrenceId:id,kind:'VOID',reason:'合成作废'}));const voidAt=new Date().toISOString()
  assert.equal(quads(cutoff),'TRAINING_EXPOSURE');assert.equal(quads(voidAt),'UNKNOWN')
  t.mock.timers.tick(3600000);assert.ok(appendCorrection({trainingOccurrenceId:id,kind:'RESTORE',reason:'合成恢复'}))
  assert.equal(quads(voidAt),'UNKNOWN');assert.equal(quads(new Date().toISOString()),'TRAINING_EXPOSURE');assert.equal(quads(cutoff),'TRAINING_EXPOSURE')
})
test('a future import field correction cannot withdraw the earlier confirmed muscle detail',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(cutoff)});fixture(t);const id=cutoffImport();assert.equal(quads(cutoff),'TRAINING_EXPOSURE')
  t.mock.timers.tick(3600000);assert.ok(appendCorrection({trainingOccurrenceId:id,kind:'FIELD',field:'weight',setKey:'set-1',originalValue:'40',newValue:'55',reason:'合成未来导入更正'}))
  assert.equal(quads(cutoff),'TRAINING_EXPOSURE');const current=readRecoveryProjection(day,new Date().toISOString())
  assert.equal(current.parts.find(p=>p.modality==='STRENGTH')?.strengthSets?.[0].loadKg,55);
  assert.equal(readRecoveryProjection(day,cutoff).parts.find(p=>p.modality==='STRENGTH')?.strengthSets?.[0].loadKg,40);
})
test('import void and restore use their actual commit cutoffs',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(cutoff)});fixture(t);const id=cutoffImport()
  t.mock.timers.tick(3600000);assert.ok(appendCorrection({trainingOccurrenceId:id,kind:'VOID',reason:'合成导入作废'}));const voidAt=new Date().toISOString()
  assert.equal(quads(cutoff),'TRAINING_EXPOSURE');assert.equal(quads(voidAt),'UNKNOWN')
  t.mock.timers.tick(3600000);assert.ok(appendCorrection({trainingOccurrenceId:id,kind:'RESTORE',reason:'合成导入恢复'}))
  assert.equal(quads(voidAt),'UNKNOWN');assert.equal(quads(new Date().toISOString()),'TRAINING_EXPOSURE')
})
for(const imported of [false,true])test(`${imported?'import':'native'} correction with unknown commit time remains an explicit evidence gap`,t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(cutoff)});fixture(t);const id=imported?cutoffImport():cutoffLift()
  const correction=appendCorrection({trainingOccurrenceId:id,kind:'FIELD',field:'weight',setKey:imported?'set-1':'move:1',originalValue:'40',newValue:'55',reason:'合成旧更正'});assert.ok(correction)
  const legacy={...correction};delete legacy.recordedAt;writeEnvelope(TRAINING_CORRECTION_KEY,[legacy])
  const v=readRecoveryProjection(day,cutoff);assert.equal(v.review.regions.find(r=>r.region==='quads')?.state,'UNKNOWN')
  assert.match(v.review.gaps.join(' '),/更正.*(?:录入|提交).*时间.*(?:未知|缺少|可靠)|更正.*缺少.*时间/)
})
test('a later running close event cannot hide segments already known at the historical cutoff',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(cutoff)});const f=fixture(t)
  f.box.setItem('fk-plan-doc-v1',JSON.stringify({schema:'fangkun-plan-v1',plan:{name:'合成轻松跑',shiftDays:0,weeks:[],days:[{date:day,title:'轻松跑',main:['轻松跑'],aux:[],strength:[]}]}}))
  const planId=`plan400:${day}:running`
  assert.ok(saveRunningPlan({planId,planSlotId:planId,components:[{componentId:'run',modality:'RUNNING',purpose:'EASY_AEROBIC',structure:{kind:'CONTINUOUS',plannedDistanceMeters:400,plannedDurationSeconds:null}}]}).ok)
  const start=startTrackSession(planId);assert.ok(start.ok,JSON.stringify(start))
  t.mock.timers.tick(90000);assert.ok(commitTrackContinuous(start.trainingOccurrenceId,'run','90','400').ok)
  const segmentAt=new Date().toISOString(),before=readRecoveryProjection(day,segmentAt);assert.ok(before.parts.some(p=>p.modality==='RUN'&&p.runSegments?.some(x=>x.distanceM===400&&x.durationSeconds===90)))
  t.mock.timers.tick(3600000);assert.ok(finishTrackSession(start.trainingOccurrenceId,'COMPLETED',6,0).ok)
  const after=readRecoveryProjection(day,segmentAt);assert.ok(after.parts.some(p=>p.modality==='RUN'&&p.runSegments?.some(x=>x.distanceM===400&&x.durationSeconds===90)));assert.equal(after.review.regions.find(r=>r.region==='quads')?.state,'UNKNOWN')
  assert.equal(after.revision,before.revision);assert.ok(after.sources.every(s=>s.knownAt&&Date.parse(s.knownAt)<=Date.parse(segmentAt)))
})
