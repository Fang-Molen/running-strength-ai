import { assessAthleteHistory, historySummary } from '../coach/assessment/history'
import { readEffectiveTrainingProfile } from '../coach/loop/effective-training'
import { readSymptoms, symptomResponses } from './symptom-store'
import { reviewSymptoms } from './symptom-review'
import { importedResponseFacts } from './analysis-followup'
import type { AnalysisFact, MetricFact, ResponseFact, TrainingFact } from './analysis-contract'
import { currentAthleteId } from '../core/events'
import { readRecoveryProjection } from './recovery-host-u11'
import { loadHealthSnapshot, HEALTH_LABELS } from './snapshot'
import { dailyCheckin } from './analysis'
import { loadEntries, aggregate, nutrientOf } from '../nutrition/log'
import {buildR4Review} from '../coach/r4/assessment'
import { readUnifiedFacts } from './unified-fact-store'
import { exactInstant } from './unified-facts'
import { projectAnalysisEvidence, analysisDigest } from './analysis-evidence'
import { buildMuscleExposure, exposureText } from './muscle-exposure'
import { evaluateRecoveryEvidence } from './recovery-assessment'
import { buildCoachAnalysisPacket } from './analysis-packet'
import { readPersonalResponses } from './personal-response-store'
import { personalHistorySummary } from './personal-response'
import { detectRedFlags } from '../core/coach-red-flags'
import { localDay } from './observation'
import { loadCorosHealth } from './coros-mcp-client'
import { readTrainingModelReview, trainingModelSummary } from '../coach/training-models/host'

