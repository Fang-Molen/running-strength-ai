import type { EvidenceSnapshot, MuscleExposureReview, Region, Side, TrainingFact } from './analysis-contract'
import { exerciseRegions, REGION_LABEL } from './muscle-recovery-u11'
import { refOf } from './analysis-evidence'
export const MUSCLE_MAPPING_VERSION='U11_CATALOG_1'
const runRegions:Region[]=['quads','hamstrings','glutes','calves']
const sumKnown=(xs:(number|null)[])=>xs.some(x=>x!==null)?xs.reduce<number>((a,b)=>a+(b??0),0):null
export function trainingDose(t:TrainingFact){
 const sets=t.strengthSets.filter(s=>s.completion==='COMPLETED'),runs=t.runSegments.filter(s=>s.completion==='COMPLETED')
 return {sets:sets.length,reps:sumKnown(sets.map(s=>s.reps)),setDetails:sets.map(s=>`${s.catalogId??'UNMAPPED'}：${s.loadKg??'未知'} kg × ${s.reps??'未知'} 次${s.holdSeconds!==null?` / ${s.holdSeconds} s`:''}（${s.loadBasis}；${s.side}；组RPE ${s.setRpe??'未知'}；RIR ${s.rir??'未知'}；离心 ${s.eccentricSeconds??'未知'} s）`),distanceM:sumKnown(runs.map(s=>s.distanceM)),workSeconds:sumKnown(runs.map(s=>s.durationSeconds)),jumpContacts:t.jumpContacts,modality:t.modality,observedType:t.observedType,plannedPurpose:t.plannedPurpose,segments:runs.map(s=>({...s,speedMps:s.distanceM!==null&&s.durationSeconds!==null&&s.durationSeconds>0?s.distanceM/s.durationSeconds:null})),
  missing:[...sets.flatMap(s=>[s.loadKg===null?'实际负重未知':null,s.reps===null&&s.holdSeconds===null?'完成量未知':null,s.loadBasis==='UNKNOWN'?'负重口径未知':null,s.rir===null?'RIR未知':null]).filter((x):x is string=>!!x),...runs.flatMap(s=>[s.distanceM===null?'分段距离未知':null,s.durationSeconds===null?'分段用时未知':null]).filter((x):x is string=>!!x)]}
}
export function buildMuscleExposure(snapshot:EvidenceSnapshot,windowHours=72):MuscleExposureReview & {windowHours:number;unmappedRefs:string[];training: {ref:ReturnType<typeof refOf>;dose:ReturnType<typeof trainingDose>}[]} {
 if(![24,48,72].includes(windowHours))throw Error('INVALID_EXPOSURE_WINDOW')
 const cutoff=Date.parse(snapshot.context.asOf)-windowHours*3600000,rows=snapshot.facts.filter((f):f is TrainingFact=>f.kind==='TRAINING'&&Date.parse(f.startedAt)>=cutoff)
 const groups=new Map<string,{region:Region;side:Side;rows:TrainingFact[]}>(),unmappedRefs:string[]=[]
 for(const t of rows){
  const pairs:{region:Region;side:Side}[]=t.modality==='RUN'&&t.observedType&&t.observedType!=='UNKNOWN'&&t.observedTypeBasis.length?runRegions.map(region=>({region,side:'BILATERAL' as const})):t.strengthSets.filter(s=>s.completion==='COMPLETED').flatMap(s=>exerciseRegions(s.catalogId??undefined).map(region=>({region,side:s.side})))
  if(!pairs.length)unmappedRefs.push(t.id)
  for(const p of pairs){const k=p.region+':'+p.side,g=groups.get(k)??{...p,rows:[]};if(!g.rows.includes(t))g.rows.push(t);groups.set(k,g)}
 }
 const regions=[...groups.values()].map(({region,side,rows:ts})=>{
  const runs=ts.filter(t=>t.modality==='RUN').flatMap(t=>t.runSegments.filter(s=>s.completion==='COMPLETED'))
  const entries=ts.flatMap(t=>t.strengthSets.filter(s=>s.completion==='COMPLETED'&&s.side===side&&exerciseRegions(s.catalogId??undefined).includes(region)).map(s=>({t,s})))
  const volumes=new Map<string,MuscleExposureReview['regions'][number]['volumeLoadKgRepsByExercise'][number]>()
  for(const {s,t} of entries){if(s.loadKg===null||s.reps===null||!s.catalogId||!['TOTAL_EXTERNAL','PER_HAND'].includes(s.loadBasis))continue
   const k=JSON.stringify([s.catalogId,s.catalogVersion,s.loadBasis,s.side,s.rangeProtocol,t.protocolKey]);const v=volumes.get(k)??{catalogId:s.catalogId,loadBasis:s.loadBasis,value:0,refs:[]};v.value+=s.loadKg*s.reps;if(!v.refs.some(r=>r.id===t.id))v.refs.push(refOf(t));volumes.set(k,v)}
  return {region,side,refs:ts.map(refOf),runDistanceM:sumKnown(runs.map(s=>s.distanceM)),runWorkSeconds:sumKnown(runs.map(s=>s.durationSeconds)),knownStrengthSets:entries.length,knownStrengthReps:sumKnown(entries.map(x=>x.s.reps)),volumeLoadKgRepsByExercise:[...volumes.values()],jumpContacts:sumKnown(ts.filter(t=>t.modality==='JUMP').map(t=>t.jumpContacts)),overlapObserved:runs.length>0&&entries.length>0,gaps:[...new Set(ts.flatMap(t=>trainingDose(t).missing))]}
 })
 // Region-level overlap is visible even if a strength record did not specify side.
 // Do not silently call UNSPECIFIED bilateral or sum duplicate side groups.
 const ledger:NonNullable<MuscleExposureReview['ledger']>=[...new Set(regions.map(r=>r.region))].map(region=>{
  const rs=regions.filter(r=>r.region===region),ids=new Set(rs.flatMap(r=>r.refs.map(f=>f.id))),ts=rows.filter(t=>ids.has(t.id))
  return {region,status:'UNKNOWN',confidence:ts.length?'MEDIUM':'UNKNOWN',supportingFacts:ts.map(refOf),conflictingFacts:snapshot.conflicts.flatMap(c=>c.refs).filter(r=>ids.has(r.id)),missingFacts:[...new Set([...rs.flatMap(r=>r.gaps),'缺少核准的个人剂量分级标准，不生成高低暴露或组织恢复百分比',...(rs.some(r=>r.side==='UNSPECIFIED')?['部分动作左右侧未记录']:[])])],overlapObserved:ts.some(t=>t.modality==='RUN')&&ts.some(t=>t.modality==='STRENGTH'),entries:ts.flatMap(t=>{
   const d=trainingDose(t),relevant=t.strengthSets.filter(s=>s.completion==='COMPLETED'&&exerciseRegions(s.catalogId??undefined).includes(region));
   const detail=t.modality==='RUN'?`${t.observedType??'UNKNOWN'} 实际 ${d.distanceM??'未知'} m / ${d.workSeconds??'未知'} s；${d.segments.map(s=>`第${s.roundIndex??'?'}轮 ${s.distanceM??'?'} m/${s.durationSeconds??'?'} s，休息 ${s.restAfterSeconds??'未知'} s`).join('；')}`:trainingDose({...t,strengthSets:relevant}).setDetails.join('；')
   return [{ref:refOf(t),occurredAt:t.startedAt,modality:t.modality,observedType:t.observedType,dose:detail,side:relevant.length&&new Set(relevant.map(s=>s.side)).size===1?relevant[0].side:t.modality==='RUN'?'BILATERAL':'UNSPECIFIED'}]
  })}
 })
 return {snapshotId:snapshot.snapshotId,ledger,regions,mappingVersion:MUSCLE_MAPPING_VERSION,isMeasuredMuscleFatigue:false,automaticPrescription:false,windowHours,unmappedRefs,training:rows.map(t=>({ref:refOf(t),dose:trainingDose(t)}))}
}
export function exposureText(e:ReturnType<typeof buildMuscleExposure>):string {
 return (e.ledger??[]).filter(r=>r.overlapObserved).map(r=>`${REGION_LABEL[r.region]}：近期跑步＋力量重复暴露；只确认参与重叠，不证明损伤或恢复不足。`).join('\n')+'\n'+e.training.map(({ref,dose:d})=>`${ref.id}：${d.distanceM!==null?`实际跑步 ${d.distanceM} m / ${d.workSeconds??'未知'} s（纯跑时间）`:`实际完成 ${d.sets} 组，${d.reps??'未知'} 次`}${d.jumpContacts!==null?`；跳跃 ${d.jumpContacts} 次接触`:''}；${d.setDetails.join('；')}；${d.missing.length?[...new Set(d.missing)].join('、'):'按实际记录计算'}。`).join('\n')+'\n跑步、力量与跳跃分维度描述；不合成肌肉疲劳分或恢复百分比。'
}
