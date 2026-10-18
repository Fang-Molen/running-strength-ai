import { currentAthleteId } from '../core/events'
import { currentStore } from '../core/storage'
import { loadCheckins } from './legacy-inputs'
import type { HealthSnapshot } from './snapshot'
import type { Checkin } from './legacy-inputs'
import type { ScheduleEntry } from './legacy-inputs'
import { exerciseById } from '../strength/catalog'
import { shiftDay, validDay } from './observation'

/** App review thresholds, not validated diagnostic cutoffs or a readiness score. */
export const FATIGUE_REVIEW_RULES={sleepDeltaHours:1,hrvDropFraction:0.15,rhrRiseBpm:5,minimumBaselineDays:3} as const
export type FatigueReview={ruleStatus:'RESEARCH_CANDIDATE';automaticPrescription:false;state:'PAIN_REVIEW'|'MULTI_SIGNAL'|'WATCH'|'INSUFFICIENT'|'NO_ADVERSE_SIGNAL';title:string;signals:{domain:'SUBJECTIVE'|'SLEEP'|'AUTONOMIC';detail:string;sourceIds:string[]}[];excluded:string[];action:string;followup:string;diagnosis:false;planChanged:false}
export function dailyCheckin(day:string,asOf=new Date().toISOString()):Checkin|null{
 const known=(stamp:unknown)=>typeof stamp==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(stamp)&&Number.isFinite(Date.parse(stamp))&&Date.parse(stamp)<=Date.parse(asOf)
 const ci=loadCheckins(currentStore()).find(c=>c.date===day&&known(c.at))??null
 try{const raw=JSON.parse(currentStore()?.getItem('fk-pain-log-v1')??'[]');const pain=Array.isArray(raw)&&raw.some((p:any)=>p?.date===day&&(p.athleteId??'local')===currentAthleteId()&&Number.isFinite(p.score)&&p.score>0&&p.score<=10&&[p.at,p.recordedAt,p.updatedAt,p.timestamp].filter(v=>v!==undefined).every(known));return pain?{...(ci??{date:day,at:''}),pain:ci?.pain==='sharp'?'sharp':'mild'}:ci}catch{return ci}
}
export function reviewFatigue(snapshot:HealthSnapshot,checkin:Checkin|null):FatigueReview{
  const signals:FatigueReview['signals']=[],excluded:string[]=[]
  const day=snapshot.asOf,ci=checkin?.date===day?checkin:null
  const view=(m:string)=>snapshot.metrics.find(x=>x.metric===m)
  const usable=(m:string)=>{const x=view(m);if(!x || x.state!=='AVAILABLE'){excluded.push(`${x?.label??m}：${x?.state==='CONFLICT'?'来源冲突':x?.state==='STALE'?'非当天数据':'缺失'}`);return null}return x}
  const sleep=usable('SLEEP'),hrv=usable('HRV'),rhr=usable('RHR'),rec=usable('RECOVERY')
  const subjectiveKnown=!!ci?.fatigue&&['fresh','ok','tired'].includes(ci.fatigue)||Number.isFinite(ci?.recovery)&&ci!.recovery!>=1&&ci!.recovery!<=10||!!rec?.current
  if(ci?.fatigue==='tired'||(ci?.recovery!=null&&ci.recovery>=1&&ci.recovery<=4)||rec?.current && rec.current.value<=4)signals.push({domain:'SUBJECTIVE',detail:'当天自述很累或主观恢复偏低',sourceIds:[...(ci?[`checkin:${day}`]:[]),...(rec?.current?[rec.current.id]:[])]})
  if(sleep?.baseline&&sleep.baseline.delta<=-FATIGUE_REVIEW_RULES.sleepDeltaHours)signals.push({domain:'SLEEP',detail:`睡眠较同来源前7天记录日均值少 ${Math.abs(sleep.baseline.delta).toFixed(1)} 小时`,sourceIds:[sleep.current!.id,...sleep.series.filter(p=>p.day>=sleep.baseline!.start&&p.day<day).map(p=>p.id)]})
  if(hrv?.baseline&&hrv.baseline.delta/hrv.baseline.mean<=-FATIGUE_REVIEW_RULES.hrvDropFraction)signals.push({domain:'AUTONOMIC',detail:'HRV低于个人近期同来源均值，需结合测量条件核对',sourceIds:[hrv.current!.id]})
  if(rhr?.baseline&&rhr.baseline.delta>=FATIGUE_REVIEW_RULES.rhrRiseBpm)signals.push({domain:'AUTONOMIC',detail:'静息心率高于个人近期同来源均值，原因尚不确定',sourceIds:[rhr.current!.id]})
  for(const x of [sleep,hrv,rhr])if(x&&!x.baseline)excluded.push(`${x.label}：个人可比基线不足，未按群体阈值判断`)
  const battery=view('BODY_BATTERY');if(battery?.current||view('READINESS')?.current)excluded.push('身体电量/准备度属于设备算法辅助指标；日最高电量不用于判断当前疲劳，也不与HRV重复计票')
  const domains=new Set(signals.map(s=>s.domain))
  const pain=ci?.pain==='mild'||ci?.pain==='sharp'
  const state:FatigueReview['state']=pain?'PAIN_REVIEW':domains.size>=2?'MULTI_SIGNAL':signals.length?'WATCH':snapshot.unreadable||![sleep,hrv,rhr].some(x=>!!x?.baseline)||[sleep,hrv,rhr].some(x=>x&&!x.baseline)||!subjectiveKnown?'INSUFFICIENT':'NO_ADVERSE_SIGNAL'
  const title={PAIN_REVIEW:'先核对疼痛与功能',MULTI_SIGNAL:'多个信号提示恢复压力',WATCH:'有单类信号，先观察核对',INSUFFICIENT:'证据不足，暂不能判断疲劳',NO_ADVERSE_SIGNAL:'已记录指标未见上述不利信号'}[state]
  const action={PAIN_REVIEW:'暂缓会诱发疼痛的高强度内容；根据症状与功能变化寻求专业评估。手表正常分数不能解除疼痛限制。',MULTI_SIGNAL:'这些变化仅达到未核准的经验复核阈值，不足以据此决定减量、停训或医学回归。先观察热身表现、疼痛和近期训练，再讨论待确认候选。',WATCH:'核对该信号的测量条件和近期训练；先看热身表现，不凭单项数值自动改课。',INSUFFICIENT:'先补当天感受、睡眠和近期实际训练，核对冲突来源；不据此自动加量。',NO_ADVERSE_SIGNAL:'结合既定计划和热身表现决定是否继续；这不等于确认完全恢复，也不自动加量。'}[state]
  return {ruleStatus:'RESEARCH_CANDIDATE',automaticPrescription:false,state,title,signals,excluded,action,followup:pain?'先记录疼痛部位、起始时间和日常活动影响；不要用加速或负重试探疼痛，回归训练需相应专业评估。':'本次热身后记录腿部感觉、疼痛与同类动作表现；主课后记录RPE，次日再看睡眠和主观恢复，重新评估。',diagnosis:false,planChanged:false}
}
export type BalanceReview={from:string;to:string;planned:{run:number;strength:number;hardDates:string[];muscleGroups:string[];unknownExercises:number};actual:{sessions:number;knownMinutes:number;unknownMinutes:number;knownRunKm:number;unknownRunKm:number;intensityKnown:number;intensityMinutes:{easy:number;moderate:number;hard:number;unknown:number}};observations:string[];gaps:string[];action:string;planChanged:false}
export function reviewBalance(entries:ScheduleEntry[],to:string):BalanceReview{
  const counts=new Map<string,number>();for(const e of entries)if(e&&typeof e.id==='string')counts.set(e.id,(counts.get(e.id)??0)+1)
  const unique=entries.filter(e=>e&&counts.get(e.id)===1)
  const from=shiftDay(to,-6),within=unique.filter(e=>e && validDay(e.date) && e.date>=from&&e.date<=to&&!['rejected','proposed'].includes(e.status))
  const planned=within.filter(e=>!e.unplanned),actual=within.filter(e=>e.actual&&['as_planned','different'].includes(e.actual.outcome)&&e.modality!=='rest')
  const hardDates=[...new Set(planned.filter(e=>e.intensity==='HARD').map(e=>e.date))].sort()
  const muscleGroups=new Set<string>();let unknownExercises=0
  for(const e of planned)for(const x of Array.isArray(e.exercises)?e.exercises:[]){if(!x){unknownExercises++;continue}const found=x.catalogId?exerciseById(x.catalogId):undefined;if(found)muscleGroups.add(found.group);else unknownExercises++}
  const observations:string[]=[],gaps:string[]=[]
  if(unique.length!==entries.length)gaps.push('日程存在重复或无效标识，相关条目未纳入计数，需核对原记录。')
  for(let i=1;i<hardDates.length;i++)if(hardDates[i]===shiftDay(hardDates[i-1],1))observations.push(`${hardDates[i-1]}、${hardDates[i]} 连续两日课表标注高强度；需核对实际完成、课间时距和恢复，不直接断定过量。`)
  for(const d of new Set(planned.map(e=>e.date))){const es=planned.filter(e=>e.date===d);if(es.some(e=>e.modality==='run'&&e.intensity==='HARD')&&es.some(e=>e.modality==='strength'))observations.push(`${d} 同日有强度跑与力量：核对先后顺序、间隔和下肢重叠。`)}
  if(planned.some(e=>e.modality==='run')&&!planned.some(e=>e.modality==='strength'))observations.push('近7天课表只看到跑步；结合比赛阶段、目标及漏记情况核对是否需要力量安排。')
  const known=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0
  const out:BalanceReview={from,to,planned:{run:planned.filter(e=>e.modality==='run').length,strength:planned.filter(e=>e.modality==='strength').length,hardDates,muscleGroups:[...muscleGroups],unknownExercises},actual:{sessions:actual.length,knownMinutes:actual.reduce((s,e)=>s+(known(e.actual!.minutes)?e.actual!.minutes!:0),0),unknownMinutes:actual.filter(e=>!known(e.actual!.minutes)).length,knownRunKm:actual.filter(e=>e.modality==='run').reduce((s,e)=>s+(known(e.actual!.km)?e.actual!.km!:0),0),unknownRunKm:actual.filter(e=>e.modality==='run'&&!known(e.actual!.km)).length,intensityKnown:actual.filter(e=>['EASY','MODERATE','HARD'].includes(e.actual!.intensity??'')).length,intensityMinutes:{easy:0,moderate:0,hard:0,unknown:0}},observations,gaps,action:'先核对连续强度日与跑步/下肢力量重叠，再结合疲劳反馈调整顺序或难度；缺少的肌群先核对是否漏记，不自动加动作。',planChanged:false}
  for(const e of actual){const key=({EASY:'easy',MODERATE:'moderate',HARD:'hard'} as const)[e.actual!.intensity as 'EASY'|'MODERATE'|'HARD']??'unknown';if(known(e.actual!.minutes))out.actual.intensityMinutes[key]+=e.actual!.minutes!}
  if(out.actual.sessions)observations.push(`已记录实际时长按填写强度：轻松${out.actual.intensityMinutes.easy}、中等${out.actual.intensityMinutes.moderate}、高强度${out.actual.intensityMinutes.hard}、强度未填${out.actual.intensityMinutes.unknown}分钟；非心率分区统计。`)
  if(within.some(e=>e.status==='done'&&!e.actual))gaps.push('部分课程只有完成标记，没有实际明细，未当成实际负荷。')
  if(out.actual.unknownMinutes||out.actual.intensityKnown<out.actual.sessions)gaps.push('实际时长或强度有缺失，不能计算完整强度分布。')
  if(!out.actual.sessions)gaps.push('日程内尚无可读实际反馈；设备活动单独列示，不与日程重复相加。')
  gaps.push('肌群列表是计划动作覆盖，不是实际刺激量；跑步公里与力量重量不相加为统一负荷。')
  if(unknownExercises)gaps.push(`${unknownExercises}个动作未匹配动作库，肌群覆盖暂不完整。`)
  return out
}
