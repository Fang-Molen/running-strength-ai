import { loadImportRatings, type ImportRating } from './coach-import-rating.ts'
import { loadConfirmedTrainingImports, normalizeConfirmedTrainingImport, type ConfirmedTrainingImport, type ImportField } from './training-import.ts'
import { currentAthleteId } from './events.ts'
import { strictIso, type FormalEvidenceRow } from './coach-v4-c11-adapter.ts'
import type { CoachParts } from './coach-brief.ts'
import { listCorrections, type TrainingCorrection } from './training-correction.ts'

const value = <T>(f: ImportField<T>): T | null => f.status === 'RECORDED' ? f.value : null
export function coachImports(athleteId=currentAthleteId(), asOf=new Date().toISOString()): ConfirmedTrainingImport[] {
 return loadConfirmedTrainingImports().map(normalizeConfirmedTrainingImport).filter((r):r is ConfirmedTrainingImport => !!r &&
  (r.athleteId ?? 'local')===athleteId && strictIso(r.confirmedAt) && strictIso(r.occurredAt.value!) && Date.parse(r.confirmedAt)<=Date.parse(asOf) && Date.parse(r.occurredAt.value!)<=Date.parse(r.confirmedAt))
}

/** Reuse the audited replacement chain for non-coach consumers. Never edit the
 * retained import or guess a segment from a date/distance match. */
