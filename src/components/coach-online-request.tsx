import { useEffect, useRef, useState } from 'react'
import { prepareOnlineExplanation, runOnlineExplanation, type OnlinePreview } from '@/lib/coach/online-session'
import { declarationQuote } from '@/lib/coach/online-contract'
import { currentAthleteId } from '@/lib/core/events'

/** Keeps the local answer visible while a separately confirmed explanation runs. */
export function CoachOnlineRequest({question,disabled,onAnswer,onNotice,onDismiss}:{question:string;disabled:boolean;onAnswer:(text:string,owner:string,source:'LOCAL'|'MODEL',unverified?:boolean)=>void;onNotice:(text:string)=>void;onDismiss:()=>void}){
 const [preview,setPreview]=useState<OnlinePreview|null>(null),[busy,setBusy]=useState(false)
 const active=useRef<AbortController|null>(null),mounted=useRef(true)
 const callbacks=useRef({onNotice,onAnswer,onDismiss});callbacks.current={onNotice,onAnswer,onDismiss}
 useEffect(()=>{
  mounted.current=true
  const invalidate=()=>{active.current?.abort();setPreview(null)}
  const events=['fk-athlete-scope-changed','fk-online-features-changed','offline','storage','fk-health-changed','fk-training-corrected','fk-schedule-changed','fk-personal-profile-changed','fk-profile-changed','fk-cycle-changed','fk-food-changed']
  events.forEach(e=>window.addEventListener(e,invalidate))
  return ()=>{mounted.current=false;active.current?.abort();events.forEach(e=>window.removeEventListener(e,invalidate))}
 },[])
 const prepare=()=>{try{setPreview(prepareOnlineExplanation(question));onNotice('请核对本次资料；点击同意后才会发送。')}catch(e){onNotice(e instanceof Error?e.message:'当前资料不可核对')}}
 const confirm=async()=>{
  if(!preview||busy)return
  const controller=new AbortController();active.current=controller;setBusy(true)
  onNotice('正在核验登录、授权快照和额度；本地回答已保留。')
  const result=await runOnlineExplanation(preview,{consent:true,signal:controller.signal})
  if(!mounted.current)return
  setBusy(false);setPreview(null);active.current=null
  if(currentAthleteId()!==preview.owner){callbacks.current.onDismiss();return}
  if('text'in result&&!controller.signal.aborted){callbacks.current.onAnswer(result.text,preview.owner,result.source,'unverified'in result&&result.unverified===true);callbacks.current.onNotice(result.source==='LOCAL'?'本次由规则处理，未调用模型；未修改课表或身体记录。':'模型输出通过事实与安全格式核验；未修改课表或身体记录。');callbacks.current.onDismiss()}
  else callbacks.current.onNotice('error'in result?result.error:'本轮已取消，本地回答保留。')
 }
 return <section data-testid="coach-online-request" className="mb-2 rounded-card border border-line p-3 text-xs">
  <p>可对这一问补充联网解释。需要有效登录和服务端额度，每次由你确认发送范围。</p>
  {preview?<div data-testid="coach-online-preview" className="mt-2 space-y-2">
   <p className="break-words"><b>本次问题：</b>{preview.question}</p>
   <p>仅选取近14天、最多6条本机人工或应用记录的时长、主观强度、睡眠及恢复反馈；全部作为未核验的用户申报。</p>
   {preview.declarations.length?<ul className="list-disc space-y-1 pl-4">{preview.declarations.map(d=><li className="break-words" key={`${d.recordId}:${d.metric}`}>{declarationQuote(d)}</li>)}</ul>:<p>本次没有可发送的上述记录，仅发送问题；资料不足不能推算配速或训练量。</p>}
   <p>未发送设备明细、训练分段、力量组次、饮食及正式课表。另有{preview.omittedRecords}条记录不在本次范围内，不能视为不存在。模型仅解释，不执行修改。</p>
   <button type="button" className="min-h-11 rounded-card border border-line px-3 font-bold" disabled={disabled||busy} onClick={()=>void confirm()}>同意发送这些资料</button>
  </div>:<button type="button" className="mt-2 min-h-11 rounded-card border border-line px-3" disabled={disabled||busy} onClick={prepare}>核对资料并联网解释</button>}
  <button type="button" className="min-h-11 px-3" onClick={()=>{active.current?.abort();onNotice('本轮已取消，本地回答保留。');onDismiss()}}>{busy?'取消本轮联网':'暂不使用'}</button>
 </section>
}
