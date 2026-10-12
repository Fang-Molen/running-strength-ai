/** V3.3 P0/P1 coach decision contract. Pure, read-only; never mutates a saved plan. */
import { arbitratePlanChange, type PlanChangeDecision } from './adaptive-plan-permissions.ts'
import { reviewFourDirections, type CoachContext, type FourDirectionReview } from './coach-four-directions.ts'

export type EventKind = '200m'|'400m'|'800m'|'1500m'|'3000m'|'5000m'|'OTHER'
export type AthleteEvidence = {
  id:string; day:string; trainingId:string; category:'SPRINT'|'INTERVAL'|'STRENGTH'|'EASY'|'UNKNOWN';
  rpe?:number|null; sleepHours?:number|null; recovery?:number|null; cmjCm?:number|null;
  pain?:number|null; painRegion?:string|null; functionalLimitation?:boolean|null;
  completed?:boolean|null; durationSeconds?:number|null; distanceMeters?:number|null;
}
export type RacePrediction = {id:string; event:EventKind; predictedSeconds:number; actualSeconds?:number|null; day:string}
export type PlanSlot = {id:string; day:string; purpose:string; intensity:'EASY'|'MODERATE'|'HARD'|'UNKNOWN'; category:AthleteEvidence['category']; revision:number}
export type CoachDecisionInput = {asOfDay:string; evidence:AthleteEvidence[]; next:PlanSlot; primaryEvent:EventKind;
  predictions?:RacePrediction[]; expectedRevision:number; daysAhead:number; proposedAction:'KEEP'|'REDUCE'|'REPLACE'|'POSTPONE'|'INCREASE';
  feedbackId:string; override?:'ACCEPT'|'REJECT'|null}
export type CoachDecision = {
  status:'SAFETY_REVIEW'|'REQUIRES_CONFIRMATION'|'NOTIFICATION_ONLY'|'REPLAN_REVIEW'|'VERSION_CONFLICT';
  suggestedAction:CoachDecisionInput['proposedAction']; permission:PlanChangeDecision;
  reasoning:FourDirectionReview; evidenceIds:string[]; uncertainties:string[]; questions:string[];
  specialty:{event:EventKind; focus:string[]; missingEvidence:string[]};
  prediction:{count:number; meanAbsoluteErrorSeconds:number|null; biasSeconds:number|null; confidence:'UNVALIDATED'|'LIMITED'|'BACKTESTED'};
  individual:{comparableSessions:number; medianRpe:number|null; recoveryEvidenceCount:number; confidence:'UNKNOWN'|'LOW'|'PROVISIONAL'};
  proposedEvent:{type:'PLAN_CHANGE_PROPOSED'; proposalId:string; slotId:string; expectedRevision:number; feedbackId:string; action:CoachDecisionInput['proposedAction']; status:CoachDecision['status']};
  mayWritePlan:false; safetyCannotBeOverridden:true;
}
const finite=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max
const median=(a:number[])=>{const s=[...a].sort((x,y)=>x-y);return s.length?s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2:null}
const eventFocus:Record<EventKind,string[]>={
  '200m':['最高速度','加速能力','速度保持','神经肌肉与技术'],
  '400m':['速度储备','专项速度耐力','配速策略','高强度恢复'],
  '800m':['有氧能力','速度储备','专项耐力','配速与恢复'],
  '1500m':['有氧能力','临界速度相关表现','速度储备','比赛配速'],
  '3000m':['有氧能力','持续配速','跑步经济性'],
  '5000m':['有氧能力','持续配速','跑步经济性'],
  OTHER:['专项要求尚未明确']}