export function effectiveImportedTraining(raw:ConfirmedTrainingImport,asOf=new Date().toISOString(),corrections:readonly TrainingCorrection[]=listCorrections(raw.confirmedImportId,asOf)) {
 const unknownCommit=corrections.some(c=>!c.recordedAt||!strictIso(c.recordedAt));
 const visible=corrections.filter(c=>c.trainingOccurrenceId===raw.confirmedImportId&&c.recordedAt&&strictIso(c.recordedAt)&&Date.parse(c.recordedAt)<=Date.parse(asOf));
 const rows=importedFormalRows([raw],raw.athleteId??'local',asOf,corrections);
 const latest=(suffix:string)=>{
  let row=rows.find(r=>r.recordId===`import:${raw.draftId}:${suffix}`);
  const seen=new Set<string>();
  while(row&&!seen.has(row.recordId)){
   seen.add(row.recordId);const next=rows.filter(r=>r.supersedesRecordId===row!.recordId);
   if(!next.length)return row;if(next.length!==1)return null;row=next[0];
  }
  return null;
 };
 const field=(original:ImportField<number>,row:FormalEvidenceRow|null|undefined,distance=false):ImportField<number>=>{
  if(unknownCommit)return {value:null,status:'AMBIGUOUS',sourceIds:original.sourceIds};
  if(!row?.supersedesRecordId)return original;
  const measured=distance?Number(row.protocol.match(/:(\d+(?:\.\d+)?)m$/)?.[1]):row.value;
  const usable=row.status==='OBSERVED'&&row.value!==null&&measured!==null&&Number.isFinite(measured);
  return {value:usable?measured:null,status:usable?'RECORDED':'AMBIGUOUS',sourceIds:[row.sourceEventId]};
 };
 const record:ConfirmedTrainingImport={...raw,
  runningSegments:raw.runningSegments.map((s,i)=>{const row=latest(`run-${i+1}`);return {...s,durationSeconds:field(s.durationSeconds,row),distanceMeters:field(s.distanceMeters,row,true)}}),
  strengthSets:raw.strengthSets.map((s,i)=>({...s,weightKg:field(s.weightKg,latest(`set-${i+1}:STRENGTH_KG`)),repetitions:field(s.repetitions,latest(`set-${i+1}:STRENGTH_REPS`)),durationSeconds:field(s.durationSeconds,latest(`set-${i+1}:STRENGTH_SECONDS`))})),
 };
 return {record,revision:visible.length,knownAt:[raw.confirmedAt,...visible.map(c=>c.recordedAt!)].sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1)!};
}
/** Read-only standalone occurrence; deleting the import removes its evidence without orphan events. */
export function importedFormalRows(records:readonly ConfirmedTrainingImport[], athleteId:string, asOf:string, corrections:readonly TrainingCorrection[]=[],ratings:readonly ImportRating[]=loadImportRatings()):FormalEvidenceRow[] {
 const rows:FormalEvidenceRow[]=[]
 const bindings=new Map<string,{keys:string[];kind:'run'|'strength'|'feedback'}>()
 for(const raw of records){
  const r=normalizeConfirmedTrainingImport(raw)
  if(!r||(r.athleteId??'local')!==athleteId||!strictIso(r.confirmedAt)||!strictIso(r.occurredAt.value!)||Date.parse(r.confirmedAt)>Date.parse(asOf)||Date.parse(r.occurredAt.value!)>Date.parse(r.confirmedAt))continue
  const cs=corrections.filter(c=>c.trainingOccurrenceId===r.confirmedImportId)
  if(cs.some(c=>!c.recordedAt||!strictIso(c.recordedAt)))continue
  const visible=cs.filter(c=>Date.parse(c.recordedAt!)<=Date.parse(asOf)).sort((a,b)=>Date.parse(a.recordedAt!)-Date.parse(b.recordedAt!))
  const voided=visible.filter(c=>c.kind==='VOID'||c.kind==='RESTORE').at(-1)?.kind==='VOID'
  const push=(suffix:string,metric:FormalEvidenceRow['metric'],v:number|null,unit:string,protocol:string,status:FormalEvidenceRow['status']='OBSERVED')=>{
   rows.push({recordId:`import:${r.draftId}:${suffix}`,athleteId,trainingOccurrenceId:r.confirmedImportId,sourceEventId:`import:${r.draftId}:${suffix}`,
    metric,value:v,unit,protocol,status:voided?'VOIDED':status,source:'USER_REPORT',occurredAt:r.occurredAt.value!,knownAt:r.confirmedAt,verifiedByFormalProjection:false})
   return rows.length-1
  }
  for(const [suffix,metric,f,unit] of [['rpe','SESSION_RPE',r.sessionRpe,'score'],['recovery','SUBJECTIVE_RECOVERY',r.subjectiveRecovery,'score'],['sleep','SLEEP_HOURS',r.sleepHours,'h']] as const)
   if(value(f)!==null)push(suffix,metric,value(f),unit,`${suffix}:session`)
  for(const rating of ratings.filter(x=>x.occurrenceId===r.confirmedImportId&&x.athleteId===athleteId&&strictIso(x.recordedAt)&&Date.parse(x.recordedAt)<=Date.parse(asOf)&&Date.parse(x.recordedAt)>=Date.parse(r.confirmedAt))){
   rows.push({recordId:rating.id,athleteId,trainingOccurrenceId:r.confirmedImportId,sourceEventId:rating.id,metric:'SESSION_RPE',value:rating.value,unit:'score',protocol:'rpe:session',status:voided?'VOIDED':'OBSERVED',source:'USER_REPORT',occurredAt:rating.eventAt,knownAt:rating.recordedAt,verifiedByFormalProjection:false})
  }
  for(const [suffix,metric,f] of [['pain','PAIN_SCORE',r.pain],['soreness','SORENESS',r.soreness]] as const)
   if(value(f))push(suffix,metric,value(f)!.intensity,'score',`${suffix}:session`)
  for(const [i,s] of r.runningSegments.entries()){
   const dist=value(s.distanceMeters),seconds=value(s.durationSeconds),round=value(s.round),repeat=value(s.repeat)
   const protocol=round!==null&&repeat!==null&&s.kind==='REPETITION'?`running:import:rep:b:step:${round}:${repeat}${dist!==null?`:${dist}m`:''}`:`running:import:segment:${i+1}:${encodeURIComponent(s.id)}:${s.kind}${dist!==null?`:${dist}m`:''}`
   if(seconds!==null&&s.kind!=='RECOVERY'){
    const at=push(`run-${i+1}`,'SPLIT_SECONDS',seconds,'s',protocol,s.completion==='COMPLETED'?'OBSERVED':s.completion==='SKIPPED'?'SKIPPED':'NOT_RECORDED')
    bindings.set(rows[at].recordId,{kind:'run',keys:[s.id,`run-${i+1}`]})
    if(s.completion==='COMPLETED'&&s.averageHeartRateBpm&&value(s.averageHeartRateBpm)!==null&&(!s.heartRateMethod||value(s.heartRateMethod)===null||value(s.heartRateMethod)==='UNKNOWN'))rows[at]={...rows[at],unverifiedHeartRate:{value:value(s.averageHeartRateBpm)!,method:'UNKNOWN'}}
   }
   if(seconds!==null&&s.kind==='RECOVERY')push(`rest-segment-${i+1}`,'REST_SECONDS',seconds,'s',`running:import:recovery:${i+1}:${encodeURIComponent(s.id)}${dist!==null?`:${dist}m`:''}`,s.completion==='COMPLETED'?'OBSERVED':s.completion==='SKIPPED'?'SKIPPED':'NOT_RECORDED')
   if(s.kind!=='RECOVERY'&&s.completion==='COMPLETED'&&seconds!==null&&s.averageHeartRateBpm&&value(s.averageHeartRateBpm)!==null&&s.heartRateMethod&&value(s.heartRateMethod)!==null&&value(s.heartRateMethod)!=='UNKNOWN'){
    push(`hr-${i+1}`,'HR_AVG_BPM',value(s.averageHeartRateBpm),'bpm',`heart:import:${s.id}`)
    rows[rows.length-1]={...rows.at(-1)!,measurement:{method:s.heartRateMethod?value(s.heartRateMethod)??'UNKNOWN':'UNKNOWN',segmentSourceId:`import:${r.draftId}:run-${i+1}`}}
   }
   const rest=value(s.recoverySeconds)
   if(rest!==null&&s.kind!=='RECOVERY'&&(s.completion==='COMPLETED'||s.recoveryScope==='AFTER_REPEAT'||s.recoveryScope==='AFTER_ROUND'))push(`rest-${i+1}`,'REST_SECONDS',rest,'s',s.recoveryScope&&s.recoveryScope!=='UNSPECIFIED'&&round!==null&&repeat!==null?`running:import:rest:b:${s.recoveryScope}:step:${round}:${repeat}`:`import-rest:${s.id}`) // no AFTER_REPEAT assumed
  }
  for(const [i,s] of r.strengthSets.entries()){
   if(s.completion!=='COMPLETED')continue
   const protocol=`strength:${encodeURIComponent(value(s.exerciseName)??'unknown')}:${value(s.setOrdinal)??i+1}`
   for(const [metric,f,unit] of [['STRENGTH_KG',s.weightKg,'kg'],['STRENGTH_REPS',s.repetitions,'reps'],['STRENGTH_SECONDS',s.durationSeconds,'s']] as const)
    if(value(f)!==null){
     const at=push(`set-${i+1}:${metric}`,metric,value(f),unit,protocol)
     bindings.set(rows[at].recordId,{kind:'strength',keys:[s.id,`set-${i+1}`,`${value(s.exerciseName)??'unknown'}:${value(s.setOrdinal)??i+1}`]})
    }
  }
  // Resolve a correction to one explicit segment/set. Preserve old and new rows for audit/as-of.
  const metricFor={weight:['STRENGTH_KG'],reps:['STRENGTH_REPS'],distance:['SPLIT_SECONDS'],duration:['SPLIT_SECONDS','STRENGTH_SECONDS'],feedback:['SESSION_RPE','SLEEP_HOURS','SUBJECTIVE_RECOVERY','PAIN_SCORE','SORENESS']} as const
  for(const c of visible.filter(c=>c.kind==='FIELD'&&c.field)){
   const metrics:readonly string[]=metricFor[c.field!]
   const replaced=new Set(rows.map(row=>row.supersedesRecordId).filter(Boolean))
   const candidates=rows.filter(row=>row.trainingOccurrenceId===r.confirmedImportId&&!replaced.has(row.recordId)&&metrics.includes(row.metric))
   const bound=c.setKey?candidates.filter(row=>bindings.get(row.recordId)?.keys.includes(c.setKey!)):candidates
   // An invalid or ambiguous binding withdraws affected values, without assigning a guessed replacement.
   const targets=bound.length?bound:candidates
   const unique=bound.length===1&&c.field!=='feedback'
   const parsed=/^\d+(?:\.\d+)?$/.test(c.newValue.trim())?Number(c.newValue):null
   for(const old of targets){
    const prior=c.field==='distance'?Number(old.protocol.match(/:(\d+(?:\.\d+)?)m$/)?.[1]):old.value
    const matchesOld=!c.originalValue.trim()||Number(c.originalValue)===prior
    const max=c.field==='weight'?1000:c.field==='reps'?1000:1000000
    const usable=unique&&matchesOld&&parsed!==null&&Number.isFinite(parsed)&&parsed<=max&&(c.field==='weight'||c.field==='reps'?parsed>=0:parsed>0)&&(c.field!=='reps'||Number.isInteger(parsed))
    const id=`correction:${c.correctionId}:${old.metric}`
    const protocol=c.field==='distance'&&usable?old.protocol.replace(/(?::\d+(?:\.\d+)?m)?$/,`:${parsed}m`):old.protocol
    const next:FormalEvidenceRow={...old,recordId:id+':'+old.recordId.split(':').slice(-2).join(':'),sourceEventId:id+':'+old.recordId.split(':').slice(-2).join(':'),
     value:usable?(c.field==='distance'?old.value:parsed):null,protocol,knownAt:c.recordedAt!,supersedesRecordId:old.recordId}
    rows.push(next)
    const binding=bindings.get(old.recordId);if(binding)bindings.set(next.recordId,binding)
    // Keep the HR observation linked to the corrected segment, without inventing a method or new HR value.
    for(let i=0;i<rows.length;i++)if(rows[i].measurement?.segmentSourceId===old.sourceEventId)
     rows[i]={...rows[i],measurement:{...rows[i].measurement!,segmentSourceId:next.sourceEventId},knownAt:c.recordedAt!}
   }
  }
 }
 return rows
}
export function importedCoachParts(r:ConfirmedTrainingImport,question:string,corrections:readonly TrainingCorrection[]=listCorrections(r.confirmedImportId),asOf=new Date().toISOString()):CoachParts {
 const all=importedFormalRows([r],r.athleteId??'local',asOf,corrections)
 const replaced=new Set(all.map(row=>row.supersedesRecordId).filter(Boolean))
 const active=all.filter(row=>row.status==='OBSERVED'&&!replaced.has(row.recordId))
 const labels:Record<string,string>={SESSION_RPE:'SESSION_RPE',SLEEP_HOURS:'SLEEP',SUBJECTIVE_RECOVERY:'SUBJECTIVE_RECOVERY',PAIN_SCORE:'PAIN',SORENESS:'SORENESS'}
 const sources:NonNullable<CoachParts['sources']>=active.map(row=>({id:row.sourceEventId,kind:'FACT',detail:(labels[row.metric]
  ?`${labels[row.metric]} 已确认导入：${row.value??'未知'}${row.unit==='h'?'小时':'/10'}；自报来源${row.supersedesRecordId?'；已更正':''}`
  :`${row.metric==='SPLIT_SECONDS'?'跑步分段':row.metric==='REST_SECONDS'?'恢复段':row.metric==='HR_AVG_BPM'?'分段平均心率':'力量实际组'}：${row.value===null?'未知':Number(row.value.toFixed(2))} ${row.unit}；${row.protocol}${row.measurement?`；方法 ${row.measurement.method==='UNKNOWN'?'未知':row.measurement.method}`:''}${row.supersedesRecordId?'；已更正':''}`).slice(0,300)}))
 sources.unshift({id:r.confirmedImportId,kind:'CONTEXT',detail:`用户选择的独立导入，${r.occurredAt.value}；不是自动合并到本机课次`})
 const rating=(metric:FormalEvidenceRow['metric'])=>{const hits=active.filter(row=>row.metric===metric);return hits.length===1?hits[0].value:null}
 const feedbackChanged=corrections.some(c=>c.kind==='FIELD'&&c.field==='feedback'&&c.recordedAt&&Date.parse(c.recordedAt)<=Date.parse(asOf))
 return {question,occurrenceId:r.confirmedImportId,runningStructure:r.runningStructure==='UNAVAILABLE'?'UNAVAILABLE':'AVAILABLE',sessionRpe:rating('SESSION_RPE'),sleepHours:rating('SLEEP_HOURS'),subjectiveRecovery:rating('SUBJECTIVE_RECOVERY'),recoveryState:null,fatigueState:null,duplicateCount:0,repetitionSlots:r.runningSegments.filter(s=>s.kind==='REPETITION').length,continuousCount:r.runningSegments.filter(s=>s.kind==='CONTINUOUS').length,plannedSetCount:null,completedSetCount:r.strengthSets.filter(s=>s.completion==='COMPLETED').length||null,durationSec:value(r.durationSeconds),pain:!feedbackChanged&&!!value(r.pain),soreness:!feedbackChanged&&!!value(r.soreness),daysToCompetition:null,week:null,bias:null,sources:sources.slice(0,100),sourceIds:sources.slice(0,100).map(s=>s.id),running:[],fuel:null}
}
