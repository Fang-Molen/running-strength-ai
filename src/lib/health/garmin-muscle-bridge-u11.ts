/** Explicit host adapter. Garmin watch HR cannot identify muscles or actual lift sets. */
type DeviceActivity={sourceIdentity?:string;startIso:string|null;sport:'RUNNING'|'STRENGTH'|'MIXED'|'UNKNOWN'}
import type {TrainingPart} from './muscle-recovery-u11'
export type Link={athleteId:string;occurrenceId:string;componentId:string;confirmed:boolean;runType?:TrainingPart['runType'];knownAt:string}
export function linkedGarminPart(activity:DeviceActivity,link:Link):TrainingPart|null{
 if(!link.confirmed||!link.athleteId||!link.occurrenceId||!link.componentId||!activity.sourceIdentity||!activity.startIso||!Number.isFinite(Date.parse(activity.startIso))||!Number.isFinite(Date.parse(link.knownAt)))return null
 if(!['RUNNING','STRENGTH'].includes(activity.sport))return null
 return {athleteId:link.athleteId,eventId:activity.sourceIdentity,occurrenceId:link.occurrenceId,componentId:link.componentId,modality:activity.sport==='RUNNING'?'RUN':'STRENGTH',occurredAt:activity.startIso,knownAt:link.knownAt,sourceId:activity.sourceIdentity,actual:'CONFIRMED',runType:link.runType??'UNKNOWN',exercises:[]}
}
/** Host supplies actual performed sets from verified training events, never planned exercise rows. */
export function confirmedStrengthPart(p:{athleteId:string;eventId:string;occurrenceId:string;componentId:string;occurredAt:string;knownAt:string;sourceId:string;sets:{catalogId?:string;name?:string;performedSets:number|null}[]}):TrainingPart{
 return {athleteId:p.athleteId,eventId:p.eventId,occurrenceId:p.occurrenceId,componentId:p.componentId,modality:'STRENGTH',occurredAt:p.occurredAt,knownAt:p.knownAt,sourceId:p.sourceId,actual:'CONFIRMED',exercises:p.sets.map(s=>({catalogId:s.catalogId,name:s.name,actualSets:s.performedSets,verified:true}))}
}
