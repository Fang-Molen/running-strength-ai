import {auditPersonalEvidence,type V4AuditedSnapshot} from './coach-evolution-v4-c10.ts'
import type {EvolutionEvidence,EvolutionMetric,EvolutionSnapshot,EvolutionSource} from './coach-evolution-v4.ts'

/** C11: explicit structured rows only. No implicit device, storage or user lookup. */
export type FormalEvidenceRow=Readonly<{
 recordId:string;athleteId:string;trainingOccurrenceId:string;sourceEventId:string;
 source:EvolutionSource;status:'OBSERVED'|'PLANNED'|'SKIPPED'|'NOT_RECORDED'|'VOIDED';
 metric:EvolutionMetric;value:number|null;unit:string;protocol:string;
 occurredAt:string;knownAt:string;supersedesRecordId?:string|null;
 measurement?:{method:string;segmentSourceId:string};
 unverifiedHeartRate?:{value:number;method:'UNKNOWN'};
 verifiedByFormalProjection:boolean
}>
export type AdaptationResult={evidence:EvolutionEvidence[];excluded:{recordId:string;reason:string}[];unverifiedRiskHints:string[];status:'EXPLICIT_ROWS_ONLY';writes:0}
const units:Record<EvolutionMetric,string>={SPLIT_SECONDS:'s',REST_SECONDS:'s',GOAL_SECONDS:'s',SLEEP_HOURS:'h',SESSION_RPE:'score',PAIN_SCORE:'score',SUBJECTIVE_RECOVERY:'score',SORENESS:'score',STRENGTH_REPS:'reps',STRENGTH_KG:'kg',STRENGTH_SECONDS:'s',HR_AVG_BPM:'bpm'}
export const strictIso=(v:string)=>{
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v))return false
 const [hour,minute,second]=v.slice(11,19).split(':').map(Number)
 if(hour>23||minute>59||second>59)return false
 if(!v.endsWith('Z')){
  const [offsetHour,offsetMinute]=v.slice(-5).split(':').map(Number)
  if(offsetHour>23||offsetMinute>59)return false
 }
 const n=Date.parse(v)
 if(!Number.isFinite(n))return false
 const [y,m,d]=v.slice(0,10).split('-').map(Number),date=new Date(Date.UTC(y,m-1,d))
 return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d
}
/** Planned, skipped and unrecorded are never silently promoted to completed observations. */
export function adaptFormalEvidenceRows(rows:readonly FormalEvidenceRow[],athleteId:string,asOf:string):AdaptationResult{
 if(!athleteId||!strictIso(asOf))throw Error('INVALID_ADAPTER_IDENTITY_OR_TIME')
 const evidence:EvolutionEvidence[]=[],excluded:AdaptationResult['excluded']=[],unverifiedRiskHints:string[]=[]
 for(const r of rows){
  const own=r.athleteId===athleteId,visible=strictIso(r.knownAt)&&strictIso(r.occurredAt)&&
   Date.parse(r.knownAt)<=Date.parse(asOf)&&Date.parse(r.occurredAt)<=Date.parse(asOf)
  // Never leak future symptoms or resurrect an explicitly voided record as a live risk hint.
  if(own&&r.source!=='THIRD_PARTY'&&visible&&r.status==='OBSERVED'&&r.metric==='PAIN_SCORE'&&typeof r.value==='number'&&Number.isFinite(r.value)&&r.value>0)
   unverifiedRiskHints.push(r.recordId)
  let reason:string|null=null
  if(!own||r.source==='THIRD_PARTY')reason='NOT_THIS_ATHLETE'
  else if(!r.recordId||!r.trainingOccurrenceId||!r.sourceEventId||!r.protocol.trim())reason='MISSING_PROVENANCE'
  else if(!strictIso(r.occurredAt)||!strictIso(r.knownAt))reason='INVALID_TIME'
  else if(['SKIPPED','NOT_RECORDED','VOIDED'].includes(r.status))reason='NOT_OBSERVED'
  else if(r.status==='PLANNED'&&(r.source!=='PLAN'||r.metric!=='GOAL_SECONDS'))reason='PLAN_NOT_OBSERVED'
  else if(r.status==='OBSERVED'&&(r.source==='PLAN'||r.metric==='GOAL_SECONDS'))reason='OBSERVATION_PLAN_CONFLICT'
  else if(r.metric==='PAIN_SCORE'&&r.source==='DEVICE')reason='DEVICE_CANNOT_ASSESS_SYMPTOM'
  else if(r.unit!==units[r.metric])reason='UNIT_MISMATCH'
  else if(r.value!==null&&(!Number.isFinite(r.value)||r.value<0))reason='INVALID_VALUE'
  else if(['SPLIT_SECONDS','GOAL_SECONDS'].includes(r.metric)&&r.value!==null&&r.value<=0)reason='INVALID_TIME_VALUE'
  else if(r.metric==='SLEEP_HOURS'&&r.value!==null&&r.value>24)reason='OUT_OF_RANGE'
  else if(['SESSION_RPE','PAIN_SCORE','SUBJECTIVE_RECOVERY','SORENESS'].includes(r.metric)&&r.value!==null&&r.value>10)reason='OUT_OF_RANGE'
  else if(r.metric==='HR_AVG_BPM'&&(!r.measurement?.method||!r.measurement.segmentSourceId||r.value===null||r.value<20||r.value>240))reason='HEART_RATE_PROVENANCE_MISSING'
  else if(r.supersedesRecordId===r.recordId)reason='SELF_CORRECTION'
  else if(r.status==='OBSERVED'&&Date.parse(r.knownAt)<Date.parse(r.occurredAt))reason='KNOWN_BEFORE_EVENT'
  if(reason){excluded.push({recordId:r.recordId,reason});continue}
  const confirmation:EvolutionEvidence['confirmation']=r.source==='TRAINING_FACT'&&r.verifiedByFormalProjection?'CONFIRMED':r.source==='USER_REPORT'?'USER_REPORTED':'UNVERIFIED'
  evidence.push({id:r.recordId,athleteId:r.athleteId,occurrenceId:r.trainingOccurrenceId,metric:r.metric,value:r.value,unit:r.unit,
   context:r.protocol,eventAt:r.occurredAt,recordedAt:r.knownAt,source:r.source,sourceId:r.sourceEventId,
   confirmation,supersedes:r.supersedesRecordId??null,...(r.unverifiedHeartRate&&r.metric==='SPLIT_SECONDS'&&Number.isFinite(r.unverifiedHeartRate.value)&&r.unverifiedHeartRate.value>=20&&r.unverifiedHeartRate.value<=240?{unverifiedHeartRate:r.unverifiedHeartRate}:{}),...(r.measurement?{measurement:r.measurement}:{})})
 }
 return {evidence,excluded,unverifiedRiskHints:[...new Set(unverifiedRiskHints)],status:'EXPLICIT_ROWS_ONLY',writes:0}
}
export type V4FormalReview={audit:V4AuditedSnapshot;adapter:AdaptationResult;safety:'NONE'|'MEDICAL_REVIEW'|'EMERGENCY';decisionAuthorization:false}
export function reviewFormalEvidence(input:{athleteId:string;asOf:string;question:string;rows:readonly FormalEvidenceRow[];prior?:EvolutionSnapshot;scopeOccurrenceIds?:readonly string[]}):V4FormalReview{
 const adapter=adaptFormalEvidenceRows(input.rows,input.athleteId,input.asOf)
 const audit=auditPersonalEvidence({athleteId:input.athleteId,asOf:input.asOf,question:input.question,evidence:adapter.evidence,prior:input.prior,scopeOccurrenceIds:input.scopeOccurrenceIds})
 // Invalid/voided symptom rows are not confirmed facts, but a visible positive risk hint must not vanish.
 const safety=audit.snapshot.safety==='EMERGENCY'?'EMERGENCY':audit.snapshot.safety==='MEDICAL_REVIEW'||adapter.unverifiedRiskHints.length?'MEDICAL_REVIEW':'NONE'
 if(safety==='MEDICAL_REVIEW'&&audit.snapshot.safety==='NONE')audit.snapshot={...audit.snapshot,safety:'MEDICAL_REVIEW',
  safetyMessage:'存在尚未核实的疼痛线索，不能据此宣布无痛；必要时寻求运动医学或康复专业评估。',nextAction:'MEDICAL_REVIEW'}
 return {adapter,audit,safety,decisionAuthorization:false}
}
