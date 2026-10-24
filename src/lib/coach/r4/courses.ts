import {currentAthleteId,loadEvents} from '../../core/events'
import {resolveScheduledCourse,scheduleExecutionId} from '../../ui/scheduled-execution'
import type {ScheduleEntry} from '../../ui/day-schedule-rules'

export function r4CourseStarted(entry:ScheduleEntry){
 const ids=[scheduleExecutionId(entry.id,'run'),scheduleExecutionId(entry.id,'strength')]
 return loadEvents().some(e=>e.athlete_id===currentAthleteId()&&ids.includes(String(e.payload.sessionId))&&['TRAINING_STARTED','TRAINING_COMPLETED','TRAINING_SET_COMPLETED','RUNNING_CONTINUOUS_COMPLETED'].includes(e.event_type))
}
/** Only self-contained saved courses can be moved. Missing templates stay missing. */
export function isR4CourseCandidate(entry:ScheduleEntry){
 if((entry.athleteId??'local')!==currentAthleteId()||entry.status!=='planned'||entry.actual||r4CourseStarted(entry)||!Number.isFinite(entry.minutes)||entry.minutes<=0)return false
 const course=resolveScheduledCourse(entry,{sessions:[]},[])
 return course.errors.length===0&&!!(course.run||course.strength)
}
