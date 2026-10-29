import {currentAthleteId,loadEvents} from '../core/events'
import {localDay,validDay} from './observation'

/** Daily self-report is distinct from feedback attached to a particular training. */
export function bodyCaptureContext(day:string){
 const rows=loadEvents().filter(e=>e.athlete_id===currentAthleteId()&&e.event_type==='SUBJECTIVE_FEEDBACK'&&!e.payload.trainingOccurrenceId)
  .filter(e=>{const d=typeof e.payload.date==='string'&&validDay(e.payload.date)?e.payload.date:Number.isFinite(Date.parse(e.timestamp))?localDay(new Date(e.timestamp)):null;return d===day})
  .flatMap(e=>{const p=e.payload,value=p.evidenceType==='SORENESS'?p.intensity:p.value;if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>10)return []
   if(p.evidenceType==='SUBJECTIVE_RECOVERY')return [{id:e.event_id,text:`恢复感受 ${value}/10`}]
   if(p.evidenceType==='SORENESS'&&typeof p.location==='string'&&p.location.trim())return [{id:e.event_id,text:`${p.location.trim().slice(0,24)}酸痛 ${value}/10`}]
   return []})
 return {rows,text:rows.length?`身体状态记录：${rows.slice(-3).map(r=>r.text).join('；')}${rows.length>3?`（另有${rows.length-3}项，需展开原记录核对）`:''}`:''}
}
