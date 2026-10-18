import {auditFeedbackRevision,reviewLongitudinalWindow} from './coach-evolution-v4-c10.ts'
import type {EvolutionSnapshot} from './coach-evolution-v4.ts'
import {adaptFormalEvidenceRows,reviewFormalEvidence,strictIso,type FormalEvidenceRow} from './coach-v4-c11-adapter.ts'

/** C12: historical replay by when a record became known, not simply when exercise happened. */
export type V4TimelinePoint={asOf:string;visibleFactCount:number;observedSessions:number;unrecordedWeeks:number;
 hypothesisStatus:'UNCONFIRMED';safety:'NONE'|'MEDICAL_REVIEW'|'EMERGENCY';
 excludedFutureOrBackfillCount:number;revisionReasonCodes:string[];adaptation:'UNKNOWN';decisionAuthorization:false}
export function replayFormalTimeline(input:{athleteId:string;question:string;rows:readonly FormalEvidenceRow[];checkpoints:readonly string[];weeks?:number}):V4TimelinePoint[]{
 if(input.checkpoints.length>20)throw Error('TOO_MANY_CHECKPOINTS')
 let previous:EvolutionSnapshot|undefined
 return input.checkpoints.map((asOf,index)=>{
  if(!strictIso(asOf)||index>0&&Date.parse(asOf)<=Date.parse(input.checkpoints[index-1]))throw Error('CHECKPOINTS_NOT_INCREASING')
  const {audit}=reviewFormalEvidence({athleteId:input.athleteId,asOf,question:input.question,rows:input.rows,prior:previous})
  const snapshot=audit.snapshot,weekly=reviewLongitudinalWindow(snapshot,input.weeks??4)
  const revisions=previous?auditFeedbackRevision(previous,snapshot).reasonCodes:[]
  previous=snapshot
  // Counts only: do not expose future source IDs or their values in the historical context.
  const all=adaptFormalEvidenceRows(input.rows,input.athleteId,asOf).evidence
  return {asOf,visibleFactCount:snapshot.active.length,
   observedSessions:new Set(snapshot.active.filter(x=>x.metric==='SPLIT_SECONDS'&&x.value!==null).map(x=>x.occurrenceId)).size,
   unrecordedWeeks:weekly.weeks.filter(x=>x.observedSplitCount===0).length,hypothesisStatus:'UNCONFIRMED',safety:snapshot.safety,
   excludedFutureOrBackfillCount:all.filter(x=>Date.parse(x.recordedAt)>Date.parse(asOf)||x.source!=='PLAN'&&Date.parse(x.eventAt)>Date.parse(asOf)).length,
   revisionReasonCodes:revisions,adaptation:'UNKNOWN',decisionAuthorization:false}
 })
}
