import test from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend} from '../core/storage.ts'
import {currentAthleteId,setEventContext} from '../core/events.ts'
import {saveDeviceRows,type DeviceHealthRow} from '../health/device-store.ts'
import {saveVital} from '../nutrition/vitals.ts'
import {saveSelfReportedRest} from '../health/rest-store.ts'
import {saveIntraday} from '../health/intraday-store.ts'
import {shiftDay} from '../health/observation.ts'
import {startTraining,completeTraining} from '../core/training-decision.ts'
import {bindTrainingStart,closeTrainingOccurrence} from '../core/occurrence.ts'
import {emptySets,recordSet} from '../core/execution.ts'
import type {Session} from '../strength/model.ts'
import {onlineRecoveryFacts} from './online-recovery-facts.ts'

const day='2026-10-22',asOf='2026-10-22T12:00:00.000Z',owner='synthetic-online-recovery'
function fixture(t:test.TestContext){
 t.mock.timers.enable({apis:['Date'],now:new Date(asOf)})
 const previous=currentAthleteId(),oldLocal=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldFetch=globalThis.fetch
 const data=new Map<string,string>(),store={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)},keys:()=>[...data.keys()]}
 Object.defineProperty(globalThis,'localStorage',{value:store,configurable:true});Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true})
 globalThis.fetch=()=>{throw Error('SYNTHETIC_TEST_NO_NETWORK')};setStoreBackend(store);setEventContext({athleteId:owner})
 t.after(()=>{setStoreBackend(null);setEventContext({athleteId:previous});globalThis.fetch=oldFetch;for(const [key,old]of [['localStorage',oldLocal],['window',oldWindow]] as const){if(old)Object.defineProperty(globalThis,key,old);else Reflect.deleteProperty(globalThis,key)}})
 return{data,store}
}
function health(metric:DeviceHealthRow['metric'],value:number,date=day,knownAt=`${date}T08:00:00Z`,sourceId='synthetic-device'):DeviceHealthRow{
 return{key:`${metric}:${date}:${sourceId}`,metric,value,day:date,source:'PRIVATE_HEALTH_SOURCE_NOTE',hrvMethod:'RMSSD',observation:{key:`${metric}:${date}:${sourceId}`,sourceId,statistic:metric==='SLEEP'?'night total':metric==='HRV'?'night RMSSD mean':metric==='BODY_BATTERY'?'当日最高（非当前值）':'daily metric',syncedAt:knownAt}}
}
const text=(f:ReturnType<typeof onlineRecoveryFacts>)=>[...f.summary,...f.details].join('\n')

