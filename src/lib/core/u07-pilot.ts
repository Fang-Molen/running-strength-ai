/**
 * FANGKUN U07 — read-only pilot projection for existing V87 HealthSnapshot.
 * Does not read private storage, write a plan, call an LLM, or issue notifications.
 * Production host must verify identity, source authorization, and freshness.
 */
import type { HealthSnapshot, HealthMetricView } from '../health/snapshot'
import type { FatigueReview } from '../health/analysis'
import type { PlanHostContext } from './coach-plan-execution'
import type { RecoveryInput, Verdict } from '../ui/recovery-verdict'

export type PilotMetricState = 'AVAILABLE'|'STALE'|'MISSING'|'CONFLICT'|'SOURCE_ERROR'|'UNVERIFIED_TIME'
export type PilotMetric = { metric:string; state:PilotMetricState; value:number|null; measuredAt:string|null; source:string|null; statistic:string|null; notes:string[]; currentValue:boolean }
export type PilotPoint = {sourceId:string; eventId:string; athleteId:string; metric:'HEART_RATE'|'BODY_BATTERY'; value:number; measuredAt:string; knownAt:string; kind:'INTRADAY_SAMPLE'|'DAILY_SUMMARY'; revision:string}
export type PilotCurve = {status:'AVAILABLE'|'UNAVAILABLE'|'CONFLICT'; reason:string; sourceId:string|null; points:{at:string;value:number}[]}

const validInstant = (s:unknown):s is string => typeof s==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s)) && Number(s.slice(11,13))<24 && Number(s.slice(14,16))<60 && Number(s.slice(17,19))<60 && (()=>{const date=s.slice(0,10);const d=new Date(date+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===date})()
const safeNumber=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)
const viewOf=(s:HealthSnapshot,metric:string)=>s.metrics.find(x=>x.metric===metric)

/** Daily summary is NOT an intraday curve; daily max Body Battery is NOT current. */
export function projectPilotHealth(snapshot:HealthSnapshot, fatigue:FatigueReview, asOf:string) {
  if(!validInstant(asOf)||!snapshot||!Array.isArray(snapshot.metrics)||!fatigue)
    return {status:'INVALID_INPUT' as const,metrics:[] as PilotMetric[],review:'NOT_AVAILABLE',trainingClearance:false,planWrite:false}
  const wanted=['SLEEP','HRV','RHR','NIGHT_HR','BODY_BATTERY','STRESS','RECOVERY','READINESS']
  const metrics:PilotMetric[]=wanted.map(metric=>{
    const view:HealthMetricView|undefined=viewOf(snapshot,metric)
    if(snapshot.unreadable)return {metric,state:'SOURCE_ERROR',value:null,measuredAt:null,source:null,statistic:null,notes:['读取失败，不等于无记录'],currentValue:false} as PilotMetric
    if(!view||view.state==='MISSING')return {metric,state:'MISSING',value:null,measuredAt:null,source:null,statistic:null,notes:[],currentValue:false} as PilotMetric
    if(view.state==='CONFLICT')return {metric,state:'CONFLICT',value:null,measuredAt:null,source:null,statistic:null,notes:['来源冲突，不能自动取平均'],currentValue:false} as PilotMetric
    const p=view.current
    if(!p||!safeNumber(p.value))return {metric,state:'MISSING',value:null,measuredAt:null,source:null,statistic:null,notes:[],currentValue:false} as PilotMetric
    const time=validInstant(p.measuredAt)?Date.parse(p.measuredAt):null
    const future=time!==null&&time>Date.parse(asOf)
    const statistic=p.statistic||'口径未标注'
    const currentValue=metric==='BODY_BATTERY' && view.state==='AVAILABLE' && time!==null && !future && Date.parse(asOf)-time<=15*60_000 && !/最高|最大|峰值|日均|平均/.test(statistic)
    const state:PilotMetricState=future?'UNVERIFIED_TIME':view.state==='STALE'?'STALE':'AVAILABLE'
    return {metric,state,value:future?null:p.value,measuredAt:future?null:p.measuredAt,source:p.source||null,statistic,notes:[...view.notes,...(metric==='BODY_BATTERY'&&!currentValue?['此读数不能标为当前身体电量']:[])],currentValue}
  })
  return {status:'READ_ONLY' as const,metrics,review:fatigue.state,trainingClearance:false,planWrite:false}
}

