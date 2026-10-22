import {currentAthleteId} from '../core/events'
/** Confirmed health imports only. Training activities continue through the existing training-import contract. */
import {currentStore} from '../core/storage'
import {loadVitals,saveVital,type HrvMethod,type VitalKind} from '../nutrition/vitals'
import {healthChanged,revisedObservation,shortHash,validDay,validObservation,type Observation} from './observation'
import {readArray} from './legacy-inputs'
export type HealthMetric='RHR'|'HRV'|'SLEEP'|'BODY_BATTERY'|'READINESS'|'STRESS'|'STEPS'|'SPO2'|'RESP'|'WEIGHT'|'ACTIVE_KCAL'|'RESTING_KCAL'|'TOTAL_KCAL'|'WORKOUT_KCAL'
export type DeviceHealthRow={key:string;source:string;metric:HealthMetric;day:string;value:number;hrvMethod?:HrvMethod;observation?:Observation}
export type ExtraRow={athleteId?:string;metric:HealthMetric;day:string;value:number;source:string;observation?:Observation}
export const DEVICE_EXTRA_KEY='fk-device-extra-v1'
const bounds:Partial<Record<HealthMetric,readonly[number,number]>>={BODY_BATTERY:[0,100],READINESS:[0,100],STRESS:[0,100],STEPS:[0,100000],SPO2:[70,100],RESP:[4,40],ACTIVE_KCAL:[0,100000],RESTING_KCAL:[0,100000],TOTAL_KCAL:[0,100000],WORKOUT_KCAL:[0,100000]}
function validExtra(v:unknown):v is ExtraRow{
 if(!v||typeof v!=='object')return false;const r=v as ExtraRow,b=bounds[r.metric];
 return !!b&&typeof r.source==='string'&&r.source.length>0&&validDay(r.day)&&Number.isFinite(r.value)&&r.value>=b[0]&&r.value<=b[1]&&validObservation(r.observation)
}
export function extrasUnreadable(){const r=readArray(DEVICE_EXTRA_KEY);return r.unreadable||r.rows.some(x=>!validExtra(x))}
export function loadExtras():ExtraRow[]{return readArray(DEVICE_EXTRA_KEY).rows.filter(validExtra).filter(x=>(x.athleteId??'local')===currentAthleteId())}
export function hrvMethodOf(_source:string):HrvMethod{return 'UNSPECIFIED'}
export function observationFor(row:DeviceHealthRow):Observation{
 const sourceId=`import:${shortHash(row.source)}`;
 return row.observation??{key:`${sourceId}:${row.metric}:${row.hrvMethod??''}:${row.day}`,sourceId,statistic:'统计口径未提供',syncedAt:new Date().toISOString()}
}
export function saveDeviceRows(health:DeviceHealthRow[],activities:readonly unknown[]=[]):{saved:number;skipped:number;errors:string[]}{
 let saved=0,skipped=0;const errors:string[]=[];
 if(activities.length)errors.push('训练活动须通过现有训练导入核对流程；未猜测训练结构或写入活动。');
 for(const row of health){
  if(!row||typeof row.source!=='string'||!row.source.trim()||!validDay(row.day)||!Number.isFinite(row.value)||!validObservation(row.observation)){errors.push('健康数据或来源无效');continue}
  const observation=observationFor(row),kind=({RHR:'RHR',HRV:'HRV',SLEEP:'SLEEP'} as Partial<Record<HealthMetric,VitalKind>>)[row.metric];
  if(kind){
   const before=loadVitals().records.find(x=>(x.athleteId??'local')===currentAthleteId()&&x.observation?.key===observation.key&&x.observation.sourceId===observation.sourceId);
   const res=saveVital({kind,value:row.value,observedOn:row.day,source:'DEVICE_CONFIRMED',note:row.source.slice(0,80),hrvMethod:kind==='HRV'?row.hrvMethod??'UNSPECIFIED':null,observation});
   if(!res.ok)errors.push(`${row.metric}：${res.reason}`);else if(before?.value===row.value)skipped++;else saved++;
   continue;
  }
  if(!validExtra(row)){errors.push(`${(row as DeviceHealthRow).metric} 无效或须在现有体测页确认`);continue}
  if(extrasUnreadable()){errors.push('已有健康记录损坏，未覆盖');continue}
  const extras=readArray(DEVICE_EXTRA_KEY).rows.filter(validExtra),old=extras.find(x=>(x.athleteId??'local')===currentAthleteId()&&x.observation?.key===observation.key&&x.observation.sourceId===observation.sourceId);
  if(old&&(old.metric!==row.metric||old.day!==row.day||old.observation!.statistic!==observation.statistic||Date.parse(observation.syncedAt)<Date.parse(old.observation!.syncedAt))){errors.push('来源标识冲突或收到旧版本，未覆盖');continue}
  const next={athleteId:currentAthleteId(),metric:row.metric,day:row.day,value:row.value,source:row.source,observation:revisedObservation(observation,old,row.value)};
  try{const s=currentStore(),raw=JSON.stringify(old?extras.map(x=>x===old?next:x):[...extras,next]);if(!s)throw Error();s.setItem(DEVICE_EXTRA_KEY,raw);if(s.getItem(DEVICE_EXTRA_KEY)!==raw)throw Error();if(old?.value===row.value)skipped++;else saved++}catch{errors.push(`${row.metric} 保存失败`)}
 }
 healthChanged();return {saved,skipped,errors}
}