test('unlinked recovery includes dated key metrics, subjective feedback, and independently recorded nap',t=>{
 const f=fixture(t);assert.deepEqual(saveDeviceRows([health('SLEEP',6.5),health('HRV',48),health('RHR',58),health('BODY_BATTERY',73),health('STRESS',24)]).errors,[])
 f.data.set('fk-checkin-v1',JSON.stringify([{athleteId:owner,date:day,at:`${day}T09:00:00Z`,fatigue:'tired',pain:'none',recovery:4,recoveryScale:10}]))
 assert.ok(saveSelfReportedRest({requestId:'nap',athleteId:owner,contextDay:day,kind:'NAP',duration:{low:25,high:25},start:null,end:null,timezone:'UTC'},Date.parse(`${day}T10:00:00Z`)).ok)
 const facts=onlineRecoveryFacts(day,asOf),out=text(facts)
 assert.match(out,/2026-10-22/);assert.match(out,/睡眠.*6\.5/);assert.match(out,/HRV.*48/);assert.match(out,/静息心率.*58/)
 assert.match(out,/很累/);assert.match(out,/恢复.*4\/10/);assert.match(out,/午睡.*25分钟/);assert.match(out,/身体电量.*73/);assert.match(out,/最高|非当前/)
 assert.doesNotMatch(out,/PRIVATE_|synthetic-online-recovery|synthetic-device/)
 assert.ok(facts.summary.every(x=>x.length<=500));assert.ok(facts.details.length<=8&&facts.details.every(x=>x.length<=350))
})
test('known-after-request readings are excluded from both daily health and minute samples',t=>{
 fixture(t);assert.deepEqual(saveDeviceRows([health('SLEEP',7.75,day,`${day}T18:00:00Z`),health('BODY_BATTERY',99,day,`${day}T18:00:00Z`)]).errors,[])
 assert.equal(saveIntraday([{schemaVersion:1,day,source:'garmin',fetchedAt:`${day}T12:02:00Z`,offsetMin:0,hr:[],bb:[[Date.parse(`${day}T11:59:00Z`),97]],restingHr:null,sleep:null,training:[]}]),1)
 const out=text(onlineRecoveryFacts(day,asOf))
 assert.doesNotMatch(out,/7\.75|7小时45|\b99\b|\b97\b/);assert.match(out,/截至|时点/)
})
test('historical day is preserved, and athlete switching cannot expose previous recovery',t=>{
 fixture(t);saveDeviceRows([health('SLEEP',6,'2026-10-21'),health('SLEEP',8)])
 const past=text(onlineRecoveryFacts('2026-10-21',asOf));assert.match(past,/2026-10-21/);assert.match(past,/睡眠.*6/);assert.doesNotMatch(past,/睡眠.*8(?:\s*h|小时)/)
 setEventContext({athleteId:'other'});assert.doesNotMatch(text(onlineRecoveryFacts(day,asOf)),/睡眠.*8(?:\s*h|小时)/)
})
test('current changes use a comparable seven-day recovery baseline without leaking source labels',t=>{
 fixture(t);saveDeviceRows([health('RHR',60),health('HRV',48),...Array.from({length:7},(_,i)=>[health('RHR',50,shiftDay(day,-i-1)),health('HRV',60,shiftDay(day,-i-1))]).flat()])
 const out=text(onlineRecoveryFacts(day,asOf))
 assert.match(out,/前7天|近7天/);assert.match(out,/中位数.*50/);assert.match(out,/\+10/);assert.match(out,/lnRMSSD/);assert.doesNotMatch(out,/PRIVATE_/)
})
test('independent conflicting health sources are retained as a conflict instead of a preferred number',t=>{
 fixture(t);saveDeviceRows([health('SLEEP',6,day,`${day}T08:00:00Z`,'source-one'),health('SLEEP',9,day,`${day}T09:00:00Z`,'source-two')])
 const out=text(onlineRecoveryFacts(day,asOf));assert.match(out,/睡眠.*冲突|冲突.*睡眠/);assert.doesNotMatch(out,/睡眠[:：]\s*(?:6|9)\s*h/)
})
test('muscle recovery keeps confirmed exposure and does not transmit custom exercise or session names',t=>{
 fixture(t)
 const session:Session={id:'private-session',name:'PRIVATE_SESSION_LOCATION',moves:[{id:'private-move',catalogId:'back-squat',customName:'PRIVATE_CUSTOM_EXERCISE',sets:1,mode:'reps',amount:8,restSec:60,weightKg:40}]}
 const start=startTraining({decisionId:'decision',sessionId:session.id,action:'ORIGINAL_PLAN'});assert.ok(start)
 assert.ok(bindTrainingStart({startEventId:start.event_id,startedAt:start.timestamp,sessionId:session.id,planSlotId:session.id,plan:session}))
 assert.ok(recordSet(session.id,'decision',{...emptySets(session)[0],actualWeight:40,actualAmount:8,completed:true,source:'user_entered',timestamp:asOf}))
 const close=completeTraining({decisionId:'decision',sessionId:session.id,planned:null,actualSets:1,actualAmount:8,actualWeightKg:40,rpe:null,pain:false,modified:false,interrupted:false});assert.ok(close);assert.ok(closeTrainingOccurrence(close))
 const out=text(onlineRecoveryFacts(day,asOf))
 assert.match(out,/股四头肌|臀肌/);assert.match(out,/训练参与/);assert.match(out,/不是.*恢复|不能.*恢复|不.*许可/);assert.doesNotMatch(out,/PRIVATE_|private-session|private-move/)
})
test('unreadable health records and missing records have different output',t=>{
 const f=fixture(t);assert.match(text(onlineRecoveryFacts(day,asOf)),/无.*记录|未.*记录|缺少/)
 f.data.set('fr255-vitals-v1','{BROKEN');assert.match(text(onlineRecoveryFacts(day,asOf)),/读取失败|无法读取/)
})
test('recovery packet reads do not mutate existing health or rest records',t=>{
 const f=fixture(t);saveDeviceRows([health('SLEEP',6.5)])
 const before=JSON.stringify([...f.data]);onlineRecoveryFacts(day,asOf)
 assert.equal(JSON.stringify([...f.data]),before)
})
test('available health recovery, steps and calorie components retain their own measurement scopes',t=>{
 fixture(t)
 assert.ok(saveVital({kind:'RECOVERY',value:7,observedOn:day,source:'MANUAL',note:'PRIVATE_RECOVERY_NOTE'},'recovery',`${day}T08:00:00Z`).ok)
 assert.deepEqual(saveDeviceRows([health('STEPS',6500),health('ACTIVE_KCAL',430),health('RESTING_KCAL',1500),health('TOTAL_KCAL',1930),health('WORKOUT_KCAL',220)]).errors,[])
 const facts=onlineRecoveryFacts(day,asOf),out=text(facts)
 assert.match(out,/主观恢复[:：]\s*7\s*\/10/);assert.match(out,/主观评分|自报评分/);assert.match(out,/步数[:：]\s*6500\s*步/)
 assert.match(out,/活动热量[:：]\s*430\s*kcal[^；。\n]*(?:不代表全天|不含静息|活动部分)/)
 assert.match(out,/静息热量[:：]\s*1500\s*kcal[^；。\n]*静息/)
 assert.match(out,/全天总热量[:：]\s*1930\s*kcal[^。\n]*(?:不.*相加|不.*叠加)/)
 assert.match(out,/单次运动热量[:：]\s*220\s*kcal[^。\n]*(?:单次|重叠)/)
 assert.doesNotMatch(out,/PRIVATE_|synthetic-online-recovery|synthetic-device/)
 assert.ok(facts.summary.every(x=>x.length<=500));assert.ok(facts.details.length<=8&&facts.details.every(x=>x.length<=350))
})
test('additional health metrics exclude future-known values and preserve independent-source conflicts',t=>{
 fixture(t)
 assert.ok(saveVital({kind:'RECOVERY',value:9,observedOn:day,source:'MANUAL'},'future-recovery',`${day}T18:00:00Z`).ok)
 assert.deepEqual(saveDeviceRows([health('STEPS',11111,day,`${day}T08:00:00Z`,'one'),health('STEPS',22222,day,`${day}T09:00:00Z`,'two'),health('ACTIVE_KCAL',333,day,`${day}T08:00:00Z`,'one'),health('ACTIVE_KCAL',444,day,`${day}T09:00:00Z`,'two'),health('TOTAL_KCAL',9999,day,`${day}T18:00:00Z`)]).errors,[])
 const out=text(onlineRecoveryFacts(day,asOf));assert.match(out,/步数.*冲突/);assert.match(out,/活动热量.*冲突/)
 assert.doesNotMatch(out,/11111|22222|333|444|9999|主观恢复[:：]\s*9/)
})
test('an explicit zero-step record stays available without filling absent energy fields',t=>{
 fixture(t);saveDeviceRows([health('STEPS',0)])
 const out=text(onlineRecoveryFacts(day,asOf));assert.match(out,/步数[:：]\s*0\s*步/)
 assert.doesNotMatch(out,/活动热量[:：]|静息热量[:：]|全天总热量[:：]|单次运动热量[:：]/)
})