/** One read-only projection supplies the existing health/coach/muscle consumers. */
export function readAnalysis(day=localDay(),asOf=new Date().toISOString(),question='',options:{r4ReferencePreview?:boolean}={}){
 const muscle=readRecoveryProjection(day,asOf,90*24),context={...muscle.analysis.context},athleteId=currentAthleteId(),facts:AnalysisFact[]=[...muscle.analysis.facts],gaps=[...muscle.review.gaps]
 const meta=(id:string,occurredAt:string,knownAt:string)=>({id,revision:0,athleteId,provider:'MANUAL' as const,accountRef:null,deviceId:null,protocolKey:null,sourceRecordId:id,occurredAt,knownAt,receivedAt:knownAt,sourceTimeZone:null,status:'CONFIRMED' as const,quality:'PARTIAL' as const,ownershipReceiptId:null})
 const raw=readUnifiedFacts(context.asOf)
 for(const f of raw.facts){const measured=f.end??f.start
  // A provider day is a calendar interval, not a synthetic measurement at sync time.
  const at=measured??(f.utcOffsetMinutes!==null?new Date(Date.parse(f.day+'T00:00:00Z')-f.utcOffsetMinutes*60000).toISOString():null)
  if(!at){gaps.push(`${f.metric}有日记录但时区/测量时刻未知；保留原日记录，不拼日内曲线`);continue}
  if(!measured)gaps.push(`${f.metric}为日级证据，测量时刻未知`)

  facts.push({...meta('device:'+JSON.stringify([f.provider,f.accountRef,f.deviceId,f.recordId,f.metric]),at,f.receivedAt),revision:f.revision,provider:f.provider,accountRef:f.accountRef,deviceId:f.deviceId,protocolKey:f.protocol,sourceRecordId:f.recordId,kind:'METRIC',temporalResolution:measured?'INSTANT':'DAY',observedAt:measured,metric:f.metric,value:f.value,unit:f.unit,statistic:'UNKNOWN',windowStart:f.start,windowEnd:f.end,providerDate:f.day,isFinal:null,energyKind:({ACTIVE_KCAL:'ACTIVE',RESTING_KCAL:'RESTING',TOTAL_KCAL:'TOTAL',WORKOUT_KCAL:'WORKOUT'} as const)[f.metric as 'ACTIVE_KCAL']??null})
 }
 for(const f of raw.evidence)if(f.quality!=='VALID')gaps.push(`${f.metric}: ${f.quality}（${f.provider}，不补零）`)
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
 const training=facts.filter((f):f is TrainingFact=>f.kind==='TRAINING')
 const responseRows=[...readPersonalResponses(context.asOf),...importedResponseFacts(athleteId,context.asOf,training)]
 for(const f of responseRows){if(f.relatedTrainingRefs.length&&!f.relatedTrainingRefs.every(r=>training.some(t=>t.id===r.id&&t.revision===r.revision))){gaps.push('历史反馈依赖的训练已更正/撤销或超出读取窗口，未绑定到新版本');continue}facts.push(f)}
 const symptoms=readSymptoms(context.asOf),symptomReview=reviewSymptoms(symptoms,day,14)
 facts.push(...symptomResponses(symptoms))
 const flags=detectRedFlags(question),pain=muscle.painReviewRequired||muscle.review.regions.some(r=>r.state==='PAIN_REVIEW')||ci?.pain==='mild'||ci?.pain==='sharp'
 const restrictions=readEffectiveTrainingProfile().restrictions.filter(r=>!/^健康筛查：UNKNOWN$/.test(r.value))
 const safetyConstraints=[...restrictions.map((r,i)=>({id:'profile-restriction:'+i,version:r.version,scope:'PAIN_REVIEW',evidenceRefs:[]})),...symptomReview.constraints,...(pain?[{id:'existing-pain',version:muscle.revision,scope:'PAIN_REVIEW',evidenceRefs:[]}]:[]),...(flags.level!=='NONE'?[{id:'existing-red-flags',version:'CURRENT',scope:flags.level,evidenceRefs:[]}]:[])]
 const foods=loadEntries().filter(f=>(f.athleteId??'local')===athleteId&&f.date===day&&exactInstant(f.recordedAt)&&Date.parse(f.recordedAt)<=Date.parse(context.asOf))
 const energy=aggregate(foods).kcal
 const nutrition={recordCount:foods.length,loggedKcal:energy.known ? energy.sum : null,unknownEnergyCount:energy.pending,dayComplete:false as const,energyDeficitKcal:null,sources:foods.map(f=>({id:f.id,source:f.source,food:f.name,portion:f.amount??f.grams??null,portionUnit:f.unit??(f.grams!=null?'g':'UNKNOWN'),uncertainty:f.nutritionSource?.uncertainty??'UNKNOWN',knownAt:f.recordedAt})),note:'只合计已记录食物；全天完整度与估计误差未知。先补餐食/分量，不诊断摄入不足，不重复加活动与训练热量。'}
 if(foods.length && nutrition.loggedKcal!==null){const knownAt=foods.map(f=>f.recordedAt!).sort().at(-1)!;facts.push({...meta('nutrition:logged:'+day,knownAt,knownAt),sourceRecordId:'nutrition:logged:'+day,revision:0,kind:'METRIC',metric:'饮食已记录能量（全天完整度未确认，不代表全天摄入）',value:nutrition.loggedKcal,unit:'kcal',statistic:'DAILY_TOTAL',windowStart:null,windowEnd:null,providerDate:day,isFinal:false,energyKind:null})}
 const cachedCoros=loadCorosHealth(athleteId),coros=cachedCoros&&Date.parse(cachedCoros.fetchedAt)<=Date.parse(context.asOf)?cachedCoros:null,corosDay=coros?.days.find(d=>d.date===day&&d.date<=context.asOf.slice(0,10))
 if(corosDay)gaps.push('高驰日级数据保留来源；账号到本机运动员的服务端绑定未核验，不可外发或与其他设备合成基准')
 const snapshot=projectAnalysisEvidence({context,facts,gaps,safetyConstraints}),exposure=buildMuscleExposure(snapshot),assessment=evaluateRecoveryEvidence(snapshot,exposure)
 const personal=personalHistorySummary(snapshot.facts.filter((f):f is TrainingFact=>f.kind==='TRAINING'),snapshot.facts.filter((f):f is ResponseFact=>f.kind==='RESPONSE'),context)
 if(personal.status==='DESCRIPTIVE'&&personal.evidenceRefs.length)assessment.observations.push({text:`个人历史：${personal.matchedSessionCount}次同来源同协议实际训练；${personal.windows.map(w=>`${w.hours}h有${w.sessionCount}次观测`).join('、')}。${personal.caveat}`,evidenceRefs:personal.evidenceRefs})
 const history=assessAthleteHistory(snapshot)
 assessment.observations.push(...history.observations)
 const packet=buildCoachAnalysisPacket(snapshot,assessment,exposure,{question})
 // R4 remains an explicitly requested, read-only review preview until app acceptance.
 const professionalReference=options.r4ReferencePreview===true?buildR4Review(snapshot,question||'当前已记录事实',{foods:foods.map(f=>({kcal:nutrientOf(f,'kcal'),protein:nutrientOf(f,'protein'),carb:nutrientOf(f,'carb'),fat:nutrientOf(f,'fat'),fiber:nutrientOf(f,'fiber')}))}):null
 const trainingModels=readTrainingModelReview(snapshot,assessment)
 return {snapshot,exposure,assessment,packet,history,nutrition,personal,muscle,trainingModels,professionalReference,coros:corosDay?{...corosDay,accountRef:coros?.accountRef??null,sessionScope:coros?.sessionScope??null,receivedAt:coros?.knownAtByDay?.[day]??coros?.fetchedAt,measuredAt:null,athleteOwnershipVerified:false}:null,revision:analysisDigest([day,snapshot.facts,snapshot.gaps,snapshot.conflicts,snapshot.safetyConstraints,nutrition,corosDay??null]),automaticPrescription:false as const}
}
export function analysisText(a:ReturnType<typeof readAnalysis>){return [historySummary(a.history),exposureText(a.exposure),trainingModelSummary(a.trainingModels.review),...a.assessment.observations.map(o=>o.text),...a.assessment.hypotheses.map(h=>`可能解释：${h.claim}。现有反证 ${h.weakeningRefs.length} 条；下一次观察：${h.discriminator}`),a.nutrition.recordCount?`${a.nutrition.loggedKcal===null?'饮食已记，热量未知':`饮食已记 ${a.nutrition.loggedKcal} kcal`}；${a.nutrition.unknownEnergyCount}条热量未知；${a.nutrition.note}`:'餐食完整性待确认，不计算热量缺口。',a.coros?`高驰 ${a.coros.date} 日级记录：${a.coros.hrvMs!=null?`HRV ${a.coros.hrvMs} ms；`:''}${a.coros.sleepMinutes!=null?`睡眠 ${a.coros.sleepMinutes} 分钟；`:''}测量时刻未知，不作为今天的实测或训练许可。`:'',`数据充分性 ${a.assessment.dataQuality}；安全状态 ${a.assessment.safetyState}。`,...a.assessment.candidates.flatMap(c=>[`候选 ${c.action??c.kind}：${c.reason??''}；${c.observation??''}；待确认，不写入计划`,...c.conditions]),a.assessment.missingDecisionInputs[0]??'下一次保留同协议观察，不能从相关性确认因果。'].filter(Boolean).join('\n')}
