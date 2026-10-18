import type {FormalEvidenceRow} from './coach-v4-c11-adapter.ts'
import {strictIso} from './coach-v4-c11-adapter.ts'
import type {EvolutionMetric,EvolutionSource} from './coach-evolution-v4.ts'
import type {RunningExecutionProjection} from './running-execution.ts'
import type {TrainingCorrection} from './training-correction.ts'

/**
 * R2 step 1: read-only FormalEvidenceRow construction from committed training events and the
 * effective correction projection. Pure: no storage, no network, no writes.
 * - knownAt is ONLY the journal/correction commit time (recordedAt). Missing => row is NOT emitted and
 *   the event id is listed in unknownCommitTime. It is never derived from the training date, `at` or order.
 * - Other athletes' events are never emitted (isolation before anything leaves the device).
 */
export type CommittedEvent={event:{event_id?:string;athlete_id?:string;timestamp?:string;event_type:string;source?:string;payload?:Record<string,unknown>};recordedAt:string|null}
export type FormalRowsResult={rows:FormalEvidenceRow[];unknownCommitTime:string[];otherAthleteSkipped:number;
 excluded:{id:string;reason:string}[];corrections:{applied:string[];pendingAfterAsOf:string[];unknownCommitTime:string[];unmapped:string[]};writes:0}
const SCALAR:Record<string,{metric:EvolutionMetric;unit:string;key:string[]}>={
 SESSION_RPE:{metric:'SESSION_RPE',unit:'score',key:['value','rpe']},SLEEP:{metric:'SLEEP_HOURS',unit:'h',key:['hours','value']},PAIN:{metric:'PAIN_SCORE',unit:'score',key:['intensity']},SUBJECTIVE_RECOVERY:{metric:'SUBJECTIVE_RECOVERY',unit:'score',key:['value']},SORENESS:{metric:'SORENESS',unit:'score',key:['intensity']}}
function evidenceType(e:CommittedEvent['event']):string|null{
 if(!['EVIDENCE_RECORDED','RPE_RECORDED','PAIN_RECORDED','SLEEP_RECORDED'].includes(e.event_type))return null
 const n=e.payload?.evidenceType
 if(typeof n==='string'&&n in SCALAR)return n
 if(e.event_type==='PAIN_RECORDED')return 'PAIN'
 if(e.event_type==='SLEEP_RECORDED')return 'SLEEP'
 return null
}
function mapSource(s:string|undefined):{source:EvolutionSource;verified:boolean}|null{
 if(s==='MANUAL')return {source:'TRAINING_FACT',verified:true}
 if(s==='DEVICE')return {source:'DEVICE',verified:false}
 if(s==='IMPORT')return {source:'USER_REPORT',verified:false}
 return null // AI_PREFILL / SYSTEM / unknown are not athlete facts
}
const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null
const t=(v:string)=>Date.parse(v)
export function runningSlotKey(s:{blockId:string;stepId:string;roundOrdinal:number;repeatOrdinal:number}){return `rep:${s.blockId}:${s.stepId}:${s.roundOrdinal}:${s.repeatOrdinal}`}

