/** BUILD 40: opt-in reduction of one future strength exercise, preserving audit inside the same Plan JSON. */
import type {Plan, Session} from '../strength/model.ts'
export type StrengthProposal={id:string;sessionId:string;moveId:string;expectedPlanRaw:string;beforeSets:number;afterSets:number;reason:string}
export type StrengthControl={previewUnlocked:boolean;athleteConfirmed:boolean;confirmedProposalId:string|null;hasTrainingStartedToday:boolean;unresolvedPain:boolean;timestamp:string}
export type StrengthResult={ok:true;plan:Plan;reason:string}|{ok:false;plan:Plan;reason:string}
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T
const fail=(plan:Plan,reason:string):StrengthResult=>({ok:false,plan,reason})
export function proposeStrengthReduction(plan:Plan,sessionId:string,moveId:string):StrengthProposal|null{
  const session=plan.sessions.find(s=>s.id===sessionId)
  const move=session?.moves.find(m=>m.id===moveId)
  if(!session||!move||!Number.isInteger(move.sets)||move.sets<=1)return null
  return {id:`strength:${sessionId}:${moveId}:${plan.coachEditRevision??0}`,sessionId,moveId,expectedPlanRaw:JSON.stringify(plan),beforeSets:move.sets,afterSets:move.sets-1,reason:'预览版仅减少一组；不改变重量、次数、训练历史或其他课程'}
}
function guard(plan:Plan,sessionId:string,control:StrengthControl):string|null{
  if(!control.previewUnlocked||!control.athleteConfirmed)return '预览权限与运动员明确确认均为必需'
  if(control.hasTrainingStartedToday)return '本次训练已经开始，不允许更改当前课表'
  if(control.unresolvedPain||plan.cycle?.logs.some(log=>log.feel==='pain'))return '存在疼痛或医学风险，暂停修改并复核'
  if(plan.cycle?.logs.some(log=>log.sessionId===sessionId))return '本周期该课程已有完成/跳过记录，不能修改'
  if(!Number.isFinite(Date.parse(control.timestamp)))return '审计时间无效'
  if((plan.coachEditHistory?.length??0)>=100)return '审计已达100条，请先完整备份，不覆盖旧审计'
  return null
}
export function applyStrengthReduction(plan:Plan,proposal:StrengthProposal,control:StrengthControl):StrengthResult{
  const problem=guard(plan,proposal.sessionId,control)
  if(problem)return fail(plan,problem)
  if(control.confirmedProposalId!==proposal.id)return fail(plan,'用户确认的不是当前提案')
  if(JSON.stringify(plan)!==proposal.expectedPlanRaw)return fail(plan,'计划已变化，请重新生成提案')
  const session=plan.sessions.find(s=>s.id===proposal.sessionId)
  const move=session?.moves.find(m=>m.id===proposal.moveId)
  if(!session||!move||move.sets!==proposal.beforeSets||move.sets<=1||proposal.afterSets!==move.sets-1)return fail(plan,'目标动作或组数已经变化')
  const revision=(plan.coachEditRevision??0)+1
  const after:Session={...clone(session),moves:session.moves.map(m=>m.id===move.id?{...m,sets:proposal.afterSets}:clone(m))}
  const record={id:`coach-edit:${revision}`,action:'APPLY' as const,proposalId:proposal.id,sessionId:session.id,before:clone(session),after:clone(after),timestamp:control.timestamp,revision}
  return {ok:true,reason:'仅修改未来力量课的一个动作组数，审计与计划保存在同一个值中',plan:{...plan,sessions:plan.sessions.map(s=>s.id===session.id?after:s),coachEditRevision:revision,coachEditHistory:[...(plan.coachEditHistory??[]),record]}}
}
export function rollbackStrengthReduction(plan:Plan,control:StrengthControl):StrengthResult{
  const last=plan.coachEditHistory?.at(-1)
  if(!last||last.action!=='APPLY')return fail(plan,'没有可撤销的最近一次教练修改')
  const problem=guard(plan,last.sessionId,control)
  if(problem)return fail(plan,problem)
  const current=plan.sessions.find(s=>s.id===last.sessionId)
  if(!current||JSON.stringify(current)!==JSON.stringify(last.after))return fail(plan,'课程已被其他编辑修改，不能覆盖')
  const revision=(plan.coachEditRevision??0)+1
  const restored=clone(last.before)
  const record={id:`coach-edit:${revision}`,action:'ROLLBACK' as const,proposalId:last.proposalId,sessionId:last.sessionId,before:clone(current),after:clone(restored),timestamp:control.timestamp,revision}
  return {ok:true,reason:'已生成新修订并保留原审计',plan:{...plan,sessions:plan.sessions.map(s=>s.id===last.sessionId?restored:s),coachEditRevision:revision,coachEditHistory:[...(plan.coachEditHistory??[]),record]}}
}
