import type { Applicability, EventFocus, MethodDimension, MethodId, ModelInput, PlannedModelSession, PurposeReadiness } from './types'
import type { ResponseFact } from '../../health/analysis-contract'
import { assessPhysiology } from './physiology'
import { reviewDistribution } from './distribution'
import { canonical, eligibleRecords, ref, scope } from './source'
import { EVENT_PRIORITIES, METHOD_SOURCE_IDS, knowledgeForMethod, trainingDecisionEvidencePolicy } from './knowledge'
import { TRAINING_MODEL_KNOWLEDGE_VERSION } from './evidence'

const day=(at:string,zone:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at))
function decisionContext(input:ModelInput){
 const bound=canonical(input.context)===canonical(input.snapshot.context)&&(!input.recovery||input.recovery.snapshotId===input.snapshot.snapshotId)
 const rows=eligibleRecords(input.snapshot.facts.filter((f):f is ResponseFact=>f.kind==='RESPONSE'),input.context,r=>JSON.stringify([r.measure,r.region,r.side,r.observationProtocol]))
 const latest=rows.filter(r=>!rows.some(other=>scope(other)===scope(r)&&other.measure===r.measure&&other.region===r.region&&other.side===r.side&&other.observationProtocol===r.observationProtocol&&Date.parse(other.occurredAt)>Date.parse(r.occurredAt)))
 const directHold=latest.some(r=>r.measure==='PAIN'&&r.value!==null&&r.value>0||r.measure==='FUNCTION'&&r.scale==='FUNCTION_LIMITATION_0_1'&&r.value===1)
 const holds=!bound||input.snapshot.safetyConstraints.length>0||directHold||input.recovery?.safetyState==='HOLD_ACTIVE'||input.recovery?.safetyState==='ESCALATION_REQUIRED'
 const current=latest.filter(r=>Date.parse(r.occurredAt)>=Date.parse(input.context.asOf)-24*36e5)
 const currentPain=current.filter(r=>r.measure==='PAIN'&&r.scale==='0-10_HIGH_WORSE'&&r.value===0)
 const currentFunction=current.filter(r=>r.measure==='FUNCTION'&&r.scale==='FUNCTION_LIMITATION_0_1'&&r.value===0)
 const paired=currentPain.some(p=>currentFunction.some(f=>f.region===p.region&&f.side===p.side))
 const concern=input.recovery?.signalState==='RECOVERY_CONCERN'||input.recovery?.signalState==='MIXED_SIGNALS'||current.some(r=>(r.measure==='SORENESS'||r.measure==='SUBJECTIVE_FATIGUE')&&r.scale==='0-10_HIGH_WORSE'&&r.value!==null&&r.value>0)
 return {bound,holds,unknownSafety:!input.recovery||input.recovery.safetyState==='UNKNOWN',current,paired,concern}
}

