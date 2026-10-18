import { useState } from 'react'
import { listCoachAnswerFeedback, saveCoachAnswerFeedback, type CoachAnswerFeedback } from '@/lib/core/coach-feedback'

export function CoachAnswerFeedbackForm({messageId,answer}:{messageId:string;answer:string}){
 const [category,setCategory]=useState<CoachAnswerFeedback['category']>('FACT')
 const [note,setNote]=useState(''),[notice,setNotice]=useState('')
 const exportFeedback=()=>{
  const blob=new Blob([JSON.stringify({version:1,feedback:listCoachAnswerFeedback()},null,2)],{type:'application/json'})
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='方坤回答反馈.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 return <details data-testid="coach-feedback" className="mt-2 text-xs">
  <summary className="min-h-8 cursor-pointer text-muted">反馈这条回答</summary>
  <div className="space-y-2 pt-2">
   <p>反馈保存在本机，可导出后自行提供给维护者。</p>
   <select aria-label="回答反馈类型" value={category} onChange={e=>setCategory(e.target.value as CoachAnswerFeedback['category'])} className="h-10 rounded-card border border-line bg-surface px-2">
    <option value="FACT">记录或数字不对</option><option value="ADVICE">建议不合适</option><option value="CLARITY">没回答清楚</option><option value="OTHER">其他问题</option>
   </select>
   <textarea aria-label="回答反馈内容" value={note} maxLength={1000} onChange={e=>setNote(e.target.value)} placeholder="哪里不对，你期望怎样改进" className="min-h-20 w-full rounded-card border border-line bg-surface p-2" />
   <div className="flex flex-wrap gap-2"><button type="button" disabled={!note.trim()} className="min-h-10 rounded-card border border-line px-3 disabled:opacity-50" onClick={()=>{
    const ok=saveCoachAnswerFeedback({messageId,answer,category,note});setNotice(ok?'反馈已保存到本机。':'保存失败，请重试或复制内容留存。');if(ok)setNote('')
   }} data-testid="coach-feedback-save">保存反馈</button><button type="button" onClick={exportFeedback} className="min-h-10 rounded-card border border-line px-3">导出我的反馈</button></div>
   <p role="status">{notice}</p>
  </div>
 </details>
}
