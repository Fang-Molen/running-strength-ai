import { projectAthleteEvidence } from './athlete-longitudinal-evidence.ts'
import type { AthleteEvidence } from './athlete-evidence-audit.ts'

/** K15 read-only gate: observations are not causal evidence or training authorization. */
export type SessionComparison = {
 status:'COMPARABLE_OBSERVATIONS'|'INSUFFICIENT_EVIDENCE'|'NOT_COMPARABLE'
 firstId?:string;lastId?:string;delta?:number;observations:number;reasons:string[]
 performanceImproved:'UNKNOWN';causalTrainingEffect:'UNKNOWN';trainingDecisionAuthorized:false
}
export function compareLongitudinalSessions(items:readonly AthleteEvidence[]):SessionComparison {
 const timeline=projectAthleteEvidence(items)
 const sessions=timeline.ordered.filter(x=>x.kind==='SESSION')
 const reasons:string[]=[]
 if(timeline.rejected.length) reasons.push('REJECTED_INVALID_RECORDS')
 if(timeline.conflicts.length) reasons.push('QUARANTINED_CONFLICTS')
 const base={observations:sessions.length,performanceImproved:'UNKNOWN' as const,causalTrainingEffect:'UNKNOWN' as const,trainingDecisionAuthorized:false as const}
 if(sessions.length<2) return {...base,status:'INSUFFICIENT_EVIDENCE',reasons:[...reasons,'FEWER_THAN_TWO_VALID_SESSIONS']}
 if(sessions.some(x=>x.value===null)) reasons.push('MISSING_SESSION_VALUE')
 if(sessions.some(x=>!x.unit?.trim())) reasons.push('MISSING_UNIT')
 if(sessions.some(x=>!x.context?.trim())) reasons.push('MISSING_PROTOCOL_CONTEXT')
 if(new Set(sessions.map(x=>x.unit?.trim().toLowerCase())).size!==1) reasons.push('UNIT_MISMATCH')
 if(new Set(sessions.map(x=>x.context?.trim().toLowerCase())).size!==1) reasons.push('PROTOCOL_CONTEXT_MISMATCH')
 if(new Set(sessions.map(x=>x.source)).size!==1) reasons.push('SOURCE_MISMATCH')
 if(sessions[0].date===sessions[sessions.length-1].date) reasons.push('SAME_DAY_ONLY')
 if(reasons.length) return {...base,status:'NOT_COMPARABLE',reasons:[...new Set(reasons)]}
 const first=sessions[0],last=sessions[sessions.length-1]
 return {...base,status:'COMPARABLE_OBSERVATIONS',firstId:first.id,lastId:last.id,delta:last.value!-first.value!,reasons:[]}
}
