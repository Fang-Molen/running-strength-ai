import {useState,useEffect} from 'react'
import {currentAthleteId} from '@/lib/core/events'
// V88.2: prod has no athlete-switch event yet; listener is inert until one is added (owner is still re-checked on save).
const ATHLETE_SCOPE_CHANGED='fk-athlete-scope-changed'
import {HEALTH_CHANGED} from '@/lib/health/observation'
import {saveSelfReportedRest,restContextLines,REST_LABELS,readRestHistory,correctSelfReportedRest,type SelfRestInput} from '@/lib/health/rest-store'
import type {RestKind} from '@/lib/health/intraday/sleep'

/** Existing health card expansion; no timer claims to measure actual sleep. */
export function RestEntry({day,onSaved}:{day:string;onSaved:()=>void}) {
 const [kind,setKind]=useState<RestKind>('NAP'),[low,setLow]=useState(''),[high,setHigh]=useState(''),[message,setMessage]=useState('')
 const [draft,setDraft]=useState<SelfRestInput|null>(null),[revision,setRevision]=useState(0)
 const [editing,setEditing]=useState<{owner:string;origin:string;revision:number;requestId:string}|null>(null)
 useEffect(()=>{
  const refresh=()=>setRevision(x=>x+1),scope=()=>{setEditing(null);setDraft(null);setLow('');setHigh('');setMessage('');refresh()}
  window.addEventListener(HEALTH_CHANGED,refresh);window.addEventListener('storage',refresh);window.addEventListener(ATHLETE_SCOPE_CHANGED,scope)
  return ()=>{window.removeEventListener(HEALTH_CHANGED,refresh);window.removeEventListener('storage',refresh);window.removeEventListener(ATHLETE_SCOPE_CHANGED,scope)}
 },[])
 const commit=(input:SelfRestInput)=>{
  const result=saveSelfReportedRest(input)
  if(!result.ok){setDraft(input);setMessage('尚未保存，输入已保留。请核对档案和本机存储后重试。');return}
  setDraft(null);setLow('');setHigh('');setMessage('已保存到本机；未自动修改训练。');setRevision(x=>x+1);onSaved()
 }
 const save=async()=>{
  const l=low.trim(),h=high.trim()
  if(!l||!h||!Number.isFinite(Number(l))||!Number.isFinite(Number(h))||Number(l)<0||Number(h)<Number(l)){setMessage('填写估计的最少与最多分钟；不确定是否睡着请选“休息（是否睡着不清楚）”。');return}
  if(editing){
   const r=await correctSelfReportedRest({athleteId:editing.owner,originEventId:editing.origin,expectedRevision:editing.revision,requestId:editing.requestId,kind,duration:{low:Number(l),high:Number(h)},confirmation:'CORRECT_SELECTED_REST'})
   if(editing.owner!==currentAthleteId())return
   setMessage(r.ok?'更正已保存，旧版本和原始时间保留。':'更正未保存，输入保留；请检查记录版本或稍后重试。')
   if(r.ok){setEditing(null);setLow('');setHigh('');onSaved()}return
  }
  commit({athleteId:currentAthleteId(),requestId:crypto.randomUUID(),contextDay:day,kind,duration:{low:Number(l),high:Number(h)},start:null,end:null,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})
 }
 void revision
 return <details className="mt-2 text-xs"><summary className="fk-link cursor-pointer">补录睡眠或休息</summary>
  <div className="mt-2 flex flex-wrap gap-2">
   <select aria-label="休息类型" value={kind} onChange={e=>setKind(e.target.value as RestKind)}>{Object.entries(REST_LABELS).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>
   <input aria-label="休息最少分钟" inputMode="decimal" className="w-20 rounded border border-line p-1" value={low} onChange={e=>setLow(e.target.value)} placeholder="最少分钟"/>
   <input aria-label="休息最多分钟" inputMode="decimal" className="w-20 rounded border border-line p-1" value={high} onChange={e=>setHigh(e.target.value)} placeholder="最多分钟"/>
   <button type="button" className="fk-chip" onClick={save}>{editing?'确认更正此条休息记录':'保存休息记录'}</button>
   {editing&&<button type="button" className="fk-chip" onClick={()=>{setEditing(null);setLow('');setHigh('')}}>取消更正</button>}
  </div>
  <p className="mt-1 text-muted">仅记录你的估计，起止时间未知；安静休息不等于睡眠。</p>
  {message?<p role="status" className="mt-1">{message}{draft?<button type="button" className="fk-link ml-2" onClick={()=>commit(draft)}>重试休息记录</button>:null}</p>:null}
  {restContextLines(day).map((line,i)=><p key={i} className="mt-1 text-muted">{line}</p>)}
  {readRestHistory().selection?.records.filter(r=>r.contextDay===day&&r.form==='DURATION_ESTIMATE'&&r.transport==='SELF_REPORT').map(r=><button type="button" className="fk-chip mt-1" key={r.originEventId} onClick={()=>{
    if(!r.originEventId||!r.duration)return
    setEditing({owner:currentAthleteId(),origin:r.originEventId,revision:r.revision,requestId:crypto.randomUUID()})
    setKind(r.kind);setLow(String(r.duration.low));setHigh(r.duration.high===null?'':String(r.duration.high));setDraft(null);setMessage('正在更正选中记录，保存时追加版本，不删除原记录。')
  }}>更正 {REST_LABELS[r.kind]} · 第{r.revision}版 · {new Date(r.knownAt).toLocaleTimeString()}</button>)}
 </details>
}
