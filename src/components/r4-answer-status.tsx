import {useEffect,useState} from 'react'
import {readR4CoachAnswer} from '@/lib/coach/r4/answer'
import {ATHLETE_SCOPE_CHANGED,currentAthleteId,onAppEvent} from '@/lib/core/events'
import {R4CourseActions} from './r4-course-actions'
import type {ChatMessage} from '@/lib/strength/coach'

export function R4AnswerStatus({basis,onRefresh}:{basis:NonNullable<ChatMessage['r4Basis']>;onRefresh:(answer:NonNullable<ReturnType<typeof readR4CoachAnswer>>)=>void}){
 const [answer,setAnswer]=useState<ReturnType<typeof readR4CoachAnswer>>(null)
 const [state,setState]=useState<'CURRENT'|'STALE'|'UNAVAILABLE'>('CURRENT')
 useEffect(()=>{
  const check=()=>{try{const a=currentAthleteId()===basis.athleteId?readR4CoachAnswer(basis.question,new Date().toISOString(),basis.day):null;setAnswer(a);setState(!a?'UNAVAILABLE':a.basisVersion===basis.version?'CURRENT':'STALE')}catch{setAnswer(null);setState('UNAVAILABLE')}}
  check();const stop=onAppEvent(check),events=[ATHLETE_SCOPE_CHANGED,'fk-plan-doc-changed','storage','fk-food-changed','fk-personal-profile-changed','fk-training-corrected','fk-training-activities-changed','fk-schedule-changed','fk-health-changed','focus']
  for(const event of events)window.addEventListener(event,check)
  return()=>{stop();for(const event of events)window.removeEventListener(event,check)}
 },[basis])
 return <>{state==='CURRENT'?<p className="mt-2 text-xs text-muted">依据当前已保存条件与记录；知识参考不代表课程审批。</p>:<div className="mt-2 rounded-card border border-line p-2 text-xs" data-testid="r4-stale-answer"><p role="status">{state==='STALE'?'记录或个人条件已变化，原回答保留为历史，相关判断需要更新。':'当前依据无法完整读取，原回答不能当作最新结论。'}</p><button type="button" className="mt-2 min-h-11 font-bold" onClick={()=>{try{const a=readR4CoachAnswer(basis.question,new Date().toISOString(),basis.day);if(a&&a.athleteId===basis.athleteId)onRefresh(a)}catch{setState('UNAVAILABLE')}}}>按最新记录更新回答</button></div>}<R4CourseActions answer={answer} current={state==='CURRENT'} /></>
}
