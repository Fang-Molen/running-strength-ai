import type { DeviceHealthRow, HealthMetric } from './device-store'
import { shortHash, validDay } from './observation'
type ResponsePart = {status:number; body:any}
export type DeviceDayResult = {rows:DeviceHealthRow[]; failures:string[]}
/** Map only observed field names. A daily maximum is not current Body Battery. */
export function garminHealthDay(day:string,account:string,s:ResponsePart,h:ResponsePart,sl:ResponsePart,syncedAt:string):DeviceDayResult {
  const rows:DeviceHealthRow[]=[], failures:string[]=[]
  if(!validDay(day)||typeof account!=='string'||!account.trim()||!Number.isFinite(Date.parse(syncedAt)))return {rows:[],failures:['同步日期、来源或接收时间无效']}
  const sourceId=`garmin:${shortHash(account)}`
  const add=(metric:HealthMetric,value:unknown,statistic:string,min:number,max:number,rawValue?:number,rawUnit?:string)=>{
    if(typeof value!=='number' || !Number.isFinite(value) || value<min || value>max)return
    rows.push({key:`${metric}:${day}`,source:'佳明账号同步',metric,day,value,observation:{key:`${sourceId}:${metric}:${statistic}:${day}`,sourceId,statistic,syncedAt,rawValue:rawValue??value,rawUnit}})
  }
  const usable=(part:ResponsePart,label:string)=>{ const b=part.body; if(part.status!==200 || !b || typeof b!=='object' || Array.isArray(b) || b.ok===false || b.error){failures.push(`${day} ${label} HTTP ${part.status}`);return false} const claimed=b.calendarDate??b.hrvSummary?.calendarDate??b.dailySleepDTO?.calendarDate; if(!claimed || claimed!==day){failures.push(`${day} ${label} 返回日期缺失或不一致`);return false}return true }
  if(usable(s,'每日汇总')) {
    add('RHR',s.body.restingHeartRate,'日静息心率',30,120)
    add('BODY_BATTERY',s.body.bodyBatteryHighestValue,'当日最高（非当前值）',0,100)
    add('STRESS',s.body.averageStressLevel,'当日平均',0,100)
    add('STEPS',s.body.totalSteps,'当日累计',0,100000)
    add('SPO2',s.body.averageSpo2,'当日平均',70,100)
    add('RESP',s.body.avgWakingRespirationValue,'清醒平均',4,40)
  }
  if(usable(h,'HRV')) add('HRV',h.body.hrvSummary?.lastNightAvg,'昨夜平均；算法未提供',1,300)
  if(usable(sl,'睡眠')) { const sec=sl.body.dailySleepDTO?.sleepTimeSeconds; if(typeof sec==='number')add('SLEEP',sec/3600,'夜间睡眠总时长',0.1,24,sec,'s') }
  return {rows,failures}
}
export function syncOutcome(failures:string[],result:{saved:number;skipped:number;errors:string[]},days:number) {
  const errors=[...failures,...result.errors]
  if(!days)errors.push('没有取得健康账号资料，健康数据未同步')
  return {status:errors.length?'partial' as const:'ok' as const,message:errors.length?`部分同步：保存/更新 ${result.saved} 条，未变化 ${result.skipped} 条；${errors.length} 项未完成。${errors.slice(0,2).join('；')}`:`同步完成：保存/更新 ${result.saved} 条，未变化 ${result.skipped} 条。健康范围 ${days} 天；缺失指标仍为空。`,errors}
}
