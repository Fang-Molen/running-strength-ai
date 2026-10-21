import {buildMuscleReview,REGIONS,REGION_LABEL,type Region,type TrainingPart,type MuscleReview} from './muscle-recovery-u11.ts'

/** Explicit report versions, including a zero-severity update. Never infer symptom resolution from time alone. */
export type SymptomUpdate={
 athleteId:string; reportId:string; sourceId:string; region:Region;
 kind:'PAIN'|'SORENESS'; severity:number; occurredAt:string; knownAt:string;
 revision:number; status:'RECORDED'|'RETRACTED';
}
export type TemporalRegionState='PAIN_ACTIVE'|'PAIN_RECHECK'|'SORENESS_ACTIVE'|'SORENESS_RECHECK'|'SOURCE_CONFLICT'|'OVERLAP_OBSERVED'|'TRAINING_EXPOSURE'|'NO_CURRENT_EVIDENCE'
export type TemporalRegion={
 region:Region; label:string; state:TemporalRegionState; lastSymptomAt:string|null;
 lastPainSeverity:number|null; lastSorenessSeverity:number|null;
 explicitZeroReport:boolean; runCount:number; strengthCount:number;
 evidenceIds:string[]; notes:string[];
}
export type MuscleTimeline={athleteId:string;asOf:string;lookbackHours:number;regions:TemporalRegion[];gaps:string[];base:MuscleReview;sourceFingerprint:string;measuredMuscleFatigue:false;recoveryPercent:null;autoPlanChange:false}
const HOUR=3600_000
const valid=(s:string)=>typeof s==='string'&&Number.isFinite(Date.parse(s))
const reportKey=(r:SymptomUpdate)=>`${r.sourceId}|${r.reportId}|${r.kind}|${r.region}`
const isConflict=(a:SymptomUpdate,b:SymptomUpdate)=>a.severity!==b.severity||a.status!==b.status||a.occurredAt!==b.occurredAt
const symptomStaleHours=36 // follow-up UX interval; NOT a recovery time estimate
export function buildMuscleTimeline(i:{athleteId:string;asOf:string;parts:TrainingPart[];symptomUpdates:SymptomUpdate[];lookbackHours?:number}):MuscleTimeline{
 const lookbackHours=i.lookbackHours??168
 if(!i.athleteId||!valid(i.asOf)||!Number.isInteger(lookbackHours)||lookbackHours<1||lookbackHours>168)throw Error('INVALID_CONTEXT')
 const asOf=Date.parse(i.asOf),cutoff=asOf-lookbackHours*HOUR,gaps:string[]=[]
 // Use U11's existing source-aware actual training projection; no duplicate load score.
 const base=buildMuscleReview({athleteId:i.athleteId,asOf:i.asOf,parts:i.parts,symptoms:[],windowHours:lookbackHours})
 const versions=new Map<string,SymptomUpdate>()
 const ambiguous=new Set<string>()
 for(const r of i.symptomUpdates){
  if(r.athleteId!==i.athleteId||!REGIONS.includes(r.region)||!r.reportId||!r.sourceId||!valid(r.occurredAt)||!valid(r.knownAt)||Date.parse(r.occurredAt)>asOf||Date.parse(r.knownAt)>asOf||Date.parse(r.knownAt)<Date.parse(r.occurredAt)||!Number.isInteger(r.revision)||r.revision<0||!Number.isFinite(r.severity)||r.severity<0||r.severity>10){gaps.push('有无效、未来或不同运动员的局部反馈，已排除');continue}
  const k=reportKey(r),old=versions.get(k)
  if(!old||r.revision>old.revision){versions.set(k,r);ambiguous.delete(k)}
  else if(r.revision===old.revision&&isConflict(r,old)){ambiguous.add(k)}
 }
 const reports=[...versions].filter(([k,r])=>!ambiguous.has(k)&&r.status==='RECORDED').map(([,r])=>r)
 const regions:TemporalRegion[]=REGIONS.map(region=>{
  const b=base.regions.find(r=>r.region===region)!,notes:string[]=[],rs=reports.filter(r=>r.region===region&&(r.kind==='PAIN'||Date.parse(r.occurredAt)>=cutoff))
  const last=(kind:'PAIN'|'SORENESS')=>{
   const xs=rs.filter(r=>r.kind===kind).sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt)||b.revision-a.revision||Date.parse(b.knownAt)-Date.parse(a.knownAt))
   if(xs.length>1&&xs[0].occurredAt===xs[1].occurredAt&&xs[0].severity!==xs[1].severity)return {value:null as SymptomUpdate|null,conflict:true}
   return {value:xs[0]??null,conflict:false}
  }
  const p=last('PAIN'),s=last('SORENESS'),ambiguousRegion=[...ambiguous].some(k=>k.endsWith(`|${region}`))
  const conflicted=p.conflict||s.conflict||ambiguousRegion
  const pain=p.value&&p.value.severity>0?p.value:null
  const sore=s.value&&s.value.severity>0?s.value:null
  const painOld=pain&&(asOf-Date.parse(pain.occurredAt))/HOUR>symptomStaleHours
  const soreOld=sore&&(asOf-Date.parse(sore.occurredAt))/HOUR>symptomStaleHours
  const overlap=b.runEventIds.length>0&&b.strengthEventIds.length>0
  let state:TemporalRegionState='NO_CURRENT_EVIDENCE'
  if(conflicted)state='SOURCE_CONFLICT'
  else if(pain)state=painOld?'PAIN_RECHECK':'PAIN_ACTIVE'
  else if(sore)state=soreOld?'SORENESS_RECHECK':'SORENESS_ACTIVE'
  else if(overlap)state='OVERLAP_OBSERVED'
  else if(b.runEventIds.length||b.strengthEventIds.length)state='TRAINING_EXPOSURE'
  if(overlap)notes.push('近期跑步与力量涉及同一肌群；不等于测得组织疲劳')
  if(painOld)notes.push('较早报告过疼痛，但缺少近期复核；不得自动宣告恢复')
  else if(pain)notes.push('近期报告疼痛，需核对症状、功能和适用的专业限制')
  if(soreOld)notes.push('酸痛反馈已过当前观察时段，现状待核对')
  if(p.value?.severity===0||s.value?.severity===0)notes.push('最近有明确的无症状反馈，但不等于组织已完全恢复')
  if(conflicted)notes.push('同一反馈存在未解决的来源或版本冲突，不据此放行训练')
  if(state==='TRAINING_EXPOSURE')notes.push('只有实际训练参与证据，尚无当前局部疲劳测量')
  const times=[p.value?.occurredAt,s.value?.occurredAt].filter((x):x is string=>Boolean(x)).sort()
  return {region,label:REGION_LABEL[region],state,lastSymptomAt:times.at(-1)??null,lastPainSeverity:p.value?.severity??null,lastSorenessSeverity:s.value?.severity??null,explicitZeroReport:p.value?.severity===0||s.value?.severity===0,runCount:b.runEventIds.length,strengthCount:b.strengthEventIds.length,evidenceIds:[...new Set([...b.runEventIds,...b.strengthEventIds,...rs.map(r=>r.reportId)])],notes}
 })
 if(ambiguous.size)gaps.push('存在同版本互相冲突的主观反馈，需核对')
 const partSignatures=[...new Set(i.parts.filter(p=>p.athleteId===i.athleteId&&valid(p.occurredAt)&&valid(p.knownAt)&&Date.parse(p.knownAt)<=asOf&&Date.parse(p.knownAt)>=Date.parse(p.occurredAt)&&!!p.eventId&&!!p.sourceId&&(p.actual==='CONFIRMED'||p.actual==='RETRACTED')).map(p=>JSON.stringify([p.eventId,p.sourceId,p.occurrenceId,p.componentId,p.modality,p.actual,p.runType,p.exercises,p.revision])))].sort()
 const reportSignatures=[...versions].map(([k,r])=>JSON.stringify([k,r.revision,r.occurredAt,r.severity,r.status,ambiguous.has(k)])).sort()
 const sourceFingerprint=JSON.stringify([partSignatures,reportSignatures])
 return {athleteId:i.athleteId,asOf:i.asOf,lookbackHours,regions,gaps:[...new Set([...base.gaps,...gaps])],base,sourceFingerprint,measuredMuscleFatigue:false,recoveryPercent:null,autoPlanChange:false}
}