test('coach and health tile use newer most-recent Body Battery, without calling receipt time a measurement',t=>{
 fixture(t)
 const row=health('BODY_BATTERY',41,day,`${day}T11:50:00Z`,'garmin:live')
 row.observation!.statistic='同步时最近值'
 assert.deepEqual(saveDeviceRows([row]).errors,[])
 saveIntraday([{schemaVersion:1,day,source:'garmin',sourceId:'garmin:live',fetchedAt:`${day}T09:00:00Z`,offsetMin:0,hr:[],bb:[[Date.parse(`${day}T08:27:00Z`),50]],restingHr:null,sleep:null,training:[]}])
 const facts=onlineRecoveryFacts(day,asOf),out=text(facts)
 assert.match(facts.summary.join('\n'),/身体电量：41\/100/)
 assert.match(out,/测量时间未提供/)
 assert.match(out,/同步.*11:50/)
 assert.doesNotMatch(out,/测量\s+2026-10-22T11:50/)
})
test('coach uses newer measured Body Battery when day summary is older',t=>{
 fixture(t)
 const row=health('BODY_BATTERY',41,day,`${day}T09:00:00Z`,'garmin:live');row.observation!.statistic='同步时最近值';saveDeviceRows([row])
 saveIntraday([{schemaVersion:1,day,source:'garmin',sourceId:'garmin:live',fetchedAt:`${day}T11:59:00Z`,offsetMin:0,hr:[],bb:[[Date.parse(`${day}T11:58:00Z`),39]],restingHr:null,sleep:null,training:[]}])
 const facts=onlineRecoveryFacts(day,asOf);assert.match(facts.summary.join('\n'),/身体电量：39\/100/);assert.match(text(facts),/测量.*11:58/)
})