export function buildFormalEvidenceRows(input:{athleteId:string;asOf:string;committed:readonly CommittedEvent[];
 corrections:readonly TrainingCorrection[];running?:Readonly<Record<string,RunningExecutionProjection>>}):FormalRowsResult{
 const {athleteId,asOf}=input
 if(!athleteId||!strictIso(asOf))throw Error('INVALID_ROWS_IDENTITY_OR_TIME')
 const res:FormalRowsResult={rows:[],unknownCommitTime:[],otherAthleteSkipped:0,excluded:[],corrections:{applied:[],pendingAfterAsOf:[],unknownCommitTime:[],unmapped:[]},writes:0}
 const byId=new Map<string,CommittedEvent>()
 const starts=new Map<string,CommittedEvent>()
 const conflictingIds=new Set<string>()
 for(const c of input.committed){
  const id=c.event.event_id
  if(!id)continue
  if(c.event.athlete_id!==athleteId){res.otherAthleteSkipped++;continue}
  if(!c.recordedAt||!strictIso(c.recordedAt)){res.unknownCommitTime.push(id);continue}
  if(t(c.recordedAt)>t(asOf))continue
  if(!c.event.timestamp||!strictIso(c.event.timestamp)){res.excluded.push({id,reason:'INVALID_EVENT_TIME'});continue}
  if(t(c.event.timestamp)>t(asOf))continue
  if(t(c.recordedAt)<t(c.event.timestamp)){res.excluded.push({id,reason:'KNOWN_BEFORE_EVENT'});continue}
  const previous=byId.get(id)
  if(previous&&JSON.stringify(previous)!==JSON.stringify(c))conflictingIds.add(id)
  else if(!previous)byId.set(id,c)
 }
 for(const id of conflictingIds){byId.delete(id);res.excluded.push({id,reason:'CONFLICTING_EVENT_ID'})}
 for(const [id,c] of byId)if(c.event.event_type==='TRAINING_STARTED')starts.set(id,c)
 // Occurrence ownership: the start event must belong to this athlete (else bound records are rejected).
 const occOk=(occ:unknown):occ is string=>typeof occ==='string'&&starts.has(occ)
 const draft:FormalEvidenceRow[]=[]
 const commit=(c:CommittedEvent)=>c.recordedAt&&strictIso(c.recordedAt)?c.recordedAt:null
 // 1) Bound subjective evidence (same binding rule as evidence.ts projectEvidence).
 const groups=new Map<string,CommittedEvent[]>()
 for(const c of byId.values()){
  const type=evidenceType(c.event);if(!type)continue
  const occ=c.event.payload?.trainingOccurrenceId
  if(!occOk(occ)){res.excluded.push({id:c.event.event_id!,reason:'UNBOUND_OR_FOREIGN_OCCURRENCE'});continue}
  const horizon=type==='SUBJECTIVE_RECOVERY'&&['24H','48H'].includes(String(c.event.payload?.horizon))?String(c.event.payload?.horizon):'session'
  const k=`${occ}|${type}|${horizon}`;groups.set(k,[...(groups.get(k)??[]),c])
 }
 for(const [k,list] of groups){
  const [occ,type,horizon]=k.split('|'),spec=SCALAR[type]
  for(const c of list){
   const id=c.event.event_id!,src=mapSource(c.event.source)
   if(!src){res.excluded.push({id,reason:'NOT_ATHLETE_FACT_SOURCE'});continue}
   const knownAt=commit(c)
   if(!knownAt){res.unknownCommitTime.push(id);continue}
   let value:number|null=null
   for(const key of spec.key){const v=num(c.event.payload?.[key]);if(v!==null){value=v;break}}
   if(value===null&&type!=='PAIN'&&type!=='SORENESS'){res.excluded.push({id,reason:'NO_VALUE'});continue}
   // Several records for one endpoint share one recordId so the V4 core quarantines them instead of picking one.
   draft.push({recordId:list.length>1?`${occ}#${type}${horizon==='session'?'':`#${horizon}`}`:id,athleteId,trainingOccurrenceId:occ,sourceEventId:id,source:src.source,status:'OBSERVED',
    metric:spec.metric,value,unit:spec.unit,protocol:`${type.toLowerCase()}:${horizon}`,occurredAt:String(c.event.timestamp??''),knownAt,supersedesRecordId:null,
    verifiedByFormalProjection:src.verified})
  }
 }
 // 2) Running execution slots (planned vs observed vs skipped kept apart).
 for(const [occ,proj] of Object.entries(input.running??{})){
  if(!starts.has(occ)||proj.availability!=='AVAILABLE')continue
  const start=starts.get(occ)!,startKnown=commit(start)
  for(const s of proj.repetitions){
   const key=runningSlotKey(s),rid=`${occ}#${key}`,protocol=`running:${s.componentId}:${key}`
   if(s.plannedDurationSeconds&&startKnown)draft.push({recordId:`${rid}#goal`,athleteId,trainingOccurrenceId:occ,sourceEventId:start.event.event_id!,source:'PLAN',status:'PLANNED',
    metric:'GOAL_SECONDS',value:s.plannedDurationSeconds,unit:'s',protocol,occurredAt:String(start.event.timestamp??''),knownAt:startKnown,verifiedByFormalProjection:true})
   for(const eid of s.sourceEventIds){
    const c=byId.get(eid);if(!c)continue
    if(c.event.payload?.trainingOccurrenceId!==occ||s.trainingOccurrenceId!==occ||!['RUNNING_REPETITION_COMPLETED','RUNNING_REPETITION_SKIPPED'].includes(c.event.event_type)){
     res.excluded.push({id:eid,reason:'RUNNING_SOURCE_BINDING_MISMATCH'});continue
    }
    const knownAt=commit(c);if(!knownAt){res.unknownCommitTime.push(eid);continue}
    const skipped=c.event.event_type==='RUNNING_REPETITION_SKIPPED',src=mapSource(c.event.source)
    if(!src){res.excluded.push({id:eid,reason:'NOT_ATHLETE_FACT_SOURCE'});continue}
    const value=skipped?null:num(c.event.payload?.actualDurationSeconds)
    const distance=num(c.event.payload?.actualDistanceMeters)
    if(!skipped&&value===null)continue
    // DUPLICATE_UNRESOLVED slots keep the shared recordId => DIVERGENT_DUPLICATE_ID quarantine in the core.
    draft.push({recordId:rid,athleteId,trainingOccurrenceId:occ,sourceEventId:eid,source:src.source,status:skipped?'SKIPPED':'OBSERVED',
     metric:'SPLIT_SECONDS',value,unit:'s',protocol:distance!==null&&distance>0?`${protocol}:${distance}m`:protocol,occurredAt:String(c.event.timestamp??''),knownAt,supersedesRecordId:null,verifiedByFormalProjection:src.verified})
   }
  }
  for(const s of proj.continuous??[]){
   for(const eid of s.sourceEventIds){
    const c=byId.get(eid);if(!c||c.event.event_type!=='RUNNING_CONTINUOUS_COMPLETED'||c.event.payload?.trainingOccurrenceId!==occ||c.event.payload?.componentId!==s.componentId)continue
    const src=mapSource(c.event.source),seconds=num(c.event.payload?.actualDurationSeconds),distance=num(c.event.payload?.actualDistanceMeters)
    if(!src||seconds===null)continue
    draft.push({recordId:`${occ}#continuous:${s.componentId}`,athleteId,trainingOccurrenceId:occ,sourceEventId:eid,source:src.source,status:'OBSERVED',metric:'SPLIT_SECONDS',value:seconds,unit:'s',protocol:`running:${s.componentId}:continuous${distance!==null&&distance>0?`:${distance}m`:''}`,occurredAt:c.event.timestamp!,knownAt:c.recordedAt!,verifiedByFormalProjection:src.verified})
   }
  }
  for(const r of proj.recoveries){
   if(r.status!=='RECORDED'&&r.status!=='DUPLICATE_UNRESOLVED')continue
   const key=`rest:${r.blockId}:${r.kind}:${r.stepId??'-'}:${r.roundOrdinal??r.afterRoundOrdinal??'-'}:${r.afterRepeatOrdinal??'-'}`
   for(const eid of r.sourceEventIds){
    const c=byId.get(eid);if(!c)continue
    if(c.event.payload?.trainingOccurrenceId!==occ||c.event.event_type!=='RUNNING_RECOVERY_RECORDED'){
     res.excluded.push({id:eid,reason:'RUNNING_SOURCE_BINDING_MISMATCH'});continue
    }
    const knownAt=commit(c);if(!knownAt){res.unknownCommitTime.push(eid);continue}
    const src=mapSource(c.event.source);if(!src)continue
    draft.push({recordId:`${occ}#${key}`,athleteId,trainingOccurrenceId:occ,sourceEventId:eid,source:src.source,status:'OBSERVED',metric:'REST_SECONDS',
     value:num(c.event.payload?.actualRecoverySeconds),unit:'s',protocol:`running:${r.componentId}:${key}`,occurredAt:String(c.event.timestamp??''),knownAt,verifiedByFormalProjection:src.verified})
   }
  }
 }
 // Strength actual fields are separately addressable; planned values never fill missing actuals.
 for(const c of byId.values()){
  const p=c.event.payload,occ=p?.trainingOccurrenceId
  if(c.event.event_type!=='TRAINING_SET_COMPLETED'||!occOk(occ)||typeof p?.moveId!=='string'||!Number.isInteger(p.setIndex)||Number(p.setIndex)<1)continue
  const src=mapSource(c.event.source);if(!src)continue
  const protocol=`strength:${encodeURIComponent(p.moveId)}:${p.setIndex}`
  const status=p.skipped===true?'SKIPPED':p.completed===true?'OBSERVED':'NOT_RECORDED'
  const values:[EvolutionMetric,string,unknown][]=[['STRENGTH_KG','kg',p.actualWeight],[p.mode==='seconds'?'STRENGTH_SECONDS':'STRENGTH_REPS',p.mode==='seconds'?'s':'reps',p.actualAmount]]
  for(const [metric,unit,raw] of values){
   const value=num(raw);if(value===null&&status==='OBSERVED')continue
   draft.push({recordId:`${occ}#${protocol}:${metric}`,athleteId,trainingOccurrenceId:occ,sourceEventId:`${c.event.event_id}:${metric}`,source:src.source,status,metric,value:status==='OBSERVED'?value:null,unit,protocol,occurredAt:c.event.timestamp!,knownAt:c.recordedAt!,verifiedByFormalProjection:src.verified})
  }
 }
 // 3) Effective corrections as of asOf, ordered by commit time.
 const mine=input.corrections.filter(c=>starts.has(c.trainingOccurrenceId))
 const unknownOcc=new Set<string>(),voided=new Map<string,{at:string}|null>(),lastRow=new Map<string,FormalEvidenceRow>()
 const known=mine.filter(c=>{
  if(!c.recordedAt||!strictIso(c.recordedAt)){res.corrections.unknownCommitTime.push(c.correctionId);unknownOcc.add(c.trainingOccurrenceId);return false}
  if(t(c.recordedAt)>t(asOf)){res.corrections.pendingAfterAsOf.push(c.correctionId);return false}
  return true
 }).sort((a,b)=>t(a.recordedAt!)-t(b.recordedAt!)||a.correctionId.localeCompare(b.correctionId))
 const out:FormalEvidenceRow[]=[]
 for(const r of draft)lastRow.set(r.recordId,r)
 const unboundSplit=new Set<string>()
 for(const c of known){
  if(c.kind==='VOID'){voided.set(c.trainingOccurrenceId,{at:c.recordedAt!});res.corrections.applied.push(c.correctionId);continue}
  if(c.kind==='RESTORE'){voided.set(c.trainingOccurrenceId,null);res.corrections.applied.push(c.correctionId);continue}
  if((c.field==='weight'||c.field==='reps')&&c.setKey){
   const split=c.setKey.lastIndexOf(':'),move=c.setKey.slice(0,split),ordinal=c.setKey.slice(split+1)
   const metric=c.field==='weight'?'STRENGTH_KG':'STRENGTH_REPS',rid=`${c.trainingOccurrenceId}#strength:${encodeURIComponent(move)}:${ordinal}:${metric}`
   const prev=lastRow.get(rid),v=/^\d+(?:\.\d+)?$/.test(c.newValue.trim())?Number(c.newValue):null
   if(prev){
    const value=v!==null&&Number.isFinite(v)&&(metric!=='STRENGTH_REPS'||Number.isInteger(v))?v:null
    const next:FormalEvidenceRow={...prev,recordId:`${rid}@${c.correctionId}`,sourceEventId:c.correctionId,source:'TRAINING_FACT',value,knownAt:c.recordedAt!,supersedesRecordId:prev.recordId,verifiedByFormalProjection:true}
    out.push(next);lastRow.set(rid,next);res.corrections.applied.push(c.correctionId);continue
   }
  }
  if((c.field==='duration'||c.field==='distance')&&c.setKey){
   // The native log binds edits to the original event; formal rows bind to the
   // plan slot. Resolve only one observed row owned by this occurrence.
   const native=c.setKey.startsWith('run-event:')
   const matches=native?draft.filter(r=>r.trainingOccurrenceId===c.trainingOccurrenceId&&r.metric==='SPLIT_SECONDS'&&r.status==='OBSERVED'&&r.sourceEventId===c.setKey!.slice('run-event:'.length)):[]
   const rid=native?(matches.length===1&&draft.filter(r=>r.recordId===matches[0].recordId).length===1?matches[0].recordId:null):`${c.trainingOccurrenceId}#${c.setKey}`
   const prev=rid?lastRow.get(rid):null,v=/^\d+(?:\.\d+)?$/.test(c.newValue.trim())?Number(c.newValue):null
   const oldDistance=prev?.protocol?.match(/:(\d+(?:\.\d+)?)m$/)
   const previous=c.field==='duration'?prev?.value:oldDistance?Number(oldDistance[1]):null
   const originalMatches=!native||(previous!==null&&Number(c.originalValue)===previous&&c.originalValue.trim()!=='')
   if(prev&&prev.metric==='SPLIT_SECONDS'&&prev.status==='OBSERVED'&&v!==null&&Number.isFinite(v)&&v>0&&originalMatches&&(c.field==='duration'||oldDistance)){
    const next:FormalEvidenceRow={...prev,recordId:`${rid}@${c.correctionId}`,sourceEventId:c.correctionId,source:'TRAINING_FACT',value:c.field==='duration'?v:prev.value,
     protocol:c.field==='distance'?prev.protocol!.replace(/:\d+(?:\.\d+)?m$/,`:${v}m`):prev.protocol,
     knownAt:c.recordedAt!,supersedesRecordId:prev.recordId,verifiedByFormalProjection:true}
    out.push(next);lastRow.set(rid!,next);res.corrections.applied.push(c.correctionId);continue
   }
  }
  // Fields without a reliable slot binding: fail closed for that occurrence's running splits.
  if(c.field==='duration'||c.field==='distance')unboundSplit.add(c.trainingOccurrenceId)
  res.corrections.unmapped.push(c.correctionId)
 }
 for(const r of [...draft,...out]){
  if(unknownOcc.has(r.trainingOccurrenceId)){res.excluded.push({id:r.recordId,reason:'CORRECTION_COMMIT_TIME_UNKNOWN'});continue}
  if(r.metric==='SPLIT_SECONDS'&&unboundSplit.has(r.trainingOccurrenceId)){res.excluded.push({id:r.recordId,reason:'UNBOUND_FIELD_CORRECTION'});continue}
  res.rows.push(voided.get(r.trainingOccurrenceId)?{...r,status:'VOIDED'}:r)
 }
 return res
}
