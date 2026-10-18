import { ABILITY_STANDARD_VERSION, buildAbilityProfile, type AbilityMeasurement, type AbilityProfile, type AbilityMetricRequest, calculateAbilityMetric } from './coach-ability-standard.ts'
import type { EvolutionEvidence, EvolutionSnapshot } from './coach-evolution-v4.ts'
import type { ReasoningFrame } from './coach-reasoning.ts'
import type { OfflineProfile, OfflineReview } from './coach-offline-loop.ts'
import type { RunningPlanSnapshot } from './running-plan.ts'
import type { StructuredCoachingCandidate } from './coach-structured-candidate.ts'
import { strictIso } from './coach-v4-c11-adapter.ts'

export type EvidenceDependency={id:string;sourceId:string;occurrenceId:string;signature:string;eventAt:string;recordedAt:string}
export function fullEvidenceDependencies(snapshot:EvolutionSnapshot):EvidenceDependency[]{
  return snapshot.active.filter(e=>e.athleteId===snapshot.athleteId&&e.source!=='PLAN'&&e.source!=='THIRD_PARTY'&&Date.parse(e.eventAt)<=Date.parse(snapshot.asOf)&&Date.parse(e.recordedAt)<=Date.parse(snapshot.asOf)).map(e=>({id:e.id,sourceId:e.sourceId,occurrenceId:e.occurrenceId,signature:JSON.stringify(e),eventAt:e.eventAt,recordedAt:e.recordedAt}))
}
export type ApprovedCourse={id:string;athleteId:string;sport:string;purpose:string;stage:string;protocolKey:string;planVersion:string;approvedAt:string;recordedAt:string;approvalSourceId:string;approvedBy:'USER'|'COACH';approvalStatus:'APPROVED'|'REVOKED';observationHypothesisIds:string[];snapshot:RunningPlanSnapshot}
export type ObservationTask={id:string;hypothesisIds:string[];reason:string;courseId:string|null;courseVersion:string|null;metrics:string[];supportOutcome:string;refuteOutcome:string;doNotExecute:string[];sourceIds:string[];status:'OBSERVATION_ONLY'|'APPROVED_COURSE_CANDIDATE'|'SAFETY_HOLD';planWrite:false}
export type ControlledCycleCandidate=StructuredCoachingCandidate&{id:string;observationTaskIds:string[];hypothesisIds:string[];courseId:string|null;planVersion:string|null;purpose:string;stage:string;competitionDate:string|null;competitionPriority:string;reason:string;requiresConfirmation:true;planWrite:false;medicalClearance:false}
export type InvalidatedSource={id:string;sourceId:string;occurrenceId:string}
export type DevelopmentProjection={version:'FK-R184-DEVELOPMENT-1';ability:AbilityProfile;observationTasks:ObservationTask[];cycleCandidate:ControlledCycleCandidate;transfer:{measurementFacts:string[];technicalObservations:string[];physiologicalInterpretations:string[];causalTransferEstablished:false};prediction:{status:'UNAVAILABLE';seconds:null;reason:string;sourceCutoff:string};dependencies:EvidenceDependency[];invalidatedSources?:InvalidatedSource[];corrections:EvolutionSnapshot['corrections'];dependenciesComplete:boolean;planWrite:false}
const visible=(t:string,asOf:string)=>strictIso(t)&&strictIso(asOf)&&Date.parse(t)<=Date.parse(asOf)

