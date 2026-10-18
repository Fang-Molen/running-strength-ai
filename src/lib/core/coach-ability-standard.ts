import { calculateQuantitativeRule, type QuantDatum, type QuantInput } from './coach-quantitative.ts'
import { strictIso } from './coach-v4-c11-adapter.ts'
import { validLoadDay } from './coach-load-metrics.ts'

/** R182 research contract, implemented as read-only projections of existing facts. */
export const ABILITY_STANDARD_VERSION = 'FK-ABILITY-STD-1.0-ADAPTER-1'
export const COMPETITIVE_AXES = ['SPD', 'SEN', 'AER', 'PWR', 'ECO'] as const
export type AbilityAxis = typeof COMPETITIVE_AXES[number]
export type AbilityDomain = AbilityAxis | 'REC' | 'BEH' | 'COMPETITION_RESULT' | 'COMPETITION_POINTS' | 'TECHNIQUE'
export type MetricRole = 'COMPETITIVE_PROXY' | 'COMPETITION_RESULT' | 'DESCRIPTIVE' | 'CONTEXTUAL' | 'TRAINING_BEHAVIOR' | 'TECHNIQUE_OBSERVATION' | 'RECOVERY_STATE'
type MetricDefinition = { axis: AbilityDomain; title: string; role: MetricRole; units: readonly string[]; direction: 'higher' | 'lower' | 'context'; normEligible: boolean; boundary: string }
const metric = (axis: AbilityDomain, title: string, role: MetricRole, units: readonly string[], direction: MetricDefinition['direction'], normEligible: boolean, boundary: string): MetricDefinition => ({axis,title,role,units,direction,normEligible,boundary})
export const ABILITY_METRICS = {
  // R182 CSV says "lower" for m/s while its formula is 30/time. Correct the mathematical direction explicitly; no anchors are approved.
  SPD01: metric('SPD','飞行30米平均速度','COMPETITIVE_PROXY',['m/s'],'higher',true,'飞行段均速不是瞬时最高速度。'),
  SPD02: metric('SPD','30米加速段平均速度','COMPETITIVE_PROXY',['m/s'],'higher',true,'只描述同起跑协议的任务表现，不当作最高速度。'),
  SPD03: metric('COMPETITION_RESULT','200米比赛用时','COMPETITION_RESULT',['s'],'lower',false,'比赛表现独立展示；不换算五维能力分或世界田联积分。'),
  SEN01: metric('SEN','400/800米速度保持系数','COMPETITIVE_PROXY',['ratio'],'higher',true,'两距离比赛平均速度比，不诊断供能或乳酸耐受。'),
  SEN02: metric('SEN','800/1500米速度保持系数','COMPETITIVE_PROXY',['ratio'],'higher',true,'不同项目成绩需同季、同计时条件，不能用间歇合计替代。'),
  SEN03: metric('SEN','800米前后圈用时差','DESCRIPTIVE',['s'],'context',false,'战术影响分圈差，不按正负自动评价好坏。'),
  SEN04: metric('SEN','同轮等距离首末用时变化','CONTEXTUAL',['%'],'context',false,'解释取决于原目的、休息和顺序，不是速度耐力分。'),
  AER01: metric('AER','临界速度模型估计','COMPETITIVE_PROXY',['m/s'],'higher',true,'需有效极限测试和拟合审阅，不是乳酸阈值或保证比赛配速。'),
  AER02: metric('AER','实测阈值速度','COMPETITIVE_PROXY',['m/s'],'higher',true,'LT1与LT2按variant分别保存，不允许合并。'),
  AER03: metric('AER','标准化耐力任务','CONTEXTUAL',['s','m'],'context',false,'保留测试类型；不自动分配高好/低好或常模。'),
  PWR01: metric('PWR','同动作相对估计1RM','COMPETITIVE_PROXY',['ratio'],'higher',true,'Epley模型估计，不证明短跑或经济性迁移。'),
  PWR02: metric('PWR','同协议反向跳高度','COMPETITIVE_PROXY',['cm'],'higher',true,'跳跃任务测量不等于跑步功率或经济性。'),
  PWR03: metric('BEH','已确认力量训练暴露','TRAINING_BEHAVIOR',['session'],'context',false,'课程次数属于执行记录，绝不是力量能力。'),
  ECO01: metric('ECO','稳态氧耗成本','COMPETITIVE_PROXY',['ml/kg/km'],'lower',true,'需要有效稳态VO2、速度、鞋、坡度与设备条件。'),
  ECO02: metric('TECHNIQUE','动作与跑姿观察','TECHNIQUE_OBSERVATION',['mixed'],'context',false,'步频、触地、不对称分别记录，不代替代谢经济性。'),
  REC01: metric('REC','近期恢复信号','RECOVERY_STATE',['mixed'],'context',false,'各项独立展示，不合成恢复分或授予医学许可。'),
  BEH01: metric('BEH','到期计划已确认完成比例','TRAINING_BEHAVIOR',['%'],'context',false,'未记录不等于跳过；同时展示记录覆盖率。'),
} as const satisfies Record<string, MetricDefinition>
export type AbilityMetricId = keyof typeof ABILITY_METRICS
export type SourceRef = { id: string; revision: string | null; role: 'MEASUREMENT' | 'CONTEXT' }
export type ReliabilityReview = { id: string; metricId: AbilityMetricId; protocolKey: string; formulaVersion: string; unit: string; reviewedAt: string; reviewer: string; sourceIds: string[]; assumptionsReviewed: boolean; sem: number | null; te: number | null; swc: number | null }
export type AbilityMeasurement = {
  id: string; athleteId: string; metricId: AbilityMetricId; variant: string | null; occurrenceIds: string[]
  value: number | null; unit: string; components: { id: string; value: number | null; unit: string }[]
  status: 'RAW_AVAILABLE' | 'UNAVAILABLE'; reasons: string[]; sourceRefs: SourceRef[]
  eventTime: string | null; recordedAt: string | null; asOf: string; protocolKey: string | null
  formulaVersion: string; formula: string; estimate: boolean; validity: 'VALID' | 'UNKNOWN'
  reliability: ReliabilityReview | null; metrics: Record<string, number | null>
}
export type AbilityMetricRequest = { id: string; metricId: AbilityMetricId; input: QuantInput; protocolKey: string | null; variant?: string; reliability?: ReliabilityReview | null }
class MissingAbilityInput extends Error {}
function unavailable(reason: string): never { throw new MissingAbilityInput(reason) }
const timeVisible = (t: string | null, asOf: string) => t !== null && strictIso(t) && strictIso(asOf) && Date.parse(t) <= Date.parse(asOf)

