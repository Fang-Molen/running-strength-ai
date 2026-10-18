import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend, type MemoryStore } from './storage.ts'
import { correctRunningMetric, correctedRunningMetric, runningCorrectionKey } from './running-log-correction.ts'
import type { RunningRepetitionSlot } from './running-execution.ts'
import { mock } from 'node:test'
import { dispatchEvent, loadEvents, setEventContext } from './events.ts'
import { saveRunningPlan, getRunningPlanSnapshot } from './running-plan.ts'
import { bindTrainingStart } from './occurrence.ts'
import { recordRunningRepetitionCompleted, projectRunningRepetitions } from './running-execution.ts'
import { readOfflineWorkspace } from './coach-offline-workspace.ts'
import { readOfflineHistory, saveOfflineReview } from './coach-offline-loop.ts'
import { blankPlan } from '../strength/model.ts'
const store = (): MemoryStore => { const map = new Map<string,string>(); return { keys:()=>[...map.keys()], getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key,value) } } }
const slot: RunningRepetitionSlot = { trainingOccurrenceId:'occ-1', runningSnapshotId:'snap-1', componentId:'c', blockId:'b', stepId:'s', roundOrdinal:1, repeatOrdinal:1, status:'COMPLETED', plannedDistanceMeters:200, plannedDurationSeconds:28, actualDistanceMeters:200, actualDurationSeconds:29, sourceEventIds:['event-1'], derivedPaceSecPerMeter:29/200, paceDistanceSourceEventId:'event-1', paceDurationSourceEventId:'event-1' }
test('running corrections keep raw facts and use unique source event', () => { setStoreBackend(store()); assert.equal(runningCorrectionKey(slot),'run-event:event-1'); assert.equal(correctRunningMetric(slot,'duration',28.2,'计时修正'),true); assert.deepEqual(correctedRunningMetric(slot,'duration'),{value:28.2,corrected:true}); assert.equal(slot.actualDurationSeconds,29); assert.equal(correctRunningMetric(slot,'duration',27.9,'再次核对'),true); assert.equal(correctedRunningMetric(slot,'duration').value,27.9); setStoreBackend(null) })
test('ambiguous or missing source cannot be corrected', () => { setStoreBackend(store()); const ambiguous={...slot,sourceEventIds:['a','b']}; assert.equal(runningCorrectionKey(ambiguous),null); assert.equal(correctRunningMetric(ambiguous,'duration',27,'test'),false); assert.equal(correctRunningMetric(slot,'duration',-1,'test'),false); assert.equal(correctRunningMetric(slot,'duration',28,''),false); assert.equal(correctedRunningMetric(slot,'duration').corrected,false); setStoreBackend(null) })

function nativeTraining(run: (input: {id: string; slot: RunningRepetitionSlot; beforeTime: string}) => void) {
 const memory=store(),previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
 setStoreBackend(memory);setEventContext({athleteId:'local'});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:memory})
 mock.timers.enable({apis:['Date'],now:new Date('2026-10-18T08:00:00Z')})
 try {
  assert.ok(saveRunningPlan({planId:'native-running',planSlotId:'native-course',components:[{componentId:'main',modality:'RUNNING',purpose:'INTERVAL',structure:{kind:'REPEATED',blocks:[{blockId:'b',roundCount:1,recoveryAfterRoundSeconds:null,steps:[{stepId:'s',plannedDistanceMeters:200,plannedDurationSeconds:40,repeatCount:2,recoveryAfterRepeatSeconds:180,recoveryBeforeNextStepSeconds:null}]}]}}]}).ok)
  const start=dispatchEvent('TRAINING_STARTED',{sessionId:'native-course',decisionId:'native-decision'})!
  bindTrainingStart({startEventId:start.event_id,startedAt:start.timestamp,sessionId:'native-course',planSlotId:'native-course',plan:{id:'native-course',name:'原生田径验收',moves:[]},runningPlanId:'native-running'})
  const snapshot=getRunningPlanSnapshot(start.event_id)!
  for(const [i,seconds] of [39,38].entries()) {
   mock.timers.tick(1000)
   assert.ok(recordRunningRepetitionCompleted({trainingOccurrenceId:start.event_id,runningSnapshotId:snapshot.runningSnapshotId,componentId:'main',blockId:'b',stepId:'s',roundOrdinal:1,repeatOrdinal:i+1,actualDistanceMeters:200,actualDurationSeconds:seconds}))
  }
  mock.timers.tick(1000)
  run({id:start.event_id,slot:projectRunningRepetitions(start.event_id,loadEvents()).slots[0],beforeTime:new Date().toISOString()})
 } finally {
  mock.timers.reset();setStoreBackend(null);setEventContext({athleteId:'local'})
  if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete (globalThis as {localStorage?:unknown}).localStorage
 }
}

test('native log correction reaches the formal coach, brief and historical withdrawal without rewriting events',()=>nativeTraining(({id,slot})=>{
 const before=readOfflineWorkspace(blankPlan(),'local',id).review
 assert.equal(before.metrics.points[0].seconds,39);assert.ok(saveOfflineReview(before).ok)
 const raw=JSON.stringify(loadEvents())
 mock.timers.tick(1000);assert.ok(correctRunningMetric(slot,'duration',40.5,'核对原生训练计时'))
 const after=readOfflineWorkspace(blankPlan(),'local',id)
 assert.equal(after.review.metrics.points[0]?.seconds,40.5)
 assert.equal(after.brief.running?.find(row=>row.kind==='REPETITION')?.actual,'200米/40.5秒')
 assert.match(after.review.text,/实际−计划 0.5秒/)
 assert.equal(JSON.stringify(loadEvents()),raw)
 assert.ok(saveOfflineReview(after.review).ok)
 const history=readOfflineHistory('local').filter(row=>row.kind==='ANALYSIS')
 assert.equal(history[0].review.metrics.points[0].seconds,39)
 assert.ok(history.at(-1)!.revisions.some(row=>row.status==='WITHDRAWN'))
}))

test('native distance and time chains preserve an earlier as-of view and do not borrow planned distance',()=>nativeTraining(({id,slot,beforeTime})=>{
 mock.timers.tick(1000);assert.ok(correctRunningMetric(slot,'duration',40.5,'核对计时'))
 mock.timers.tick(1000);assert.ok(correctRunningMetric(slot,'distance',198.5,'核对实际距离'))
 const current=readOfflineWorkspace(blankPlan(),'local',id)
 assert.equal(current.review.metrics.points[0]?.seconds,40.5)
 assert.equal(current.review.metrics.points[0]?.distanceMeters,198.5)
 assert.equal(current.brief.running?.find(row=>row.kind==='REPETITION')?.actual,'198.5米/40.5秒')
 const old=readOfflineWorkspace(blankPlan(),'local',id,'复盘这次训练',beforeTime)
 assert.equal(old.review.metrics.points[0]?.seconds,39)
 assert.equal(old.brief.running?.find(row=>row.kind==='REPETITION')?.actual,'200米/39秒')
 assert.equal(loadEvents().filter(event=>event.event_type==='RUNNING_REPETITION_COMPLETED')[0].payload.actualDistanceMeters,200)
}))
