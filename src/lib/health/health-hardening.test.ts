import assert from 'node:assert/strict'
import test,{beforeEach,afterEach} from 'node:test'
import {setStoreBackend,type MemoryStore} from '../core/storage'
import {setEventContext} from '../core/events'
import {saveVital,loadVitals,VITALS_KEY} from '../nutrition/vitals'
import {saveDeviceRows,loadExtras,type DeviceHealthRow} from './device-store'
import {loadHealthSnapshot} from './snapshot'
import {reviewFatigue,reviewBalance} from './analysis'
import {garminHealthDay} from './garmin-health'
import {readCoachData,answerFromAppData} from './coach-data'
import {assembleCoachBrief} from '../core/coach-brief'
import {answerLocally} from '../core/coach-local-first'
import {shiftDay} from './observation'
import {confirmTrainingImport,createTrainingImportDraft} from '../core/training-import'
import {appendCorrection} from '../core/training-correction'
import type {ScheduleEntry} from './legacy-inputs'

const day='2026-10-17',at='2026-10-17T01:00:00Z';let store:MemoryStore,data:Map<string,string>;
const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
beforeEach(()=>{data=new Map();store={getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v)},keys:()=>[...data.keys()]};setStoreBackend(store);setEventContext({athleteId:'local'});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:store})})
afterEach(()=>{setStoreBackend(null);setEventContext({athleteId:'local'});if(old)Object.defineProperty(globalThis,'localStorage',old);else delete (globalThis as any).localStorage})
const row=(metric:DeviceHealthRow['metric'],value:number,date=day):DeviceHealthRow=>({key:`${metric}:${date}`,source:'synthetic-watch',metric,value,day:date,hrvMethod:'RMSSD',observation:{key:`${metric}:${date}`,sourceId:'watch-a',statistic:'daily',syncedAt:at}})
const metric=(m:string)=>loadHealthSnapshot(day).metrics.find(x=>x.metric===m)!
const seed=(m:DeviceHealthRow['metric'],vs:number[])=>saveDeviceRows(vs.map((v,i)=>row(m,v,shiftDay(day,i-vs.length+1))))

