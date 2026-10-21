/** V92: verified COROS evidence adapter. No login, scraping or persistence. */
import type { Input, Sample, Sleep, Training } from './intraday-recovery-u10'
export type Metric='HEART_RATE'|'STRESS'|'HRV'|'RESTING_HR'|'STEPS'|'SLEEP_MINUTES'
export type Measure={id:string;metric:Metric;value:number;unit:'bpm'|'score'|'ms'|'steps'|'min';measuredAt:string;statistic:'INSTANT'|'DAILY_MEAN'|'DAILY_MAX'|'DAILY_TOTAL';revision?:number;protocol?:string}
export type SleepEvent={id:string;startAt:string;endAt:string;kind:'MAIN'|'NAP'|'REST'|'UNKNOWN_SLEEP';evidence:'DEVICE_SLEEP'|'DEVICE_REST'|'USER_CONFIRMED'}
export type Activity={id:string;startAt:string;endAt:string;kind:'RUN'|'STRENGTH'|'OTHER';actual:'CONFIRMED'|'UNVERIFIED'}
export type VerifiedBatch={athleteId:string;accountRef:string;verifiedOwner:boolean;source:'COROS_VERIFIED_SYNC'|'COROS_VERIFIED_EXPORT';receivedAt:string;measures:Measure[];sleeps:SleepEvent[];activities:Activity[]}
export type DailyFact={metric:Exclude<Metric,'HEART_RATE'|'STRESS'>;value:number;unit:string;measuredAt:string;statistic:string;sourceId:string;recordId:string}
export type Adapted={athleteId:string;sourceId:string|null;samples:Sample[];sleepEvents:Sleep[];trainingEvents:Training[];dailyFacts:DailyFact[];warnings:string[];capabilities:{heartRate:boolean;stress:boolean;bodyBattery:false;napEvents:boolean;workouts:boolean}}
const ts=(v:string)=>Date.parse(v),valid=(v:string)=>typeof v==='string'&&Number.isFinite(ts(v)),FUTURE=300000
const limits:Record<Metric,[number,number,string]>={HEART_RATE:[25,240,'bpm'],STRESS:[0,100,'score'],HRV:[1,500,'ms'],RESTING_HR:[25,200,'bpm'],STEPS:[0,250000,'steps'],SLEEP_MINUTES:[0,1440,'min']}
const empty=(id:string,warnings:string[]):Adapted=>({athleteId:id,sourceId:null,samples:[],sleepEvents:[],trainingEvents:[],dailyFacts:[],warnings,capabilities:{heartRate:false,stress:false,bodyBattery:false,napEvents:false,workouts:false}})
/** Caller must verify ownership server-side; accountRef is opaque and contains no tokens. */
export function adaptVerifiedCoros(b:VerifiedBatch,athleteId:string,now:string):Adapted{
 if(!athleteId||!valid(now))throw Error('INVALID_CONTEXT')
 const warnings:string[]=[]
 if(!b.verifiedOwner||b.athleteId!==athleteId||!/^[-_a-zA-Z0-9]{6,100}$/.test(b.accountRef)||!valid(b.receivedAt)||ts(b.receivedAt)>ts(now)+FUTURE||!['COROS_VERIFIED_SYNC','COROS_VERIFIED_EXPORT'].includes(b.source))return empty(athleteId,['账号归属或来源未核实，拒绝接入'])
 const sourceId='coros:'+b.accountRef,r=empty(athleteId,warnings);r.sourceId=sourceId
 const latest=new Map<string,Measure>(),conflict=new Set<string>()
 for(const m of b.measures){const lim=limits[m.metric]
  if(!m.id||!lim||!valid(m.measuredAt)||ts(m.measuredAt)>ts(now)+FUTURE||ts(m.measuredAt)>ts(b.receivedAt)+FUTURE||!Number.isFinite(m.value)||m.value<lim[0]||m.value>lim[1]||m.unit!==lim[2]||!Number.isInteger(m.revision??0)||(m.revision??0)<0){warnings.push('已排除无效读数');continue}
  const key=m.metric+':'+m.id,p=latest.get(key)
  if(!p){latest.set(key,m);continue}
  if((m.revision??0)===(p.revision??0)&&(m.value!==p.value||m.measuredAt!==p.measuredAt)){conflict.add(key);warnings.push('同版本设备读数冲突');continue}
  if((m.revision??0)>(p.revision??0)){latest.set(key,m);conflict.delete(key)}
 }
 for(const [key,m] of latest){if(conflict.has(key))continue
  if(m.metric==='HEART_RATE'||m.metric==='STRESS'){
   if(m.statistic!=='INSTANT')continue
   r.samples.push({athleteId,metric:m.metric,value:m.value,measuredAt:m.measuredAt,knownAt:b.receivedAt,sourceId,protocol:m.protocol||`coros:${m.metric.toLowerCase()}:device`,statistic:'INSTANT',quality:'CONFIRMED',context:'UNKNOWN',revision:m.revision??0})
  }else r.dailyFacts.push({metric:m.metric,value:m.value,unit:m.unit,measuredAt:m.measuredAt,statistic:m.statistic,sourceId,recordId:m.id})
 }
 const sleeps=new Map<string,SleepEvent>(),badSleep=new Set<string>()
 for(const s of b.sleeps){if(!s.id||!valid(s.startAt)||!valid(s.endAt)||ts(s.endAt)<=ts(s.startAt)||ts(s.endAt)>ts(now)+FUTURE||ts(s.endAt)>ts(b.receivedAt)+FUTURE||ts(s.endAt)-ts(s.startAt)>86400000){warnings.push('已排除无效睡眠事件');continue}
  const p=sleeps.get(s.id);if(p&&(p.startAt!==s.startAt||p.endAt!==s.endAt||p.kind!==s.kind)){badSleep.add(s.id);warnings.push('同ID睡眠事件冲突');continue}sleeps.set(s.id,s)
 }
 r.sleepEvents=[...sleeps.values()].filter(s=>!badSleep.has(s.id)).map(s=>({athleteId,eventId:'coros-sleep:'+s.id,startAt:s.startAt,endAt:s.endAt,knownAt:b.receivedAt,sourceId,kind:s.kind,evidence:s.evidence}))
 const acts=new Map<string,Activity>(),badAct=new Set<string>()
 for(const a of b.activities){if(!a.id||a.actual!=='CONFIRMED'||!valid(a.startAt)||!valid(a.endAt)||ts(a.endAt)<=ts(a.startAt)||ts(a.endAt)>ts(now)+FUTURE||ts(a.endAt)>ts(b.receivedAt)+FUTURE)continue
  const p=acts.get(a.id);if(p&&(p.startAt!==a.startAt||p.endAt!==a.endAt||p.kind!==a.kind)){badAct.add(a.id);warnings.push('同ID训练冲突');continue}acts.set(a.id,a)
 }
 r.trainingEvents=[...acts.values()].filter(a=>!badAct.has(a.id)).map(a=>({athleteId,eventId:'coros-activity:'+a.id,startAt:a.startAt,endAt:a.endAt,sourceId,kind:a.kind}))
 r.capabilities={heartRate:r.samples.some(s=>s.metric==='HEART_RATE'),stress:r.samples.some(s=>s.metric==='STRESS'),bodyBattery:false,napEvents:r.sleepEvents.some(s=>s.kind==='NAP'&&s.evidence==='DEVICE_SLEEP'),workouts:r.trainingEvents.length>0}
 return r
}
/** Same U10 projection; no synthetic Garmin Body Battery for COROS. */
export function mergeCorosRecovery(base:Input,coros:Adapted):Input{
 if(base.athleteId!==coros.athleteId)return base
 return {...base,samples:[...base.samples,...coros.samples],sleepEvents:[...base.sleepEvents,...coros.sleepEvents],trainingEvents:[...base.trainingEvents,...coros.trainingEvents]}
}