function rawObservation(metricId:'SEN04'|'PWR01'|'REC01',rows:EvolutionEvidence[],snapshot:EvolutionSnapshot):AbilityMeasurement{
  const times=rows.map(r=>r.eventAt).sort((a,b)=>Date.parse(a)-Date.parse(b)),recordTimes=rows.map(r=>r.recordedAt).sort((a,b)=>Date.parse(a)-Date.parse(b))
  return {id:`observed:${snapshot.athleteId}:${metricId}:${rows.map(r=>r.id).join('|')}`,athleteId:snapshot.athleteId,metricId,variant:metricId==='SEN04'?'PARTIAL_TRAINING_OBSERVATIONS':metricId==='PWR01'?'RAW_TRAINING_SETS':null,occurrenceIds:[...new Set(rows.map(r=>r.occurrenceId))],value:null,unit:'mixed',components:rows.map(r=>({id:r.context,value:r.value,unit:r.unit})),status:'RAW_AVAILABLE',reasons:[metricId==='SEN04'?'保留实际分段与原始距离；完整性、目的或协议不足时不生成跨组指标。':metricId==='PWR01'?'只展示力量实际组次和负荷；协议、动作及体重条件不足时不计算相对e1RM或推断迁移。':'信号分别展示，不汇总为恢复评分。'],sourceRefs:rows.map(r=>({id:r.sourceId,revision:JSON.stringify(r),role:'MEASUREMENT'})),eventTime:times.at(-1)??null,recordedAt:recordTimes.at(-1)??null,asOf:snapshot.asOf,protocolKey:null,formulaVersion:ABILITY_STANDARD_VERSION+':OBSERVATIONS',formula:'raw_visible_observations_only',estimate:false,validity:'UNKNOWN',reliability:null,metrics:{}}
}

