import { withUnifiedFacts } from './unified-snapshot'
import { loadCorosHealthPoints } from './coros-health-points'
import { currentAthleteId } from '../core/events'
import { loadCheckins, checkinsUnreadable, type Checkin } from './legacy-inputs'
import { loadVitals, type VitalRecord } from '../nutrition/vitals'
import { loadExtras, extrasUnreadable, type ExtraRow } from './device-store'
import { currentStore } from '../core/storage'
import { healthChanged, localDay, shiftDay, shortHash, validDay, valueText } from './observation'

export const HEALTH_SOURCES_KEY='fk-health-sources-v1'
function healthSourcesKey(){return currentAthleteId()==='local'?HEALTH_SOURCES_KEY:HEALTH_SOURCES_KEY+':'+encodeURIComponent(currentAthleteId())}
export const HEALTH_LABELS:Record<string,string>={SLEEP:'睡眠',RHR:'静息心率',HRV:'HRV',NIGHT_HR:'夜间平均心率',RECOVERY:'主观恢复',BODY_BATTERY:'身体电量',READINESS:'训练准备度',STRESS:'压力',STEPS:'步数',SPO2:'血氧',RESP:'呼吸',ACTIVE_KCAL:'活动热量',RESTING_KCAL:'静息热量',TOTAL_KCAL:'全天总热量',WORKOUT_KCAL:'单次运动热量'}
export type HealthPoint={id:string;metric:string;day:string;value:number;source:string;stream:string;statistic:string;method:string;updatedAt:string;measuredAt:string|null;legacy:boolean;sourceId?:string;deviceLabel?:string;measurementMethod?:string}
export type HealthMetricView={metric:string;label:string;state:'AVAILABLE'|'CONFLICT'|'STALE'|'MISSING';current:HealthPoint|null;candidates:HealthPoint[];series:HealthPoint[];availableSources:{id:string;label:string}[];selectedSource:string|null;baseline:{mean:number;count:number;delta:number;start:string;end:string}|null;notes:string[]}
export type HealthSnapshot={asOf:string;metrics:HealthMetricView[];unreadable:boolean}
export function loadHealthSources():Record<string,string>{try{const p=JSON.parse(currentStore()?.getItem(healthSourcesKey())??'{}');return p && typeof p==='object' && !Array.isArray(p)?Object.fromEntries(Object.entries(p).filter(([k,v])=>k in HEALTH_LABELS&&typeof v==='string')) as Record<string,string>:{} }catch{return {}}}
export function saveHealthSource(metric:string,source:string|null):boolean{if(!(metric in HEALTH_LABELS))return false;try{const p=loadHealthSources();if(source)p[metric]=source;else delete p[metric];const s=currentStore();if(!s)return false;const raw=JSON.stringify(p);s.setItem(healthSourcesKey(),raw);if(s.getItem(healthSourcesKey())!==raw)return false;healthChanged();return true}catch{return false}}
function legacyStat(metric:string,source:string):string {return /佳明账号同步/.test(source)?({SLEEP:'夜间睡眠总时长',HRV:'昨夜平均；算法未提供',BODY_BATTERY:'当日最高（非当前值）',RHR:'日静息心率',STRESS:'当日平均'}[metric]??'统计口径未提供'):'统计口径未提供'}
export function healthPoints(vitals:VitalRecord[],extras:ExtraRow[]):HealthPoint[]{
  const out:HealthPoint[]=[]
  for(const v of vitals){if((v.athleteId??'local')!==currentAthleteId())continue;const source=v.note||({MANUAL:'手工记录',IMAGE_CONFIRMED:'截图核对',DEVICE_CONFIRMED:'设备导入'}[v.source]);const method=v.hrvMethod??'';const statistic=v.observation?.statistic??legacyStat(v.kind,source);out.push({id:v.id,metric:v.kind,day:v.observedOn,value:v.value,source,sourceId:v.observation?.sourceId,method,statistic,stream:`${v.observation?.sourceId??`legacy:${shortHash(v.source+':'+source+':'+(v.deviceLabel??'')+':'+(v.measurementMethod??''))}`}|${statistic}|${method}`,updatedAt:v.observation?.syncedAt??v.createdAt,measuredAt:v.observation?.measuredAt??v.observedAt,legacy:!v.observation,deviceLabel:v.deviceLabel,measurementMethod:v.measurementMethod})}
  for(const [i,e] of extras.entries()){if(!e || typeof e.source!=='string' || typeof e.metric!=='string')continue;const statistic=e.observation?.statistic??legacyStat(e.metric,e.source);out.push({id:e.observation?.key??`extra:${i}`,metric:e.metric,day:e.day,value:e.value,source:e.source,sourceId:e.observation?.sourceId,method:'',statistic,stream:`${e.observation?.sourceId??`legacy:${shortHash(e.source)}`}|${statistic}|`,updatedAt:e.observation?.syncedAt??'',measuredAt:e.observation?.measuredAt??null,legacy:!e.observation})}
  return out.filter(p=>Number.isFinite(p.value)&&validDay(p.day)&&p.metric in HEALTH_LABELS)
}
/** 佳明账号同步写入的带观测元数据的读数（sourceId = garmin:<账号哈希>）。 */
export const isGarminSync=(p:HealthPoint)=>!p.legacy&&p.stream.startsWith('garmin:')
/** UI and coach share this read-only projection. No source averaging or date backfill. */
export function buildHealthSnapshot(vitals:VitalRecord[],extras:ExtraRow[],asOf:string,preferred:Record<string,string>={},checkins:Checkin[]=[],extraPoints:HealthPoint[]=[]):HealthSnapshot{
  if(!validDay(asOf))asOf=localDay()
  const selfSleep:HealthPoint[]=checkins.filter(c=>validDay(c.date)&&Number.isFinite(c.sleep)&&c.sleep!>=0.1&&c.sleep!<=24).map(c=>({id:`checkin-sleep:${c.date}`,metric:'SLEEP',day:c.date,value:c.sleep!,source:'主观打卡',stream:'self:sleep-range',statistic:'自报睡眠区间代表值（非精确测量）',method:'',updatedAt:c.at,measuredAt:null,legacy:false}))
  const points=[...healthPoints(vitals,extras),...selfSleep,...extraPoints].filter(p=>p.day<=asOf)
  const metrics=Object.entries(HEALTH_LABELS).map(([metric,label]):HealthMetricView=>{
    const all=points.filter(p=>p.metric===metric).sort((a,b)=>a.day.localeCompare(b.day)||((Date.parse(a.updatedAt)||0)-(Date.parse(b.updatedAt)||0))||a.id.localeCompare(b.id))
    const availableSources=[...new Map(all.map(p=>[p.stream,{id:p.stream,label:`${p.source} · ${p.statistic}${p.method?` · ${p.method}`:''}${p.legacy?' · 旧/手填来源':''}`}])).values()]
    const selectedSource=preferred[metric]??null
    const eligible=selectedSource?all.filter(p=>p.stream===selectedSource):all
    const lastDay=eligible.at(-1)?.day
    // Only explicit observation-key updates are revisions. Independent conflicting readings stay unresolved.
    const groups=new Map<string,HealthPoint[]>();for(const p of eligible){const key=`${p.stream}:${p.day}`;groups.set(key,[...groups.get(key)??[],p])}
    const daily=[...groups.values()].flatMap(rows=>new Set(rows.map(p=>p.value)).size===1?[rows.at(-1)!]:rows)
    const candidates=daily.filter(p=>p.day===lastDay)
    // 用户未指定来源时：同日有佳明账号同步（非旧格式）读数，默认以最新一次佳明同步为准，其余来源保留在 candidates 里可切换。
    const garmin=selectedSource?[]:candidates.filter(isGarminSync).sort((a,b)=>(Date.parse(a.updatedAt)||0)-(Date.parse(b.updatedAt)||0))
    const preferredGarmin:HealthPoint|null=null // Independent sources require an explicit user choice; brand priority cannot resolve conflict.
    const conflict=candidates.length>1&&!preferredGarmin
    const current=preferredGarmin??(conflict?null:candidates[0]??null)
    const series=current?[...groups.values()].filter(rows=>rows[0].stream===current.stream&&new Set(rows.map(p=>p.value)).size===1).map(rows=>rows.at(-1)!).sort((a,b)=>a.day.localeCompare(b.day)):[]
    const reference=current?.day??asOf, start=shiftDay(reference,-7)
    const prior=series.filter(p=>p.day>=start&&p.day<reference)
    // Three recorded days is a coverage rule for a descriptive baseline, not a diagnostic threshold.
    const comparable=metric!=='HRV'||current?.method==='RMSSD'||current?.method==='SDNN'
    const baseline=current&&prior.length>=3&&comparable?{mean:prior.reduce((s,p)=>s+p.value,0)/prior.length,count:prior.length,delta:current.value-prior.reduce((s,p)=>s+p.value,0)/prior.length,start,end:shiftDay(reference,-1)}:null
    const notes:string[]=[]
    if(preferredGarmin)notes.push(`同日另有 ${candidates.length-1} 个读数（其他来源或旧口径），默认以最新佳明同步为准；可在来源中切换。`)
    if(conflict)notes.push('同一天存在多个来源、统计口径或独立观测冲突，未取平均；请选择来源并核对原始记录。')
    if(selectedSource&&!eligible.length)notes.push('所选来源暂无该日期前的数据，未自动切换其他来源。')
    if(current?.day!==asOf&&current)notes.push(`历史值 ${current.day}，不能当作今天状态。`)
    if(current?.legacy)notes.push('旧/手填记录未含完整设备元数据；原值保留。')
    if(metric==='BODY_BATTERY'&&current?.statistic.includes('最高'))notes.push('日最高值不代表当前电量，不参与当前疲劳判定。')
    return {metric,label,state:conflict?'CONFLICT':!current?'MISSING':current.day===asOf?'AVAILABLE':'STALE',current,candidates,series,availableSources,selectedSource,baseline,notes}
  })
  return {asOf,metrics,unreadable:false}
}
export function loadHealthSnapshot(asOf=localDay()):HealthSnapshot{
  const v=loadVitals(),coros=loadCorosHealthPoints(),snap=buildHealthSnapshot(v.records,loadExtras(),asOf,loadHealthSources(),loadCheckins(currentStore()),coros.points);snap.unreadable=v.unreadable||extrasUnreadable()||checkinsUnreadable()||coros.unreadable
  return withUnifiedFacts(snap)
}
export function healthSummaryLine(view:HealthMetricView):string{
  if(view.state==='MISSING')return `${view.label}：无可用记录`
  if(view.state==='CONFLICT')return `${view.label}：来源待核对（${view.candidates.map(p=>`${p.source} ${valueText(p.metric,p.value)} · ${p.statistic}`).join('；')}）`
  const p=view.current!;return `${view.label}：${valueText(p.metric,p.value)} · ${p.day} · ${p.source} · ${p.statistic}${view.state==='STALE'?'；历史值':''}${view.baseline?`；较前7天同来源${view.baseline.count}个记录日均值 ${view.baseline.delta>=0?'+':''}${view.baseline.delta.toFixed(2)}`:''}`
}
