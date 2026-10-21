import type {Metric, MetricView, View} from './intraday-recovery-u10.ts'

/** Display freshness is an operational UX policy, NOT a physiological cutoff. */
export type Freshness = 'CURRENT' | 'RECENT' | 'STALE' | 'UNAVAILABLE' | 'CONFLICT'
export type MetricFreshness = {
  metric: Metric | 'RHR' | 'HRV';
  state: Freshness;
  measuredAt: string | null;
  sourceId: string | null;
  ageMinutes: number | null;
  value: number | null;
  note: string;
}
const MINUTE=60_000
const DAY=24*60*MINUTE
const windows: Record<Metric|'RHR'|'HRV',readonly [number,number]> = {
  HEART_RATE:[30,120], BODY_BATTERY:[30,120], STRESS:[30,120],
  RHR:[36*60,72*60], HRV:[36*60,72*60]
}
function validDate(s:string){return Number.isFinite(Date.parse(s))}
export function classifyFreshness(i:{metric:Metric|'RHR'|'HRV';asOf:string;measuredAt?:string|null;sourceId?:string|null;value?:number|null;conflict?:boolean}):MetricFreshness{
  if(!validDate(i.asOf))throw new Error('INVALID_AS_OF')
  const base={metric:i.metric,measuredAt:i.measuredAt??null,sourceId:i.sourceId??null,value:i.value??null,ageMinutes:null as number|null}
  if(i.conflict)return {...base,state:'CONFLICT',note:'数据来源冲突，暂不作为当前值'}
  if(!i.measuredAt||!validDate(i.measuredAt)||!i.sourceId||i.value==null||!Number.isFinite(i.value))return {...base,state:'UNAVAILABLE',note:'暂无可确认的时间序列读数'}
  const age=(Date.parse(i.asOf)-Date.parse(i.measuredAt))/MINUTE
  if(age<0)return {...base,ageMinutes:null,state:'UNAVAILABLE',note:'读数时间晚于判断时点，已排除'}
  const [fresh,recent]=windows[i.metric]
  const state:Freshness=age<=fresh?'CURRENT':age<=recent?'RECENT':'STALE'
  const note=state==='CURRENT'?'近期设备读数（非医学实时监护）':state==='RECENT'?'已有一段时间未更新':`最后测量距今${Math.round(age)}分钟，不代表当前状态`
  return {...base,ageMinutes:Math.round(age),state,note}
}
export function freshnessFromIntraday(view:View,asOf:string):MetricFreshness[]{
  const metrics:Metric[]=['HEART_RATE','BODY_BATTERY','STRESS']
  return metrics.map(metric=>{
    const m:MetricView=view.metrics[metric]
    return classifyFreshness({metric,asOf,measuredAt:m.latest?.measuredAt,sourceId:m.sourceId,value:m.latest?.value,conflict:m.status==='SOURCE_CONFLICT'})
  })
}
/** Daily RHR/HRV are NOT transformed into minute-level samples. */
export function dailyMetricFreshness(metric:'RHR'|'HRV',i:{asOf:string;measuredAt?:string|null;sourceId?:string|null;value?:number|null}):MetricFreshness{
  return classifyFreshness({...i,metric})
}
export const FRESHNESS_POLICY={metricDisplayWindowsMinutes:windows,explanation:'界面新鲜度标签仅用于避免把旧数据冒充实时值；不是训练安全阈值。'} as const