/** No new athlete store: consumed by OfflineReview and saved in its existing append-only journal. */
export function buildDevelopmentProjection(input:{snapshot:EvolutionSnapshot;frame:ReasoningFrame;profile:OfflineProfile;purpose:OfflineReview['purpose'];hypotheses:OfflineReview['hypotheses'];occurrenceId:string|null;safetyRestricted:boolean;metricRequests?:readonly AbilityMetricRequest[];approvedCourses?:readonly ApprovedCourse[];invalidatedSources?:readonly InvalidatedSource[]}):DevelopmentProjection{
  const {snapshot:s,frame,profile,purpose,hypotheses}=input
  const dependencies=fullEvidenceDependencies(s),actual=s.active.filter(e=>e.athleteId===s.athleteId&&e.source!=='PLAN'&&e.source!=='THIRD_PARTY'&&e.value!==null&&visible(e.eventAt,s.asOf)&&visible(e.recordedAt,s.asOf))
  const measurements:AbilityMeasurement[]=[]
  const selected=actual.filter(e=>e.occurrenceId===input.occurrenceId)
  const splits=selected.filter(e=>e.metric==='SPLIT_SECONDS'&&e.unit==='s')
  if(splits.length)measurements.push(rawObservation('SEN04',splits,s))
  const strength=selected.filter(e=>['STRENGTH_REPS','STRENGTH_KG','STRENGTH_SECONDS'].includes(e.metric))
  if(strength.length)measurements.push(rawObservation('PWR01',strength,s))
  const recovery=selected.filter(e=>['SLEEP_HOURS','SESSION_RPE','PAIN_SCORE','SUBJECTIVE_RECOVERY','SORENESS','HR_AVG_BPM'].includes(e.metric))
  if(recovery.length)measurements.push(rawObservation('REC01',recovery,s))
  for(const request of input.metricRequests??[]){
    // An adapter may annotate effective facts but cannot inject another athlete, future evidence or invented measurements.
    const datums=[...Object.values(request.input.values??{}),...request.input.series??[]].filter((d):d is NonNullable<typeof d>=>!!d)
    if(request.input.athleteId!==s.athleteId||request.input.asOf!==s.asOf)continue
    const hasUnboundDatum=datums.some(d=>
      !['ACTUAL','SELF_REPORT'].includes(d.kind)||!d.sourceIds.length||
      d.sourceIds.some(id=>!actual.some(e=>
        e.id===d.id&&e.sourceId===id&&e.value===d.value&&e.unit===d.unit&&
        e.eventAt===d.at&&e.recordedAt===d.recordedAt&&d.revision===JSON.stringify(e)
      ))
    )
    if(hasUnboundDatum)continue
    measurements.push(calculateAbilityMetric(request))
  }
  const ability=buildAbilityProfile({athleteId:s.athleteId,asOf:s.asOf,sport:profile.event,populationKey:null,measurements})
  const visibleCourses=(input.approvedCourses??[]).filter(c=>c.athleteId===s.athleteId&&visible(c.recordedAt,s.asOf)&&visible(c.approvedAt,c.recordedAt))
  const approved=visibleCourses.filter(c=>c.approvalStatus==='APPROVED'&&!visibleCourses.some(other=>other!==c&&other.id===c.id&&Date.parse(other.recordedAt)>=Date.parse(c.recordedAt))&&profile.event!==null&&c.sport===profile.event&&purpose.purpose!=='UNKNOWN'&&c.purpose===purpose.purpose&&purpose.stage!=='UNKNOWN'&&c.stage===purpose.stage&&c.protocolKey&&c.planVersion&&c.approvalSourceId&&hypotheses.length>0&&hypotheses.every(h=>c.observationHypothesisIds.includes(h.id))&&['USER','COACH'].includes(c.approvedBy)&&visible(c.snapshot.capturedAt,c.approvedAt)&&c.snapshot.sourcePlanId===c.id)
  // Ambiguous approvals do not result in an arbitrary course choice.
  const course=approved.length===1&&!input.safetyRestricted?approved[0]:null
  const observationTasks:ObservationTask[]=hypotheses.slice(0,2).map(h=>({id:`observe:${s.athleteId}:${input.occurrenceId??'background'}:${h.id}`,hypothesisIds:[h.id],reason:h.explanation,courseId:course?.id??null,courseVersion:course?.planVersion??null,metrics:frame.computed.strength.length?['同动作、相同活动范围的实际组次和负重','整课RPE','动作观察及次日反应']:['同轮逐段实际距离与用时','实际组间及轮间休息','计时方式、环境及整课RPE','次日恢复与症状'],supportOutcome:`在记录条件一致的后续观察中复核：${h.support.join('；')||'先建立可比较记录'}。只支持暂定解释，不确认病因。`,refuteOutcome:h.against.join('；')||'若可比条件下未再出现相同现象或出现相反证据，削弱原解释。',doNotExecute:['疼痛、急症线索、病后异常或专业许可不足时不安排负荷测试','原目的、协议或课程批准版本不明时只补记录','不以缺少数据为由增加剂量或安排全力测试'],sourceIds:[...h.sourceIds,...(course?[course.approvalSourceId]:[])],status:input.safetyRestricted?'SAFETY_HOLD':course?'APPROVED_COURSE_CANDIDATE':'OBSERVATION_ONLY',planWrite:false}))
  if(!observationTasks.length)observationTasks.push({id:`observe:${s.athleteId}:${input.occurrenceId??'background'}:context`,hypothesisIds:[],reason:input.safetyRestricted?'安全限制优先。':'当前事实不足以定位短板，先补最重要的信息。',courseId:null,courseVersion:null,metrics:[purpose.purpose==='UNKNOWN'?'原计划目的':'同协议实际记录','症状与整课反馈'],supportOutcome:'有有效来源后才能建立待验证假设。',refuteOutcome:'新的记录与原转述矛盾时保留冲突并核对，不择值。',doNotExecute:['不为补齐能力图安排未经批准的测试'],sourceIds:purpose.sourceIds,status:input.safetyRestricted?'SAFETY_HOLD':'OBSERVATION_ONLY',planWrite:false})
  const reason=input.safetyRestricted?'既有安全门控限制，暂不生成训练调整。':course?'将已批准课程作为观察候选；确认观察安排与原版本后再执行。':'暂无唯一且与当前目的、阶段匹配的已批准课程，只生成观察任务。'
  const cycleCandidate:ControlledCycleCandidate={id:`cycle:${s.athleteId}:${input.occurrenceId??'background'}:${s.asOf}`,decision:course?'CONDITIONAL_REPEAT':'HOLD',changed_variable:null,from:null,to:null,unchanged:['原正式训练计划、剂量及版本'],stop_conditions:observationTasks.flatMap(t=>t.doNotExecute),preconditions:['用户确认观察候选','原安全门控与适用的专业许可继续有效','目的、实际表现和比赛优先级已核对'],rule_ids:['FK-R182-STD-20','FK-R182-STD-23','FK-NO-AUTO-WRITE'],observationTaskIds:observationTasks.map(t=>t.id),hypothesisIds:hypotheses.map(h=>h.id),courseId:course?.id??null,planVersion:course?.planVersion??null,purpose:purpose.purpose,stage:purpose.stage,competitionDate:profile.competitionDate,competitionPriority:profile.competitionPriority,reason,requiresConfirmation:true,planWrite:false,medicalClearance:false}
  return {version:'FK-R184-DEVELOPMENT-1',ability,observationTasks,cycleCandidate,transfer:{measurementFacts:[...frame.computed.strength.map(s=>JSON.stringify(s)),...frame.computed.points.map(p=>`${p.distanceMeters??'UNKNOWN'}m / ${p.seconds}s [${p.sourceId}]`)],technicalObservations:ability.independent.find(d=>d.domain==='TECHNIQUE')?.measurements.flatMap(m=>m.components.map(c=>`${c.id}: ${c.value??'UNKNOWN'} ${c.unit}`))??[],physiologicalInterpretations:['力量、动作观察与跑步表现需分层；没有直接验证时不认定训练迁移或代谢经济性改善。'],causalTransferEstablished:false},prediction:{status:'UNAVAILABLE',seconds:null,reason:'尚无经核准且通过时间外验证的成绩预测模型；间歇合计与能力图不生成精确PB。',sourceCutoff:s.asOf},dependencies,invalidatedSources:input.invalidatedSources?.map(d=>({...d}))??[],corrections:s.corrections.map(c=>({...c})),dependenciesComplete:s.quarantined.length===0&&(s.scopeConflictCount??0)===0,planWrite:false}
}