/** Requires actual timestamped samples. Do not interpolate or invent missing values. */
export function buildIntradayCurve({athleteId,metric,asOf,points}: {athleteId:string;metric:PilotPoint['metric'];asOf:string;points:PilotPoint[]}):PilotCurve {
  const unavailable=(reason:string):PilotCurve=>({status:'UNAVAILABLE',reason,sourceId:null,points:[]})
  if(!athleteId||!validInstant(asOf)||!Array.isArray(points))return unavailable('INVALID_INPUT')
  const eligible=points.filter(p=>p&&p.athleteId===athleteId&&p.metric===metric&&p.kind==='INTRADAY_SAMPLE'&&validInstant(p.measuredAt)&&validInstant(p.knownAt)&&Date.parse(p.measuredAt)<=Date.parse(p.knownAt)&&Date.parse(p.knownAt)<=Date.parse(asOf)&&Date.parse(p.measuredAt)>=Date.parse(asOf)-24*60*60_000&&safeNumber(p.value)&&!!p.sourceId&&!!p.eventId&&!!p.revision&&(metric!=='BODY_BATTERY'||p.value>=0&&p.value<=100)&&(metric!=='HEART_RATE'||p.value>0&&p.value<300))
  if(eligible.length<2)return unavailable('NO_TIMESTAMPED_SERIES')
  const sources=[...new Set(eligible.map(p=>p.sourceId))]
  if(sources.length!==1)return {status:'CONFLICT',reason:'MULTIPLE_SOURCES_REQUIRE_SELECTION',sourceId:null,points:[]}
  const dedup=new Map<string,PilotPoint>()
  for(const p of eligible){const key=p.sourceId+':'+p.eventId;const old=dedup.get(key)
    if(old && old.revision===p.revision && (old.value!==p.value||old.measuredAt!==p.measuredAt))return {status:'CONFLICT',reason:'SAME_REVISION_CONFLICT',sourceId:null,points:[]}
    if(!old||Date.parse(old.knownAt)<Date.parse(p.knownAt))dedup.set(key,p)
  }
  const samples=[...dedup.values()].sort((a,b)=>Date.parse(a.measuredAt)-Date.parse(b.measuredAt))
  if(new Set(samples.map(p=>p.measuredAt)).size<2)return unavailable('INSUFFICIENT_DISTINCT_TIMES')
  return {status:'AVAILABLE',reason:'ACTUAL_TIMESTAMPED_SAMPLES',sourceId:sources[0],points:samples.map(p=>({at:p.measuredAt,value:p.value}))}
}

/** Read-only display decision; NEVER promote device signals to medical or training clearance. */
export function projectPilotRecoveryMessage(fatigue:FatigueReview,hasRecentSymptoms:boolean) {
  if(!fatigue)return {status:'UNAVAILABLE',title:'恢复信息待核对',trainingClearance:false,planWrite:false}
  const safety=hasRecentSymptoms||fatigue.state==='PAIN_REVIEW'
  const title=safety?'有不适需要核对':fatigue.state==='INSUFFICIENT'?'恢复信息不足':fatigue.state==='MULTI_SIGNAL'?'多项变化值得复核':fatigue.state==='WATCH'?'有变化需要观察':'暂无新的明确不利线索'
  return {status:safety?'SAFETY_REVIEW':'OBSERVATION_ONLY',title,trainingClearance:false,planWrite:false}
}

