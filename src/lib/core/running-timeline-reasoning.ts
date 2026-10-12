/** BUILD 45J: evidence-gated longitudinal context; no causal diagnosis or plan writes. */
import {assessRunningContext, type ExamContext} from './running-context-exam.ts';
export type LinkedObservation={trainingOccurrenceId:string;sourceEventId:string;value:number|null};
export type TimelineInput={session:ExamContext;previousSessions:LinkedObservation[];preRecovery:LinkedObservation[];postRpe:LinkedObservation[];recovery24h:LinkedObservation[];recovery48h:LinkedObservation[];painFlag:boolean};
export function reasonTrainingTimeline(input:TimelineInput){
 const current=input.session.trainingOccurrenceId;
 const assessment=assessRunningContext(input.session);
 const evidenceKeys=new Set<string>();
 const inspect=(name:keyof Pick<TimelineInput,'previousSessions'|'preRecovery'|'postRpe'|'recovery24h'|'recovery48h'>, expected:'current'|'previous')=>{
  const items=input[name];
  if(items.some(x=>!x.sourceEventId||!x.trainingOccurrenceId||!Number.isFinite(x.value as number)&&x.value!==null))return {status:'INVALID' as const,values:[] as number[],sources:[] as string[]};
  const matched=items.filter(x=>expected==='current'?x.trainingOccurrenceId===current:x.trainingOccurrenceId!==current);
  if(new Set(matched.map(x=>x.sourceEventId)).size!==matched.length||matched.some(x=>evidenceKeys.has(x.sourceEventId)))return {status:'DUPLICATE' as const,values:[] as number[],sources:[] as string[]};
  matched.forEach(x=>evidenceKeys.add(x.sourceEventId));
  const values=matched.filter(x=>x.value!==null).map(x=>x.value as number);
  return {status:values.length===1?'AVAILABLE' as const:values.length===0?'UNKNOWN' as const:'CONFLICT' as const,values,sources:matched.map(x=>x.sourceEventId)};
 };
 const previous=inspect('previousSessions','previous');
 const pre=inspect('preRecovery','current');
 const post=inspect('postRpe','current');
 const h24=inspect('recovery24h','current');
 const h48=inspect('recovery48h','current');
 const checks={previous,pre,post,h24,h48};
 const invalid=Object.values(checks).some(x=>x.status==='INVALID'||x.status==='DUPLICATE');
 const pain=input.painFlag||input.session.pain===true;
 return {status:invalid?'BLOCKED' as const:assessment.status==='OBSERVATION_ONLY'?'OBSERVATION_ONLY' as const:'INSUFFICIENT_EVIDENCE' as const,
  pattern:assessment.status==='OBSERVATION_ONLY'?assessment.pattern:'UNKNOWN', timeline:checks,
  safety:pain?'SAFETY_REVIEW' as const:'NO_PAIN_FLAG_REPORTED' as const,
  priorSessionCausedCurrentPerformance:'UNKNOWN' as const, fatigueDiagnosis:'UNKNOWN' as const,
  nextSessionPrescription:null,decision:'NONE' as const,writes:0 as const,
  caveats:['TEMPORAL_ASSOCIATION_NOT_CAUSATION','NO_AUTOMATIC_PLAN_CHANGE','MISSING_IS_NOT_NORMAL']};
}
