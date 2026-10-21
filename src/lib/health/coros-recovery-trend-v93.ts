/** v89.9.4 休眠（DORMANT）：仅经服务端核实的高驰日级批次才有数据；目前没有这样的来源，界面不引用。 */
/** COROS day-level descriptive recovery evidence. Not Garmin Body Battery, not a medical fatigue score. */
import type { DailyFact } from './coros-evidence-v92'
export type TrendPoint={day:string;hrvMs:number|null;restingHrBpm:number|null;sleepMinutes:number|null;steps:number|null;warnings:string[]}
const dayOf=(t:string,offset:number)=>{const ms=Date.parse(t);return Number.isFinite(ms)?new Date(ms+offset*60000).toISOString().slice(0,10):null}
export function corosDailyRecoveryTrend(facts:DailyFact[],offsetMinutes:number):TrendPoint[]{
 if(!Number.isInteger(offsetMinutes)||Math.abs(offsetMinutes)>840)throw Error('INVALID_OFFSET')
 const days=new Map<string,DailyFact[]>()
 for(const f of facts){if(!['HRV','RESTING_HR','SLEEP_MINUTES','STEPS'].includes(f.metric)||!Number.isFinite(f.value)||!f.recordId||!f.sourceId)continue
  const day=dayOf(f.measuredAt,offsetMinutes);if(!day)continue;days.set(day,[...(days.get(day)??[]),f])}
 return [...days].sort(([a],[b])=>a.localeCompare(b)).map(([day,items])=>{
  const warnings:string[]=[]
  const get=(metric:DailyFact['metric'],unit:string)=>{
   const matches=items.filter(f=>f.metric===metric)
   if(!matches.length)return null
   const ids=new Map<string,DailyFact>();let conflict=false
   for(const f of matches){if(f.unit!==unit||f.statistic!=='DAILY_TOTAL'&&metric==='STEPS'||f.statistic!=='DAILY_TOTAL'&&metric==='SLEEP_MINUTES'){warnings.push(metric+' 单位或统计口径不匹配');continue}
    const prev=ids.get(f.recordId);if(prev&&prev.value!==f.value){conflict=true;continue}ids.set(f.recordId,f)}
   const distinct=[...ids.values()];if(conflict||distinct.length>1){warnings.push(metric+' 同日来源冲突，未合并');return null}
   return distinct[0]?.value??null
  }
  return {day,hrvMs:get('HRV','ms'),restingHrBpm:get('RESTING_HR','bpm'),sleepMinutes:get('SLEEP_MINUTES','min'),steps:get('STEPS','steps'),warnings}
 })
}
export function corosRecoveryInterpretation(points:TrendPoint[]){
 const last=points.at(-1)??null
 const prior=points.slice(0,-1).filter(p=>p.hrvMs!==null&&p.restingHrBpm!==null)
 return {latest:last,comparableReferenceDays:prior.length,hasComparableBaseline:prior.length>=7,
  fatigueStatus:'UNDETERMINED' as const,trainingClearance:false as const,
  note:'仅展示高驰每日睡眠、HRV、静息心率、步数与个人历史。不能据此生成Garmin身体电量曲线、肌肉疲劳百分比或自动训练许可。'}
}
