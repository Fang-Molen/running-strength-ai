import type {FoodEntry} from './log'
import {currentAthleteId,loadEvents} from '../core/events'
import {getTrainingPlanSnapshot,listTrainingOccurrences} from '../core/occurrence'
import {getRunningPlanSnapshot} from '../core/running-plan'
import {occurrenceVoided} from '../core/training-correction'
export type SessionTime={id:string;kind:'RUNNING'|'STRENGTH'|'MIXED'|'UNKNOWN';startAt:string|null;endAt:string|null}
/** Native course windows only, with verified ownership and actual timestamps. */
export function currentSessionTimes(now=new Date()):SessionTime[]{
 const events=loadEvents(),athlete=currentAthleteId()
 return listTrainingOccurrences().flatMap(o=>{
  const start=events.find(e=>e.event_id===o.startEventId&&e.event_type==='TRAINING_STARTED')
  if(!start||start.athlete_id!==athlete||occurrenceVoided(o.trainingOccurrenceId)||!o.startedAt||new Date(o.startedAt).toDateString()!==now.toDateString())return []
  const running=!!getRunningPlanSnapshot(o.trainingOccurrenceId)?.components.some(c=>c.modality==='RUNNING')
  const strength=!!(o.trainingPlanSnapshotId&&getTrainingPlanSnapshot(o.trainingPlanSnapshotId)?.sets.length)
  const kind=running&&strength?'MIXED':running?'RUNNING':strength?'STRENGTH':'UNKNOWN'
  return [{id:o.trainingOccurrenceId,kind,startAt:o.startedAt,endAt:o.lifecycle==='COMPLETED'||o.lifecycle==='INTERRUPTED'?o.endedAt:null}]
 })
}
/** UI timing reference from the handoff. A matched meal is never nutritional adequacy. */
export function matchSessionMeals(sessions:readonly SessionTime[],entries:readonly FoodEntry[]){
 const timed=entries.filter(e=>e.eatenAt&&Number.isFinite(Date.parse(e.eatenAt)))
 return {untimed:entries.length-timed.length,sessions:sessions.map(s=>{
  const start=s.startAt?Date.parse(s.startAt):NaN,end=s.endAt?Date.parse(s.endAt):NaN
  const validEnd=Number.isFinite(start)&&Number.isFinite(end)&&end>=start
  const window=(a:number,b:number)=>!Number.isFinite(a)||!Number.isFinite(b)?{status:'UNKNOWN' as const,meals:[] as FoodEntry[]}:{status:'TIMED_RECORDS' as const,meals:timed.filter(e=>Date.parse(e.eatenAt!)>=a&&Date.parse(e.eatenAt!)<=b)}
  return {...s,before:window(start-3*3600000,start),after:window(validEnd?end:NaN,validEnd?end+2*3600000:NaN),adequacy:'UNKNOWN' as const}
 })}
}
