import {currentAthleteId} from '../core/events'
import {currentStore} from '../core/storage'
import {strictIso} from '../core/coach-v4-c11-adapter'
import {readRecoveryContext} from '../core/coach-recovery-context'
import {readRecoveryProjection} from '../health/recovery-host-u11'
import {loadHealthSnapshot,type HealthMetricView,type HealthPoint} from '../health/snapshot'
import {loadIntraday} from '../health/intraday-store'
import {localDay,validDay} from '../health/observation'
import {REGION_LABEL,type RegionState} from '../health/muscle-recovery-u11'

type Facts={summary:string[];details:string[]}
const round=(n:number)=>Number(n.toFixed(2))
const clip=(s:string,n:number)=>s.length<=n?s:s.slice(0,n-8)+'（明细省略）'
const time=(v:unknown):v is string=>typeof v==='string'&&strictIso(v)
const labels:Record<string,string>={SLEEP:'睡眠',RHR:'静息心率',HRV:'HRV',BODY_BATTERY:'身体电量',READINESS:'训练准备度',STRESS:'压力',RECOVERY:'主观恢复',STEPS:'步数',ACTIVE_KCAL:'活动热量',RESTING_KCAL:'静息热量',TOTAL_KCAL:'全天总热量',WORKOUT_KCAL:'单次运动热量'}
const units:Record<string,string>={SLEEP:'h',RHR:'bpm',HRV:'ms',BODY_BATTERY:'/100',READINESS:'/100',STRESS:'/100',RECOVERY:'/10',STEPS:'步',ACTIVE_KCAL:'kcal',RESTING_KCAL:'kcal',TOTAL_KCAL:'kcal',WORKOUT_KCAL:'kcal'}
const additionalScopes:Record<string,string>={RECOVERY:'主观评分，非实测恢复百分比',STEPS:'当日累计，记录覆盖完整性未确认',ACTIVE_KCAL:'活动部分，不含静息，不代表全天总消耗',RESTING_KCAL:'静息部分，不代表全天总消耗',TOTAL_KCAL:'设备日总量，覆盖完整性未确认，不与分项相加',WORKOUT_KCAL:'单次运动，可能与活动或总量重叠，不另行累加'}
const states:Record<RegionState,string>={PAIN_REVIEW:'有自报疼痛，需核对症状与功能',REPORTED_SORENESS:'有自报酸痛',OVERLAP_OBSERVED:'跑步和力量训练参与重叠',TRAINING_EXPOSURE:'有已确认训练参与',UNKNOWN:'缺少可信局部依据'}

/** Re-select visible observations before formatting; never emit a raw source label or user note. */
function dailyPoint(view:HealthMetricView,day:string,asOf:string):{point:HealthPoint|null;state:'AVAILABLE'|'CONFLICT'|'MISSING'|'STALE'}{
 const seen=new Map<string,HealthPoint>(),cutoff=Date.parse(asOf)
 for(const point of [...view.series,...view.candidates,...(view.current?[view.current]:[])]){
  if(point.day>day||!validDay(point.day)||view.selectedSource&&point.stream!==view.selectedSource||!time(point.updatedAt)||Date.parse(point.updatedAt)>cutoff||!Number.isFinite(point.value))continue
  if(point.measuredAt!==null&&(!time(point.measuredAt)||Date.parse(point.measuredAt)>cutoff||Date.parse(point.measuredAt)>Date.parse(point.updatedAt)))continue
  const previous=seen.get(point.id)
  if(!previous||Date.parse(point.updatedAt)>Date.parse(previous.updatedAt))seen.set(point.id,point)
 }
 const newest=[...seen.values()].map(p=>p.day).sort().at(-1),candidates=[...seen.values()].filter(p=>p.day===newest)
 if(new Set(candidates.map(p=>JSON.stringify([p.stream,p.statistic,p.method,p.value]))).size>1)return{point:null,state:'CONFLICT'}
 const point=candidates.at(-1)??null
 return{point,state:!point?'MISSING':point.day===day?'AVAILABLE':'STALE'}
}