/** Purpose gates are conservative product decisions; no HRV value grants clearance. */
export function assessSessionPurpose(input:ModelInput,session:PlannedModelSession):PurposeReadiness {
 const ctx=decisionContext(input),easy=session.purpose==='EASY'||session.purpose==='RECOVERY'
 const runs=session.plan.components.filter(c=>c.modality==='RUNNING')
 const high=['SPEED','VO2','RACE_PACE'].includes(session.purpose)||runs.some(c=>['REPETITION_SPEED','RACE'].includes(c.purpose))
 const purposeConflict=easy&&session.plan.components.some(c=>c.modality!=='RUNNING'||!['EASY_AEROBIC','LONG','WARMUP','COOLDOWN'].includes(c.purpose))
 const reasons:string[]=[],missing:string[]=[]
 let state:PurposeReadiness['state']='MAINTAIN',allowKeep=true,allowReduce=true
 const basisRefs=[...ctx.current.map(ref),...(input.recovery?.observations.flatMap(o=>o.evidenceRefs)??[])]
 if(ctx.holds){state='HOLD';allowKeep=false;allowReduce=false;reasons.push('疼痛、动作功能或既有医学/安全限制优先；HRV、成绩与恢复曲线不能解除。')}
 else if(ctx.unknownSafety||input.snapshot.conflicts.length){state='INSUFFICIENT';allowKeep=false;allowReduce=false;missing.push('当前疼痛与功能核对、来源冲突或安全状态待复核。')}
 else if(input.recovery?.signalState==='INSUFFICIENT'){
  state='INSUFFICIENT';allowKeep=false;allowReduce=false;missing.push('现有实际反馈不足以比较本课；补当前疼痛、日常/原热身功能和主观状态。')
 }else if(ctx.concern){
  state='CONSERVATIVE_ONLY'
  allowKeep=easy&&!high&&ctx.paired
  allowReduce=!high&&(easy||session.purpose==='THRESHOLD')&&ctx.paired
  reasons.push(easy?'有疲劳/酸痛反应时，当前无痛与正常功能反馈可支持保留熟悉的轻松目的或单项减量候选。':high?'速度、VO2与专项高强度更依赖动作和重复质量；当前反应不支持仅凭正常HRV保留或减次数后继续原强度。':'当前反应只支持在无痛、功能正常且阈值依据明确时讨论已有课的单项减量。')
  if(!ctx.paired)missing.push('同部位、同侧的当前无痛与正常功能反馈。')
 }
 if(purposeConflict){allowKeep=false;allowReduce=false;if(state!=='HOLD')state='INSUFFICIENT';missing.push('课程目的与保存的执行结构冲突，不能把高强度或混合课按轻松跑放行。')}
 if(session.purpose==='STRENGTH'){allowKeep=false;allowReduce=false;state=ctx.holds?'HOLD':'INSUFFICIENT';missing.push('力量剂量由既有力量模块按实际动作与训练目的复核。')}
 if(!session.familiar){allowKeep=false;allowReduce=false;if(state!=='HOLD')state='INSUFFICIENT';missing.push('当前课程缺少既有耐受记录。')}
 const risk=easy?'轻松目的仍可能受疼痛或动作改变影响；原强度和总量不增加。':session.purpose==='THRESHOLD'?'减少次数仍保留原强度，不能把减量视为恢复完成；阈值失配或反应恶化时暂停。':session.purpose==='STRENGTH'?'与跑步重叠的肌群负荷需按动作与目的复核。':'减少次数不会降低单次速度要求；疲劳、疼痛或动作变化可破坏重复质量。'
 const observation=easy?'记录原热身/日常功能、主观用力及次日疼痛或酸痛；不新增测试。':session.purpose==='THRESHOLD'?'保留原组休下的分段、RPE与已有阈值监测，观察训练后及次日反应；不补造乳酸值。':'核对原热身动作、原组休下的逐次完成质量与主观状态，再记录次日反应；不加最大努力测试。'
 if(!ctx.concern&&!ctx.holds&&!ctx.unknownSafety)reasons.push('保留已熟悉且已有批准的目的和剂量；缺HRV本身不是暂停依据。')
 return {sessionId:session.id,purpose:session.purpose,state,allowKeep,allowReduce,reasons,missing,basisRefs:[...new Map(basisRefs.map(r=>[r.id+'@'+r.revision,r])).values()],risk,observation,medicalClearance:false}
}