test('unknown Garmin HRV algorithm is never a comparable baseline even with a named statistic',()=>{
 const rows=[0,1,2,3].map(i=>({...row('HRV',60,shiftDay(day,-i)),hrvMethod:'UNSPECIFIED' as const,observation:{...row('HRV',60,shiftDay(day,-i)).observation!,statistic:'昨夜平均；算法未提供'}}));
 saveDeviceRows(rows);assert.equal(metric('HRV').current?.value,60);assert.equal(metric('HRV').baseline,null);
})
test('undated Garmin responses cannot be assigned a requested day or claim successful sync',()=>{
 const r=garminHealthDay(day,'synthetic',{status:200,body:{restingHeartRate:50}},{status:200,body:{hrvSummary:{lastNightAvg:70}}},{status:200,body:{dailySleepDTO:{sleepTimeSeconds:28800}}},at)
 assert.equal(r.rows.length,0);assert.equal(r.failures.length,3)
})
test('out-of-order resync cannot replace a newer correction',()=>{
 saveDeviceRows([row('RHR',50)]);const newer={...row('RHR',55),observation:{...row('RHR',55).observation!,syncedAt:'2026-10-17T02:00:00Z'}};saveDeviceRows([newer]);
 const before=store.getItem(VITALS_KEY);assert.equal(saveDeviceRows([row('RHR',49)]).errors.length,1);assert.equal(store.getItem(VITALS_KEY),before);assert.equal(metric('RHR').current?.value,55)
})
test('reused observation key cannot silently change metric or day',()=>{
 saveDeviceRows([row('RHR',50)]);const changed={...row('SLEEP',8),observation:row('RHR',50).observation};
 assert.equal(saveDeviceRows([changed]).errors.length,1);assert.equal(loadVitals().records.length,1);assert.equal(loadVitals().records[0].kind,'RHR')
})
test('same external key in two device streams does not overwrite either source',()=>{
 saveDeviceRows([row('RHR',50),{...row('RHR',70),observation:{...row('RHR',70).observation!,sourceId:'watch-b'}}]);
 assert.equal(loadVitals().records.length,2);assert.equal(metric('RHR').state,'CONFLICT')
})
test('legacy device labels keep independent HRV histories apart',()=>{
 for(let i=0;i<4;i++)saveVital({kind:'HRV',value:50,source:'MANUAL',hrvMethod:'RMSSD',observedOn:shiftDay(day,-i),deviceLabel:i?'watch-A':'watch-B',measurementMethod:'morning'});
 assert.equal(metric('HRV').current?.value,50);assert.equal(metric('HRV').baseline,null)
})
test('independent conflicting readings from the same source are not silently treated as revisions',()=>{
 saveVital({kind:'RHR',value:50,source:'MANUAL',observedOn:day});saveVital({kind:'RHR',value:70,source:'MANUAL',observedOn:day});
 assert.equal(metric('RHR').state,'CONFLICT');assert.equal(metric('RHR').current,null);assert.equal(loadVitals().records.length,2)
})
test('a conflicting historical day is excluded from the descriptive baseline',()=>{
 seed('SLEEP',[8,8,8,7]);saveDeviceRows([{...row('SLEEP',5,shiftDay(day,-1)),observation:{...row('SLEEP',5,shiftDay(day,-1)).observation!,key:'independent'}}]);
 assert.equal(metric('SLEEP').baseline,null);assert.equal(metric('SLEEP').current?.value,7)
})
test('malformed persisted values remain unreadable instead of becoming zero',()=>{
 saveVital({kind:'SLEEP',value:8,source:'MANUAL',observedOn:day});const v=JSON.parse(store.getItem(VITALS_KEY)!);v.records[0].value=null;store.setItem(VITALS_KEY,JSON.stringify(v));const before=store.getItem(VITALS_KEY);
 assert.equal(loadVitals().unreadable,true);assert.equal(saveDeviceRows([row('SLEEP',7)]).saved,0);assert.equal(store.getItem(VITALS_KEY),before)
})
test('invalid check-ins are reported unreadable without a crash or a recovered verdict',()=>{
 seed('SLEEP',[8,8,8,8]);store.setItem('fk-checkin-v1',JSON.stringify([null,{date:day,at,fatigue:'great'}]));
 const d=readCoachData(day);assert.equal(d.fatigue.state,'INSUFFICIENT');assert.ok(d.warnings.some(x=>x.includes('无法读取')))
})
test('storage read denial is an explicit unreadable state',()=>{
 setStoreBackend({getItem:()=>{throw Error('denied')},setItem:()=>{}});assert.equal(loadVitals().unreadable,true);assert.equal(loadHealthSnapshot(day).unreadable,true)
})
test('candidate fatigue thresholds never become a reduction prescription or training permission',()=>{
 seed('SLEEP',[8,8,8,6]);seed('HRV',[60,60,60,40]);const before=[...data];const r=reviewFatigue(loadHealthSnapshot(day),{date:day,at,fatigue:'tired'});
 assert.equal(r.state,'MULTI_SIGNAL');assert.equal(r.ruleStatus,'RESEARCH_CANDIDATE');assert.equal(r.automaticPrescription,false);assert.match(r.action,/不足以据此决定减量/);assert.equal(r.planChanged,false);assert.deepEqual([...data],before)
})
test('health data does not hijack a session split or rest-time question',()=>{
 seed('SLEEP',[8,8,8,6]);const b=assembleCoachBrief(null,day+' 本次4×1000米配速和组间恢复数据如何',null);
 assert.equal(answerFromAppData(b),null);assert.doesNotMatch(answerLocally(b).text,/分析日期：/)
})
test('an emergency still overrides a daily multi-signal review',()=>{
 seed('SLEEP',[8,8,8,6]);store.setItem('fk-checkin-v1',JSON.stringify([{date:day,at,fatigue:'tired'}]));
 const result=answerLocally(assembleCoachBrief(null,day+' 今天疲劳胸痛喘不上气还能练吗',null));assert.match(result.text,/急救|急诊/);assert.doesNotMatch(result.text,/分析日期：/)
})
test('duplicate schedule IDs do not inflate actual sessions or minutes',()=>{
 const e:ScheduleEntry={id:'one',date:day,kind:'run',modality:'run',title:'课',focus:[],minutes:30,intensity:'EASY',lowerHeavy:false,source:'custom',refId:null,status:'done',actual:{outcome:'as_planned',minutes:30,km:5,intensity:'EASY',note:'',reasons:[],at}};
 const r=reviewBalance([e,{...e}],day);assert.equal(r.actual.sessions,0);assert.equal(r.actual.knownMinutes,0);assert.match(r.gaps.join(''),/重复/)
})
test('corrupt legacy schedule is explicitly unavailable instead of being claimed empty',()=>{
 store.setItem('fk-schedule-v1','{');const d=readCoachData(day);assert.ok(d.warnings.some(x=>x.includes('日程无法读取')));assert.equal(store.getItem('fk-schedule-v1'),'{')
})
test('switching athlete retains records but cannot reuse another athlete health measurements',()=>{
 saveDeviceRows([row('RHR',50),row('STEPS',100)]);setEventContext({athleteId:'other'});assert.equal(metric('RHR').state,'MISSING');assert.equal(loadExtras().length,0);
 saveDeviceRows([row('RHR',70),row('STEPS',200)]);assert.equal(metric('RHR').current?.value,70);setEventContext({athleteId:'local'});assert.equal(metric('RHR').current?.value,50);assert.equal(loadExtras()[0].value,100);assert.equal(loadVitals().records.length,2)
})
const recorded=<T,>(value:T)=>({value,status:'RECORDED',sourceIds:['text']});
function imported(){const draft=createTrainingImportDraft({sport:'RUNNING',occurredAt:recorded('2026-10-16T01:00:00Z'),title:recorded('合成训练'),durationSeconds:recorded(1800),totalDistanceMeters:recorded(5000),runningStructure:'UNAVAILABLE'},'TEXT',['text']);const r=confirmTrainingImport(draft);assert.equal(r.ok,true);if(!r.ok)throw Error('confirmation failed');return r.record}
test('daily import summary does not combine athletes or count imported activities as completed core sessions',()=>{
 imported();const d=readCoachData(day);assert.equal(d.imports.count,1);assert.equal(d.coreActual.sessions,0);assert.equal(d.balance.actualSessions,0);
 setEventContext({athleteId:'other'});assert.equal(readCoachData(day).imports.count,0)
})
test('correction invalidates old imported total and void removes the activity from daily context',()=>{
 const i=imported();assert.equal(readCoachData(day).imports.latest[0].distanceM,5000);
 appendCorrection({trainingOccurrenceId:i.confirmedImportId,kind:'FIELD',field:'distance',setKey:null,originalValue:'5000',newValue:'4800',reason:'合成核对'});
 assert.equal(readCoachData(day).imports.latest[0].distanceM,null);
 appendCorrection({trainingOccurrenceId:i.confirmedImportId,kind:'VOID',reason:'合成撤回'});assert.equal(readCoachData(day).imports.count,0)
})
test('offline answer generation performs no fetch and writes no official plan or training data',()=>{
 saveDeviceRows([row('SLEEP',7.25)]);const before=[...data];const prior=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden')};
 try{const b=assembleCoachBrief(null,day+' 健康睡眠数据',null);const a=answerLocally(b);assert.match(a.text,/7小时15分/);assert.equal(b.sleepHours,null);assert.deepEqual([...data],before)}finally{globalThis.fetch=prior}
})