/** No storage, no score calculation, no training decision. Returned measurements are derived views, not a second fact store. */
export function calculateAbilityMetric(request: AbilityMetricRequest): AbilityMeasurement {
  const {input,metricId}=request
  const definition: MetricDefinition | undefined = Object.hasOwn(ABILITY_METRICS,metricId) ? ABILITY_METRICS[metricId] : undefined
  const result: AbilityMeasurement={id:request.id,athleteId:input.athleteId,metricId,variant:request.variant??null,occurrenceIds:[],value:null,unit:definition?.units[0]??'',components:[],status:'UNAVAILABLE',reasons:[],sourceRefs:[],eventTime:null,recordedAt:null,asOf:input.asOf,protocolKey:request.protocolKey,formulaVersion:ABILITY_STANDARD_VERSION+':'+metricId,formula:'',estimate:false,validity:'UNKNOWN',reliability:request.reliability??null,metrics:{}}
  try {
    if(!definition||!request.id||!input.athleteId||!strictIso(input.asOf))unavailable('INVALID_REQUEST')
    const consumed:QuantDatum[]=[]
    const take=(key:string,unit:string,min=0,allowPlan=false)=>{
      const d=input.values?.[key]
      if(!d||d.value===null)unavailable('MISSING:'+key)
      if(!d.id||d.athleteId!==input.athleteId||!d.sourceIds.length||d.sourceIds.some(id=>!id.trim())||!timeVisible(d.recordedAt,input.asOf)||!timeVisible(d.at,input.asOf)||Date.parse(d.recordedAt)<Date.parse(d.at)||!['ACTUAL','SELF_REPORT',...(allowPlan?['PLAN']:[])].includes(d.kind))unavailable('INVALID_SOURCE:'+key)
      if(d.unit!==unit||!Number.isFinite(d.value)||d.value<min)unavailable('UNIT_OR_VALUE:'+key)
      consumed.push(d);return d.value
    }
    const condition=(name:string)=>{if(!input.conditions?.includes(name)||!input.conditionSourceIds?.length||input.conditionSourceIds.some(id=>!id.trim()))unavailable('CONDITION:'+name)}
    const sameProtocol=(keys:string[])=>{
      if(!request.protocolKey||request.protocolKey==='UNKNOWN'||keys.some(k=>input.values?.[k]?.protocol!==request.protocolKey))unavailable('PROTOCOL_UNKNOWN_OR_DIFFERENT')
    }
    const reuse=(ruleId:string)=>{
      const q=calculateQuantitativeRule(ruleId,input)
      if(q.status!=='AVAILABLE')unavailable(q.missing.join(';'))
      result.value=q.value;result.unit=q.unit;result.metrics={...q.metrics};result.components=q.series.map(s=>({...s}));result.estimate=q.estimate;result.formula=q.formula;result.formulaVersion=q.version+':'+ruleId
      result.sourceRefs=q.sourceRefs.map(s=>({id:s.id,revision:s.revision,role:['ACTUAL','SELF_REPORT','PLAN','ESTIMATE'].includes(s.kind)?'MEASUREMENT':'CONTEXT'}))
      const ids=new Set(q.sourceRefs.map(s=>s.id))
      consumed.push(...[...Object.values(input.values??{}),...input.series??[]].filter((d):d is QuantDatum=>!!d&&d.sourceIds.some(s=>ids.has(s))))
      if(metricId!=='PWR03'&&(!request.protocolKey||request.protocolKey==='UNKNOWN'||consumed.some(d=>d.protocol!==request.protocolKey)))unavailable('PROTOCOL_UNKNOWN_OR_DIFFERENT')
    }
    switch(metricId){
      case 'SPD01': case 'SPD02': {
        condition(metricId==='SPD01'?'FLYING_30M_CONFIRMED':'START_30M_PROTOCOL_CONFIRMED')
        const seconds=take('seconds','s',Number.MIN_VALUE);sameProtocol(['seconds'])
        if(input.values!.seconds!.distanceMeters!==30)unavailable('EXACT_RECORDED_30M_REQUIRED')
        result.value=30/seconds;result.formula='30/actual_seconds';break
      }
      case 'SPD03': {
        condition('OFFICIAL_VALID_200M_RESULT');result.value=take('seconds','s',Number.MIN_VALUE)
        if(input.values!.seconds!.distanceMeters!==200)unavailable('OFFICIAL_200M_REQUIRED')
        sameProtocol(['seconds']);result.formula='actual_200m_seconds';break
      }
      case 'SEN01': case 'SEN02': {
        condition('OFFICIAL_CONTINUOUS_RESULTS');condition('SAME_SEASON_AND_TIMING')
        const short=take('shortSeconds','s',Number.MIN_VALUE),long=take('longSeconds','s',Number.MIN_VALUE)
        const shortM=metricId==='SEN01'?400:800,longM=metricId==='SEN01'?800:1500
        if(input.values!.shortSeconds!.distanceMeters!==shortM||input.values!.longSeconds!.distanceMeters!==longM)unavailable('EXACT_EVENT_DISTANCES_REQUIRED')
        sameProtocol(['shortSeconds','longSeconds']);result.value=(short/shortM)/(long/longM);result.formula='(short_seconds/short_meters)/(long_seconds/long_meters)';break
      }
      case 'SEN03': {
        condition('SAME_800M_RACE');const first=take('first400','s',Number.MIN_VALUE),last=take('last400','s',Number.MIN_VALUE)
        const a=input.values!.first400!,b=input.values!.last400!
        if(a.distanceMeters!==400||b.distanceMeters!==400||!a.structure?.sessionId||a.structure.sessionId!==b.structure?.sessionId||a.structure.ordinal!==1||b.structure.ordinal!==2)unavailable('ORDERED_SAME_RACE_400M_SPLITS_REQUIRED')
        sameProtocol(['first400','last400']);result.value=last-first;result.formula='second400-first400';break
      }
      case 'SEN04': reuse('SESS_FADE');break
      case 'AER01': reuse('ABIL_CS');condition('CS_FIT_REVIEWED');break
      case 'AER02': {
        condition('MEASURED_THRESHOLD_METHOD_RECORDED')
        if(!['LT1','LT2'].includes(request.variant??''))unavailable('SEPARATE_LT1_LT2_REQUIRED')
        result.value=take('speed','m/s',Number.MIN_VALUE);sameProtocol(['speed']);result.formula='measured_'+request.variant+'_speed';break
      }
      case 'AER03': {
        condition('STANDARDIZED_TEST_DEFINED');const unit=input.metricUnit
        if(unit!=='s'&&unit!=='m')unavailable('TEST_UNIT_REQUIRED')
        result.value=take('current',unit,Number.MIN_VALUE);sameProtocol(['current']);result.unit=unit;result.formula='actual_standardized_test_result';break
      }
      case 'PWR01': {
        reuse('STR_E1RM');const kg=take('bodyMassKg','kg',Number.MIN_VALUE)
        condition('BODY_MASS_MATCHED_TO_TEST');result.metrics.e1rmKg=result.value;result.value=result.value!/kg;result.unit='ratio';result.formula='Epley_e1rm_kg/body_mass_kg';result.formulaVersion=ABILITY_STANDARD_VERSION+':PWR01';break
      }
      case 'PWR02': condition('CMJ_PROTOCOL_CONFIRMED');result.value=take('height','cm',Number.MIN_VALUE);sameProtocol(['height']);result.formula='measured_CMJ_height';break
      case 'PWR03': reuse('STR_FREQ_PERIOD');break
      case 'ECO01': {
        condition('STEADY_STATE_VO2_VALID');condition('SHOES_GRADE_ENVIRONMENT_RECORDED')
        const oxygen=take('vo2','ml/kg/min',Number.MIN_VALUE),speed=take('speedKmh','km/h',Number.MIN_VALUE)
        sameProtocol(['vo2','speedKmh']);result.value=oxygen*60/speed;result.formula='VO2_ml_kg_min*60/speed_kmh';break
      }
      case 'ECO02': case 'REC01': {
        const allowed:Record<string,string>=metricId==='ECO02'?{cadence:'steps/min',groundContactTime:'ms',asymmetry:'%'}:{sleepHours:'h',sessionRpe:'/10',subjectiveRecovery:'/10',painScore:'/10',soreness:'/10',restingHeartRate:'bpm',averageHeartRate:'bpm',hrv:'ms'}
        for(const [key,unit] of Object.entries(allowed)){
          const d=input.values?.[key];if(!d||d.value===null)continue
          const value=take(key,unit)
          if(unit==='/10'&&value>10||unit==='h'&&value>24||unit==='%'&&value>100)unavailable('INVALID_SCALE:'+key)
          result.components.push({id:key,value,unit})
        }
        if(!result.components.length)unavailable('NO_VALID_INDIVIDUAL_SIGNALS')
        if(metricId==='ECO02')condition('MATCHED_SPEED_DEVICE_GRADE')
        result.formula='individual_observations_no_composite';break
      }
      case 'BEH01': {
        condition('DUE_PLAN_REVISION_CONFIRMED');condition('EXECUTION_STATUSES_DISTINCT')
        if(!input.window?.complete||!input.window.sourceIds.length||input.window.sourceIds.some(id=>!id.trim())||!validLoadDay(input.window.startDay)||!validLoadDay(input.window.endDay)||input.window.startDay>input.window.endDay||input.window.endDay>input.asOf.slice(0,10))unavailable('COMPLETE_DUE_WINDOW_REQUIRED')
        const due=take('due','session',1,true),done=take('completed','session'),skipped=take('skipped','session'),unknown=take('notRecorded','session')
        if(![due,done,skipped,unknown].every(Number.isInteger)||done+skipped+unknown!==due)unavailable('INCONSISTENT_DUE_SESSION_COUNTS')
        result.value=100*done/due;result.metrics={due,completed:done,skipped,notRecorded:unknown,coveragePercent:100*(done+skipped)/due};result.formula='100*confirmed_completed_due_sessions/confirmed_due_sessions';break
      }
    }
    if(result.value!==null&&!Number.isFinite(result.value))unavailable('NON_FINITE_RESULT')
    for(const d of consumed)for(const id of d.sourceIds)if(!result.sourceRefs.some(s=>s.id===id&&s.revision===d.revision))result.sourceRefs.push({id,revision:d.revision,role:'MEASUREMENT'})
    for(const id of input.conditionSourceIds??[])if(!result.sourceRefs.some(s=>s.id===id))result.sourceRefs.push({id,revision:null,role:'CONTEXT'})
    result.occurrenceIds=[...new Set(consumed.flatMap(d=>d.structure?.sessionId?[d.structure.sessionId]:[]))]
    const eventTimes=consumed.map(d=>d.at).sort((a,b)=>Date.parse(a)-Date.parse(b)),recordTimes=consumed.map(d=>d.recordedAt).sort((a,b)=>Date.parse(a)-Date.parse(b))
    result.eventTime=eventTimes.at(-1)??null;result.recordedAt=recordTimes.at(-1)??null
    if(!result.sourceRefs.length||!result.eventTime||!result.recordedAt)unavailable('MEASUREMENT_SOURCE_TIMES_REQUIRED')
    if(input.conditions?.includes('MEASUREMENT_VALIDITY_REVIEWED'))condition('MEASUREMENT_VALIDITY_REVIEWED')
    result.validity=input.conditions?.includes('MEASUREMENT_VALIDITY_REVIEWED')?'VALID':'UNKNOWN'
    if(!result.protocolKey||result.protocolKey==='UNKNOWN')result.reasons.push('PROTOCOL_UNKNOWN')
    if(result.validity!=='VALID')result.reasons.push('VALIDITY_NOT_REVIEWED')
    result.reasons.push(definition.boundary);result.status='RAW_AVAILABLE'
  }catch(error){result.status='UNAVAILABLE';result.value=null;result.components=[];result.metrics={};result.reasons.push(error instanceof MissingAbilityInput?error.message:'INVALID_INPUT_SHAPE')}
  return result
}

