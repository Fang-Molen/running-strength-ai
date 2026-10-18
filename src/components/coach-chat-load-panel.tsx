import { useState } from 'react'
import { chatLoadPreview, saveChatSessionLoad } from '@/lib/core/coach-chat-load'
import type { ImportSport } from '@/lib/core/training-import'
import { CoachSavedOfflineReview } from './coach-saved-offline-review'

export function CoachChatLoadPanel({ question, draftId, selectedOccurrenceId, onSaved }: { question: string; draftId: string; selectedOccurrenceId: string | null; onSaved: () => void }) {
  const [sport, setSport] = useState<ImportSport>('UNKNOWN')
  const [when, setWhen] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [savedOccurrenceId, setSavedOccurrenceId] = useState<string|null>(null)
  const [notice, setNotice] = useState('')
  const load = chatLoadPreview(question)
  if (!load) return null
  return <details data-testid="chat-load-save" className="rounded-card border border-line bg-surface p-3 text-sm">
    <summary className="min-h-11 cursor-pointer font-bold">{load.au} AU · {saved ? '已确认保存' : '聊天自报未保存'} · 保存入口</summary>
    <p>{load.rpe} × {load.minutes} 分钟 = {load.au} AU。只保存整课时长和整课 RPE，不补填工作组、分段或恢复状态。</p>
    {selectedOccurrenceId ? <p className="mt-2">当前已关联训练，请在原记录中补充或更正，避免再建立一份重复记录。</p> : <>
      <label className="mt-2 block">实际训练类型<select aria-label="聊天负荷训练类型" value={sport} onChange={e => setSport(e.target.value as ImportSport)} className="mt-1 min-h-11 w-full rounded-card border border-line bg-bg px-2"><option value="UNKNOWN">请选择</option><option value="RUNNING">跑步</option><option value="STRENGTH">力量</option></select></label>
      <label className="mt-2 block">实际训练时间（本机时区）<input aria-label="聊天负荷训练时间" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className="mt-1 min-h-11 w-full rounded-card border border-line bg-bg px-2" /></label>
      <label className="mt-2 flex min-h-11 items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>我确认这是尚未记录的新训练；时长包含热身、恢复和整理，评分是整课 RPE。</span></label>
      <button type="button" disabled={saved || !confirmed || !when || sport === 'UNKNOWN'} className="min-h-11 rounded-card border border-line px-3 font-bold disabled:opacity-40" onClick={() => {
        const time = new Date(when)
        const result = saveChatSessionLoad({ question, draftId, occurredAt: Number.isFinite(time.getTime()) ? time.toISOString() : '', sport, confirmedNewSession: confirmed, selectedOccurrenceId })
        if (result.ok) { setSaved(true); setSavedOccurrenceId(result.record.confirmedImportId); setNotice(result.duplicate ? '这条确认已保存，没有重复建立记录。' : '已保存本人确认的整课时长和整课RPE，可以在日志中查看。'); onSaved() }
        else setNotice(result.reason)
      }}>确认保存这次负荷</button>
    </>}
    {notice && <p role="status" className="mt-2">{notice}</p>}
    {savedOccurrenceId&&<CoachSavedOfflineReview occurrenceId={savedOccurrenceId}/>}
  </details>
}
