import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend } from '../../core/storage'
import { currentAthleteId, setEventContext, dispatchEvent } from '../../core/events'
import type { ScheduleEntry } from '../../ui/day-schedule-rules'
import { readTrainingModelWorkbench } from './workbench'
import { saveCycleGoal } from '../cycle/host'
import { emptyProfile, saveProfile } from '../../strength/profile'
const at='2026-10-23T12:00:00.000Z'
function setup(t:test.TestContext,entries:ScheduleEntry[]=[]){
 t.mock.timers.enable({apis:['Date'],now:Date.parse(at)})
 const previous=currentAthleteId(),data=new Map<string,string>([['fk-schedule-v1',JSON.stringify({entries,acks:[]})]])
 const store={keys:()=>[...data.keys()],getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)}}
 setStoreBackend(store);setEventContext({athleteId:'workbench-athlete'})
 const original=globalThis.fetch;globalThis.fetch=(async()=>{throw Error('No external requests')}) as typeof fetch
 t.after(()=>{setStoreBackend(null);setEventContext({athleteId:previous});globalThis.fetch=original})
 return data
}
const entry=(extra:Partial<ScheduleEntry>={}):ScheduleEntry=>({athleteId:'workbench-athlete',id:'owned',date:'2026-10-24',kind:'run',modality:'run',title:'真实保存的轻松课',focus:[],minutes:20,intensity:'EASY',lowerHeavy:false,source:'custom',refId:null,status:'planned',runComponents:[{componentId:'component1',modality:'RUNNING',purpose:'EASY_AEROBIC',structure:{kind:'CONTINUOUS',plannedDistanceMeters:null,plannedDistanceMaxMeters:null,plannedDurationSeconds:1200}}],...extra})
test('production workbench reads missing facts without inventing a profile or safe recovery',async t=>{
 setup(t)
 const r=await readTrainingModelWorkbench({},'2026-10-23',at)
 assert.equal(r.input.profile.experience,'UNKNOWN');assert.equal(r.input.profile.phase,'UNKNOWN');assert.equal(r.input.profile.eventMeters,null)
 assert.equal(r.result.candidates.length,0);assert.equal(r.result.review.allowTrainingCandidates,false)
 assert.ok(r.missing.length);assert.ok(r.result.review.methods.every(m=>m.status==='INSUFFICIENT'||m.status==='HOLD'))
})
test('only actual host-resolved unstarted components get NOT_STARTED; familiarity does not clear missing recovery',async t=>{
 const data=setup(t,[entry()]);const before=data.get('fk-schedule-v1')
 const r=await readTrainingModelWorkbench({eventMeters:1500,phase:'BUILD',experience:'TRAINED',familiarSessionIds:['owned']},'2026-10-23',at)
 assert.equal(r.input.sessions[0].executionState,'NOT_STARTED');assert.equal(r.input.sessions[0].familiar,true)
 assert.ok(r.input.profile.sourceRefs.some(ref=>ref.id.includes('intent')))
 assert.equal(r.result.review.allowTrainingCandidates,false);assert.ok(r.result.candidates.every(c=>c.after===null))
 assert.equal(data.get('fk-schedule-v1'),before)
})
test('legacy ownership, actual data and text-only plans are not upgraded into executable courses',async t=>{
 setup(t,[entry({id:'legacy',athleteId:undefined}),entry({id:'actual',actual:{outcome:'different',minutes:10,intensity:null,note:'',reasons:[],at}}),entry({id:'text-only',runComponents:undefined,title:'400米×8'}),entry({id:'foreign',athleteId:'someone-else'})])
 const r=await readTrainingModelWorkbench({},'2026-10-23',at)
 assert.ok(r.input.sessions.every(s=>s.executionState!=='NOT_STARTED'));assert.equal(r.result.candidates.length,0)
 assert.ok(!r.input.sessions.some(s=>s.id==='text-only'||s.id==='foreign'));assert.ok(r.missing.some(x=>x.includes('结构')))
})
test('a real committed start invalidates the planned course state',async t=>{
 setup(t,[entry()]);assert.ok(dispatchEvent('TRAINING_STARTED',{sessionId:'scheduled:owned:run'}))
 const r=await readTrainingModelWorkbench({},'2026-10-23',at)
 assert.equal(r.input.sessions[0].executionState,'STARTED');assert.equal(r.result.candidates.length,0)
})
test('switching athlete drops an in-flight read and a fresh scope has unknown intent',async t=>{
 setup(t,[entry()])
 const pending=readTrainingModelWorkbench({eventMeters:1500,phase:'BUILD',experience:'TRAINED',familiarSessionIds:['owned']},'2026-10-23',at)
 setEventContext({athleteId:'other-workbench-athlete'})
 await assert.rejects(pending)
 const next=await readTrainingModelWorkbench({},'2026-10-23',at)
 assert.equal(next.input.context.athleteId,'other-workbench-athlete');assert.equal(next.input.profile.eventMeters,null)
 assert.equal(next.input.profile.experience,'UNKNOWN');assert.equal(next.input.sessions.length,0)
})
test('saved cycle/profile intent fills the production workbench without a repeated form',async t=>{
 const data=setup(t,[entry()])
 assert.ok(saveProfile({...emptyProfile(),weightKg:'66',aim:'lose',targetKg:'64',trainingDays:[1,3,5],days:3,minutes:45,marks:[{meters:1500,recent:'4:30',goal:'4:20',deadline:'2026-11-07'}]}))
 await saveCycleGoal({eventMeters:1500,raceDate:'2026-11-07',targetSeconds:260,experience:'TRAINED',priority:'SPEED',horizonWeeks:4,taperDays:7,proposeExtraMinutes:null},0,at)
 const before=JSON.stringify([...data])
 const r=await readTrainingModelWorkbench({},'2026-10-23',at)
 assert.equal(r.input.profile.eventMeters,1500);assert.equal(r.input.profile.raceDate,'2026-11-07');assert.equal(r.input.profile.targetSeconds,260);assert.equal(r.input.profile.experience,'TRAINED')
 assert.deepEqual(r.scientificInput.availability.days.value,[1,3,5]);assert.equal(r.scientificInput.availability.minutes.value,45)
 assert.equal(r.scientificInput.nutrition.weightKg.value,66);assert.equal(r.scientificInput.nutrition.targetKg.value,64)
 assert.equal(r.scientificInput.goals.primaryGoal.value,'FAT_LOSS')
 assert.equal(r.scientificInput.running.selfReportedPBs[0].seconds.value,270);assert.equal(r.input.performances.length,0)
 assert.ok(r.followups.length<=2);assert.ok(!r.followups.some(x=>x.includes('主要训练项目')))
 assert.equal(JSON.stringify([...data]),before,'read must preserve every stored record')
})
test('same-owner saved profile edits during the asynchronous read invalidate its sources',async t=>{
 setup(t,[entry()])
 const pending=readTrainingModelWorkbench({},'2026-10-23',at)
 assert.ok(saveProfile({...emptyProfile(),weightKg:'70',trainingDays:[2,4]}))
 await assert.rejects(pending,/SUBJECT_OR_SOURCE_CHANGED/)
})
test('completed saved execution carries familiarity without inventing a maximal performance',async t=>{
 setup(t,[entry(),entry({id:'history',date:'2026-10-22',status:'done',actual:{outcome:'as_planned',minutes:20,intensity:'EASY',note:'',reasons:[],at,executionState:'COMPLETED'}})])
 const r=await readTrainingModelWorkbench({},'2026-10-23',at)
 assert.equal(r.input.sessions.find(s=>s.id==='owned')!.familiar,true)
 assert.ok(r.input.sessions.find(s=>s.id==='owned')!.sourceRefs.some(s=>s.id.startsWith('saved-execution:')))
 assert.equal(r.input.performances.length,0)
 assert.equal(r.scientificInput.running.observedWeeks[0].minutes,20)
 assert.equal(r.scientificInput.running.observedWeeks[0].coverage,'RECORDED_ONLY')
})
