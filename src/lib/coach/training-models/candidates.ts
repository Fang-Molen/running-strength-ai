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
  const readiness=review.purposeReadiness.find(r=>r.sessionId===s.id)!
  missing.push(...readiness.missing.map(m=>m+'：'+s.id))
  const base={sessionId:s.id,date:s.date,before:clone(s.plan),basisRefs:[...s.sourceRefs,...review.factsUsed],requiresConfirmation:true as const,automaticExecution:false as const,
   purpose:s.purpose,risk:readiness.risk,observation:readiness.observation,knowledgeVersion:review.knowledgeVersion,
   supportsWhen:'已批准的相近实际剂量下，原热身功能、重复质量和次日反应稳定。',weakensWhen:'出现疼痛、动作改变、重复质量下降或更正后的事实与当前依据不符；停止沿用当前候选。'}
  const add=(action:TrainingCandidate['action'],after:TrainingCandidate['after'],changedVariable:TrainingCandidate['changedVariable'],reason:string)=>candidates.push({...base,id:JSON.stringify([s.id,action]),action,after,changedVariable,reason})
  add('SKIP',null,'SESSION_EXECUTION','暂不执行本课；保留原始计划，核对疼痛、功能和恢复后再决定。')
  const recover=()=>add('RECOVERY',null,'SESSION_EXECUTION','本课改为休息与恢复观察，不增添跑步、力量或测试剂量；原计划保留。')
  if(!review.allowTrainingCandidates){recover();continue}
  if((s.purpose==='THRESHOLD'||s.plan.components.some(c=>c.modality==='RUNNING'&&c.purpose==='TEMPO_THRESHOLD'))&&!review.physiology.thresholds.allPairs.length){missing.push('阈值课缺少个体实测阈值依据：'+s.id);recover();continue}
  if(!readiness.allowKeep&&!readiness.allowReduce){missing.push(...readiness.reasons.map(r=>r+'：'+s.id));recover();continue}
  if(readiness.allowKeep)add('KEEP',clone(s.plan),'NONE','保留已存在且熟悉的课程；维持当前剂量，不据分布标签加量。'+readiness.reasons.join(''))
  const after=clone(s.plan)
  let reduced=false
  for(const component of after.components){
   if(component.modality!=='RUNNING'||component.structure.kind!=='REPEATED')continue
   for(const block of component.structure.blocks){const step=block.steps.find(x=>x.repeatCount>2||x.repeatCount===2&&x.recoveryAfterRepeatSeconds===null)
    if(step){step.repeatCount-=1;reduced=true;break}}
   if(reduced)break
  }
  if(readiness.allowReduce&&reduced&&validateRunningComponents(after.components).ok)add('REDUCE',after,'REPEAT_COUNT','仅将一个已有步骤的重复次数减1；轮数、距离、目标用时与休息保持原样。这是待确认的保守候选，不是减量比例处方。')
  if(!readiness.allowKeep)recover()
 }
 return {review,candidates,missing:[...new Set(missing)],planWritten:false as const}
}
