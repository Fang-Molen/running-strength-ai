import { shortHash } from './observation'
import { normalizeFact, projectFacts, factId, factProtocol, dayAt, exactInstant, type UnifiedFact, type FactMetric } from './unified-facts'
import type { DeviceHealthRow, DeviceParseResult } from '../ui/device-parse'
const healthMetrics=new Set(['RHR','HRV','SLEEP','WEIGHT','BODY_BATTERY','STEPS','ACTIVE_KCAL','RESTING_KCAL','TOTAL_KCAL','WORKOUT_KCAL'])
/** Explicit reviewed exchange schema, NOT a claim to implement a vendor cloud API. */
export function parseUnifiedExport(text:string,athleteId:string):DeviceParseResult|null{
  let v:any;try{v=JSON.parse(text)}catch{return null}
  if(v?.schema!=='fangkun-device-facts-v1')return null
  const notes=['本机交换格式：请核对本人、设备和协议后保存；不代表已连接品牌云端。']
  if(!Array.isArray(v.facts)||v.facts.length>20000)return {kind:'设备证据',brand:'未知',health:[],activities:[],notes:['记录格式无效或超过20000条']}
  const facts:UnifiedFact[]=[]
  for(const raw of v.facts){const f=normalizeFact(raw);if(!f||f.athleteId!==athleteId){notes.push('已拒绝无效或非当前运动员记录');continue}facts.push(f)}
  return {kind:'设备证据',brand:[...new Set(facts.map(f=>f.provider))].join('/'),health:factHealthRows(facts),activities:[],facts,notes:[...new Set(notes)]}
}
export function factHealthRows(raw:UnifiedFact[]):DeviceHealthRow[]{
 const latest=projectFacts(raw,raw[0]?.athleteId??'',new Date().toISOString()),out:DeviceHealthRow[]=[]
 for(const f of latest.facts){if(!healthMetrics.has(f.metric))continue
  const identity=shortHash(factId(f)),sourceId=`${f.provider.toLowerCase()}:${shortHash(f.accountRef+':'+f.deviceId)}`
  out.push({key:`fact:${identity}`,source:`${f.provider} · 核对导入`,metric:f.metric as DeviceHealthRow['metric'],day:f.day,value:f.value!,hrvMethod:f.metric==='HRV'?/SDNN/.test(f.protocol)?'SDNN':/RMSSD/.test(f.protocol)?'RMSSD':'UNSPECIFIED':undefined,
    observation:{key:`fact:${identity}`,sourceId,statistic:f.protocol.slice(0,80),syncedAt:f.receivedAt,measuredAt:f.end??f.start,rawValue:f.rawValue??undefined,rawUnit:f.rawUnit,facts:raw.filter(x=>factId(x)===factId(f))}})
 }
 return out
}
const attrs=(s:string)=>Object.fromEntries([...s.matchAll(/([\w]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replace(/&amp;/g,'&').replace(/&quot;/g,'"')]))
const iso=(s:string)=>s?.replace(/^(\d{4}-\d\d-\d\d) /,'$1T').replace(/ ([+-]\d\d)(\d\d)$/,'$1:$2')
const offset=(s:string)=>{const m=s.match(/([+-])(\d\d):?(\d\d)$/);return m?(m[1]==='-'?-1:1)*(+m[2]*60 + +m[3]):s.endsWith('Z')?0:null}
/** Apple records remain per device/protocol. Sleep stages are interval-unioned;
 * activity energy is not total expenditure, and sample sums are not full-day coverage. */
export function appleHealthFacts(xml:string,sinceDay:string,athleteId:string,receivedAt=new Date().toISOString()){
 const facts:UnifiedFact[]=[],notes:string[]=[],sleep=new Map<string,UnifiedFact[]>(),sums=new Map<string,UnifiedFact[]>()
 const mapping:Record<string,[FactMetric,string]>={HKQuantityTypeIdentifierRestingHeartRate:['RHR','bpm'],HKQuantityTypeIdentifierHeartRateVariabilitySDNN:['HRV','ms'],HKQuantityTypeIdentifierBodyMass:['WEIGHT','kg'],HKQuantityTypeIdentifierStepCount:['STEPS','steps'],HKQuantityTypeIdentifierActiveEnergyBurned:['ACTIVE_KCAL','kcal'],HKQuantityTypeIdentifierBasalEnergyBurned:['RESTING_KCAL','kcal']}
 for(const m of xml.matchAll(/<Record\s([^>]*?)\/?>/g)){
  const a=attrs(m[1]),start=iso(a.startDate),end=iso(a.endDate??a.startDate),off=offset(end??'')
  if(!exactInstant(start)||!exactInstant(end)||off===null){notes.push('未含有效时区的 Apple 记录未采用');continue}
  const asleep=a.type==='HKCategoryTypeIdentifierSleepAnalysis'&&/Asleep/i.test(a.value??'')
  if(!asleep&&!mapping[a.type])continue
  const day=dayAt(end,off)!;if(day<sinceDay)continue
  const metric=asleep?'SLEEP':mapping[a.type][0],deviceId=shortHash(JSON.stringify([a.sourceName??'UNKNOWN',a.sourceVersion??'UNKNOWN',a.device??'UNKNOWN']))
  const value=asleep?(Date.parse(end)-Date.parse(start))/36e5:a.value?.trim()?Number(a.value):NaN
  const unit=asleep?'h':a.unit==='count/min'?'bpm':a.unit==='count'?'steps':a.unit
  const protocol=asleep?'APPLE_ASLEEP_INTERVAL_UNION':metric==='HRV'?'APPLE_SDNN_SAMPLE':`APPLE_${metric}_SAMPLE`
  const recordId=a.uuid??shortHash(JSON.stringify([a.type,a.sourceName,a.sourceVersion,a.device,start,end,a.value,a.unit]))
  const f=normalizeFact({athleteId,provider:'APPLE',accountRef:'LOCAL_REVIEWED_EXPORT',deviceId,recordId,metric,value,unit,protocol,start,end,receivedAt,day,utcOffsetMinutes:off,quality:'VALID',revision:0})
  if(!f){notes.push('已排除无效 Apple 数值或单位');continue}
  const group=JSON.stringify([deviceId,asleep?'sleep-sessions':day,metric]),target=asleep?sleep:['STEPS','ACTIVE_KCAL','RESTING_KCAL'].includes(metric)?sums:null
  if(target)target.set(group,[...target.get(group)??[],f]);else facts.push(f)
 }
 const sleepClusters:[string,UnifiedFact[]][]=[]
 for(const [key,rows] of sleep){
  const ordered=[...rows].sort((a,b)=>Date.parse(a.start!)-Date.parse(b.start!));let cluster:UnifiedFact[]=[],latest=-Infinity
  const close=()=>{if(cluster.length)sleepClusters.push([key+':'+cluster[0].start,cluster]);cluster=[];latest=-Infinity}
  for(const f of ordered){if(Date.parse(f.start!)>latest)close();cluster.push(f);latest=Math.max(latest,Date.parse(f.end!))}close()
 }
 const aggregated:UnifiedFact[]=[],components=new Map<string,UnifiedFact[]>()
 for(const [key,raw] of [...sleepClusters,...sums]){
  const unique=[...new Map(raw.map(f=>[factId(f),f])).values()].sort((a,b)=>Date.parse(a.start!)-Date.parse(b.start!)),isSleep=unique[0].metric==='SLEEP'
  let end=-Infinity,total=0,overlap=false
  for(const f of unique){const a=Date.parse(f.start!),b=Date.parse(f.end!);if(a<end&&!isSleep)overlap=true;total+=isSleep?Math.max(0,b-Math.max(a,end))/36e5:f.value!;end=Math.max(end,b)}
  if(overlap){facts.push(...unique);notes.push('步数/能量样本时段重叠，保留原始证据，未相加');continue}
  const last=unique.reduce((a,b)=>Date.parse(a.end!)>=Date.parse(b.end!)?a:b)
  const recordId='daily:'+shortHash(key);components.set(recordId,unique)
  aggregated.push({...unique[0],recordId,day:isSleep?dayAt(last.end!,last.utcOffsetMinutes!)!:unique[0].day,protocol:isSleep?'APPLE_ASLEEP_INTERVAL_UNION':'APPLE_RECORDED_SAMPLE_SUM',value:total,start:unique[0].start,end:last.end,rawValue:total,rawUnit:unique[0].unit})
  facts.push(...unique,aggregated.at(-1)!)
 }
 const rows=factHealthRows([...facts.filter(f=>!['STEPS','ACTIVE_KCAL','RESTING_KCAL','SLEEP'].includes(f.metric)),...aggregated])
 for(const row of rows){const agg=row.observation!.facts![0];if(aggregated.includes(agg)||agg.recordId.startsWith('daily:'))row.observation!.facts=[...(components.get(agg.recordId)??[]),agg]}
 return {health:rows,facts,notes:[...new Set(notes),'Apple 步数/能量仅为已导入样本合计，未证明全天完整；HRV 按 SDNN 保留，不混同 RMSSD。']}
}