/** V87 local-device host is intentionally unable to authorize production plan changes. */
export function inspectPlanMutationGate(host:PlanHostContext|null,proposalConfirmed:boolean) {
  const reasons:string[]=[]
  if(!host||host.readState!=='AVAILABLE')reasons.push('HOST_NOT_READABLE')
  if(host?.actor?.scope==='LOCAL_DEVICE_ONLY')reasons.push('LOCAL_DEVICE_SCOPE_ONLY')
  if(!host?.actor)reasons.push('ACTOR_MISSING')
  if(host?.calendarCoverage!=='COMPLETE')reasons.push('CALENDAR_INCOMPLETE')
  if(host?.persistenceBoundary!=='COORDINATED_LOCAL')reasons.push('WRITE_BOUNDARY_UNCOORDINATED')
  if(host?.safety!=='ALLOW_DATE_MOVE')reasons.push('SAFETY_NOT_CLEARED')
  if(!proposalConfirmed)reasons.push('USER_CONFIRMATION_MISSING')
  // The pilot never authorizes writes even when the host claims all conditions are met.
  return {pilotAllowsWrite:false,reasons,requiresExistingProductionExecutor:true}
}

export type PilotTask = {athleteId:string;eventKey:string;revision:string;kind:'SAFETY_REVIEW'|'PLAN_CONFLICT'|'RECOVERY_CHANGE'|'POST_TRAINING_FEEDBACK'|'SYNC_FAILURE'|'INFO_UPDATE';material:boolean}
/** Cross-page single inbox. A declined noncritical suggestion cannot suppress safety review. */
export function pilotInbox({athleteId,tasks,declined=[],seen=[],quiet=false}: {athleteId:string;tasks:PilotTask[];declined?:string[];seen?:string[];quiet?:boolean}) {
  if(!athleteId||!Array.isArray(tasks))return {primary:null,queued:[] as string[],ignored:['INVALID_INPUT']}
  const priority:Record<PilotTask['kind'],number>={SAFETY_REVIEW:0,PLAN_CONFLICT:1,RECOVERY_CHANGE:2,POST_TRAINING_FEEDBACK:3,SYNC_FAILURE:4,INFO_UPDATE:5}
  const grouped=new Map<string,PilotTask>(),ignored:string[]=[]
  for(const t of tasks){if(!t||t.athleteId!==athleteId||!t.eventKey||!t.revision){ignored.push('WRONG_SCOPE');continue}
    const key=JSON.stringify([athleteId,t.eventKey,t.revision]),prior=grouped.get(key)
    if(!prior||priority[t.kind]<priority[prior.kind])grouped.set(key,t)
  }
  const candidates=[...grouped.entries()].sort((a,b)=>priority[a[1].kind]-priority[b[1].kind]||a[0].localeCompare(b[0]))
  const queued:string[]=[]
  for(const [key,t] of candidates){
    if(t.kind==='SAFETY_REVIEW')return {primary:{key,kind:t.kind,channel:'IN_APP_ONLY' as const},queued,ignored}
    if(declined.includes(key)||seen.includes(key)||!t.material){ignored.push('NO_NEW_ACTION');continue}
    if(quiet){queued.push(key);continue}
    return {primary:{key,kind:t.kind,channel:'IN_APP_ONLY' as const},queued,ignored}
  }
  return {primary:null,queued,ignored}
}

/** Compatibility projection for V87 legacy recoveryVerdict users (r8/assessment).
 * Does not overwrite the legacy result; UI may render this neutral safety wrapper. */
export function guardLegacyRecoveryVerdict(input:RecoveryInput, verdict:Verdict) {
  const pain=input.pain==='sharp'||input.pain==='mild'
  const personal= input.subjective!==null && Number.isFinite(input.subjective)
  const otherComparable= (input.sleepH!==null && input.sleepBase!==null) || (input.hrv!==null && input.hrvBase!==null) || (input.rhr!==null && input.rhrBase!==null)
  if(pain)return {status:'SAFETY_REVIEW',title:'请先核对疼痛与功能',trainingClearance:false,planWrite:false,legacyLevel:verdict.level}
  if(!personal&&!otherComparable)return {status:'INSUFFICIENT',title:'设备指标不能单独判断训练是否适宜',trainingClearance:false,planWrite:false,legacyLevel:verdict.level}
  return {status:'OBSERVATION_ONLY',title:verdict.level==='reduce'?'有恢复变化需要复核':verdict.level==='watch'?'有变化需要观察':'结合训练与当前感受核对',trainingClearance:false,planWrite:false,legacyLevel:verdict.level}
}
