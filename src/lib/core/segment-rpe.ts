import {dispatchEvent,loadEvents,currentAthleteId} from './events.ts'
import {getTrainingOccurrence,getTrainingPlanSnapshot} from './occurrence.ts'
import {projectRunningExecution} from './running-execution.ts'
import {occurrenceVoided} from './training-correction.ts'
import {projectActualSets} from './canonical.ts'
export type SegmentRpeIdentity={occurrenceId:string;unit:'RUNNING'|'STRENGTH';segmentId:string}
export const strengthRpeId=(moveId:string,setIndex:number)=>`move:${moveId}:set${setIndex}`
export const runRpeId=(s:{componentId:string;blockId:string;stepId:string;roundOrdinal:number;repeatOrdinal:number})=>`${s.componentId}/${s.blockId}/${s.stepId}:r${s.roundOrdinal}-s${s.repeatOrdinal}`
function knownSegment(i:SegmentRpeIdentity){
 if(occurrenceVoided(i.occurrenceId))return false
 const events=loadEvents(),occurrence=getTrainingOccurrence(i.occurrenceId),start=events.find(e=>e.event_id===occurrence?.startEventId)
 if(!start||start.athlete_id!==currentAthleteId())return false
 if(i.unit==='RUNNING')return projectRunningExecution(i.occurrenceId,events).repetitions.some(s=>runRpeId(s)===i.segmentId&&s.status==='COMPLETED')
 if(i.unit!=='STRENGTH'||occurrence?.planKnowledge!=='KNOWN'||!occurrence.trainingPlanSnapshotId)return false
 const snapshot=getTrainingPlanSnapshot(occurrence.trainingPlanSnapshotId)
 if(!snapshot)return false
 const attempts=events.filter(e=>e.event_type==='TRAINING_SET_COMPLETED'&&e.athlete_id===currentAthleteId()&&e.payload.trainingOccurrenceId===i.occurrenceId)
 return projectActualSets(snapshot,attempts).plannedSets.some(s=>strengthRpeId(s.moveId,s.setIndex)===i.segmentId&&s.status==='COMPLETED')
}
export function readSegmentRpe(i:SegmentRpeIdentity){
 if(!knownSegment(i))return null
 return loadEvents().filter(e=>e.event_type==='RPE_RECORDED'&&e.athlete_id===currentAthleteId()&&e.payload.evidenceType==='SET_RPE'&&e.payload.trainingOccurrenceId===i.occurrenceId&&e.payload.unit===i.unit&&e.payload.segmentId===i.segmentId&&typeof e.payload.value==='number'&&Number.isFinite(e.payload.value)&&e.payload.value>=0&&e.payload.value<=10).at(-1)??null
}
/** Append-only, exact segment identity, idempotent retries; never becomes SESSION_RPE. */
export function recordSegmentRpe(i:SegmentRpeIdentity,value:number){
 if(!Number.isFinite(value)||value<0||value>10||!knownSegment(i))return {ok:false as const,reason:'分段未确认完成或评分无效；已保存成绩保留，评分未保存。'}
 const previous=readSegmentRpe(i)
 if(previous?.payload.value===value)return {ok:true as const,eventId:previous.event_id,unchanged:true}
 const event=dispatchEvent('RPE_RECORDED',{evidenceType:'SET_RPE',trainingOccurrenceId:i.occurrenceId,unit:i.unit,segmentId:i.segmentId,value,supersedes:previous?.event_id??null},{source:'MANUAL'})
 return event&&readSegmentRpe(i)?.event_id===event.event_id?{ok:true as const,eventId:event.event_id,unchanged:false}:{ok:false as const,reason:'评分写入未核实；已完成成绩不受影响，请重试评分。'}
}
