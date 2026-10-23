import type { PersonalResponseInput, PersonalResponseReview, ResponseFact, TrainingFact } from './analysis-contract'
import { projectAnalysisEvidence, refOf, stableJson } from './analysis-evidence'
export type ResponseTimeline={trainingRef:ReturnType<typeof refOf>;timeOrigin:'TRAINING_END'|'START_END_UNKNOWN';observations:{ref:ReturnType<typeof refOf>;hours:number;value:number|null;measure:string;scale:string}[];endpointInterval:[number,number]|null;rightCensoredAt:number|null;confounders:string[];comparable:boolean;reason:string[]}
export const quantile=(values:number[],p:number):number|null=>{if(!values.length)return null;const a=[...values].sort((a,b)=>a-b),x=(a.length-1)*p,l=Math.floor(x);return a[l]+(a[Math.ceil(x)]-a[l])*(x-l)}
/** Exact-dose matching is deliberately conservative: no unvalidated similarity tolerance. */
export function responseProtocol(t:TrainingFact):string|null {
 if(!t.protocolKey||!t.deviceId||!t.accountRef)return null
 if(t.modality==='STRENGTH'&&(!t.strengthSets.length||t.strengthSets.some(s=>s.completion==='COMPLETED'&&(!s.catalogId||!s.catalogVersion||s.side==='UNSPECIFIED'||s.loadKg===null||s.loadBasis==='UNKNOWN'||s.reps===null&&s.holdSeconds===null||s.rir===null||!s.rangeProtocol))))return null
 if(t.modality==='RUN'&&(!t.runSegments.length||t.runSegments.some(s=>s.completion==='COMPLETED'&&(s.distanceM===null||s.durationSeconds===null||s.surface===null))))return null
 return stableJson([t.athleteId,t.provider,t.accountRef,t.deviceId,t.protocolKey,t.modality,t.strengthSets.map(({id,...s})=>s),t.runSegments.map(({id,...s})=>s)])
}
export function reviewPersonalResponse(input:PersonalResponseInput):PersonalResponseReview & {timeline:ResponseTimeline[];windows:{hours:number;sessionCount:number;median:number|null;iqr:[number,number]|null}[]} {
 const s=projectAnalysisEvidence({context:input.context,facts:[...input.training,...input.responses]})
 const all=s.facts.filter((f):f is TrainingFact=>f.kind==='TRAINING'),training=all.filter(t=>t.protocolKey===input.protocolKey||input.protocolKey==='UNCONFIRMED'&&!t.protocolKey).sort((a,b)=>a.startedAt.localeCompare(b.startedAt))
 const responses=s.facts.filter((f):f is ResponseFact=>f.kind==='RESPONSE'&&f.region===input.region&&f.side===input.side)
 const comparator=training.at(-1)?responseProtocol(training.at(-1)!):null
 const timeline:ResponseTimeline[]=training.map(t=>{
  const rs=responses.filter(r=>r.relatedTrainingRefs.some(x=>x.id===t.id&&x.revision===t.revision)).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt))
  const observations=rs.map(r=>({ref:refOf(r),hours:(Date.parse(r.occurredAt)-Date.parse(t.endedAt??t.startedAt))/3600000,value:r.value,measure:r.measure,scale:r.scale})).filter(r=>r.hours>=0)
  const confounders=all.filter(o=>o.canonicalActivityId!==t.canonicalActivityId&&Date.parse(o.startedAt)>Date.parse(t.startedAt)&&Date.parse(o.startedAt)<=Math.max(Date.parse(t.startedAt),...rs.map(r=>Date.parse(r.occurredAt)))).map(o=>`重叠训练:${o.id}`)
  for(const r of rs)if(r.notes)confounders.push(`自报背景:${r.notes}`)
  // Only this explicitly named self-report endpoint is implemented, never inferred clinical recovery.
  const endpoint=rs.filter(r=>input.registeredEndpoint==='SELF_REPORTED_SORENESS_ZERO_V1'&&r.measure==='SORENESS'&&r.scale==='0-10_HIGH_WORSE'&&r.observationProtocol==='SELF_REPORTED_SORENESS_ZERO_V1'&&r.value!==null).map(r=>({hours:(Date.parse(r.occurredAt)-Date.parse(t.endedAt??t.startedAt))/3600000,value:r.value!})).filter(r=>r.hours>=0)
  const met=endpoint.find(r=>r.value===0),prior=met?endpoint.filter(r=>r.hours<met.hours&&r.value>0).at(-1):null
  const reason=[...(!comparator||responseProtocol(t)!==comparator?['动作、剂量、来源或测量协议不完整/不匹配']:[]),...(!t.endedAt?['训练结束时刻未知，小时数仅从开始时刻描述，不作为可比恢复间隔']:[]),...(!rs.every(r=>r.observationProtocol===input.registeredEndpoint)?['反馈协议不匹配']:[]),...confounders]
  return {trainingRef:refOf(t),timeOrigin:t.endedAt?'TRAINING_END':'START_END_UNKNOWN',observations,endpointInterval:met?[prior?.hours??0,met.hours]:null,rightCensoredAt:!met&&endpoint.length?endpoint.at(-1)!.hours:null,confounders,comparable:reason.length===0,reason}
 })
 const comparable=timeline.filter(t=>t.comparable),windows=[24,48,72].map(hours=>{
  // An exact scheduled elapsed hour is required; observations outside it remain visible, never interpolated.
  const xs=comparable.flatMap(t=>{const o=t.observations.filter(o=>o.hours===hours&&o.measure==='SORENESS'&&o.scale==='0-10_HIGH_WORSE'&&o.value!==null);return o.length===1?[o[0].value!]:[]})
  return {hours,sessionCount:xs.length,median:quantile(xs,.5),iqr:xs.length?[quantile(xs,.25)!,quantile(xs,.75)!] as [number,number]:null}
 })
 const evidenceRefs=[...training,...responses].map(refOf),missingCount=timeline.filter(t=>!t.observations.length).length
 const status=!training.length?'UNCALIBRATED':!comparator?'NOT_COMPARABLE':comparable.some(t=>t.observations.length)?'DESCRIPTIVE':'INSUFFICIENT'
 return {status,endpoint:input.registeredEndpoint,independentSessionCount:new Set(training.map(t=>t.canonicalActivityId)).size,observationCount:timeline.reduce((n,t)=>n+t.observations.length,0),intervalCensoredCount:timeline.filter(t=>t.endpointInterval).length,rightCensoredCount:timeline.filter(t=>t.rightCensoredAt!==null).length,missingCount,comparator,estimateInterval:null,unit:null,validationReportId:null,evidenceRefs,caveats:['未校准：仅描述真实观测，不预测组织恢复或许可训练','未登记的终点不拟合；缺失与72小时后仍有症状者保留','同一训练多次随访不作为独立样本','睡眠、疾病、测量条件缺少时，不能排除混杂'],isTissueRecoveryPrediction:false,canAuthorizeTraining:false,timeline,windows}
}