export function evaluateCoachDecision(input:CoachDecisionInput):CoachDecision {
  if(!input||!/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDay)||!Array.isArray(input.evidence)||!input.next?.id||!input.next.purpose?.trim()||!input.feedbackId?.trim()||!eventFocus[input.primaryEvent]||!Number.isInteger(input.daysAhead)||input.daysAhead<0)throw Error('invalid coach decision input')
  if(input.evidence.some(e=>!e.id?.trim()||!e.trainingId?.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(e.day)||e.day>input.asOfDay))throw Error('unbound or future evidence')
  const ids=input.evidence.map(e=>e.id);if(new Set(ids).size!==ids.length)throw Error('duplicate evidence IDs')
  const ordered=[...input.evidence].sort((a,b)=>a.day.localeCompare(b.day)||a.id.localeCompare(b.id))
  const current=ordered.at(-1)
  if(!current)throw Error('missing linked feedback')
  const context:CoachContext={history:ordered.slice(0,-1).map(e=>({...e,day:e.day})),current:{...current,day:current.day},next:{id:input.next.id,day:input.next.day,category:input.next.category,purpose:input.next.purpose,intensity:input.next.intensity}}
  const reasoning=reviewFourDirections(context)
  const pain=current.pain!=null&&current.pain>0?{region:current.painRegion?.trim()||'未明确部位',severity:current.pain,functionalLimitation:current.functionalLimitation??null}:undefined
  const permission=arbitratePlanChange({daysAhead:input.daysAhead,expectedRevision:input.expectedRevision,actualRevision:input.next.revision,reason:'训练反馈复核',evidenceIds:ids,discomfort:pain,nextSessionIntensity:input.next.intensity,proposedAction:input.proposedAction})
  const status:CoachDecision['status']=permission.status==='SAFETY_REVIEW'?'SAFETY_REVIEW':permission.status==='REJECT_CONFLICT'?'VERSION_CONFLICT':permission.status==='REQUIRE_CONFIRMATION'?'REQUIRES_CONFIRMATION':permission.status==='NOTIFY_BEFORE_CHANGE'?'NOTIFICATION_ONLY':'REPLAN_REVIEW'
  const comparable=ordered.filter(e=>e.category===current.category&&e.completed===true&&e.day<current.day)
  const rpes=comparable.filter(e=>finite(e.rpe,1,10)).map(e=>e.rpe as number)
  const recoveryEvidenceCount=comparable.filter(e=>finite(e.recovery,1,10)||finite(e.cmjCm,1,150)).length
  const individual={comparableSessions:comparable.length,medianRpe:median(rpes),recoveryEvidenceCount,confidence:(comparable.length>=5&&recoveryEvidenceCount>=3?'PROVISIONAL':comparable.length>=2?'LOW':'UNKNOWN') as 'PROVISIONAL'|'LOW'|'UNKNOWN'}
  const paired=(input.predictions||[]).filter(p=>p.event===input.primaryEvent&&p.day<=input.asOfDay&&finite(p.predictedSeconds,1,1e6)&&finite(p.actualSeconds,1,1e6))
  const errors=paired.map(p=>(p.actualSeconds as number)-p.predictedSeconds)
  const prediction={count:paired.length,meanAbsoluteErrorSeconds:errors.length?Math.round(errors.reduce((a,b)=>a+Math.abs(b),0)/errors.length*100)/100:null,biasSeconds:errors.length?Math.round(errors.reduce((a,b)=>a+b,0)/errors.length*100)/100:null,confidence:(paired.length>=5?'BACKTESTED':paired.length?'LIMITED':'UNVALIDATED') as 'BACKTESTED'|'LIMITED'|'UNVALIDATED'}
  const missingEvidence:string[]=[]
  if(!ordered.some(e=>finite(e.durationSeconds,1,1e6)&&finite(e.distanceMeters,1,1e6)))missingEvidence.push('缺少可追溯的距离与时间表现，不能量化专项能力')
  if(individual.confidence!=='PROVISIONAL')missingEvidence.push('相似训练及恢复证据不足，不能建立可靠个人响应模型')
  const uncertainties=[...reasoning.uncertainty,...missingEvidence]
  if(prediction.confidence==='UNVALIDATED')uncertainties.push('缺少已配对比赛预测与成绩，不能声称预测已校准')
  const questions=[...reasoning.questions]
  if(pain)questions.push('疼痛位置、开始时间、动作受限程度是否发生变化？')
  const proposalId=`${input.next.id}:${input.next.revision}:${input.feedbackId}:${input.proposedAction}`
  return {status,suggestedAction:input.proposedAction,permission,reasoning,evidenceIds:ids,uncertainties,questions,
    specialty:{event:input.primaryEvent,focus:eventFocus[input.primaryEvent],missingEvidence},prediction,individual,
    proposedEvent:{type:'PLAN_CHANGE_PROPOSED',proposalId,slotId:input.next.id,expectedRevision:input.next.revision,feedbackId:input.feedbackId,action:input.proposedAction,status},mayWritePlan:false,safetyCannotBeOverridden:true}
}
