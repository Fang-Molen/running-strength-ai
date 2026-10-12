/** V3.3 M3/M7 projection only. No new brain engine, no autonomous training decision. */
import type {Plan} from '../strength/model.ts'
export type ResponseEvidence={occurrenceId:string;sessionContext:string;completed:boolean;sessionRpe:number|null;recovery24h:number|null;recovery48h:number|null;sourceIds:string[];painReported:boolean}
export type M3Readiness={status:'INSUFFICIENT'|'CONFLICT'|'CANDIDATE';context:string;count:number;sourceIds:string[];statement:string}
export function assessM3PersonalResponse(evidence:ResponseEvidence[],context:string):M3Readiness{
  const relevant=evidence.filter(e=>e.sessionContext===context&&e.completed&&e.sourceIds.length>0)
  const unique=[...new Map(relevant.map(e=>[e.occurrenceId,e])).values()]
  const bound=unique.filter(e=>Number.isInteger(e.sessionRpe)&&e.sessionRpe!==null&&e.sessionRpe>=1&&e.sessionRpe<=10&&Number.isInteger(e.recovery24h)&&e.recovery24h!==null&&e.recovery24h>=1&&e.recovery24h<=10&&Number.isInteger(e.recovery48h)&&e.recovery48h!==null&&e.recovery48h>=1&&e.recovery48h<=10)
  const ids=[...new Set(bound.flatMap(e=>e.sourceIds))]
  if(bound.length<3)return {status:'INSUFFICIENT',context,count:bound.length,sourceIds:ids,statement:'至少需要3次同类训练，且每次有绑定的整课RPE及24/48小时恢复反馈；不根据单次截图学习负荷规律。'}
  if(bound.some(e=>e.painReported))return {status:'CONFLICT',context,count:bound.length,sourceIds:ids,statement:'存在疼痛记录，暂停形成稳定个人响应规律，需人工评估。'}
  const high=bound.filter(e=>e.recovery48h!==null&&e.recovery48h>=7).length
  const low=bound.filter(e=>e.recovery48h!==null&&e.recovery48h<=3).length
  if(high>0&&low>0)return {status:'CONFLICT',context,count:bound.length,sourceIds:ids,statement:'同类训练后48小时恢复反馈相互矛盾，不能选择一个代表值。'}
  return {status:'CANDIDATE',context,count:bound.length,sourceIds:ids,statement:'已有同类训练的重复反馈，可供教练人工审查；仅为低置信度个人响应候选，不授权自动加量或伤病判断。'}
}
export type M7ReasoningRecord={id:string;proposalId:string;action:'APPLY'|'ROLLBACK';revision:number;timestamp:string;basis:'USER_CONFIRMED_PREVIEW';automaticDecision:false}
export function projectM7Reasoning(plan:Plan):M7ReasoningRecord[]{
  return (plan.coachEditHistory??[]).filter(x=>x&&typeof x.proposalId==='string').map(x=>({id:x.id,proposalId:x.proposalId,action:x.action,revision:x.revision,timestamp:x.timestamp,basis:'USER_CONFIRMED_PREVIEW' as const,automaticDecision:false as const}))
}
