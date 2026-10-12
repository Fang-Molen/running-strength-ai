/** BUILD 45H: deterministic, read-only coaching comprehension guardrails. */
import {observeStructuredRunning, type StructuredInput} from './running-structured-context.ts';
export type ExamContext = StructuredInput & {goal?:'EVEN'|'PROGRESSIVE'|'UNSPECIFIED'; preRecovery?:number|null; postRpe?:number|null; pain?:boolean; nextSessionRequested?:boolean};
export function assessRunningContext(input:ExamContext){
 const observation=observeStructuredRunning(input);
 if(observation.status!=='READ_ONLY') return {status:'INSUFFICIENT_EVIDENCE' as const, reason:observation.reason, decision:'NONE' as const, observation};
 const relevant=input.reps.filter(r=>r.trainingOccurrenceId===input.trainingOccurrenceId);
 const valid=relevant.filter(r=>r.seconds!=null&&Number.isFinite(r.seconds)&&r.seconds>0&&r.distanceMeters!=null&&r.distanceMeters>0);
 const distances=new Set(valid.map(r=>r.distanceMeters));
 const ordered=[...valid].sort((a,b)=>a.round-b.round||a.step-b.step);
 const sameDistance=distances.size===1 && valid.length===relevant.length;
 const delta=sameDistance&&ordered.length>1?Number((ordered.at(-1)!.seconds!-ordered[0].seconds!).toFixed(3)):null;
 const pattern=delta===null?'UNKNOWN':delta>0?'SLOWER_FINISH':delta<0?'FASTER_FINISH':'EQUAL_ENDPOINTS';
 const goal=input.goal??'UNSPECIFIED';
 const goalAssessment=goal==='UNSPECIFIED'||delta===null?'UNKNOWN':goal==='EVEN'?(delta===0?'ENDPOINTS_MATCH':'ENDPOINTS_DIFFER'):(delta<0?'ENDPOINTS_SUPPORT_PROGRESSIVE':'ENDPOINTS_DO_NOT_SUPPORT_PROGRESSIVE');
 const safety=input.pain===true?'PAIN_REQUIRES_REVIEW':'NO_PAIN_FLAG_REPORTED';
 return {status:'OBSERVATION_ONLY' as const, pattern,deltaSeconds:delta,goal,goalAssessment,safety,preRecovery:input.preRecovery??null,postRpe:input.postRpe??null, decision:'NONE' as const, causalFatigue:'UNKNOWN' as const, nextSessionPrescription:null, observation};
}
