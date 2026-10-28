import type { OnlineConversationTurn } from '@/lib/coach/online-handoff'
import { useEffect, useRef, useState } from 'react'
import { prepareOnlineExplanation, runOnlineExplanation, onlinePreviewIsCurrent, type OnlinePreview, type OnlineAnswerBasis } from '@/lib/coach/online-session'
import { currentAthleteId } from '@/lib/core/events'

/** Every question has its own lifecycle. A later question never cancels an earlier one. */
export function CoachOnlineRequest({question,owner,disabled,selectedTrainingIds,conversation,onAnswer,onNotice,onDismiss}:{question:string;owner:string;disabled:boolean;selectedTrainingIds?:readonly string[];conversation?:readonly OnlineConversationTurn[];onAnswer:(text:string,owner:string,source:'LOCAL'|'MODEL',unverified?:boolean,basis?:OnlineAnswerBasis)=>void;onNotice:(text:string)=>void;onDismiss:()=>void}){
 const [status,setStatus]=useState('准备联网分析…'),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0)
 const active=useRef<AbortController|null>(null),started=useRef(-1)
 const callbacks=useRef({onNotice,onAnswer,onDismiss});callbacks.current={onNotice,onAnswer,onDismiss}
 useEffect(()=>{
  if(disabled){setBusy(false);setStatus('当前仅保留本地回答；联网选择已关闭或设备离线。');return}
  if(started.current===attempt)return
  let live=true,preview:OnlinePreview
  const controller=new AbortController();active.current=controller
  const show=(text:string)=>{if(live){setStatus(text);callbacks.current.onNotice(text)}}
  try{preview=prepareOnlineExplanation(question,selectedTrainingIds,conversation);if(preview.owner!==owner)throw Error('运动员已切换，本问未发送。')}
  catch(error){started.current=attempt;setBusy(false);show(error instanceof Error?error.message:'本问资料暂不可读取，本地回答保留。');return}
  const invalidate=()=>{if(!onlinePreviewIsCurrent(preview))controller.abort()}
  const events=['fk-athlete-scope-changed','fk-online-features-changed','offline','storage','fk-health-changed','fk-training-corrected','fk-schedule-changed','fk-personal-profile-changed','fk-profile-changed','fk-cycle-changed','fk-food-changed']
  events.forEach(e=>window.addEventListener(e,invalidate))
  setBusy(true);show('正在核验登录、相关资料与额度；本地回答已保留。')
  // Deferring the first dispatch lets React effect cleanup cancel a development
  // remount before any request is made; an already started attempt never auto-retries.
  queueMicrotask(()=>{
  if(!live)return
  started.current=attempt
  void runOnlineExplanation(preview,{signal:controller.signal}).then(result=>{
   if(!live)return
   setBusy(false)
   if(currentAthleteId()!==owner){callbacks.current.onDismiss();return}
   if('text'in result&&!controller.signal.aborted){
    const basis={conversation:preview.conversation,owner,question,day:preview.day,sourceVersion:preview.sourceVersion,selectedTrainingIds:preview.selectedTrainingIds}
    callbacks.current.onAnswer(result.text,owner,result.source,'unverified'in result&&result.unverified===true,basis)
    show(result.source==='LOCAL'?'本次由规则处理，未调用模型。':'联网解释已返回；未进行网页检索，未修改正式记录。')
    callbacks.current.onDismiss()
   }else show('error'in result?result.error:'本轮已取消，本地回答保留。')
  })
  })
  return()=>{live=false;controller.abort();events.forEach(e=>window.removeEventListener(e,invalidate))}
 },[question,owner,disabled,attempt,selectedTrainingIds,conversation])
 return <section data-testid="coach-online-request" className="mb-2 rounded-card border border-line p-3 text-xs">
  <p className="break-words"><b>{question}</b></p>
  <p role="status" className="mt-1">{status}</p>
  {!busy&&started.current>=0&&<button type="button" disabled={disabled} className="min-h-11 px-3" onClick={()=>setAttempt(n=>n+1)}>重新分析这一问</button>}
  <button type="button" className="min-h-11 px-3" onClick={()=>{active.current?.abort();onDismiss()}}>{busy?'取消本轮联网':'收起状态'}</button>
 </section>
}
