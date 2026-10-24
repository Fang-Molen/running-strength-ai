import {useEffect,useState} from 'react'
import {Sheet} from './sheet'
import {R4CourseActions} from './r4-course-actions'
import {readR4CoachAnswer} from '@/lib/coach/r4/answer'
import {ATHLETE_SCOPE_CHANGED,currentAthleteId,onAppEvent} from '@/lib/core/events'

export function PlanCourseDateSheet({onClose}:{onClose:()=>void}){
 const [owner]=useState(currentAthleteId),[answer,setAnswer]=useState<ReturnType<typeof readR4CoachAnswer>>(null),[error,setError]=useState('')
 useEffect(()=>{
  const refresh=()=>{if(currentAthleteId()!==owner){onClose();return}try{setAnswer(readR4CoachAnswer('调整训练课表'));setError('')}catch{setAnswer(null);setError('课程或记录读取失败，请关闭后重试；原安排保留。')}}
  refresh();const off=onAppEvent(refresh),names=['storage','fk-schedule-changed','fk-training-corrected','fk-personal-profile-changed','fk-plan-doc-changed',ATHLETE_SCOPE_CHANGED]
  for(const name of names)window.addEventListener(name,refresh)
  return()=>{off();for(const name of names)window.removeEventListener(name,refresh)}
 },[owner,onClose])
 return <Sheet title="移动或交换训练" label="调整训练日期" onClose={onClose} footer={null}>
  <p className="text-sm text-muted">先选择课程，再选择空日期或另一节课程。确认前核对前后日期，动作、组数、重量和休息保持原样。</p>
  {error?<p role="alert" className="mt-3 text-sm">{error}</p>:answer?.courses.length?<R4CourseActions answer={answer} current origin="USER_CALENDAR" />:<p className="mt-4 text-sm">暂无可调整的课程。请先保存完整课程；已开始、完成或已记录结果的训练保留在原日期。</p>}
 </Sheet>
}
