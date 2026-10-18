import {useState} from 'react'
import {saveChatTraining,type ChatTraining} from '@/lib/core/coach-chat-evidence'
import {CoachSavedOfflineReview} from './coach-saved-offline-review'

export function CoachChatTrainingPanel({chat,selectedOccurrenceId,onSaved}:{chat:ChatTraining;selectedOccurrenceId:string|null;onSaved:(occurrenceId:string)=>void}){
 const [sport,setSport]=useState<'UNKNOWN'|'RUNNING'|'STRENGTH'|'MIXED'>('UNKNOWN')
 const [when,setWhen]=useState(''),[confirmed,setConfirmed]=useState(false),[notice,setNotice]=useState(''),[saved,setSaved]=useState<string|null>(null)
 return <details data-testid="chat-training-save" className="rounded-card border border-line bg-surface p-3 text-sm">
  <summary className="min-h-11 cursor-pointer py-2 font-bold">聊天自报 · {saved?'已保存':'未保存'} · 保存为训练</summary>
  <p>{chat.splits.length?`${chat.rounds}轮、${chat.splits.filter(s=>s.seconds!==null).length}段有成绩、${chat.splits.filter(s=>s.seconds===null).length}段未记。`:''}{chat.minutes!==null?`整课${chat.minutes}分钟。`:''}{chat.rpe!==null?`RPE ${chat.rpe}${chat.rpeAssumed?'暂按整课理解':''}。`:''}组间休息{chat.restSeconds??'未提供'}{chat.restSeconds!==null?'秒':''}，轮间休息{chat.roundRestSeconds??'未提供'}{chat.roundRestSeconds!==null?'秒':''}。</p>
  {chat.splits.length>0&&<p className="break-words">{chat.splits.map(s=>`第${s.round}轮第${s.repeat}次 ${s.meters}米/${s.seconds===null?'未记':s.seconds+'秒'}${s.excluded?'（异常待核对）':''}`).join('；')}</p>}
  {selectedOccurrenceId?<p>已经关联训练，请在原记录更正入口核对，避免重复保存。</p>:<>
   {!chat.splits.length&&<label className="mt-2 block">训练类型<select aria-label="自报训练类型" value={sport} onChange={e=>setSport(e.target.value as typeof sport)} className="mt-1 min-h-11 w-full rounded-card border border-line bg-bg px-2"><option value="UNKNOWN">待确认</option><option value="RUNNING">跑步</option><option value="STRENGTH">力量</option><option value="MIXED">混合</option></select></label>}
   <label className="mt-2 block">实际训练日期与时间<input aria-label="自报训练实际时间" type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)} className="mt-1 min-h-11 w-full rounded-card border border-line bg-bg px-2"/></label>
   <label className="mt-2 flex min-h-11 gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>我已核对每段、缺失和休息；这是未保存的新训练，时长为整课，RPE为整课评分。</span></label>
   <button type="button" disabled={!confirmed||!when||!!saved} className="min-h-11 rounded-card border border-line px-3 disabled:opacity-40" onClick={()=>{const time=new Date(when),r=saveChatTraining(chat,Number.isFinite(time.getTime())?time.toISOString():'',confirmed,sport);if(r.ok){setSaved(r.record.confirmedImportId);setNotice('已保存核对后的实际训练，原聊天仍保留。');onSaved(r.record.confirmedImportId)}else setNotice(r.reason)}}>确认保存为训练</button>
  </>}
  {notice&&<p role="status">{notice}</p>}
  {saved&&<CoachSavedOfflineReview occurrenceId={saved}/>}
 </details>
}