/** Daily and intraday context remain separate from session facts and never grant training permission. */
export function onlineRecoveryFacts(day:string,asOf:string):Facts{
 const owner=currentAthleteId(),fail=(message:string):Facts=>({summary:[`恢复与健康：${message}`],details:[]})
 if(!validDay(day)||!time(asOf)||day>localDay(new Date(asOf)))return fail('分析日期或截止时间无效，未读取恢复数值。')
 if(!currentStore())return fail('本机健康存储无法读取，未解释为没有记录。')
 try{
  const context=readRecoveryContext(owner,day,asOf),health=loadHealthSnapshot(day)
  if(!context)return fail('当前档案或恢复上下文无法读取。')
  const summary:string[]=[],details:string[]=[],metrics:string[]=[]
  if(health.unreadable)summary.push(`${day} 部分健康来源无法读取，未视为没有记录或恢复正常。`)
  for(const metric of ['SLEEP','RHR','HRV','BODY_BATTERY','READINESS','STRESS'] as const){
   const view=health.metrics.find(v=>v.metric===metric),known=view?dailyPoint(view,day,asOf):{point:null,state:'MISSING' as const}
   const fact=context.quantitative.facts.find(f=>f.metric===metric)
   if(['SLEEP','RHR','HRV'].includes(metric)&&fact){
    const method=metric==='HRV'&&known.point&&['RMSSD','SDNN'].includes(known.point.method)?`（${known.point.method}）`:metric==='HRV'?'（算法未确认）':''
    metrics.push(`${labels[metric]}：${round(fact.value)} ${units[metric]}${method}${fact.quality==='SELF_REPORT_RANGE'?'（自报区间代表值）':''}`)
   }else if(known.state==='CONFLICT')metrics.push(`${labels[metric]}：来源或独立记录冲突，未取平均`)
   else if(known.point&&known.state==='STALE')metrics.push(`${labels[metric]}：仅有 ${known.point.day} 历史记录，不代表 ${day} 状态`)
   else if(!['SLEEP','RHR','HRV'].includes(metric)&&known.point){
    const qualifier=metric==='BODY_BATTERY'?/最高|MAX/i.test(known.point.statistic)?'（当日最高，非当前电量）':'（设备日记录，非实时恢复许可）':'（设备日记录）'
    metrics.push(`${labels[metric]}：${round(known.point.value)}${units[metric]}${qualifier}`)
   }else metrics.push(`${labels[metric]}：截至分析时点无可用记录`)
  }
  summary.push(clip(`${day} 恢复与健康（日历日背景；截至 ${asOf}）：${metrics.join('；')}。`,500))
  const additional:string[]=[]
  for(const metric of ['RECOVERY','STEPS','ACTIVE_KCAL','RESTING_KCAL','TOTAL_KCAL','WORKOUT_KCAL'] as const){
   const view=health.metrics.find(v=>v.metric===metric);if(!view)continue
   const known=dailyPoint(view,day,asOf)
   if(known.state==='CONFLICT')additional.push(`${labels[metric]}：来源或独立记录冲突，未取平均`)
   else if(known.point&&known.state==='STALE')additional.push(`${labels[metric]}：仅有 ${known.point.day} 历史记录，不代表 ${day} 状态`)
   else if(known.point)additional.push(`${labels[metric]}：${round(known.point.value)} ${units[metric]}（${additionalScopes[metric]}）`)
  }
  if(additional.length)summary.push(clip(`${day} 其他健康记录（截至 ${asOf}）：${additional.join('；')}。`,500))
  // These strings are generated from enumerated checkin fields and rest durations, never free-text notes.
  const subjective=context.subjective.filter(s=>s.startsWith('当天自报'))
  const rest=context.subjective.filter(s=>!s.startsWith('当天自报'))
  if(context.safetyHold)summary.unshift(`${day} 恢复安全线索：已有疼痛或不适反馈待核对，设备指标不能解除此限制。`)
  if(subjective.length)details.push(clip(`${day} 主观反馈：${subjective.join('；')}。`,350))
  if(rest.length)details.push(clip(`${day} 独立睡眠/休息：${rest.join('；')}`,350))
  const trends=context.quantitative.facts.filter(f=>f.quality==='CALCULATED').map(f=>f.text)
  if(trends.length)details.push(clip(`个人恢复趋势：${trends.join(' ')}`,350))
  const importantMissing=context.missing.filter(s=>/冲突|读取|知晓时间|分析时点之后/.test(s))
  if(importantMissing.length)details.push(clip(`恢复资料限制：${importantMissing.slice(0,3).join('；')}`,350))
  const muscle=readRecoveryProjection(day,asOf)
  if(muscle.unreadable)summary.push(`${day} 部分肌群训练来源读取失败，不能当作没有训练或疼痛。`)
  const observed=muscle.review.regions.filter(r=>r.state!=='UNKNOWN')
  const groups=(['PAIN_REVIEW','REPORTED_SORENESS','OVERLAP_OBSERVED','TRAINING_EXPOSURE'] as const).flatMap(state=>{const rows=observed.filter(r=>r.state===state);return rows.length?[`${rows.map(r=>REGION_LABEL[r.region]).join('、')}：${states[state]}`]:[]})
  summary.push(clip(`肌群恢复（${day}，截至 ${muscle.review.asOf}）：${groups.length?groups.join('；'):'缺少可信的实际动作或局部反馈'}；这是训练参与/主观反馈，不是实测恢复程度，也不发训练许可。`,500))
  // U10 accepts a small clock skew. This outgoing packet uses the stricter actual request cutoff.
  const intra=loadIntraday(owner)[day]
  if(intra&&time(intra.fetchedAt)&&Date.parse(intra.fetchedAt)<=Date.parse(asOf)){
   const bits=(['HEART_RATE','BODY_BATTERY','STRESS'] as const).flatMap(metric=>{
    const view=muscle.intraday.metrics[metric],point=view.latest,label=metric==='HEART_RATE'?'心率':metric==='BODY_BATTERY'?'身体电量':'压力'
    return view.status==='SOURCE_CONFLICT'?[`${label}来源冲突`]:point&&time(point.measuredAt)&&Date.parse(point.measuredAt)<=Date.parse(asOf)?[`${label} ${round(point.value)}，测量 ${point.measuredAt}`]:[]
   })
   if(bits.length)details.push(clip(`${day} 手表日内：${bits.join('；')}。仅代表所列测量时刻，不是肌肉恢复或训练许可。`,350))
  }
  if(currentAthleteId()!==owner)return fail('运动员档案已切换，旧恢复摘要已丢弃。')
  return{summary:summary.map(s=>clip(s,500)),details:details.slice(0,8)}
 }catch{return fail(`${day} 部分恢复来源读取失败，不能解释为没有健康、休息或训练记录。`)}
}
