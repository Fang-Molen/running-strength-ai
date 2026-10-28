import { useEffect, useState } from 'react'
import { onlinePreviewIsCurrent, type OnlineAnswerBasis } from '@/lib/coach/online-session'
import { currentAthleteId } from '@/lib/core/events'
export function CoachOnlineAnswerStatus({basis}:{basis:OnlineAnswerBasis}){
 const [changed,setChanged]=useState(false)
 useEffect(()=>{
  const refresh=()=>setChanged(currentAthleteId()!==basis.owner||!onlinePreviewIsCurrent(basis,false))
  const events=['storage','fk-athlete-scope-changed','fk-health-changed','fk-training-corrected','fk-schedule-changed','fk-personal-profile-changed','fk-profile-changed','fk-cycle-changed','fk-food-changed']
  refresh();events.forEach(e=>window.addEventListener(e,refresh));return()=>events.forEach(e=>window.removeEventListener(e,refresh))
 },[basis])
 return changed?<p data-testid="online-answer-stale" className="mt-2 text-xs text-amber-600">本回答的相关资料已变化或暂不可核对；请重新分析后再参考。原回答保留，不代表当前建议。</p>:null
}
