import test from 'node:test'
import assert from 'node:assert/strict'
import { currentAthleteId, setEventContext, EVENT_JOURNAL_PREFIX } from '../core/events'
import { setStoreBackend } from '../core/storage'
import { bindTrainingStart, closeTrainingOccurrence } from '../core/occurrence'
import { appendCorrection } from '../core/training-correction'
import { saveComponent } from '../ui/plan400-components-store'
import { readRecoveryProjection, recoveryExplanation } from './recovery-host-u11'
import { readCoachData, answerFromAppData } from './coach-data'
import { readGlobalCoachSnapshot } from '../coach/global-coach-host-v89'
import { emptyPlanExecution } from '../coach/plan-execution/core'
import type { CoachBrief } from '../core/coach-brief'
import { buildMuscleReview, type TrainingPart } from './muscle-recovery-u11'

const day='2026-10-20',now='2026-10-20T20:00:00Z',athlete='u11-synthetic'
function fixture(t:test.TestContext) {
  const owner=currentAthleteId(),prev=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
  const map=new Map<string,string>(),box={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},keys:()=>[...map.keys()]}
  setStoreBackend(box);setEventContext({athleteId:athlete})
  Object.defineProperty(globalThis,'localStorage',{value:box,configurable:true})
  t.after(()=>{setStoreBackend(null);setEventContext({athleteId:owner});if(prev)Object.defineProperty(globalThis,'localStorage',prev);else Reflect.deleteProperty(globalThis,'localStorage')})
  return {map,box}
}
function training(f:ReturnType<typeof fixture>,id='set-session',owner=athlete) {
  const at='2026-10-20T08:00:00Z',closed='2026-10-20T08:30:00Z'
  const plan={id,name:'合成力量',moves:[{id:'squat',catalogId:'back-squat',customName:'',sets:4,mode:'reps',amount:8,restSec:90,weightKg:50}]}
  bindTrainingStart({startEventId:id,startedAt:at,sessionId:id,planSlotId:id,plan})
  const events=[
    {event_id:id,event_type:'TRAINING_STARTED',timestamp:at,payload:{sessionId:id,trainingOccurrenceId:id}},
    ...[1,2].map(n=>({event_id:`${id}:set:${n}`,event_type:'TRAINING_SET_COMPLETED',timestamp:`2026-10-20T08:0${n}:00Z`,payload:{sessionId:id,trainingOccurrenceId:id,moveId:'squat',catalogId:'back-squat',setIndex:n,completed:true,skipped:false,actualAmount:8,actualWeight:50}})),
    {event_id:`${id}:end`,event_type:'TRAINING_COMPLETED',timestamp:closed,payload:{sessionId:id,trainingOccurrenceId:id,setsCompleted:2}},
  ].map(e=>({...e,athlete_id:owner}))
  events.forEach((e,i)=>f.map.set(`${EVENT_JOURNAL_PREFIX}${e.event_id}`,JSON.stringify({schemaVersion:1,id:e.event_id,order:Date.parse(e.timestamp)+i,data:e,recordedAt:e.timestamp})))
  closeTrainingOccurrence(events.at(-1)!)
}
test('actual two sets, not four planned sets, reach 3D evidence, coach and global host',async t=>{
  const f=fixture(t);training(f)
  const before=[...f.map],v=readRecoveryProjection(day,now)
  assert.equal(v.review.regions.find(r=>r.region==='quads')?.state,'TRAINING_EXPOSURE')
  assert.equal(v.sources[0].actualSets,2);assert.match(recoveryExplanation(v),/2组/)
  const data=readCoachData(day)
  assert.match(data.muscleRecovery!.explanation,/2组/)
  const text=answerFromAppData({question:'我的肌群最近参与情况',appData:data} as CoachBrief)
  assert.match(text!,/2组/);assert.doesNotMatch(text!,/4组|恢复\d+%/)
  const global=await readGlobalCoachSnapshot(day,{read:async(id:string)=>emptyPlanExecution(id)})
  assert.equal(global.data?.muscleRecovery?.revision,data.muscleRecovery?.revision)
  assert.deepEqual([...f.map],before);assert.equal(global.planWriteEnabled,false)
})
test('completion-only V4 feedback is UNKNOWN and does not borrow planned muscle groups',async t=>{
  const f=fixture(t)
  saveComponent(day,'strength',{status:'done'},f.box,new Date('2026-10-20T08:00:00Z'))
  const v=readRecoveryProjection(day,now)
  assert.ok(v.review.regions.every(r=>r.state==='UNKNOWN'));assert.match(v.review.summary,/无法判断具体肌群/)
  assert.ok(v.review.gaps.some(g=>g.includes('分项评价')))
  const global=await readGlobalCoachSnapshot(day,{read:async(id:string)=>emptyPlanExecution(id)})
  assert.equal(global.evidence.find(e=>e.metric==='MUSCLE_EXPOSURE')?.availability,'MISSING')
  assert.equal(global.data?.muscleRecovery?.hasObservedRegions,false)
})
test('void and field corrections invalidate old muscle evidence immediately without rewriting originals',t=>{
  const f=fixture(t);training(f)
  const before=readRecoveryProjection(day,now);assert.equal(before.sources[0].actualSets,2)
  const oldJournal=[...f.map].filter(([k])=>k.startsWith(EVENT_JOURNAL_PREFIX))
  assert.ok(appendCorrection({trainingOccurrenceId:'set-session',kind:'FIELD',field:'reps',reason:'合成更正',newValue:'0'}))
  const after=readRecoveryProjection(day,now)
  assert.ok(after.review.regions.every(r=>r.state==='UNKNOWN'));assert.notEqual(after.revision,before.revision)
  assert.deepEqual([...f.map].filter(([k])=>k.startsWith(EVENT_JOURNAL_PREFIX)),oldJournal)
})
test('different athlete cannot contribute a set or a pain record',t=>{
  const f=fixture(t);training(f,'other','foreign')
  f.map.set('fk-pain-log-v1',JSON.stringify([{id:'foreign-pain',athleteId:'foreign',date:day,part:'股四头肌',score:8,occurredAt:'2026-10-20T08:00:00Z',recordedAt:'2026-10-20T08:01:00Z'}]))
  const v=readRecoveryProjection(day,now);assert.equal(v.sources.length,0);assert.ok(v.review.regions.every(r=>r.state==='UNKNOWN'))
})
test('explicit timed pain overrides participation and deletion returns to observed exposure',t=>{
  const f=fixture(t);training(f)
  const initial=readRecoveryProjection(day,now)
  f.map.set('fk-pain-log-v1',JSON.stringify([{id:'pain',athleteId:athlete,date:day,part:'左股四头肌',score:3,occurredAt:'2026-10-20T09:00:00Z',recordedAt:'2026-10-20T09:01:00Z'}]))
  const pain=readRecoveryProjection(day,now)
  assert.equal(pain.review.regions.find(r=>r.region==='quads')?.state,'PAIN_REVIEW')
  assert.notEqual(pain.revision,initial.revision);assert.equal(pain.automaticPrescription,false)
  f.map.set('fk-pain-log-v1','[]')
  assert.equal(readRecoveryProjection(day,now).review.regions.find(r=>r.region==='quads')?.state,'TRAINING_EXPOSURE')
})
test('knee pain and date-only history are not invented quadriceps evidence',t=>{
  const f=fixture(t)
  f.map.set('fk-pain-log-v1',JSON.stringify([{id:'old',athleteId:athlete,date:day,part:'膝盖',score:5}]))
  const v=readRecoveryProjection(day,now)
  assert.ok(v.review.regions.every(r=>r.state==='UNKNOWN'));assert.ok(v.review.gaps.some(g=>g.includes('膝盖')&&g.includes('5/10')))
})
test('missing continuous device data stays unavailable; rereads are stable',t=>{
  fixture(t)
  const first=readRecoveryProjection(day,now),second=readRecoveryProjection(day,'2026-10-20T20:01:00Z')
  assert.equal(first.revision,second.revision)
  assert.ok(Object.values(first.intraday.metrics).every(m=>m.status==='NO_CONTINUOUS_DATA'&&m.latest===null))
})
test('corrupt local records are explicit read errors and retained byte-for-byte',t=>{
  const f=fixture(t);f.map.set('fk-pain-log-v1','{bad')
  const v=readRecoveryProjection(day,now)
  assert.equal(v.unreadable,true);assert.equal(f.map.get('fk-pain-log-v1'),'{bad')
})
test('equal-version conflicting exercises are excluded regardless of input order',()=>{
  const p:TrainingPart={athleteId:athlete,eventId:'a',occurrenceId:'o',componentId:'s',modality:'STRENGTH',occurredAt:'2026-10-20T08:00:00Z',knownAt:'2026-10-20T09:00:00Z',sourceId:'phone',actual:'CONFIRMED',exercises:[{catalogId:'back-squat',actualSets:2,verified:true}]}
  const q={...p,eventId:'b',exercises:[{catalogId:'pushup',actualSets:2,verified:true}]}
  for(const parts of [[p,q],[q,p]]) {
    const v=buildMuscleReview({athleteId:athlete,asOf:now,parts,symptoms:[]})
    assert.ok(v.regions.every(r=>r.state==='UNKNOWN'));assert.ok(v.gaps.some(g=>g.includes('冲突')))
  }
})
test('equal-version retraction wins and cannot resurrect because of ordering',()=>{
  const p:TrainingPart={athleteId:athlete,eventId:'a',occurrenceId:'o',componentId:'s',modality:'STRENGTH',occurredAt:'2026-10-20T08:00:00Z',knownAt:'2026-10-20T09:00:00Z',sourceId:'phone',actual:'CONFIRMED',exercises:[{catalogId:'back-squat',actualSets:2,verified:true}]}
  const gone={...p,actual:'RETRACTED' as const}
  for(const parts of [[p,gone],[gone,p]])assert.ok(buildMuscleReview({athleteId:athlete,asOf:now,parts,symptoms:[]}).regions.every(r=>r.state==='UNKNOWN'))
})