export function selectTrainingModels(input:ModelInput){
 const physiology=assessPhysiology(input),distribution=reviewDistribution(input),p=input.profile,ctx=decisionContext(input)
 const {holds,unknownSafety,bound}=ctx
 const eventFocus:EventFocus=p.eventMeters===400?'400':p.eventMeters===800?'800':p.eventMeters===1500?'1500':p.eventMeters!==null&&p.eventMeters>=3000?'LONG_DISTANCE':p.eventMeters!==null?'OTHER':'UNKNOWN'
 const short=eventFocus==='400'||eventFocus==='800'
 const daysToRace=p.raceDate&&/^\d{4}-\d\d-\d\d$/.test(p.raceDate)?(Date.parse(p.raceDate+'T00:00:00Z')-Date.parse(day(input.context.asOf,input.context.timeZone)+'T00:00:00Z'))/86400000:null
 const imminent=daysToRace!==null&&daysToRace>=0&&daysToRace<=7
 const thresholds=!!(physiology.thresholds.speed||physiology.thresholds.heartRate)
 const profileKnown=!!p.sourceRefs.length&&p.eventMeters!==null&&Number.isFinite(p.eventMeters)&&p.eventMeters>0&&p.phase!=='UNKNOWN'
 const purposeReadiness=input.sessions.map(s=>assessSessionPurpose(input,s))
 const runnable=(purposes?:PlannedModelSession['purpose'][])=>purposeReadiness.some(r=>(r.allowKeep||r.allowReduce)&&(!purposes||purposes.includes(r.purpose))&&input.sessions.some(s=>s.id===r.sessionId&&s.executionState==='NOT_STARTED'&&s.date>=day(input.context.asOf,input.context.timeZone)))
 const methods:Applicability[]=[]
 function add(method:MethodId,dimension:MethodDimension,status:Applicability['status'],missing:string[],reasons:string[],applicability:string[],limits:string[],candidateAllowed:boolean,priority:Applicability['conditionalRank']['priority']='COMPARE',rankReason='资料齐备后按当前阶段和实际反应比较，同层方法可并列。'){
  const sources=knowledgeForMethod(method),keyMissing=[...new Set([...missing,...(unknownSafety?['当前疼痛、功能与安全状态']:[]),...(!bound?['一致的运动员、证据和恢复版本']:[]),...(input.snapshot.conflicts.length?['原始证据冲突复核']:[])])]
  const support=method==='BLOCK'?['现有目录没有块状组织优越性的直接证据；只保留研究比较位置。']:method==='THRESHOLD_ORIENTED'?['强度域与阈值测量研究支持区分中强度范围，不证明阈值导向分布更优。']:method==='SINGLE_THRESHOLD'?['间歇编程与阈值方法资料支持核对已有单课结构，不证明单阈值优于双阈值。']:sources.flatMap(s=>[...s.supports])
  methods.push({method,dimension,status,reasons,missing:keyMissing,keyMissing,evidenceIds:[...METHOD_SOURCE_IDS[method]],applicability,support,limits:[...limits,...sources.flatMap(s=>[...s.limitations])],dataAdequacy:!bound||input.snapshot.conflicts.length?'CONFLICT':keyMissing.length?'INSUFFICIENT':distribution.pattern==='UNRESOLVED'&&dimension==='DISTRIBUTION'?'PARTIAL':'SUFFICIENT_FOR_COMPARISON',candidateAllowed:candidateAllowed&&!holds&&!unknownSafety&&status!=='NOT_APPLICABLE'&&status!=='INSUFFICIENT',conditionalRank:{priority:holds||unknownSafety||status==='INSUFFICIENT'||status==='NOT_APPLICABLE'?'DEFER':priority,withinDimension:dimension,reason:rankReason,universalBest:false},...(dimension==='EVENT'?{eventFocus}:{})})
 }
 for(const method of ['PYRAMIDAL','POLARIZED','THRESHOLD_ORIENTED'] as const){
  const missing=[...(!thresholds?['同测试、同口径的实测阈值分区']:[]),...(!profileKnown?['目标项目和当前训练阶段']:[])]
  const status=holds?'HOLD':unknownSafety||missing.length?'INSUFFICIENT':short||imminent||p.phase==='TAPER'||method==='THRESHOLD_ORIENTED'?'CONDITIONAL':'CONSIDER'
  const first=method==='PYRAMIDAL'&&p.phase==='BASE'&&!short&&!imminent
  add(method,'DISTRIBUTION',status,missing,[method==='PYRAMIDAL'?'比较低强度为主、适量中高强度的阶段安排。':method==='POLARIZED'?'比较低强度为主并保留部分高强度的阶段安排。':'比较中强度训练占比较高的分布描述，不据标签新增阈值量。','分布与单/双阈值、块状组织分属不同维度，可组合。'],['结合目标、阶段、可用时间及既有负荷耐受；保持原统计口径。'],[...(short?['400/800专项优先级不能由长跑分布直接替代。']:[]),...(imminent||p.phase==='TAPER'?['赛前保留已熟悉刺激，本轮不更换分布策略。']:[]),'观察到某种分布形状不代表它适合当前运动员，也不是本轮训练配比处方。'],runnable(),first?'CONSIDER_FIRST':'COMPARE',first?'基础阶段先讨论低强度基础和已有耐受；这是当前条件下的讨论顺序，不代表金字塔普遍优越。':imminent?'比赛临近，优先维持熟悉内容，不依据标签重排训练。':'同层保留并列比较；不按精英/普通水平自动选极化或金字塔。')
 }
 const commonMissing=[...(!thresholds?['个体实测阈值']:[]),...(!profileKnown?['目标项目和当前训练阶段']:[])]
 add('SINGLE_THRESHOLD','ORGANIZATION',holds?'HOLD':unknownSafety||commonMissing.length?'INSUFFICIENT':'CONDITIONAL',commonMissing,['复核已有的一次阈值课，不从单课名称推出训练效果。'],['已有熟悉阈值课、个体阈值依据及恢复反馈。'],['单课组织不等于阈值导向分布，也不能由CS/VDOT填充LT2。'],runnable(['THRESHOLD']),'CONSIDER_FIRST','已有熟悉单课时先核对它；避免在资料不足时新增第二课。')
 const doubleMissing=[...commonMissing,...(['doubleThresholdExperience','lactateMonitoring','coachSupervision','twoSessionsAvailable'] as const).filter(k=>p[k]!==true).map(k=>({doubleThresholdExperience:'既有双课耐受记录',lactateMonitoring:'乳酸与主观负荷监测条件',coachSupervision:'教练复核',twoSessionsAvailable:'两课时间及课间恢复条件'}[k]))]
 const existingDouble=input.sessions.some(s=>s.purpose==='THRESHOLD'&&input.sessions.filter(o=>o.date===s.date&&o.purpose==='THRESHOLD'&&o.familiar&&o.executionState==='NOT_STARTED'&&purposeReadiness.some(r=>r.sessionId===o.id&&r.allowKeep)).length>=2)
 add('DOUBLE_THRESHOLD','ORGANIZATION',holds?'HOLD':p.experience==='NOVICE'?'NOT_APPLICABLE':unknownSafety||doubleMissing.length?'INSUFFICIENT':'CONDITIONAL',doubleMissing,['双阈值为同日安排方式，可同时呈现金字塔或极化分布。','已有小样本急性实验，不能据此承诺长期提高成绩或降低伤病。'],['明确既有双课耐受、个体阈值、乳酸监测、教练复核及两课恢复条件。'],['不自动增加第二课，不复制研究中的阈值、周跑量或课间小时数。'],existingDouble,'COMPARE','条件齐备才复核已存在的同日双课；不因更高水平而优先。')
 add('BLOCK','ORGANIZATION',holds?'HOLD':'INSUFFICIENT',['针对项目与人群的直接证据','已有训练块的执行记录、跨周耐受和恢复响应'],['块状组织安排跨周重点，可与不同分布组合。'],['明确阶段目标及既有跨周训练记录。'],['现有来源不足以推荐新训练块；仅研究比较。'],false,'DEFER','缺直接依据与个体跨周记录，暂不进入课表候选。')
 const eventRaces=physiology.eventProfile.races.filter(r=>r.distanceM===p.eventMeters)
 add('EVENT_SPECIFIC','EVENT',holds?'HOLD':unknownSafety||!profileKnown?'INSUFFICIENT':eventRaces.length?'CONSIDER':'CONDITIONAL',[...(!profileKnown?['目标项目和当前训练阶段']:[]),...(eventRaces.length?[]:['近期同协议专项比赛/连续测试及分段'])],['围绕已声明专项比较实测比赛速度、重复质量及恢复；不同距离不相互充当精确预测。'],[...EVENT_PRIORITIES[eventFocus]],['缺速度、恢复、分段或既有耐受记录时不生成新的高强度剂量。','项目能量系统贡献不能转换为个人训练时间配比。'],runnable(['SPEED','RACE_PACE','VO2']),'CONSIDER_FIRST','先明确专项需求与当前阶段，再比较分布与课次组织；不同距离不互相排名。')
 const notes=[...(!bound?['上下文/恢复版本不匹配，必须重新读取。']:[]),...(holds?['已有安全限制，模型选择不能解除限制。']:[]),...(unknownSafety?['当前安全状态未核定，不输出可执行训练建议。']:[]),...(imminent?['比赛临近：7日为产品保守复核窗口，不是统一生理减量规则。']:[]),'条件排序只表示本轮复核先后；不同维度不互斥，也没有通用最优方法。']
 for(const s of input.sessions)if(s.purpose==='STRENGTH'&&input.sessions.some(r=>r.date===s.date&&['SPEED','RACE_PACE','VO2'].includes(r.purpose)))notes.push('同日力量与关键跑步课需核对先后、间隔和目的；不以固定小时数保证恢复。')
 return {version:'FK_TRAINING_MODELS_2' as const,knowledgeVersion:TRAINING_MODEL_KNOWLEDGE_VERSION,physiology,distribution,methods,preferredMethod:null,
  dimensions:{distribution:methods.filter(m=>m.dimension==='DISTRIBUTION'),organization:methods.filter(m=>m.dimension==='ORGANIZATION'),event:methods.filter(m=>m.dimension==='EVENT')},eventFocus,eventPriorities:EVENT_PRIORITIES[eventFocus],
  ranking:{scope:'WITHIN_DIMENSION_ONLY' as const,universalBest:false as const,entries:methods.map(m=>({method:m.method,...m.conditionalRank}))},purposeReadiness,evidencePolicy:trainingDecisionEvidencePolicy(),
  allowTrainingCandidates:!holds&&!unknownSafety&&!input.snapshot.conflicts.length,notes,daysToRace,imminentRace:imminent,
  factsUsed:[...physiology.thresholds.allPairs.flatMap(t=>t.refs),...physiology.eventProfile.races.map(r=>r.ref),...distribution.refs,...p.sourceRefs,...purposeReadiness.flatMap(r=>r.basisRefs)],scientificallyValidated:false,planWritten:false}
}
