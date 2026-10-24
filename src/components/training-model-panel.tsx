import { useEffect, useRef, useState } from 'react'
import { currentAthleteId } from '@/lib/core/events'
import { localDay } from '@/lib/health/observation'
import { describeTrackPlan, describePlanRest } from '@/lib/ui/running-workouts'
import type { RunningPlan } from '@/lib/core/running-plan'
import { readTrainingModelWorkbench, type TrainingModelWorkbench, type WorkbenchOptions } from '@/lib/coach/training-models/workbench'
import { createTrainingConfirmation, createIndexedDbTrainingConfirmations, type TrainingProposal, type TrainingExportReceipt } from '@/lib/coach/training-models/confirmation'
const button='min-h-11 rounded-card border border-line px-3 py-2 text-sm font-bold disabled:opacity-50'
const names={PYRAMIDAL:'金字塔',POLARIZED:'极化',DOUBLE_THRESHOLD:'双阈值',EVENT_SPECIFIC:'专项'} as const
const statuses={CONSIDER:'可讨论',CONDITIONAL:'有条件',NOT_APPLICABLE:'不适用',INSUFFICIENT:'缺资料',HOLD:'暂停复核'} as const
const actions={KEEP:'保持原课',REDUCE:'减少一个步骤的重复次数',RECOVERY:'恢复观察',SKIP:'暂不执行本课'} as const
export function download(receipt:TrainingExportReceipt):{status:'REQUESTED'|'FAILED'|'BLOCKED';message:string}{
 if(receipt.athleteId!==currentAthleteId()||receipt.kind!=='CONFIRMED_EXPORT'||receipt.scheduleWritten!==false||receipt.automaticExecution!==false)return {status:'BLOCKED',message:'用户或回执状态已变化，未下载其他档案的文件。'}
 let url:string|null=null,link:HTMLAnchorElement|null=null
 try{
  url=URL.createObjectURL(new Blob([JSON.stringify({schema:'FK_CONFIRMED_TRAINING_EXPORT_1',receipt},null,2)],{type:'application/json'}))
  link=document.createElement('a');link.href=url;link.download=`training-model-${receipt.id.replace(/[^A-Za-z0-9_-]/g,'_')}.json`;document.body.appendChild(link);link.click()
  return {status:'REQUESTED',message:'已请求浏览器下载JSON，请在下载记录中核对是否保存成功；可再次下载。确认回执已保留，尚未写入日程或启动训练。'}
 }catch{return {status:'FAILED',message:'确认回执已保存，但本机文件下载未能发起；可重试下载或换用浏览器。原日程未修改。'}}
 finally{link?.remove();if(url){const retained=url;const timer=setTimeout(()=>URL.revokeObjectURL(retained),30000);if(typeof timer==='object'&&'unref' in timer)timer.unref()}}
}
function PlanSummary({plan}:{plan:RunningPlan|null}){
 if(!plan)return <p className="mt-1 text-muted">本次不执行训练；原计划保留。</p>
 return <div className="mt-1 space-y-2">{plan.components.map((component,index)=>{
  if(component.modality==='STRENGTH')return <p key={index} className="text-muted">力量部分原样保留；动作与剂量请在原力量课程中核对。</p>
  const single={...plan,components:[component]}
  return <div key={index}><p>{describeTrackPlan(single)}</p>{component.structure.kind==='REPEATED'?<><p className="text-muted">{describePlanRest(single)}</p>{component.structure.blocks.flatMap((block,bi)=>block.steps.map((step,si)=><p key={bi+':'+si} className="text-xs text-muted">{block.roundCount}轮，每轮{step.repeatCount}次；每次{step.plannedDistanceMeters===null?'距离未设置':`${step.plannedDistanceMeters}米`}{step.plannedDurationSeconds===null?'；目标用时未设置':`；目标${step.plannedDurationSeconds}秒`}</p>))}</>:null}</div>
 })}</div>
}
function CandidateDifference({before,after}:{before:RunningPlan;after:RunningPlan|null}){
 return <div className="mt-2 grid gap-3 sm:grid-cols-2"><div><b>原课</b><PlanSummary plan={before}/></div><div><b>这份候选</b><PlanSummary plan={after}/></div></div>
}
export function TrainingModelReview({view,familiar,onFamiliar,onPrepare,disabled,prepareDisabled=false}:{view:TrainingModelWorkbench;familiar:readonly string[];onFamiliar:(id:string,checked:boolean)=>void;onPrepare:(id:string)=>void;disabled:boolean;prepareDisabled?:boolean}){
 return <div className="mt-3 space-y-3 text-sm">
  <p className="text-xs text-muted">读取截止：{view.asOf}。方法适用性是保守分析，不代表已验证最优方案或医学许可。</p>
  {view.result.review.methods.map(m=><div key={m.method} className="rounded-card bg-bg p-3"><b>{names[m.method]} · {statuses[m.status]}</b><p className="mt-1 text-muted">{m.reasons.join(' ')}</p></div>)}
  <details className="rounded-card border border-line p-3" open><summary className="font-bold">缺失资料（{view.missing.length}）</summary>{view.missing.map((m,i)=><p key={i} className="mt-1 text-muted">{m}</p>)}</details>
  <div><b>已有课程</b>{view.courses.length?view.courses.map(c=><div key={c.id} className="mt-2 rounded-card bg-bg p-3"><p>{c.date} · {c.title} · {c.state==='NOT_STARTED'?'尚未开始':c.state==='STARTED'?'已开始':c.state==='COMPLETED'?'已完成':'状态待核对'}</p>{c.reason?<p className="text-xs text-muted">{c.reason}</p>:null}<label className="mt-2 flex min-h-11 items-center gap-2"><input type="checkbox" checked={familiar.includes(c.id)} disabled={disabled||c.state!=='NOT_STARTED'} onChange={e=>onFamiliar(c.id,e.target.checked)}/>我近期完成过同结构课程，且已核对耐受情况（本次自报）</label></div>):<p className="mt-2 text-muted">没有当前档案已保存的结构化课程。</p>}</div>
  <p className="text-xs text-muted">熟悉勾选不替代疼痛、功能和恢复资料，也不能解除原有安全限制。</p>
  <div><b>候选差异（{view.result.candidates.length}）</b>{view.result.candidates.map(c=><div key={c.id} className="mt-2 rounded-card border border-line p-3"><p className="font-bold">{c.date} · {actions[c.action]}</p><p className="mt-1 text-muted">{c.reason}</p><CandidateDifference before={c.before} after={c.after}/><button type="button" className={button} disabled={disabled||prepareDisabled} onClick={()=>onPrepare(c.id)}>准备这份导出</button></div>)}</div>
 </div>
}
/** No auto-read, network call, schedule write or training start. */
export function TrainingModelPanel({revision}:{revision:number|string}){
 const [options,setOptions]=useState<WorkbenchOptions>({eventMeters:null,phase:'UNKNOWN',experience:'UNKNOWN',familiarSessionIds:[]})
 const optionsRef=useRef(options);optionsRef.current=options
 const [view,setView]=useState<TrainingModelWorkbench|null>(null),[proposal,setProposal]=useState<TrainingProposal|null>(null)
 const [receipt,setReceipt]=useState<TrainingExportReceipt|null>(null)
 const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[message,setMessage]=useState('')
 const guard=useRef(false),sequence=useRef(0),day=useRef(''),controller=useRef<ReturnType<typeof createTrainingConfirmation>|null>(null)
 useEffect(()=>{sequence.current++;setView(null);setProposal(null);setReceipt(null);setMessage('');controller.current=null;return()=>{sequence.current++}},[revision])
 const current=view?.input.context.athleteId===currentAthleteId()?view:null
 function change(next:WorkbenchOptions){optionsRef.current=next;setOptions(next);setDirty(true);setProposal(null);setMessage('本轮输入已变化，请重新读取后核对候选。')}
 async function act(work:()=>Promise<void>){if(guard.current)return;guard.current=true;setBusy(true);const token=sequence.current,owner=currentAthleteId();try{await work()}catch{if(token===sequence.current&&owner===currentAthleteId())setMessage('本机资料或确认记录未能可靠读取，尚未导出；原日程未修改。')}finally{guard.current=false;setBusy(false)}}
 async function read(){await act(async()=>{const owner=currentAthleteId(),token=sequence.current;day.current=localDay();const next=await readTrainingModelWorkbench(optionsRef.current,day.current);if(owner!==currentAthleteId()||token!==sequence.current)return;let receiptReadFailed=false;const saved=await createIndexedDbTrainingConfirmations().transact(owner,d=>Object.values(d.receipts).filter(r=>r.athleteId===owner&&r.kind==='CONFIRMED_EXPORT'&&r.scheduleWritten===false&&r.automaticExecution===false).sort((a,b)=>Date.parse(b.confirmedAt)-Date.parse(a.confirmedAt))[0]??null).catch(()=>{receiptReadFailed=true;return null});if(owner!==currentAthleteId()||token!==sequence.current)return;setReceipt(saved);setView(next);setDirty(false);setProposal(null);setMessage(receiptReadFailed?'训练资料已读取，但历史导出回执无法读取；不能据此认定没有回执。原日程未修改。':'已读取本机资料；请选择并核对一份候选，尚未写入日程。')})}
 function confirmation(){
  if(!controller.current){const owner=currentAthleteId();controller.current=createTrainingConfirmation({repository:createIndexedDbTrainingConfirmations(),loadInput:async()=>{
   if(owner!==currentAthleteId())throw Error('SUBJECT_CHANGED')
   const next=await readTrainingModelWorkbench(optionsRef.current,day.current)
   if(owner!==currentAthleteId())throw Error('SUBJECT_CHANGED')
   return next.input
  }})}return controller.current
 }
 async function prepare(id:string){await act(async()=>{if(!current||dirty)return;const owner=currentAthleteId(),result=await confirmation().prepare(id);if(owner!==currentAthleteId())return;if(result.ok){setProposal(result.value);setMessage('已准备这份结构导出；请再次核对完整差异后确认。')}else setMessage(`候选或资料已变化，未准备导出（${result.code}）。请重新读取。`)})}
 async function confirm(){await act(async()=>{if(!proposal||dirty)return;const token=sequence.current,owner=currentAthleteId(),result=await confirmation().confirm({proposalId:proposal.id,hash:proposal.hash,confirmation:'CONFIRM_TRAINING_EXPORT'});if(owner!==currentAthleteId()||token!==sequence.current)return;if(!result.ok){setMessage(`确认未完成（${result.code}），请重新读取核对；原日程未修改。`);return}setProposal(null);setReceipt(result.value);setMessage(download(result.value).message)})}
 return <details className="rounded-card border border-line bg-surface p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">训练模型与课表候选</summary>
  <p className="mt-2 text-sm text-muted">仅在本机核对已有课程。目标和阶段属于本轮意图；默认未知，不套用他人情况。尚未写入日程，也不会自动联网。</p>
  <div className="mt-3 grid gap-3 sm:grid-cols-3">
   <label className="text-sm">目标项目<select aria-label="本轮目标项目" className="mt-1 min-h-11 w-full rounded-card border border-line bg-bg px-2" value={options.eventMeters??''} disabled={busy} onChange={e=>change({...options,eventMeters:e.target.value?Number(e.target.value):null})}><option value="">未知</option>{[400,800,1500,3000,5000,10000].map(n=><option key={n} value={n}>{n}米</option>)}</select></label>
   <label className="text-sm">当前阶段<select aria-label="本轮训练阶段" className="mt-1 min-h-11 w-full rounded-card border border-line bg-bg px-2" value={options.phase} disabled={busy} onChange={e=>change({...options,phase:e.target.value as WorkbenchOptions['phase']})}>{Object.entries({UNKNOWN:'未知',BASE:'基础',BUILD:'建立',SPECIFIC:'专项',TAPER:'减量'}).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
   <label className="text-sm">训练经验<select aria-label="本轮训练经验" className="mt-1 min-h-11 w-full rounded-card border border-line bg-bg px-2" value={options.experience} disabled={busy} onChange={e=>change({...options,experience:e.target.value as WorkbenchOptions['experience']})}>{Object.entries({UNKNOWN:'未知',NOVICE:'初学',TRAINED:'有训练经历',ADVANCED:'长期系统训练'}).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
  </div>
  <button type="button" className={`${button} mt-3`} disabled={busy} onClick={()=>void read()}>{busy?'正在核对…':'读取本机资料 / 重新读取'}</button>
  {message?<p role="status" className="mt-3 break-words text-sm">{message}</p>:null}
  {receipt?.athleteId===currentAthleteId()?<button type="button" className={`${button} mt-2`} disabled={busy} onClick={()=>{if(receipt)setMessage(download(receipt).message)}}>再次下载已确认的JSON（不重复确认）</button>:null}
  {current?<TrainingModelReview view={current} familiar={options.familiarSessionIds??[]} disabled={busy} prepareDisabled={dirty} onFamiliar={(id,checked)=>change({...options,familiarSessionIds:checked?[...(options.familiarSessionIds??[]),id]:(options.familiarSessionIds??[]).filter(x=>x!==id)})} onPrepare={id=>void prepare(id)}/>:null}
  {proposal&&current?<div className="mt-3 rounded-card border border-accent p-3 text-sm"><b>再次核对并确认导出</b><p className="mt-1">{actions[proposal.candidate.action]}；有效至 {proposal.expiresAt}。确认后只保存本机导出回执。</p><CandidateDifference before={proposal.candidate.before} after={proposal.candidate.after}/><button type="button" className={`${button} mt-2`} disabled={busy||dirty} onClick={()=>void confirm()}>确认导出这份JSON（不写日程）</button></div>:null}
 </details>
}