export type HypothesisState='PENDING'|'SUPPORTED'|'WEAKENED'|'WITHDRAWN'
export type HypothesisRevision={priorReviewId:string;hypothesisId:string;status:HypothesisState;reason:string;evidenceIds:string[];priorSourceSignatures:string[];reviewedAt:string;manualObservation:boolean}
export type LinkedObservation={hypothesisId:string;sourceReviewId:string;observedReviewId:string;outcome:'SUPPORT'|'REFUTE'|'INCONCLUSIVE';sourceIds:string[];reviewedAt:string;reviewer:string;reason:string;confirmed:true;protocolKey:string}
/** Source corrections invalidate dependent hypotheses; omissions outside a known scope do not. */
export function reviseHypotheses(priorReviewId:string,prior:OfflineReview,current:OfflineReview,observations:readonly LinkedObservation[]=[],currentReviewId:string|null=null,evaluationAsOf=current.asOf):HypothesisRevision[]{
  if(prior.athleteId!==current.athleteId||!visible(current.asOf,evaluationAsOf)||Date.parse(prior.asOf)>=Date.parse(current.asOf))return []
  const currentDependencies=current.development?.dependencies??[],priorDependencies=prior.development?.dependencies??[]
  const corrections=current.development?.corrections??[]
  const replaced=(id:string):boolean=>{
    const seen=new Set<string>();let cursor=id
    while(!seen.has(cursor)){
      seen.add(cursor);const correction=corrections.find(c=>c.replacedId===cursor)
      if(!correction)return false
      if(currentDependencies.some(d=>d.id===correction.replacementId))return true
      cursor=correction.replacementId
    }
    return false
  }
  return prior.hypotheses.map(h=>{
    const dependencies=priorDependencies.filter(d=>h.sourceIds.includes(d.sourceId))
    // Absence can mean incomplete reading, a different scope, or an unavailable import.
    // Withdraw only on a visible replacement chain or a changed version of the same evidence ID.
    const changed=current.development?.dependenciesComplete===true&&dependencies.some(p=>current.development?.invalidatedSources?.some(n=>n.id===p.id&&n.sourceId===p.sourceId&&n.occurrenceId===p.occurrenceId)||replaced(p.id)||currentDependencies.some(n=>n.id===p.id&&n.occurrenceId===p.occurrenceId&&n.signature!==p.signature))
    const base:HypothesisRevision={priorReviewId,hypothesisId:h.id,status:'PENDING',reason:'保留待验证；缺失不是反证，单次表现不修改能力分。',evidenceIds:[],priorSourceSignatures:dependencies.map(d=>d.signature),reviewedAt:evaluationAsOf,manualObservation:false}
    if(changed)return {...base,status:'WITHDRAWN',reason:'有效来源被更正或撤回；旧版本保留，依赖旧来源的解释撤回。',evidenceIds:currentDependencies.map(d=>d.sourceId)}
    const observation=observations.filter(o=>o.confirmed===true&&o.sourceReviewId===priorReviewId&&o.observedReviewId===currentReviewId&&o.hypothesisId===h.id&&o.reviewer.trim()&&o.reason.trim()&&o.sourceIds.length&&visible(o.reviewedAt,evaluationAsOf)&&Date.parse(o.reviewedAt)>=Date.parse(current.asOf)&&o.protocolKey===observationProtocolKey(current)&&o.protocolKey===observationProtocolKey(prior)&&current.comparableOccurrenceIds.includes(prior.occurrenceId??'')&&current.purpose.purpose!=='UNKNOWN'&&current.purpose.purpose===prior.purpose.purpose&&current.development?.dependenciesComplete===true&&o.sourceIds.every(id=>currentDependencies.some(d=>d.sourceId===id&&d.occurrenceId===current.occurrenceId&&Date.parse(d.eventAt)>Date.parse(prior.asOf)))).at(-1)
    if(!observation)return base
    return {...base,status:observation.outcome==='SUPPORT'?'SUPPORTED':observation.outcome==='REFUTE'?'WEAKENED':'PENDING',reason:`人工复核的同协议观察：${observation.reason}；这是暂定解释状态，不证明病因或训练因果。`,evidenceIds:[...observation.sourceIds],manualObservation:true}
  })
}

