import type { ModelInput, TrainingCandidate } from './types'
import { validateRunningComponents } from '../../core/running-plan'
import { selectTrainingModels } from './selection'
const clone=<T>(v:T):T=>structuredClone(v)
const validDay=(v:string)=>/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v
/** Reuse current planned structures. No generated increase, new intensity, or forced training distribution. */
export function buildTrainingCandidates(input:ModelInput){
 const review=selectTrainingModels(input),candidates:TrainingCandidate[]=[],missing:string[]=[]
 if(!review.allowTrainingCandidates)missing.push('安全状态或证据版本尚未核定，保留暂停/复核选项。')
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:input.context.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(input.context.asOf))
 for(const s of input.sessions){
  if(s.executionState!=='NOT_STARTED'||s.date<today){missing.push('仅接受明确尚未开始的当前/未来课程：'+s.id);continue}
  if(!s.id||!validDay(s.date)||!s.sourceRefs.length||!validateRunningComponents(s.plan.components).ok||input.sessions.filter(x=>x.id===s.id).length!==1){missing.push('计划身份、来源、日期或执行结构不完整：'+s.id);continue}
  const base={sessionId:s.id,date:s.date,before:clone(s.plan),basisRefs:[...s.sourceRefs,...review.factsUsed],requiresConfirmation:true as const,automaticExecution:false as const}
  const add=(action:TrainingCandidate['action'],after:TrainingCandidate['after'],changedVariable:TrainingCandidate['changedVariable'],reason:string)=>candidates.push({...base,id:JSON.stringify([s.id,action]),action,after,changedVariable,reason})
  add('SKIP',null,'SESSION_EXECUTION','暂不执行本课；保留原始计划，核对疼痛、功能和恢复后再决定。')
  if(!review.allowTrainingCandidates)continue
  if(s.purpose==='THRESHOLD'&&!review.physiology.thresholds.allPairs.length){missing.push('阈值课缺少个体实测阈值依据：'+s.id);continue}
  if(!s.familiar){missing.push('当前课程缺少既有耐受记录，不在本轮引入新刺激：'+s.id);continue}
  if(s.purpose==='STRENGTH'){missing.push('力量剂量继续由既有力量模块复核，不从跑步模型修改：'+s.id);continue}
  const concern=input.recovery?.signalState==='RECOVERY_CONCERN'||input.recovery?.signalState==='MIXED_SIGNALS'
  if(!concern)add('KEEP',clone(s.plan),'NONE','保留已存在且熟悉的课程；维持当前剂量，不据分布标签加量。')
  const after=clone(s.plan)
  let reduced=false
  for(const component of after.components){
   if(component.modality!=='RUNNING'||component.structure.kind!=='REPEATED')continue
   for(const block of component.structure.blocks){const step=block.steps.find(x=>x.repeatCount>2||x.repeatCount===2&&x.recoveryAfterRepeatSeconds===null)
    if(step){step.repeatCount-=1;reduced=true;break}}
   if(reduced)break
  }
  if(reduced&&validateRunningComponents(after.components).ok)add('REDUCE',after,'REPEAT_COUNT','仅将一个已有步骤的重复次数减1；轮数、距离、目标用时与休息保持原样。这是待确认的保守候选，不是减量比例处方。')
  if(concern)add('RECOVERY',null,'SESSION_EXECUTION','本课改为休息与恢复观察，不增添跑步、力量或测试剂量；原计划保留。')
 }
 return {review,candidates,missing:[...new Set(missing)],planWritten:false as const}
}
