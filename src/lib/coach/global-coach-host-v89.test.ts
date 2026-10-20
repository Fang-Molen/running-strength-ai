import test from 'node:test'
import assert from 'node:assert/strict'
import { currentAthleteId, setEventContext } from '../core/events'
import { setStoreBackend } from '../core/storage'
import { saveVital } from '../nutrition/vitals'
import { saveComponent } from '../ui/plan400-components-store'
import { phoneRows, garminRows } from '../ui/training-read-model'
import { pendingTaskId } from '../ui/pending-feedback'
import { emptyPlanExecution } from './plan-execution/core'
import { readGlobalCoachSnapshot, feedbackTasks, subscribeGlobalCoach } from './global-coach-host-v89'
import { coordinateGlobal } from './global-coach-v89'

const day='2026-10-20'
function fixture(t: test.TestContext) {
  const previous=currentAthleteId(), old=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
  const map=new Map<string,string>(), box={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},keys:()=>[...map.keys()]}
  setStoreBackend(box);setEventContext({athleteId:'synthetic-v89-a'})
  Object.defineProperty(globalThis,'localStorage',{value:box,configurable:true})
  t.after(()=>{setStoreBackend(null);setEventContext({athleteId:previous});if(old)Object.defineProperty(globalThis,'localStorage',old);else Reflect.deleteProperty(globalThis,'localStorage')})
  const repository={read:async(id:string)=>emptyPlanExecution(id)}
  return {map,box,repository}
}
test('partial sources preserve unknown metrics and never write plans or source records',async t=>{
  const f=fixture(t),before=[...f.map];const snapshot=await readGlobalCoachSnapshot(day,f.repository)
  assert.equal(snapshot.result.state,'PARTIAL');assert.equal(snapshot.planWriteEnabled,false)
  assert.ok(snapshot.evidence.every(e=>e.value===null));assert.deepEqual([...f.map],before)
})
test('actual sleep value, source metadata and correction revision reach the host',async t=>{
  const f=fixture(t)
  const draft={kind:'SLEEP' as const,value:347/60,observedOn:day,source:'DEVICE_CONFIRMED' as const,
    observation:{key:'sleep-a',sourceId:'synthetic-watch',statistic:'夜间睡眠',syncedAt:day+'T07:00:00Z',measuredAt:day+'T06:00:00Z'}}
  assert.ok(saveVital(draft).ok)
  const a=await readGlobalCoachSnapshot(day,f.repository),sleep=a.evidence.find(e=>e.metric==='SLEEP')!
  assert.equal(sleep.value,347/60);assert.equal(sleep.unit,'h');assert.match(sleep.summary,/5小时47分/)
  assert.equal(sleep.observedAt,day+'T06:00:00Z')
  assert.ok(saveVital({...draft,value:6}).ok)
  const b=await readGlobalCoachSnapshot(day,f.repository)
  assert.notEqual(a.revision,b.revision);assert.notEqual(sleep.revision,b.evidence.find(e=>e.metric==='SLEEP')?.revision)
})
test('foreign health, food, phone rows and old unowned records never enter another profile',async t=>{
  const f=fixture(t);assert.ok(saveVital({kind:'RHR',value:52,observedOn:day,source:'MANUAL'}).ok)
  f.box.setItem('fr255-food-log-v1',JSON.stringify([{id:'a',athleteId:'synthetic-v89-a',date:day,meal:'早餐',name:'合成餐',kcal:300}]))
  f.box.setItem('fk-schedule-v1',JSON.stringify({entries:[{id:'foreign',athleteId:'synthetic-v89-a',date:day,kind:'strength',modality:'strength',status:'done',actual:{outcome:'as_planned',minutes:20}}],acks:[]}))
  setEventContext({athleteId:'synthetic-v89-b'})
  const snapshot=await readGlobalCoachSnapshot(day,f.repository)
  assert.equal(snapshot.evidence.find(e=>e.metric==='RHR')?.value,null)
  assert.equal(snapshot.data?.nutrition.count,0);assert.equal(phoneRows(f.box).length,0)
  assert.equal(garminRows({a:{id:1,start:day+'T08:00:00Z'}}).length,0)
})
test('scope switch while awaiting receipts discards old facts',async t=>{
  fixture(t)
  const snapshot=await readGlobalCoachSnapshot(day,{read:async id=>{setEventContext({athleteId:'synthetic-v89-b'});return emptyPlanExecution(id)}})
  assert.equal(snapshot.result.state,'UNAVAILABLE');assert.equal(snapshot.data,null);assert.deepEqual(snapshot.evidence,[])
})
test('new source version during receipt read rejects the stale projection',async t=>{
  const f=fixture(t)
  const snapshot=await readGlobalCoachSnapshot(day,{read:async id=>{f.box.setItem('fk-checkin-v1',JSON.stringify([{athleteId:currentAthleteId(),date:day,at:day+'T08:00:00Z',pain:'sharp'}]));return emptyPlanExecution(id)}})
  assert.equal(snapshot.result.state,'UNAVAILABLE');assert.match(snapshot.limitations.join(),/更新/)
})
test('corrupt source is unavailable, not a successful empty history',async t=>{
  const f=fixture(t);f.box.setItem('fk-schedule-v1','{corrupt')
  const snapshot=await readGlobalCoachSnapshot(day,f.repository)
  assert.equal(snapshot.result.state,'UNAVAILABLE');assert.equal(snapshot.data,null)
})
test('IndexedDB unavailable leaves usable partial health facts without claiming permission',async t=>{
  fixture(t);assert.ok(saveVital({kind:'RHR',value:52,observedOn:day,source:'MANUAL'}).ok)
  const snapshot=await readGlobalCoachSnapshot(day,{read:async()=>{throw Error('quota')}})
  assert.equal(snapshot.result.state,'PARTIAL');assert.equal(snapshot.evidence.find(e=>e.metric==='RHR')?.value,52)
  assert.equal(snapshot.planWriteEnabled,false);assert.match(snapshot.limitations.join(),/回执/)
})
test('independent conflicting sources stay visible and cannot be dismissed as normal',async t=>{
  const f=fixture(t)
  assert.ok(saveVital({kind:'RHR',value:52,observedOn:day,source:'MANUAL',note:'source-a'}).ok)
  assert.ok(saveVital({kind:'RHR',value:62,observedOn:day,source:'MANUAL',note:'source-b'}).ok)
  const snapshot=await readGlobalCoachSnapshot(day,f.repository),metric=snapshot.evidence.find(e=>e.metric==='RHR')!
  assert.equal(metric.availability,'CONFLICT');assert.equal(metric.value,null)
  const task=snapshot.result.tasks.find(t=>t.kind==='VERIFY_SOURCE')!
  const result=coordinateGlobal({athleteId:currentAthleteId(),today:day,readState:'READY',facts:[metric],parts:[],dismissedTaskIds:[task.id]})
  assert.ok(result.tasks.some(t=>t.id===task.id));assert.equal(result.state,'PARTIAL')
})
test('feedback tasks use one scoped logical ID and keep running and strength separate',()=>{
  const run={date:day,part:'running' as const,kind:'rate_run' as const,text:'跑步待评价',deferred:true}
  const lift={...run,part:'strength' as const,kind:'rate_lift' as const,text:'力量待评价'}
  const tasks=feedbackTasks([run,lift],'a')
  assert.equal(tasks[0].id,pendingTaskId(run,'a'));assert.notEqual(tasks[0].id,tasks[1].id)
  assert.notEqual(pendingTaskId(run,'a'),pendingTaskId(run,'b'))
})
test('foreign component feedback remains byte-identical and is not projected as current training',t=>{
  const f=fixture(t);setEventContext({athleteId:'local'})
  assert.ok(saveComponent('2026-10-19','running',{status:'done',rpe:5},f.box))
  const raw=f.box.getItem('fk-plan400-v4-components-v1')
  setEventContext({athleteId:'synthetic-v89-b'})
  assert.equal(phoneRows(f.box).length,0);assert.equal(saveComponent('2026-10-19','strength',{status:'done'},f.box),false)
  assert.equal(f.box.getItem('fk-plan400-v4-components-v1'),raw)
})
test('health, nutrition, corrections and profile events notify after commit, coalesce and clean up',async t=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'window'),win=new EventTarget()
  Object.defineProperty(globalThis,'window',{value:win,configurable:true})
  t.after(()=>{if(old)Object.defineProperty(globalThis,'window',old);else Reflect.deleteProperty(globalThis,'window')})
  let calls=0;const off=subscribeGlobalCoach(()=>calls++)
  for(const name of ['fk-health-changed','fk-food-changed','fk-training-corrected','fk-athlete-scope-changed'])win.dispatchEvent(new Event(name))
  assert.equal(calls,0);await Promise.resolve();assert.equal(calls,1)
  win.dispatchEvent(new Event('fk-health-changed'));off();await Promise.resolve();assert.equal(calls,1)
})
test('calendar dates are strict rather than normalized into another month',()=>{
  const r=coordinateGlobal({athleteId:'a',today:'2026-02-30',readState:'READY',facts:[],parts:[]})
  assert.equal(r.state,'UNAVAILABLE')
})
