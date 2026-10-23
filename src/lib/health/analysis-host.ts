import type { AnalysisFact, MetricFact, ResponseFact, TrainingFact } from './analysis-contract'
import { currentAthleteId } from '../core/events'
import { readRecoveryProjection } from './recovery-host-u11'
import { loadHealthSnapshot, HEALTH_LABELS } from './snapshot'
import { dailyCheckin } from './analysis'
import { loadEntries, aggregate } from '../nutrition/log'
import { readUnifiedFacts } from './unified-fact-store'
import { exactInstant } from './unified-facts'
import { projectAnalysisEvidence, analysisDigest } from './analysis-evidence'
import { buildMuscleExposure, exposureText } from './muscle-exposure'
import { evaluateRecoveryEvidence } from './recovery-assessment'
import { buildCoachAnalysisPacket } from './analysis-packet'
import { readPersonalResponses } from './personal-response-store'
import { reviewPersonalResponse } from './personal-response'
import { detectRedFlags } from '../core/coach-red-flags'
import { localDay } from './observation'
import { loadCorosHealth } from './coros-mcp-client'

/** One read-only projection supplies the existing health/coach/muscle consumers. */
export function readAnalysis(day=localDay(),asOf=new Date().toISOString(),question=''){
 const muscle=readRecoveryProjection(day,asOf),context={...muscle.analysis.context},athleteId=currentAthleteId(),facts:AnalysisFact[]=[...muscle.analysis.facts],gaps=[...muscle.review.gaps]
 const meta=(id:string,occurredAt:string,knownAt:string)=>({id,revision:0,athleteId,provider:'MANUAL' as const,accountRef:null,deviceId:null,protocolKey:null,sourceRecordId:id,occurredAt,knownAt,receivedAt:knownAt,sourceTimeZone:null,status:'CONFIRMED' as const,quality:'PARTIAL' as const,ownershipReceiptId:null})
 const raw=readUnifiedFacts(context.asOf)
 for(const f of raw.facts){const at=f.end??f.start;if(!at){gaps.push(`${f.metric}有日记录但测量时刻未知；不生成日内曲线`);continue}
  facts.push({...meta('device:'+JSON.stringify([f.provider,f.accountRef,f.deviceId,f.recordId,f.metric]),at,f.receivedAt),revision:f.revision,provider:f.provider,accountRef:f.accountRef,deviceId:f.deviceId,protocolKey:f.protocol,sourceRecordId:f.recordId,kind:'METRIC',metric:f.metric,value:f.value,unit:f.unit,statistic:'UNKNOWN',windowStart:f.start,windowEnd:f.end,providerDate:f.day,isFinal:null,energyKind:({ACTIVE_KCAL:'ACTIVE',RESTING_KCAL:'RESTING',TOTAL_KCAL:'TOTAL',WORKOUT_KCAL:'WORKOUT'} as const)[f.metric as 'ACTIVE_KCAL']??null})
 }
 const health=loadHealthSnapshot(day)
 for(const m of health.metrics){
  if(m.state==='CONFLICT'){gaps.push(`${m.label}独立来源有冲突，等待选源`);continue}
  for(const f of m.series){
   if(f.stream.startsWith('unified:')||raw.facts.some(r=>r.metric===m.metric&&r.day===f.day))continue
   if(!exactInstant(f.updatedAt)||!f.measuredAt||!exactInstant(f.measuredAt)){if(f===m.current)gaps.push(`${m.label}测量时刻未知；已留在原日级记录，不伪装今日实测`);continue}
   facts.push({...meta(`health:${f.stream}:${f.id}`,f.measuredAt,f.updatedAt),sourceRecordId:f.id,protocolKey:f.stream,provider:/佳明/.test(f.source)?'GARMIN':/高驰/.test(f.source)?'COROS':'MANUAL',accountRef:f.stream,deviceId:f.deviceLabel??null,kind:'METRIC',metric:m.metric,value:f.value,unit:({SLEEP:'h',HRV:'ms',RHR:'bpm',STEPS:'steps',ACTIVE_KCAL:'kcal',TOTAL_KCAL:'kcal',WORKOUT_KCAL:'kcal',RESTING_KCAL:'kcal'} as Record<string,string>)[m.metric]??'provider units',statistic:'UNKNOWN',windowStart:null,windowEnd:null,providerDate:f.day,isFinal:null,energyKind:({ACTIVE_KCAL:'ACTIVE',TOTAL_KCAL:'TOTAL',WORKOUT_KCAL:'WORKOUT',RESTING_KCAL:'RESTING'} as const)[m.metric as 'ACTIVE_KCAL']??null})
  }
 }
 const ci=dailyCheckin(day,context.asOf)
 if(ci&&exactInstant(ci.at)){
  if(ci.sleep!=null)facts.push({...meta('checkin:sleep:'+day,ci.at,ci.at),kind:'METRIC',metric:'SLEEP_SELF_REPORT',value:ci.sleep,unit:'h',statistic:'UNKNOWN',windowStart:null,windowEnd:null,providerDate:day,isFinal:null,energyKind:null})
  if(ci.recovery!=null)facts.push({...meta('checkin:recovery:'+day,ci.at,ci.at),kind:'RESPONSE',relatedTrainingRefs:[],region:null,side:'UNSPECIFIED',measure:'RECOVERY_FEELING',value:ci.recovery,scale:ci.recoveryScale===10?'1-10_HIGH_BETTER':'LEGACY_SCALE_UNCONFIRMED',observationProtocol:null,elapsedHours:null,functionTaskId:null,notes:ci.fatigue??null})
  if(ci.pain==='none')facts.push({...meta('checkin:pain:'+day,ci.at,ci.at),kind:'RESPONSE',relatedTrainingRefs:[],region:null,side:'UNSPECIFIED',measure:'PAIN',value:0,scale:'SELF_REPORT_ABSENCE',observationProtocol:null,elapsedHours:null,functionTaskId:null,notes:null})
 }
 facts.push(...readPersonalResponses(context.asOf))
 const flags=detectRedFlags(question),pain=muscle.review.regions.some(r=>r.state==='PAIN_REVIEW')||ci?.pain==='mild'||ci?.pain==='sharp'
 const safetyConstraints=[...(pain?[{id:'existing-pain',version:muscle.revision,scope:'PAIN_REVIEW',evidenceRefs:[]}]:[]),...(flags.level!=='NONE'?[{id:'existing-red-flags',version:'CURRENT',scope:flags.level,evidenceRefs:[]}]:[])]
 const foods=loadEntries().filter(f=>(f.athleteId??'local')===athleteId&&f.date===day&&exactInstant(f.recordedAt)&&Date.parse(f.recordedAt)<=Date.parse(context.asOf))
 const energy=aggregate(foods).kcal
 const nutrition={recordCount:foods.length,loggedKcal:energy.known ? energy.sum : null,unknownEnergyCount:energy.pending,dayComplete:false as const,energyDeficitKcal:null,sources:foods.map(f=>({id:f.id,source:f.source,food:f.name,portion:f.amount??f.grams??null,portionUnit:f.unit??(f.grams!=null?'g':'UNKNOWN'),uncertainty:f.nutritionSource?.uncertainty??'UNKNOWN',knownAt:f.recordedAt})),note:'只合计已记录食物；全天完整度与估计误差未知。先补餐食/分量，不诊断摄入不足，不重复加活动与训练热量。'}
 if(foods.length && nutrition.loggedKcal!==null){const knownAt=foods.map(f=>f.recordedAt!).sort().at(-1)!;facts.push({...meta('nutrition:logged:'+day,knownAt,knownAt),sourceRecordId:'nutrition:logged:'+day,revision:0,kind:'METRIC',metric:'饮食已记录能量（全天完整度未确认，不代表全天摄入）',value:nutrition.loggedKcal,unit:'kcal',statistic:'DAILY_TOTAL',windowStart:null,windowEnd:null,providerDate:day,isFinal:false,energyKind:null})}
 const cachedCoros=loadCorosHealth(athleteId),coros=cachedCoros&&Date.parse(cachedCoros.fetchedAt)<=Date.parse(context.asOf)?cachedCoros:null,corosDay=coros?.days.find(d=>d.date===day&&d.date<=context.asOf.slice(0,10))
 if(corosDay)gaps.push('高驰日级数据保留来源；账号到本机运动员的服务端绑定未核验，不可外发或与其他设备合成基准')
 const snapshot=projectAnalysisEvidence({context,facts,gaps,safetyConstraints}),exposure=buildMuscleExposure(snapshot),assessment=evaluateRecoveryEvidence(snapshot)
 const packet=buildCoachAnalysisPacket(snapshot,assessment,exposure)
 return {snapshot,exposure,assessment,packet,nutrition,coros:corosDay?{...corosDay,accountRef:coros?.accountRef??null,sessionScope:coros?.sessionScope??null,receivedAt:coros?.knownAtByDay?.[day]??coros?.fetchedAt,measuredAt:null,athleteOwnershipVerified:false}:null,revision:analysisDigest([day,snapshot.facts,snapshot.gaps,snapshot.conflicts,snapshot.safetyConstraints,nutrition,corosDay??null]),automaticPrescription:false as const}
}
export function analysisText(a:ReturnType<typeof readAnalysis>){return [exposureText(a.exposure),...a.assessment.observations.map(o=>o.text),...a.assessment.hypotheses.map(h=>`可能解释：${h.claim}。反证观察：${h.discriminator}`),a.nutrition.recordCount?`${a.nutrition.loggedKcal===null?'饮食已记，热量未知':`饮食已记 ${a.nutrition.loggedKcal} kcal`}；${a.nutrition.unknownEnergyCount}条热量未知；${a.nutrition.note}`:'餐食完整性待确认，不计算热量缺口。',a.coros?`高驰 ${a.coros.date} 日级记录：${a.coros.hrvMs!=null?`HRV ${a.coros.hrvMs} ms；`:''}${a.coros.sleepMinutes!=null?`睡眠 ${a.coros.sleepMinutes} 分钟；`:''}测量时刻未知，不作为今天的实测或训练许可。`:'',`数据充分性 ${a.assessment.dataQuality}；安全状态 ${a.assessment.safetyState}。`,...a.assessment.candidates.flatMap(c=>c.conditions),a.assessment.missingDecisionInputs[0]??'下一次保留同协议观察，不能从相关性确认因果。'].filter(Boolean).join('\n')}
