import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIntradayDay, type IntradayDay } from './garmin-intraday.ts'
import { intradayRecoveryFromStore } from './intraday-recovery-bridge-v89.ts'
import { buildIntradayRecovery, type Input } from './intraday-recovery-u10.ts'
import { eventReadout, restOnDay, restReadout } from './event-presentation.ts'
import type { RestRecord } from './intraday/sleep.ts'
const day='2026-10-21',now='2026-10-23T12:00:00Z',ms=(s:string)=>Date.parse(s)
const empty=(d=day):IntradayDay=>({schemaVersion:1,source:'garmin',day:d,fetchedAt:now,offsetMin:480,hr:[],bb:[],st:[],restingHr:null,sleep:null,training:[]})
const hr={status:200,body:{calendarDate:day,startTimestampGMT:'2026-10-20 16:00:00',startTimestampLocal:'2026-10-21 00:00:00',heartRateValues:[[ms('2026-10-21T08:00:00+08:00'),60]]}}

test('training after last HR sample remains on that device calendar day; other days and future events stay out',()=>{
 const activities=[{startIso:'2026-10-21T18:00:00+08:00',durationSec:3600,sportLabel:'跑步',key:'act-1'}, {startIso:'2026-10-22T18:00:00+08:00',durationSec:3600,sportLabel:'跑步'}, {startIso:'2026-10-21T23:00:00+08:00',durationSec:3600,sportLabel:'未来'}]
 const d=buildIntradayDay({day,now:'2026-10-21T20:00:00+08:00',hr,stress:undefined,activities}).day!
 assert.equal(d.training.length,1);assert.equal(d.training[0].id,'act-1');assert.equal(d.training[0].start,ms(activities[0].startIso))
})
test('sleep-only and activity-only days are retained without inventing HR or battery samples',()=>{
 const d=buildIntradayDay({day,now,hr:undefined,stress:undefined,sleep:{status:200,body:{dailySleepDTO:{calendarDate:day,sleepStartTimestampGMT:ms(day+'T00:00:00Z'),sleepEndTimestampGMT:ms(day+'T07:00:00Z')}}}}).day!
 assert.ok(d.sleep);assert.deepEqual(d.hr,[]);assert.deepEqual(d.bb,[])
 const t=buildIntradayDay({day,now,hr:undefined,stress:undefined,activities:[{startIso:day+'T12:00:00Z',durationSec:600,sportLabel:'跑步'}]}).day!
 assert.equal(t.training.length,1)
 assert.equal(buildIntradayDay({day,now,hr:undefined,stress:undefined,sleep:{status:200,body:{dailySleepDTO:{calendarDate:'2026-10-20'}}}}).day,null)
})
test('overnight sleep preserves full interval and duration while chart only covers selected day; late sync is readable',()=>{
 const d={...empty(),sleep:[ms('2026-10-20T23:00:00+08:00'),ms(day+'T07:00:00+08:00')] as [number,number]}
 const v=intradayRecoveryFromStore({[day]:d},'local',day,now)!
 const e=v.events[0];assert.equal(e.startHour,0);assert.equal(e.endHour,7)
 assert.deepEqual(eventReadout(e,day,480),{time:'前一天 23:00–07:00',duration:'时段 8小时 · 当天 7小时'})
 assert.equal(intradayRecoveryFromStore({[day]:d},'local',day,'2026-10-21T12:00:00Z')!.events.length,0,'as-of evidence does not leak a later sync')
})
test('adjacent-day copies of overnight training are deduplicated; tomorrow boundary is explicit',()=>{
 const t={start:ms(day+'T23:30:00+08:00'),end:ms('2026-10-22T00:30:00+08:00'),label:'跑步'}
 const a={...empty(),training:[t]},b={...empty('2026-10-22'),training:[t]}
 const v=intradayRecoveryFromStore({[day]:a,'2026-10-22':b},'local',day,now)!
 assert.equal(v.events.length,1);assert.equal(eventReadout(v.events[0],day,480).time,'23:30–次日 00:30');assert.equal(eventReadout(v.events[0],day,480).duration,'时段 1小时 · 当天 30分钟')
 const v2=intradayRecoveryFromStore({[day]:a,'2026-10-22':b},'local','2026-10-22',now)!
 assert.equal(v2.events.length,1);assert.equal(v2.events[0].endHour,.5)
})
test('future, wrong-owner and unknown-at-time training cannot be shown as confirmed',()=>{
 const input:Input={athleteId:'a',day,utcOffsetMinutes:480,now:day+'T12:00:00+08:00',samples:[],sleepEvents:[],trainingEvents:[]}
 const t={athleteId:'a',eventId:'t',startAt:day+'T10:00:00+08:00',endAt:day+'T11:00:00+08:00',sourceId:'watch',kind:'RUN' as const}
 for(const bad of [{...t,athleteId:'b'},{...t,endAt:day+'T14:00:00+08:00'},{...t,knownAt:day+'T13:00:00+08:00'},{...t,sourceId:''}])assert.equal(buildIntradayRecovery({...input,trainingEvents:[bad]}).events.length,0)
 assert.equal(buildIntradayRecovery({...input,trainingEvents:[t]}).events.length,1)
})
test('phone timezone cannot change an event when the device offset exists, including half-hour offsets',()=>{
 const base={...empty(),offsetMin:570,sleep:[ms('2026-10-20T15:00:00Z'),ms('2026-10-20T22:00:00Z')] as [number,number]}
 const view=intradayRecoveryFromStore({[day]:base},'a',day,now)!
 assert.equal(eventReadout(view.events[0],day,570).time,'00:30–07:30')
})
const rest=(patch:Partial<RestRecord>={}):RestRecord=>({athleteId:'local',sourceNamespace:'self:local',originEventId:'r',transport:'SELF_REPORT',transportRecordId:'r',revision:1,knownAt:ms(now),removed:false,kind:'NAP',form:'DURATION_ESTIMATE',duration:{low:20,high:null},contextDay:day,sourceEpisodeId:null,inclusion:'UNKNOWN',protocol:'SELF_REPORTED_Asia/Shanghai',occurredStart:null,occurredEnd:null,...patch})
test('self-reported estimates keep unknown clock time and one-sided duration, never manufacture a nap interval',()=>{
 const r=rest();assert.deepEqual(restReadout(r,day,480),{time:'未填写具体时刻',duration:'至少 20 分钟'})
 assert.equal(restOnDay([r],day,480).length,1);assert.equal(restOnDay([r],'2026-10-22',480).length,0)
})
test('self-reported absolute intervals are shown by overlap rather than a mismatched context date',()=>{
 const r=rest({form:'INTERVAL',duration:null,contextDay:'2026-10-20',occurredStart:ms(day+'T13:00:00+08:00'),occurredEnd:ms(day+'T13:30:00+08:00')})
 assert.equal(restOnDay([r],day,480).length,1);assert.equal(restOnDay([r],'2026-10-20',480).length,0)
 assert.deepEqual(restReadout(r,day,480),{time:'13:00–13:30',duration:'时段 30分钟'})
})
test('overlapping sleep disagreement remains visible instead of being called a confirmed single interval',()=>{
 const input:Input={athleteId:'a',day,utcOffsetMinutes:480,now,samples:[],trainingEvents:[],sleepEvents:[
  {athleteId:'a',eventId:'1',sourceId:'watch',kind:'MAIN',evidence:'DEVICE_SLEEP',knownAt:now,startAt:day+'T00:00:00+08:00',endAt:day+'T08:00:00+08:00'},
  {athleteId:'a',eventId:'2',sourceId:'self',kind:'MAIN',evidence:'USER_CONFIRMED',knownAt:now,startAt:day+'T00:00:00+08:00',endAt:day+'T07:00:00+08:00'}]}
 assert.equal(buildIntradayRecovery(input).events[0].status,'CONFLICT')
})