export type ApprovedAbilityReference={referenceId:string;metricId:AbilityMetricId;variant:string|null;version:string;formulaVersion:string;unit:string;protocolKey:string;sport:string;populationKey:string;direction:'higher'|'lower';lowAnchor:number;highAnchor:number;approvalStatus:'APPROVED'|'CANDIDATE'|'REVOKED';reviewer:string;approvedAt:string;source:string;hash:string}
/** Research supplied no approved population norms. Never populate this from an unreviewed workbook. */
export const APPROVED_ABILITY_REFERENCES:readonly ApprovedAbilityReference[]=[]
export type AbilityScore={status:string;score:number|null;measurementId:string;referenceId:string|null;referenceVersion:string|null;referenceHash:string|null;reason:string}
export function scoreAbilityMeasurement(m:AbilityMeasurement,reference:ApprovedAbilityReference|null,context:{athleteId:string;sport:string|null;populationKey:string|null;asOf:string;expectedReferenceVersion?:string}):AbilityScore{
  const fail=(status:string,reason:string):AbilityScore=>({status,score:null,measurementId:m.id,referenceId:reference?.referenceId??null,referenceVersion:reference?.version??null,referenceHash:reference?.hash??null,reason})
  const definition:MetricDefinition=ABILITY_METRICS[m.metricId]
  if(m.status!=='RAW_AVAILABLE'||m.value===null||!Number.isFinite(m.value)||m.athleteId!==context.athleteId||!timeVisible(m.eventTime,context.asOf)||!timeVisible(m.recordedAt,context.asOf)||m.sourceRefs.some(s=>s.role==='MEASUREMENT'&&!s.revision))return fail('INVALID_MEASUREMENT','来源版本或有效测量不足，保留可见原始值。')
  if(!definition.normEligible)return fail('NOT_NORM_SCORABLE','该指标属于描述、技术或训练行为，不映射能力分。')
  if(m.validity!=='VALID'||!m.protocolKey)return fail('UNCERTAINTY_UNKNOWN','测量有效性或协议未审阅。')
  const r=m.reliability
  if(!r||!r.reviewer||!r.sourceIds.length||!r.assumptionsReviewed||r.metricId!==m.metricId||r.protocolKey!==m.protocolKey||r.formulaVersion!==m.formulaVersion||r.unit!==m.unit||!timeVisible(r.reviewedAt,context.asOf)||[r.sem,r.te].every(n=>n===null)||[r.sem,r.te,r.swc].some(n=>n!==null&&(!Number.isFinite(n)||n<0)))return fail('UNCERTAINTY_UNKNOWN','可靠性与误差条件尚未审阅。')
  if(!reference||reference.approvalStatus!=='APPROVED'||!reference.reviewer||!reference.source||!reference.hash||!reference.version||!timeVisible(reference.approvedAt,context.asOf))return fail('NO_APPROVED_REFERENCE','当前没有核准常模。')
  if(!context.sport||!context.populationKey||reference.sport!==context.sport||reference.populationKey!==context.populationKey)return fail('POPULATION_MISMATCH','项目或人群不匹配。')
  if(reference.metricId!==m.metricId||reference.variant!==m.variant||reference.protocolKey!==m.protocolKey||reference.unit!==m.unit)return fail('PROTOCOL_MISMATCH','指标、子类型、单位或协议不匹配。')
  if(reference.formulaVersion!==m.formulaVersion||context.expectedReferenceVersion&&reference.version!==context.expectedReferenceVersion)return fail('REFERENCE_VERSION_MISMATCH','参考或算法版本不一致。')
  const L=reference.lowAnchor,U=reference.highAnchor
  if(reference.direction!==definition.direction||![L,U].every(Number.isFinite)||(reference.direction==='higher'?U<=L:L<=U))return fail('INVALID_ANCHORS','参考方向或锚点无效。')
  const raw=reference.direction==='higher'?100*(m.value-L)/(U-L):100*(L-m.value)/(L-U)
  if(!Number.isFinite(raw))return fail('INVALID_ANCHORS','无法获得有限的尺度位置。')
  return {...fail('SCORE_AVAILABLE','仅为该参考版本的尺度位置，不是生物能力百分比。'),score:Math.min(100,Math.max(0,raw))}
}

