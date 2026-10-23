/** Read-only training-exposure and symptom map. NOT measured muscle fatigue. */
import type { TrainingFact, StrengthSet } from './analysis-contract'
import { exerciseById } from '../strength/catalog'
export type Region='quads'|'hamstrings'|'glutes'|'calves'|'hip_flexors'|'adductors'|'core'|'lower_back'|'chest'|'back'|'shoulders'|'arms'|'feet'
export type TrainingPart={athleteId:string;eventId:string;occurrenceId?:string;componentId?:string;modality:'RUN'|'STRENGTH';occurredAt:string;knownAt:string;sourceId:string;actual:'CONFIRMED'|'UNVERIFIED'|'PLANNED'|'RETRACTED';runType?:'EASY'|'TEMPO'|'INTERVAL'|'SPRINT'|'HILL'|'UNKNOWN';exercises?:{catalogId?:string;name?:string;actualSets?:number|null;verified:boolean}[];revision?:number;strengthSets?:StrengthSet[];runSegments?:TrainingFact['runSegments'];runningStructure?:unknown;endedAt?:string|null;sessionRpe?:number|null;protocolKey?:string|null;provenance?:import('./brand-isolation').Provenance}
export type Symptom={athleteId:string;eventId:string;occurredAt:string;knownAt:string;region:Region;kind:'SORENESS'|'PAIN';severity?:number;sourceId:string;revision?:number}
export type RegionState='PAIN_REVIEW'|'REPORTED_SORENESS'|'OVERLAP_OBSERVED'|'TRAINING_EXPOSURE'|'UNKNOWN'
export type RegionReview={region:Region;state:RegionState;runEventIds:string[];strengthEventIds:string[];symptomEventIds:string[];notes:string[]}
export type MuscleReview={athleteId:string;asOf:string;windowHours:number;regions:RegionReview[];gaps:string[];summary:string;automaticPrescription:false;isMeasuredMuscleFatigue:false}
export const REGIONS:Region[]=['quads','hamstrings','glutes','calves','hip_flexors','adductors','core','lower_back','chest','back','shoulders','arms','feet']
export const REGION_LABEL:Record<Region,string>={quads:'股四头肌',hamstrings:'腘绳肌',glutes:'臀肌',calves:'小腿后群',hip_flexors:'髋屈肌',adductors:'内收肌',core:'核心',lower_back:'下背部',chest:'胸肌',back:'背部',shoulders:'肩部',arms:'手臂',feet:'足部'}
const RUN:Record<NonNullable<TrainingPart['runType']>,Region[]>={EASY:['quads','hamstrings','glutes','calves'],TEMPO:['quads','hamstrings','glutes','calves'],INTERVAL:['quads','hamstrings','glutes','calves','hip_flexors'],SPRINT:['quads','hamstrings','glutes','calves','hip_flexors'],HILL:['quads','hamstrings','glutes','calves'],UNKNOWN:[]}
const EX:Record<string,Region[]>={
'back-squat':['quads','glutes','core'],'front-squat':['quads','glutes','core'],goblet:['quads','glutes','core'],'db-squat':['quads','glutes','core'],'leg-press':['quads','glutes'],
'bb-dl':['hamstrings','glutes','lower_back','quads'],rdl:['hamstrings','glutes','lower_back'],'db-rdl':['hamstrings','glutes','lower_back'],sumo:['glutes','adductors','quads','hamstrings'],'trap-dl':['glutes','quads','hamstrings'],
'db-lunge':['quads','glutes'],'walk-lunge':['quads','glutes'],'rev-lunge':['quads','glutes'],bss:['quads','glutes'],'step-up':['quads','glutes'],
'leg-curl':['hamstrings'],'good-morning':['hamstrings','glutes','lower_back'],calf:['calves'],'bb-calf':['calves'],'seat-calf':['calves'],
'hip-thrust':['glutes'],'glute-bridge':['glutes'],'single-hip':['glutes'],'kb-swing':['glutes','hamstrings'],'side-leg':['glutes'],
plank:['core'],'side-plank':['core'],'knee-plank':['core'],'dead-bug':['core'],crunch:['core'],bicycle:['core'],russian:['core'],situp:['core'],vup:['core'],
bench:['chest','shoulders','arms'],'bb-bench':['chest','shoulders','arms'],'db-bench':['chest','shoulders','arms'],pushup:['chest','shoulders','arms'],pullup:['back','arms'],row:['back','arms'],'bb-row':['back','arms'],'db-row':['back','arms'],'overhead-press':['shoulders','arms'],'bb-ohp':['shoulders','arms'],'db-ohp':['shoulders','arms']}
/** v89.2：动作库非目录条目（extra:<名称>）与目录分组兜底。只按动作库条目，不按自由文本猜。 */
const EXTRA_EX:Record<string,Region[]>={'extra:分腿蹲':['quads','glutes'],'extra:Pallof 抗旋转':['core'],'extra:鸟狗':['core','lower_back'],'extra:北欧腿弯举':['hamstrings'],'extra:深蹲':['quads','glutes','core'],'extra:核心':['core']}
const GROUP_EX:Record<string,Region[]>={胸:['chest','shoulders','arms'],背:['back','arms'],肩:['shoulders'],手臂:['arms'],臀:['glutes'],核心:['core']}
export function exerciseRegions(id?:string):Region[]{
 if(!id)return[]
 if(id.startsWith('extra:'))return EXTRA_EX[id]??[]
 const c=id.startsWith('local:')?id.slice(6):id
 if(EX[c])return EX[c]
 const g=exerciseById(c)?.group;return g?GROUP_EX[g]??[]:[]
}
const time=(s:string)=>Date.parse(s)
const valid=(s:string)=>typeof s==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(time(s))
const key=(p:TrainingPart)=>p.occurrenceId&&p.componentId?`${p.athleteId}|${p.occurrenceId}|${p.componentId}|${p.modality}`:`${p.athleteId}|${p.sourceId}|${p.eventId}|${p.modality}`
export function buildMuscleReview(input:{athleteId:string;asOf:string;parts:TrainingPart[];symptoms:Symptom[];windowHours?:number}):MuscleReview{
 const {athleteId,asOf}=input,now=time(asOf),windowHours=input.windowHours??72
 if(!athleteId||!valid(asOf)||!Number.isInteger(windowHours)||windowHours<1||windowHours>168)throw Error('INVALID_CONTEXT')
 const start=now-windowHours*3600000,gaps:string[]=[],groups=new Map<string,TrainingPart>(),conflicts=new Set<string>()
 for(const p of input.parts){
  if(p.athleteId!==athleteId||!valid(p.occurredAt)||!valid(p.knownAt)||time(p.occurredAt)>now||time(p.knownAt)>now||time(p.knownAt)<time(p.occurredAt)||time(p.occurredAt)<start)continue
  if(p.actual==='PLANNED')continue
  if(p.actual==='RETRACTED'){const k=key(p),old=groups.get(k);if(!old||(p.revision??0)>=(old.revision??0)){groups.set(k,p);conflicts.delete(k)}continue}
  if(p.actual!=='CONFIRMED'){gaps.push('存在未确认活动，未当作实际训练');continue}
  if(!p.eventId||!p.sourceId){gaps.push('训练缺少稳定来源标识，未纳入');continue}
  const k=key(p),old=groups.get(k)
  if(!old){groups.set(k,p);continue}
  if((p.revision??0)>(old.revision??0)){groups.set(k,p);conflicts.delete(k);continue}
  if((p.revision??0)===(old.revision??0)){
   if(old.actual==='RETRACTED')continue
   const score=(x:TrainingPart)=>(x.exercises??[]).filter(e=>e.verified).length+(x.modality==='RUN'&&x.runType&&x.runType!=='UNKNOWN'?1:0)
   const content=(x:TrainingPart)=>JSON.stringify([x.actual,x.occurredAt,x.runType??'UNKNOWN',(x.exercises??[]).map(e=>[e.catalogId,e.name,e.actualSets,e.verified]).sort()])
   if(content(p)!==content(old)){
    // A summary with no exercise details may be enriched by confirmed phone sets.
    if(score(p)>0&&score(old)===0)groups.set(k,p)
    else if(!(score(old)>0&&score(p)===0))conflicts.add(k)
   }
  }
 }
 for(const k of conflicts){groups.delete(k);gaps.push('同一训练组成存在冲突版本，已排除，等待核对')}
 const runs=new Map<Region,Set<string>>(),lifts=new Map<Region,Set<string>>()
 for(const r of REGIONS){runs.set(r,new Set());lifts.set(r,new Set())}
 for(const p of groups.values()){
  if(p.actual==='RETRACTED')continue
  const k=key(p)
  if(p.modality==='RUN'){
   if(!p.runType||p.runType==='UNKNOWN'){gaps.push('跑步缺少可信训练类型，不能凭平均心率推断肌群疲劳');continue}
   for(const r of RUN[p.runType])runs.get(r)!.add(k)
  }else{
   if(!p.exercises?.length){gaps.push('无法判断具体肌群：力量活动只有摘要，缺少已完成动作和组次');continue}
   for(const e of p.exercises){
    if(!e.verified){gaps.push('未确认动作不作为实际训练');continue}
    if(e.actualSets!=null&&(!Number.isInteger(e.actualSets)||e.actualSets<0)){gaps.push('组次无效，未纳入');continue}
    if(e.actualSets===0)continue
    const rs=exerciseRegions(e.catalogId)
    if(!rs.length){gaps.push(`动作 ${e.name??e.catalogId??'未知'} 的肌群未映射，不按名称猜测`);continue}
    for(const r of rs)lifts.get(r)!.add(k)
    if(e.actualSets==null)gaps.push('已确认动作缺少实际组数，不估算剂量')
   }
  }
 }
 const sym=new Map<Region,Map<string,Symptom>>()
 for(const s of input.symptoms){
  if(s.athleteId!==athleteId||!REGIONS.includes(s.region)||!s.eventId||!s.sourceId||!valid(s.occurredAt)||!valid(s.knownAt)||time(s.occurredAt)>now||time(s.knownAt)>now||time(s.knownAt)<time(s.occurredAt)||time(s.occurredAt)<start||s.severity!=null&&(!Number.isFinite(s.severity)||s.severity<0||s.severity>10))continue
  const m=sym.get(s.region)??new Map<string,Symptom>(),k=`${s.sourceId}|${s.eventId}`,old=m.get(k)
  if(!old||(s.revision??0)>(old.revision??0))m.set(k,s)
  sym.set(s.region,m)
 }
 const regions=REGIONS.map(region=>{
  const r=[...runs.get(region)!],l=[...lifts.get(region)!],ss=[...(sym.get(region)?.values()??[])],notes:string[]=[]
  const pain=ss.some(s=>s.kind==='PAIN'&&(s.severity??1)>0),sore=ss.some(s=>s.kind==='SORENESS'&&(s.severity??1)>0)
  const state:RegionState=pain?'PAIN_REVIEW':sore?'REPORTED_SORENESS':r.length&&l.length?'OVERLAP_OBSERVED':r.length||l.length?'TRAINING_EXPOSURE':'UNKNOWN'
  if(r.length&&l.length)notes.push('跑步和力量涉及同一区域：仅说明训练刺激叠加，不能证明损伤或疲劳程度')
  if(pain)notes.push('报告疼痛，需核对症状及功能；设备分数不能解除限制')
  if(state==='TRAINING_EXPOSURE')notes.push('推定参与区域，不是实测肌肉疲劳')
  return {region,state,runEventIds:r,strengthEventIds:l,symptomEventIds:ss.map(s=>s.eventId),notes}
 })
 const n=regions.filter(r=>r.state!=='UNKNOWN').length
 return {athleteId,asOf,windowHours,regions,gaps:[...new Set(gaps)],summary:n?`近${windowHours}小时${n}个区域有训练参与或主观反馈，不能据此估算恢复百分比。`:'没有足够的已确认实际训练或局部反馈，不能绘制可信肌肉疲劳程度。',automaticPrescription:false,isMeasuredMuscleFatigue:false}
}
export const MESH_KEYS:Record<Region,string[]>={quads:['rectus_fem','vastus_lat','vastus_med'],hamstrings:['biceps_fem','semitend'],glutes:['glutes','glute_med'],calves:['gastroc_med','gastroc_lat','soleus'],hip_flexors:['iliopsoas'],adductors:['adductors'],core:['abs','ext_oblique'],lower_back:['erectors'],chest:['pec_upper','pec_lower'],back:['lats','rhomboids','traps'],shoulders:['delt_front','delt_side','delt_rear'],arms:['biceps','triceps_long','triceps_lat'],feet:['foot_intrinsic','plantar_fascia']}
