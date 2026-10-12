/** BUILD 45E: purpose-aware, read-only running repetition context. No prescriptions. */
import {observeRunningSequence, type RepEvidence} from './running-sequence-observation.ts';
export type SessionPurpose='EVEN_PACE'|'PROGRESSIVE_FASTER'|'PROGRESSIVE_SLOWER'|'UNSPECIFIED';
export type ContextRep=RepEvidence & {restAfterSeconds?:number|null; rpe?:number|null};
export type SessionContext={purpose:SessionPurpose; reps:ContextRep[]; preSessionRecovery?:number|null; postSessionRpe?:number|null; recovery24h?:number|null; recovery48h?:number|null};
export type ContextResult={status:'AVAILABLE'|'PARTIAL'|'UNAVAILABLE';purpose:SessionPurpose; sequence:ReturnType<typeof observeRunningSequence>; targetComparisons:{ordinal:number; actualSeconds:number; targetSeconds:number; deltaSeconds:number; sourceEventId:string}[]; purposeAlignment:'CONSISTENT'|'NOT_CONSISTENT'|'UNKNOWN'; contextAvailability:{preSession:boolean;restIntervals:number;postSession:boolean;recovery24h:boolean;recovery48h:boolean}; caveats:string[]; decision:'NONE';};
const valid=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
export function observeRunningSessionContext(input:SessionContext):ContextResult {
 const sequence=observeRunningSequence(input.reps);
 const reps=[...input.reps].sort((a,b)=>a.ordinal-b.ordinal);
 const targets=reps.filter(r=>valid(r.seconds)&&valid(r.targetSeconds)&&valid(r.distanceMeters)&&!!r.sourceEventId).map(r=>({ordinal:r.ordinal,actualSeconds:r.seconds!,targetSeconds:r.targetSeconds!,deltaSeconds:r.seconds!-r.targetSeconds!,sourceEventId:r.sourceEventId!}));
 const allComparable=sequence.status==='AVAILABLE'&&reps.length>=2;
 let purposeAlignment:ContextResult['purposeAlignment']='UNKNOWN';
 if(allComparable && input.purpose!=='UNSPECIFIED') {
  if(input.purpose==='EVEN_PACE') purposeAlignment=sequence.pattern==='STABLE'?'CONSISTENT':sequence.pattern==='UNKNOWN'?'UNKNOWN':'NOT_CONSISTENT';
  if(input.purpose==='PROGRESSIVE_FASTER') purposeAlignment=sequence.pattern==='FASTER'?'CONSISTENT':sequence.pattern==='UNKNOWN'?'UNKNOWN':'NOT_CONSISTENT';
  if(input.purpose==='PROGRESSIVE_SLOWER') purposeAlignment=sequence.pattern==='SLOWER'?'CONSISTENT':sequence.pattern==='UNKNOWN'?'UNKNOWN':'NOT_CONSISTENT';
 }
 const contextAvailability={preSession:valid(input.preSessionRecovery),restIntervals:reps.filter(r=>valid(r.restAfterSeconds)).length,postSession:valid(input.postSessionRpe),recovery24h:valid(input.recovery24h),recovery48h:valid(input.recovery48h)};
 const caveats=['OBSERVATION_NOT_CAUSATION','NO_FATIGUE_DIAGNOSIS','NO_AUTOMATIC_PLAN_CHANGE'];
 if(input.purpose==='UNSPECIFIED') caveats.push('PURPOSE_NOT_PROVIDED');
 if(reps.some(r=>r.targetSeconds==null)) caveats.push('TARGETS_INCOMPLETE');
 if(contextAvailability.restIntervals<Math.max(0,reps.length-1)) caveats.push('REST_CONTEXT_INCOMPLETE');
 if(!contextAvailability.recovery24h||!contextAvailability.recovery48h) caveats.push('FOLLOWUP_INCOMPLETE');
 return {status:sequence.status,purpose:input.purpose,sequence,targetComparisons:targets,purposeAlignment,contextAvailability,caveats,decision:'NONE'};
}
