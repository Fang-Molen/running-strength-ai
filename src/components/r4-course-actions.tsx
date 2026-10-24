import {useState} from 'react'
import {currentAthleteId} from '@/lib/core/events'
import {loadSchedule} from '@/lib/ui/day-schedule'
import {previewR4CourseMove,confirmR4CourseMove,undoR4CourseMove,type R4CourseProposal,type CourseChangeOrigin} from '@/lib/coach/r4/course-flow'
import type {readR4CoachAnswer} from '@/lib/coach/r4/answer'

type Answer=NonNullable<ReturnType<typeof readR4CoachAnswer>>
/** The answer may propose a choice; only this explicit confirmation writes the calendar. */
export function R4CourseActions({answer,current,origin='COACH_REFERENCE',initialCourseId=''}:{answer:Answer|null;current:boolean;origin?:CourseChangeOrigin;initialCourseId?:string}){
 const [courseId,setCourseId]=useState(initialCourseId),[date,setDate]=useState(''),[proposal,setProposal]=useState<R4CourseProposal|null>(null)
 const [operation,setOperation]=useState<'MOVE'|'SWAP'>('MOVE'),[swapId,setSwapId]=useState(''),[reason,setReason]=useState('调整训练安排')
 const [receipt,setReceipt]=useState<{proposalId:string;entryId:string;athleteId:string}|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 const owned=!!answer&&answer.athleteId===currentAthleteId(),courses=owned?answer.courses:[]
 const receiptOwned=receipt?.athleteId===currentAthleteId()
 if(!owned||(!courses.length&&!receiptOwned))return null
 const selectedId=courseId||courses[0]?.id,otherCourses=courses.filter(c=>c.id!==selectedId),targetId=swapId||otherCourses[0]?.id
 const targetDate=operation==='SWAP'?otherCourses.find(c=>c.id===targetId)?.date??'':date
 const preview=()=>{try{if(!current)return;setProposal(previewR4CourseMove(answer.question,selectedId,targetDate,reason,origin));setMessage('请核对变更；尚未写入日历。')}catch(e){setProposal(null);setMessage(e instanceof Error?e.message:'暂时无法预览')}}
 const confirm=async()=>{
  if(!proposal||busy)return
  setBusy(true)
  try{const result=await confirmR4CourseMove(proposal,'CONFIRM_THIS_CHANGE');if(currentAthleteId()!==proposal.athleteId)return
   setMessage(result.ok?result.message:result.reason)
   if(result.ok){setReceipt({proposalId:proposal.id,entryId:proposal.after.id,athleteId:proposal.athleteId});setProposal(null)}
  }catch{setMessage('保存未核实，请核对日历后再继续。')}finally{setBusy(false)}
 }
 const undo=async()=>{
  if(!receipt||!receiptOwned||busy)return
  setBusy(true)
  try{const result=await undoR4CourseMove(receipt.proposalId,'UNDO_THIS_CHANGE');if(currentAthleteId()!==receipt.athleteId)return
   setMessage(result.ok?result.message:result.reason);if(result.ok)setReceipt(null)
  }catch{setMessage('撤销未核实，请核对日历。')}finally{setBusy(false)}
 }
 return <section className="mt-3 space-y-2 rounded-xl border border-line p-3 text-sm" aria-label="课程日期调整" data-testid="r4-course-actions">
  <p className="font-bold">移动日期或交换两节课</p>
  <p className="text-xs text-muted">只核对本机已有安排；请同时核对未记录的比赛、训练与恢复要求。</p>
  {current&&courses.length>0?<><label className="block">选择课程<select aria-label="选择要调整的课程" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2" value={selectedId} onChange={e=>{setCourseId(e.target.value);setProposal(null)}}>{courses.map(c=><option key={c.id} value={c.id}>{c.date} · {c.title}</option>)}</select></label>
   <div className="flex gap-2" role="group" aria-label="调整方式"><button type="button" className="fk-chip min-h-11" aria-pressed={operation==='MOVE'} onClick={()=>{setOperation('MOVE');setProposal(null)}}>移动到其他日期</button><button type="button" className="fk-chip min-h-11" aria-pressed={operation==='SWAP'} onClick={()=>{setOperation('SWAP');setProposal(null)}}>交换两节课</button></div>
   {operation==='SWAP'?<label className="block">与哪节课交换<select aria-label="选择交换课程" value={targetId??''} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2" onChange={e=>{setSwapId(e.target.value);setProposal(null)}}>{otherCourses.map(c=><option key={c.id} value={c.id}>{c.date} · {c.title}</option>)}</select>{!otherCourses.length?<span className="text-xs">暂无另一节可交换的课程。</span>:null}</label>:<label className="block">新日期<input aria-label="新日期" type="date" value={date} onChange={e=>{setDate(e.target.value);setProposal(null)}} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2" /></label>}
   <label className="block">调整原因<input aria-label="调整原因" maxLength={160} value={reason} onChange={e=>{setReason(e.target.value);setProposal(null)}} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2" /></label>
   <button type="button" disabled={busy||!targetDate||!reason.trim()} className="fk-chip min-h-11" onClick={preview}>预览日期变更</button></>:null}
  {proposal?<div data-testid="r4-course-preview" className="rounded-lg bg-surface-2 p-2"><p className="whitespace-pre-wrap">{proposal.diff}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy||!current} className="fk-primary min-h-11 px-3" onClick={()=>void confirm()}>{proposal.kind==='SWAP'?'确认两课对调':'确认写入日历'}</button><button type="button" disabled={busy} className="fk-chip min-h-11" onClick={()=>{setProposal(null);setMessage('已取消预览，日历未修改。')}}>取消变更</button></div></div>:null}
  {message?<p role="status" className="keep text-xs">{message}</p>:null}
  {receiptOwned?<div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="fk-chip min-h-11" onClick={()=>void undo()}>撤销本次日期调整</button><button type="button" className="fk-chip min-h-11" onClick={()=>{if(!receiptOwned)return;const entry=loadSchedule().entries.find(e=>e.id===receipt.entryId);if(entry)window.dispatchEvent(new CustomEvent('fk-open-scheduled',{detail:entry.id}));else setMessage('课程已改变，请重新核对日历。')}}>打开已确认课程</button></div>:null}
 </section>
}
