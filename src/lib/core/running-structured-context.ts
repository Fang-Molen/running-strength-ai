/** BUILD 45G: read-only structure-aware sequence comparison; no persistence or prescriptions. */
import {observeRunningSequence, type RepEvidence} from './running-sequence-observation.ts';
export type StructuredRep=RepEvidence & {trainingOccurrenceId:string;componentId:string;blockId:string;round:number;step:number;restAfterSeconds?:number|null};
export type StructuredInput={trainingOccurrenceId:string;reps:StructuredRep[]};
export function observeStructuredRunning(input:StructuredInput){
 if(!input.trainingOccurrenceId) throw new Error('MISSING_OCCURRENCE_ID');
 const excluded=input.reps.filter(r=>r.trainingOccurrenceId!==input.trainingOccurrenceId).length;
 const reps=input.reps.filter(r=>r.trainingOccurrenceId===input.trainingOccurrenceId);
 if(reps.some(r=>!r.componentId||!r.blockId||!Number.isInteger(r.round)||r.round<1||!Number.isInteger(r.step)||r.step<1||!r.sourceEventId))return {status:'BLOCKED' as const,reason:'INVALID_STRUCTURE' as const,excluded,blocks:[],decision:'NONE' as const};
 if(new Set(reps.map(r=>r.sourceEventId)).size!==reps.length)return {status:'BLOCKED' as const,reason:'DUPLICATE_EVENT_ID' as const,excluded,blocks:[],decision:'NONE' as const};
 if(new Set(reps.map(r=>`${r.componentId}|${r.blockId}|${r.round}|${r.step}`)).size!==reps.length)return {status:'BLOCKED' as const,reason:'DUPLICATE_STEP' as const,excluded,blocks:[],decision:'NONE' as const};
 const groups=new Map<string,StructuredRep[]>();
 for(const r of reps){const k=JSON.stringify([r.componentId,r.blockId]);groups.set(k,[...(groups.get(k)||[]),r]);}
 const blocks=[...groups].map(([key,items])=>{
  const [componentId,blockId]=JSON.parse(key) as [string,string];
  const rounds=[...new Set(items.map(r=>r.round))].sort((a,b)=>a-b).map(round=>{
   const steps=items.filter(r=>r.round===round).sort((a,b)=>a.step-b.step);
   const byDistance=[...new Set(steps.map(r=>r.distanceMeters).filter(d=>d!=null))].map(distanceMeters=>{
    const matching=steps.filter(r=>r.distanceMeters===distanceMeters);
    return {distanceMeters,sequence:observeRunningSequence(matching.map((r,i)=>({...r,ordinal:i+1}))),sourceEventIds:matching.map(r=>r.sourceEventId)};
   });
   return {round,steps:steps.map(r=>({step:r.step,distanceMeters:r.distanceMeters,seconds:r.seconds,restAfterSeconds:r.restAfterSeconds??null,sourceEventId:r.sourceEventId})),byDistance};
  });
  const sameStepAcrossRounds=[...new Set(items.map(r=>r.step))].sort((a,b)=>a-b).map(step=>{
   const matching=items.filter(r=>r.step===step).sort((a,b)=>a.round-b.round);
   const distances=[...new Set(matching.map(r=>r.distanceMeters))];
   return {step,distanceMeters:distances.length===1?distances[0]:null,sequence:distances.length===1?observeRunningSequence(matching.map((r,i)=>({...r,ordinal:i+1}))):null,reason:distances.length===1?'OK':'DISTANCE_MISMATCH'};
  });
  return {componentId,blockId,rounds,sameStepAcrossRounds};
 });
 return {status:blocks.length?'READ_ONLY' as const:'UNAVAILABLE' as const,reason:'OBSERVATION_ONLY' as const,excluded,blocks,decision:'NONE' as const,caveats:['NO_CAUSAL_FATIGUE_INFERENCE','NO_PLAN_WRITE','NO_CROSS_DISTANCE_TIME_COMPARISON']};
}