/** Observed change, never a claim of true adaptation without an applicable measurement-error model. */
export function compareAbilityMeasurements(prior:AbilityMeasurement,current:AbilityMeasurement,asOf:string){
  const fail=(reason:string)=>({status:'UNAVAILABLE' as const,delta:null,percent:null,mdc95:null,beyondMdc:null,reason})
  if(prior.status!=='RAW_AVAILABLE'||current.status!=='RAW_AVAILABLE'||prior.value===null||current.value===null||prior.athleteId!==current.athleteId||prior.metricId!==current.metricId||prior.variant!==current.variant||prior.unit!==current.unit||prior.formulaVersion!==current.formulaVersion||!prior.protocolKey||prior.protocolKey!==current.protocolKey)return fail('个人、指标、单位或测量协议不可比。')
  if(![prior.eventTime,prior.recordedAt,current.eventTime,current.recordedAt].every(t=>timeVisible(t,asOf))||Date.parse(prior.eventTime!)>=Date.parse(current.eventTime!))return fail('缺少真实时间顺序或包含未来信息。')
  if(prior.sourceRefs.some(p=>p.role==='MEASUREMENT'&&current.sourceRefs.some(c=>c.role==='MEASUREMENT'&&c.id===p.id)))return fail('同一来源修订不作为新的独立观察。')
  const delta=current.value-prior.value,r=current.reliability
  const validError=r&&r.assumptionsReviewed&&r.metricId===current.metricId&&r.unit===current.unit&&r.formulaVersion===current.formulaVersion&&r.protocolKey===current.protocolKey&&r.reviewer&&r.sourceIds.length&&timeVisible(r.reviewedAt,asOf)&&r.sem!==null&&Number.isFinite(r.sem)&&r.sem>=0
  const mdc95=validError?1.96*Math.SQRT2*r.sem!:null
  return {status:'AVAILABLE' as const,delta,percent:prior.value>0?100*delta/prior.value:null,mdc95,beyondMdc:mdc95===null?null:Math.abs(delta)>mdc95,reason:mdc95===null?'仅为观测变化；个体误差未知，不能认定真实提高。':'报告适用误差模型下的变化；仍不能推断训练因果。'}
}
export function abilityGoalProgress(baseline:AbilityMeasurement,current:AbilityMeasurement,target:{value:number;version:string;setAt:string;metricId:AbilityMetricId;variant:string|null;unit:string;protocolKey:string},asOf:string){
  const comparison=compareAbilityMeasurements(baseline,current,asOf)
  if(comparison.status!=='AVAILABLE'||!target.version||!timeVisible(target.setAt,asOf)||!timeVisible(baseline.recordedAt,target.setAt)||Date.parse(target.setAt)>Date.parse(current.eventTime!)||target.metricId!==current.metricId||target.variant!==current.variant||target.unit!==current.unit||target.protocolKey!==current.protocolKey||!Number.isFinite(target.value)||baseline.value===target.value)return {status:'UNAVAILABLE',rawPercent:null,barPercent:null,targetVersion:target.version}
  const rawPercent=100*(current.value!-baseline.value!)/(target.value-baseline.value!)
  return Number.isFinite(rawPercent)?{status:'AVAILABLE',rawPercent,barPercent:Math.min(100,Math.max(0,rawPercent)),targetVersion:target.version}:{status:'UNAVAILABLE',rawPercent:null,barPercent:null,targetVersion:target.version}
}

