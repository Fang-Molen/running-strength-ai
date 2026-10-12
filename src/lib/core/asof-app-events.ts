/** K20 read-only bridge to actual journal and correction contracts.
 * recordedAt is submission time; event.timestamp/correction.at are not substitutes.
 * Legacy/imported records without explicit submission metadata remain unknown.
 */
import { readJournal } from './storage-journal'
import { loadEvents, EVENT_JOURNAL_PREFIX } from './events'
import { listCorrections, type TrainingCorrection } from './training-correction'
import { validTimestamp, asOfDay } from './asof-event-ledger'
import type { AppEvent } from './types'

export type ObservedAppEvent = { event:AppEvent; recordedAt:string|null }
export function projectAsOfAppEvents(rows:readonly ObservedAppEvent[], corrections:readonly TrainingCorrection[], cutoff:string) {
 const base={cutoff,trainingDecisionAuthorized:false as const,clinicalClearance:'UNKNOWN' as const,originalDataModified:false as const}
 if(!validTimestamp(cutoff))return {...base,status:'INVALID_CUTOFF' as const,events:[] as AppEvent[],corrections:[] as TrainingCorrection[],issues:['INVALID_CUTOFF']}
 const limit=Date.parse(cutoff);const issues:string[]=[];const byId=new Map<string,AppEvent>();const quarantine=new Set<string>()
 for(const row of rows){
  if(!row.recordedAt || !validTimestamp(row.recordedAt)){issues.push('UNKNOWN_SUBMISSION_TIME');continue}
  if(Date.parse(row.recordedAt)>limit)continue
  const e=row.event
  if(!e.event_id || !validTimestamp(e.timestamp)){issues.push('INVALID_EVENT_TIME');continue}
  if(Date.parse(e.timestamp)>limit){issues.push('EVENT_OCCURRENCE_AFTER_CUTOFF');continue}
  const previous=byId.get(e.event_id)
  if(previous&&JSON.stringify(previous)!==JSON.stringify(e)){quarantine.add(e.event_id);issues.push('CONFLICTING_EVENT_ID');continue}
  byId.set(e.event_id,structuredClone(e))
 }
 const visible=[...byId.values()].filter(e=>!quarantine.has(e.event_id))
 const starts=new Set(visible.filter(e=>e.event_type==='TRAINING_STARTED').map(e=>e.event_id))
 const knownCorrections:TrainingCorrection[]=[];const correctionIds=new Map<string,TrainingCorrection>();const conflicts=new Set<string>()
 for(const row of corrections){
  if(!row.recordedAt || !validTimestamp(row.recordedAt)){issues.push('UNKNOWN_CORRECTION_SUBMISSION_TIME');continue}
  if(Date.parse(row.recordedAt)>limit)continue
  if(!validTimestamp(row.at) || Date.parse(row.at)>limit || !starts.has(row.trainingOccurrenceId)){issues.push('UNBOUND_OR_INVALID_CORRECTION');continue}
  const old=correctionIds.get(row.correctionId)
  if(old&&JSON.stringify(old)!==JSON.stringify(row)){conflicts.add(row.correctionId);issues.push('CONFLICTING_CORRECTION_ID')}
  else if(!old)correctionIds.set(row.correctionId,structuredClone(row))
 }
 for(const row of correctionIds.values())if(!conflicts.has(row.correctionId))knownCorrections.push(row)
 return {...base,status:issues.length?'NEEDS_RECONCILIATION' as const:'REVIEWABLE' as const,asOfTrainingDay:asOfDay(cutoff),events:visible,corrections:knownCorrections,issues:[...new Set(issues)]}
}
/** This returns filtered source records, not current-value projections. Consumers
 * must apply only these supplied corrections; global effectiveField() is forbidden
 * in historical evaluation because it would read today's correction store. */
export function readAsOfAppEvents(cutoff:string) {
 const physical=readJournal<AppEvent>(EVENT_JOURNAL_PREFIX)
 const rows:ObservedAppEvent[]=physical.map(x=>({event:x.data,recordedAt:x.recordedAt??null}))
 const journalIds=new Set(physical.map(x=>x.data.event_id))
 for(const event of loadEvents())if(!journalIds.has(event.event_id))rows.push({event,recordedAt:null})
 return projectAsOfAppEvents(rows,listCorrections(),cutoff)
}
