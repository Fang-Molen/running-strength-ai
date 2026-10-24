import { calculateQuantitativeRule } from '../../core/coach-quantitative'
import type { QuantDatum } from '../../core/coach-quantitative'
import type { ModelInput, ThresholdRecord, PerformanceRecord } from './types'
import { eligibleRecords, ref, scope, exactTime } from './source'
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0
type ThresholdPair={markers:readonly [string,string];values:[number,number];unit:'m/s'|'bpm';testId:string;method:string;refs:ReturnType<typeof ref>[];measuredAt:string;knownAt:string;validity:'EXPLICIT'|'NOT_SPECIFIED'}
function thresholdPairs(input:ModelInput,unit:'m/s'|'bpm'):ThresholdPair[]{
 const rows=eligibleRecords(input.thresholds,input.context,r=>'THRESHOLD:'+r.marker+':'+r.unit)
 .filter(r=>r.modality==='RUNNING'&&r.unit===unit&&positive(r.value)&&r.testId&&r.method&&r.protocolKey&&(!r.validUntil||exactTime(r.validUntil)&&Date.parse(r.validUntil)>=Date.parse(input.context.asOf)))
 const pairs:ThresholdPair[]=[]
 for(const low of rows.filter(r=>r.marker==='LT1'||r.marker==='VT1')){
  const marker=low.marker==='LT1'?'LT2':'VT2'
  const upper=rows.filter(r=>r.marker===marker&&r.testId===low.testId&&r.method===low.method&&Date.parse(r.occurredAt)===Date.parse(low.occurredAt)&&scope(r)===scope(low))
  const lower=rows.filter(r=>r.marker===low.marker&&r.testId===low.testId&&r.method===low.method&&Date.parse(r.occurredAt)===Date.parse(low.occurredAt)&&scope(r)===scope(low))
  if(lower.length!==1||upper.length!==1||low.value!>=upper[0].value!)continue
  pairs.push({markers:[low.marker,marker],values:[low.value!,upper[0].value!],unit,testId:low.testId,method:low.method,refs:[ref(low),ref(upper[0])],measuredAt:low.occurredAt,knownAt:new Date(Math.max(Date.parse(low.knownAt),Date.parse(upper[0].knownAt))).toISOString(),validity:low.validUntil&&upper[0].validUntil?'EXPLICIT':'NOT_SPECIFIED'})
 }
 return pairs.sort((a,b)=>Date.parse(b.measuredAt)-Date.parse(a.measuredAt))
}
export function assessPhysiology(input:ModelInput){
 const speed=thresholdPairs(input,'m/s'),hr=thresholdPairs(input,'bpm')
 const records=eligibleRecords(input.performances,input.context,()=> 'PERFORMANCE')
 .filter(r=>r.maximal&&r.effort!=='INTERVAL'&&positive(r.distanceM)&&positive(r.seconds)&&r.protocolKey&&r.testId)
 const recent=records.filter(r=>Date.parse(input.context.asOf)-Date.parse(r.occurredAt)<=90*86400000)
 const groups=new Map<string,PerformanceRecord[]>()
 for(const r of recent.filter(r=>r.seconds>=120&&r.seconds<=900)){
  const key=JSON.stringify([scope(r),r.testId]);groups.set(key,[...(groups.get(key)??[]),r])
 }
 const group=[...groups.values()].filter(rs=>rs.length>=3&&new Set(rs.map(r=>r.seconds)).size>=3).sort((a,b)=>Math.max(...b.map(r=>Date.parse(r.occurredAt)))-Math.max(...a.map(r=>Date.parse(r.occurredAt))))[0]??[]
 const datum=(r:PerformanceRecord):QuantDatum=>({id:r.id,athleteId:r.athleteId,value:r.seconds,unit:'s',sourceIds:[r.sourceRecordId],revision:String(r.revision),kind:'ACTUAL',at:r.occurredAt,recordedAt:r.knownAt,protocol:scope(r),distanceMeters:r.distanceM})
 const cs=calculateQuantitativeRule('ABIL_CS',{athleteId:input.context.athleteId,asOf:input.context.asOf,series:group.map(datum),conditions:group.length?['MAXIMAL_TESTS','SAME_TEST_PROTOCOL']:[],conditionSourceIds:group.map(r=>r.sourceRecordId)})
 // 90d, 120–900s and VDOT 600–7200s are conservative engineering windows, not validated physiological cut-offs.
 if(cs.status==='AVAILABLE'&&(cs.metrics.dPrimeMeters===null||cs.metrics.dPrimeMeters<=0)){
  cs.status='UNAVAILABLE';cs.value=null;cs.missing.push('NONPOSITIVE_DPRIME_REVIEW_REQUIRED')
 }
 const races=recent.filter(r=>r.effort==='RACE').map(r=>({distanceM:r.distanceM,seconds:r.seconds,speedMps:r.distanceM/r.seconds,at:r.occurredAt,protocol:scope(r),ref:ref(r)}))
 const latest=(d:number)=>races.filter(r=>r.distanceM===d).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0]
 const r400=latest(400),r800=latest(800),r1500=latest(1500)
 const ratio=(a:typeof r400,b:typeof r400)=>a&&b&&a.protocol===b.protocol?b.speedMps/a.speedMps:null
 const sustained=recent.filter(r=>r.effort==='RACE'&&r.seconds>=600&&r.seconds<=7200).sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt))[0]
 let vdot:null|{value:number;sourceRef:ReturnType<typeof ref>;measuredVO2max:false;automaticTrainingPace:false;formulaVersion:string}=null
 if(sustained){
  const t=sustained.seconds/60,v=sustained.distanceM/t
  const value=(-4.60+.182258*v+.000104*v*v)/(.8+.1894393*Math.exp(-.012778*t)+.2989558*Math.exp(-.1932605*t))
  if(positive(value))vdot={value,sourceRef:ref(sustained),measuredVO2max:false,automaticTrainingPace:false,formulaVersion:'DANIELS_GILBERT_1979_APPENDIX_A'}
 }
 return {thresholds:{speed:speed[0]??null,heartRate:hr[0]??null,allPairs:[...speed,...hr]},cs,vdot,
 eventProfile:{races,speedRetention800over400:ratio(r400,r800),speedRetention1500over800:ratio(r800,r1500),predicted400Seconds:null,predicted800Seconds:null,predicted1500Seconds:null,aerobicContributionPercent:null},
 limitations:['LT、VT、CS和VDOT分开保存，不互相覆盖；没有实测阈值不补默认值。','成绩比较为90日描述窗口；天气、赛程、疲劳及场地可影响结果，不是能力或病因诊断。','VDOT仅为持续比赛表现估计指数，不是实测VO2max，不自动生成阈值处方。','固定乳酸交点不是每个人的LT；单次高R2不证明CS适用于处方。']}
}
/** Descriptive interpolation only. Input curve is explicitly a single ordered laboratory protocol. */
export function fixedLactateCrossing(stages:readonly {speed:number;lactate:number}[],target:number){
 if(stages.length<2||!positive(target)||stages.some((s,i)=>!positive(s.speed)||!Number.isFinite(s.lactate)||s.lactate<0||i>0&&(s.speed<=stages[i-1].speed||s.lactate<stages[i-1].lactate)))return null
 if(stages.filter(s=>s.lactate===target).length>1)return null
 const exact=stages.find(s=>s.lactate===target);if(exact)return {label:'OBLA'+target,speed:exact.speed,isIndividualLT:false as const}
 for(let i=1;i<stages.length;i++){const a=stages[i-1],b=stages[i];if(a.lactate<target&&b.lactate>target)return {label:'OBLA'+target,speed:a.speed+(b.speed-a.speed)*(target-a.lactate)/(b.lactate-a.lactate),isIndividualLT:false as const}}
 return null
}