export type AbilityProfile={version:string;athleteId:string;asOf:string;axes:{id:AbilityAxis;label:string;score:null;status:'待评估'|'已有原始指标';measurements:AbilityMeasurement[];reason:string}[];independent:{domain:'REC'|'BEH'|'COMPETITION_RESULT'|'COMPETITION_POINTS'|'TECHNIQUE';measurements:AbilityMeasurement[]}[];scores:AbilityScore[];changes:{measurementId:string;priorId:string;comparison:ReturnType<typeof compareAbilityMeasurements>}[];compositeScore:null;planWrite:false}
export function buildAbilityProfile(input:{athleteId:string;asOf:string;sport:string|null;populationKey:string|null;measurements:readonly AbilityMeasurement[];references?:readonly ApprovedAbilityReference[]}):AbilityProfile{
  const labels:Record<AbilityAxis,string>={SPD:'速度',SEN:'速度耐力',AER:'有氧耐力',PWR:'力量功率',ECO:'跑步经济性'}
  const visible=input.measurements.filter(m=>m.athleteId===input.athleteId&&timeVisible(m.recordedAt,input.asOf)&&timeVisible(m.eventTime,input.asOf))
  const references=input.references??APPROVED_ABILITY_REFERENCES
  const scores=visible.map(m=>{const matching=references.filter(r=>r.metricId===m.metricId&&r.variant===m.variant&&r.protocolKey===m.protocolKey&&r.sport===input.sport&&r.populationKey===input.populationKey);return scoreAbilityMeasurement(m,matching.length===1?matching[0]:null,input)})
  const changes:AbilityProfile['changes']=[]
  for(const m of visible){
    const prior=visible.filter(p=>p.id!==m.id&&p.metricId===m.metricId&&p.variant===m.variant&&p.protocolKey===m.protocolKey&&Date.parse(p.eventTime!)<Date.parse(m.eventTime!)).sort((a,b)=>Date.parse(b.eventTime!)-Date.parse(a.eventTime!))[0]
    if(prior)changes.push({measurementId:m.id,priorId:prior.id,comparison:compareAbilityMeasurements(prior,m,input.asOf)})
  }
  return {version:ABILITY_STANDARD_VERSION,athleteId:input.athleteId,asOf:input.asOf,axes:COMPETITIVE_AXES.map(id=>{const measurements=visible.filter(m=>ABILITY_METRICS[m.metricId].axis===id);return {id,label:labels[id],score:null,status:measurements.some(m=>m.status==='RAW_AVAILABLE')?'已有原始指标':'待评估',measurements,reason:'当前没有核准的维度合成标准；不填零，不用经验分或训练次数代替。'}}),independent:(['REC','BEH','COMPETITION_RESULT','COMPETITION_POINTS','TECHNIQUE'] as const).map(domain=>({domain,measurements:visible.filter(m=>ABILITY_METRICS[m.metricId].axis===domain)})),scores,changes,compositeScore:null,planWrite:false}
}