/** Deliberately unavailable without a recorded timing/device method; same distance alone is insufficient. */
export function observationProtocolKey(review:OfflineReview):string|null{
  if(review.purpose.purpose==='UNKNOWN'||!review.development?.dependenciesComplete)return null
  let rows:EvolutionEvidence[]
  try{rows=review.development.dependencies.filter(d=>d.occurrenceId===review.occurrenceId).map(d=>JSON.parse(d.signature) as EvolutionEvidence)}catch{return null}
  const work=rows.filter(e=>e.metric==='SPLIT_SECONDS'),rests=rows.filter(e=>e.metric==='REST_SECONDS')
  if(!work.length||!rests.length||work.some(e=>!e.measurement?.method||/UNKNOWN|未核验/.test(e.measurement.method)))return null
  return JSON.stringify([review.purpose.purpose,review.purpose.stage,work.map(e=>[e.context,e.unit,e.source,e.measurement!.method]).sort(),rests.map(e=>[e.context,e.value,e.unit]).sort()])
}

export function auditPredictionTimeline(input:{predictionAt:string;trainingCutoff:string;modelApproved:boolean;validation:{trainEnd:string;holdoutStart:string;holdoutEnd:string;reviewedAt:string;reviewer:string;modelVersion:string;approved:boolean}|null;features:readonly {eventAt:string;recordedAt:string}[]}){
  const reasons:string[]=[]
  if(!strictIso(input.predictionAt)||!visible(input.trainingCutoff,input.predictionAt))reasons.push('INVALID_TRAINING_CUTOFF')
  if(!input.features.length)reasons.push('FEATURE_EVIDENCE_UNAVAILABLE')
  if(input.features.some(f=>!visible(f.eventAt,input.trainingCutoff)||!visible(f.recordedAt,input.predictionAt)))reasons.push('FUTURE_INFORMATION_LEAKAGE')
  const v=input.validation
  if(!input.modelApproved||!v||!v.approved||!v.reviewer||!v.modelVersion||!visible(v.trainEnd,input.trainingCutoff)||![v.trainEnd,v.holdoutStart,v.holdoutEnd,v.reviewedAt].every(t=>visible(t,input.predictionAt))||Date.parse(v.trainEnd)>=Date.parse(v.holdoutStart)||Date.parse(v.holdoutStart)>Date.parse(v.holdoutEnd)||Date.parse(v.holdoutEnd)>Date.parse(v.reviewedAt))reasons.push('NO_RELIABLE_OUT_OF_TIME_VALIDATION')
  return {eligibleForModelReview:reasons.length===0,reasons,predictionSeconds:null,automaticPredictionAuthorized:false as const}
}