import { saveIntraday, loadIntraday, intradayComplete } from './intraday-store.ts'
import { setStoreBackend } from '../core/storage.ts'
import { setEventContext } from '../core/events.ts'
test('event-only sync after failed readings preserves earlier samples and retries incomplete cache',()=>{
 const map=new Map<string,string>();setStoreBackend({keys:()=>[...map.keys()],getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v)}});setEventContext({athleteId:'local'})
 try{
  const prior={...empty(),eventTimingVersion:2 as const,hr:[[ms(day+'T08:00:00+08:00'),60]] as [number,number][],bb:[[ms(day+'T08:00:00+08:00'),50]] as [number,number][]}
  saveIntraday([prior]);assert.equal(intradayComplete(day),true)
  const update=buildIntradayDay({day,now,hr:{status:500,body:{}},stress:undefined,activities:[{startIso:day+'T12:00:00Z',durationSec:600,sportLabel:'跑步'}]}).day!
  saveIntraday([update]);const kept=loadIntraday()[day];assert.deepEqual(kept.hr,prior.hr);assert.deepEqual(kept.bb,prior.bb);assert.equal(kept.training.length,1);assert.equal(intradayComplete(day),false)
  saveIntraday([{...prior,eventTimingVersion:undefined}]);assert.equal(intradayComplete(day),false,'pre-R3 days are refetched in the existing window')
 }finally{setStoreBackend(null);setEventContext({athleteId:'local'})}
})
