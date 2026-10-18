import { useEffect, useState } from 'react'
import { currentAthleteId } from '@/lib/core/events'
import { loadPlan, blankPlan } from '@/lib/strength/model'
import { readOfflineWorkspace } from '@/lib/core/coach-offline-workspace'
import { saveOfflineReview } from '@/lib/core/coach-offline-loop'
import {StorageDurability} from './storage-durability'

/** Mounted by the completed-save flow, never by the fact writer or a model request. */
export function CoachSavedOfflineReview({occurrenceId}:{occurrenceId:string}){
 const [text,setText]=useState('正在本地核对已保存记录…'),[notice,setNotice]=useState('')
 useEffect(()=>{
  try{const {review}=readOfflineWorkspace(loadPlan()??blankPlan(),currentAthleteId(),occurrenceId);setText(review.text);setNotice(saveOfflineReview(review).ok?'判断和观察目标已保留，可在方坤复盘中补后续反馈。':'分析已生成，但判断历史未保存；训练记录不受影响。')}
  catch{setText('训练已保存，本次分析暂时无法读取完整记录。请在方坤复盘中重试。')}
 },[occurrenceId])
 return <section data-testid="saved-offline-review" className="mt-3 rounded-card border border-line bg-surface p-3 text-sm"><h3 className="font-bold">本地分析</h3><p className="mt-2 whitespace-pre-line break-words">{text}</p><p className="mt-2 text-xs text-muted">{notice}</p><StorageDurability/></section>
}
