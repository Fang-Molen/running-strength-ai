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
  // v89.2：更正按日志同口径逐组覆盖——一组改成 0 次只少这一组；两组都改成 0 才没有参与证据
  assert.ok(appendCorrection({trainingOccurrenceId:'set-session',kind:'FIELD',field:'reps',setKey:'squat:1',originalValue:'8',reason:'合成更正',newValue:'0'}))
  const one=readRecoveryProjection(day,now);assert.equal(one.sources[0].actualSets,1);assert.notEqual(one.revision,before.revision)
  assert.ok(appendCorrection({trainingOccurrenceId:'set-session',kind:'FIELD',field:'reps',setKey:'squat:2',originalValue:'8',reason:'合成更正',newValue:'0'}))
  const after=readRecoveryProjection(day,now)
  assert.ok(after.review.regions.every(r=>r.state==='UNKNOWN'));assert.notEqual(after.revision,before.revision)
  assert.ok(appendCorrection({trainingOccurrenceId:'set-session',kind:'VOID',reason:'整节作废'}))
  assert.equal(readRecoveryProjection(day,now).sources.length,0)
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

// v89.2（用户 10-21）：日志里 10-19 V4 力量“逐组已记”，肌群视图却显示“暂无已确认的逐组力量记录”。
import { startTraining, completeTraining } from '../core/training-decision'
import { emptySets, recordSet } from '../core/execution'
import { plan400TodayEntry } from '../ui/plan400-start'
import { resolveScheduledCourse } from '../ui/scheduled-execution'
import { loadTrainingActivities } from '../ui/training-read-model'
import { setRunDevice } from '../ui/plan400-components-store'
import { garminViewKey } from './garmin-view-scope'
import { libraryKey, v4RunType, LIBRARY_ALIAS } from './muscle-log-source'
import { ACTIONS } from '../strength/action-picker'
import V4 from '../../../test-fixtures/private/plan400-v4.json' with { type: 'json' }
import type { V4Day } from '../ui/plan400-view'
function v4Lift(f:ReturnType<typeof fixture>){
  const d=(V4.days as V4Day[]).find(x=>x.date==='2026-10-19')!
  const entry=plan400TodayEntry(d,null,()=>({unit:'reps',perSide:false}))!
  const s=resolveScheduledCourse(entry,{sessions:[]},[]).strength!
  const st=startTraining({decisionId:'d-v4',sessionId:s.id,action:'ORIGINAL_PLAN'})!
  bindTrainingStart({startEventId:st.event_id,startedAt:st.timestamp,sessionId:s.id,planSlotId:entry.id,plan:s})
  for(const set of emptySets(s)) recordSet(s.id,'d-v4',{...set,actualWeight:set.plannedWeight,actualAmount:set.plannedAmount,completed:true,source:'user_confirmed_plan',timestamp:new Date().toISOString()})
  closeTrainingOccurrence(completeTraining({decisionId:'d-v4',sessionId:s.id,planned:null,actualSets:10,actualAmount:null,actualWeightKg:null,rpe:null,pain:false,modified:false,interrupted:false}) as never)
  void f
}
test('v89.2 V4 free-text moves logged set by set reach muscle view, log and coach as the same record',async t=>{
  const f=fixture(t);setEventContext({athleteId:'local'});v4Lift(f)
  const asOf=new Date(Date.now()+3600e3).toISOString(),v=readRecoveryProjection(undefined,asOf)
  const log=loadTrainingActivities().find(r=>r.source==='execution'&&r.sport==='STRENGTH')!
  assert.equal(v.sources.length,1);assert.equal(v.sources[0].actualSets,log.sets);assert.equal(log.sets,10)
  assert.match(v.sources[0].detail,/分腿蹲 2组；RDL 2组；臀推 2组；提踵 2组；抗旋 2组/)
  const on=v.review.regions.filter(r=>r.state!=='UNKNOWN').map(r=>r.region)
  for(const r of ['quads','hamstrings','glutes','calves','core'] as const) assert.ok(on.includes(r),r)
  assert.equal(v.review.gaps.filter(g=>/未映射/.test(g)).length,0)
  assert.deepEqual([v.sources[0].regionSets?.quads,v.sources[0].regionSets?.glutes,v.sources[0].regionSets?.calves],[2,6,2]) // v89.4 刺激情景按该肌群实际组数
  const ex=recoveryExplanation(v);assert.equal(ex.split('分腿蹲 2组').length-1,1,'依据只列一次，不按肌群重复')
  const data=readCoachData(v.day);assert.match(data.muscleRecovery!.explanation,/分腿蹲 2组/);assert.equal(data.muscleRecovery!.hasObservedRegions,true)
})
test('v89.2 linked watch run uses the planned session type; unlinked runs get one short note',t=>{
  const f=fixture(t);setEventContext({athleteId:'local'})
  f.map.set(garminViewKey('fk-garmin-acts-v1'),JSON.stringify({
    a:{id:101,start:'2026-10-19T09:00:00Z',type:'running',dist:3000,dur:1500,athleteId:'local'},
    b:{id:102,start:'2026-10-20T07:00:00Z',type:'running',dist:5000,dur:1800,athleteId:'local'},
    c:{id:103,start:'2026-10-20T09:00:00Z',type:'running',dist:4000,dur:1500,athleteId:'local'}}))
  assert.ok(setRunDevice('2026-10-19',{sourceIdentity:'garmin:101',source:'garmin',linkedBy:'user'},undefined,f.box))
  const v=readRecoveryProjection('2026-10-20','2026-10-20T20:00:00Z')
  const run=v.sources.find(s=>s.id.endsWith('|RUN'))!;assert.match(run.detail,/间歇\/速度耐力/)
  assert.ok(v.review.regions.find(r=>r.region==='hip_flexors')!.runEventIds.length)
  assert.deepEqual(v.review.gaps.filter(g=>/手表跑步/.test(g)),['2 条手表跑步未关联计划课：类型未知，未计入肌群（可在日志里关联）'])
})
test('v89.2 library aliases point at real library entries; planned run types come from plan text only',()=>{
  const keys=new Set(ACTIONS.map(a=>a.key))
  for(const [name,key] of Object.entries(LIBRARY_ALIAS)) if(key!=='extra:核心') assert.ok(keys.has(key),`${name}→${key}`)
  assert.equal(libraryKey('主力腿部动作'),null);assert.equal(libraryKey('分腿蹲'),'extra:分腿蹲');assert.equal(libraryKey('x','rdl'),'local:rdl')
  const day=(d:string)=>(V4.days as V4Day[]).find(x=>x.date===d)!
  assert.equal(v4RunType(day('2026-10-19')),'INTERVAL')
  assert.equal(v4RunType({title:'节奏容量＋力量B',main:['','正式主课：150m×5']}),'TEMPO')
  assert.equal(v4RunType({title:'低强度恢复',main:['','轻松跑20—30分钟']}),'EASY')
  assert.equal(v4RunType({title:'休息',main:['','完全休息']}),'UNKNOWN')
})
test('v89.3 U12: old pain stays 待复核 beyond 72h; a later explicit 0 clears it without claiming recovery',t=>{
  const f=fixture(t)
  f.map.set('fk-pain-log-v1',JSON.stringify([{id:'old',athleteId:athlete,date:'2026-10-16',part:'股四头肌',score:5,occurredAt:'2026-10-16T08:00:00Z',recordedAt:'2026-10-16T08:05:00Z'}]))
  const v=readRecoveryProjection(day,now),q=v.review.regions.find(r=>r.region==='quads')!
  assert.equal(q.state,'PAIN_REVIEW');assert.ok(q.notes.some(n=>/不得自动宣告恢复/.test(n)))
  assert.match(v.sources.find(s=>s.id==='pain:old')!.label,/待复核/)
  f.map.set('fk-pain-log-v1',JSON.stringify([{id:'old',athleteId:athlete,date:'2026-10-16',part:'股四头肌',score:5,occurredAt:'2026-10-16T08:00:00Z',recordedAt:'2026-10-16T08:05:00Z'},
    {id:'zero',athleteId:athlete,date:'2026-10-20',part:'股四头肌',score:0,occurredAt:'2026-10-20T07:00:00Z',recordedAt:'2026-10-20T07:01:00Z'}]))
  const w=readRecoveryProjection(day,now),q2=w.review.regions.find(r=>r.region==='quads')!
  assert.equal(q2.state,'UNKNOWN');assert.ok(q2.notes.some(n=>/不等于组织已完全恢复/.test(n)))
})
