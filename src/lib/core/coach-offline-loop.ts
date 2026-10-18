import {intervalTargetAnalysis,reportedRace} from './coach-specialty-analysis.ts'
import {sanitizeOfflineSnapshot,offlineSignals,signalQuery,cleanAthleteText,type NumericSignal} from './coach-offline-insights.ts'
import type {ChatTraining} from './coach-chat-evidence.ts'
import { appendJournal, readJournal } from './storage-journal.ts'
import { buildReasoningFrame, formatComputedFacts, reasoningRevisionNotice, createReasoningBasis, type ReasoningBasis, type ReasoningFrame } from './coach-reasoning.ts'
import type { EvolutionSnapshot } from './coach-evolution-v4.ts'
import { computeV4Facts, type ComputedFact } from './coach-v4-computed.ts'
import { comparisonProtocol } from './coach-evolution-v4.ts'
import { detectRedFlags, redFlagResponse } from './coach-red-flags.ts'
import { calendarDay } from './coach-calendar.ts'
import { daysBetweenCalendarDates } from './coach-cognition-tools.ts'
import { retrieveResearchIndex, type ResearchHit } from './coach-research-index.ts'
import type { RunningPlanSnapshot } from './running-plan.ts'
import type { RunningRoundAnalysis } from './running-round-analysis.ts'
import { formatSessionLoad, type SessionLoad } from './coach-session-load.ts'
import { buildDevelopmentProjection, reviseHypotheses, type DevelopmentProjection, type HypothesisRevision, type LinkedObservation, type ApprovedCourse } from './coach-development-projection.ts'
import type { AbilityMetricRequest } from './coach-ability-standard.ts'
import {quantitativeReviewFacts} from './coach-quantitative-adapter.ts'
import type {QuantResult} from './coach-quantitative.ts'
import {registerReviewClaims,readClaimRevisions} from './coach-p7-runtime.ts'
import {validRecoveryContext,recoveryContextLines,type RecoveryContext} from './coach-recovery-context.ts'

export const OFFLINE_LOOP_VERSION='FK-OFFLINE-LOOP-R184-1'
export const OFFLINE_PROFILE_PREFIX='fr255-coach-profile-r13:'
export const OFFLINE_REVIEW_PREFIX='fr255-coach-review-r13:'
export type OfflineProfile={athleteId:string;event:string|null;pbSeconds:number|null;pbOn:string|null;timing:'UNKNOWN'|'HAND'|'ELECTRONIC';age:number|null;sex?:'UNKNOWN'|'FEMALE'|'MALE';experienceMonths:number|null;competitionDate:string|null;competitionPriority:'UNKNOWN'|'A'|'B'|'C';stage:'UNKNOWN'|'基础期'|'储备/基础期'|'冬训期'|'专项准备期'|'备赛期'|'备赛期/减量'|'比赛期'|'过渡期';coachIntent:string|null}
export type ProfileRecord={id:string;createdAt:string;profile:OfflineProfile;confirmed:true;supersedes:string|null}
export const emptyOfflineProfile=(athleteId:string):OfflineProfile=>({athleteId,event:null,pbSeconds:null,pbOn:null,timing:'UNKNOWN',age:null,sex:'UNKNOWN',experienceMonths:null,competitionDate:null,competitionPriority:'UNKNOWN',stage:'UNKNOWN',coachIntent:null})
const validTime=(s:string)=>Number.isFinite(Date.parse(s))&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(s)
const validDay=(s:string|null)=>s===null||daysBetweenCalendarDates(s,s)===0
const nullable=(n:number|null,a:number,b:number)=>n===null||Number.isFinite(n)&&n>=a&&n<=b
const validProfile=(p:OfflineProfile)=>p&&typeof p.athleteId==='string'&&p.athleteId.length>0&&(p.event===null||/^(60|100|200|400|800|1500|3000|5000|10000)米$|^半马$|^马拉松$/.test(p.event))&&nullable(p.pbSeconds,1,100000)&&nullable(p.age,1,110)&&nullable(p.experienceMonths,0,1200)&&validDay(p.pbOn)&&validDay(p.competitionDate)&&['UNKNOWN','HAND','ELECTRONIC'].includes(p.timing)&&['UNKNOWN','A','B','C'].includes(p.competitionPriority)&&['UNKNOWN','基础期','储备/基础期','冬训期','专项准备期','备赛期','备赛期/减量','比赛期','过渡期'].includes(p.stage)&&(p.sex===undefined||['UNKNOWN','FEMALE','MALE'].includes(p.sex))&&(p.coachIntent===null||typeof p.coachIntent==='string'&&p.coachIntent.length<=200)
export function readOfflineProfile(athleteId:string,asOf=new Date().toISOString()):ProfileRecord|null{
 const rows=readJournal<ProfileRecord>(OFFLINE_PROFILE_PREFIX).filter(x=>!x.recordedAt||validTime(x.recordedAt)&&Date.parse(x.recordedAt)<=Date.parse(asOf)).map(x=>x.data).filter(r=>r?.confirmed===true&&validProfile(r.profile)&&r.profile.athleteId===athleteId&&validTime(r.createdAt)&&Date.parse(r.createdAt)<=Date.parse(asOf))
 return rows.at(-1)??null
}
export function saveOfflineProfile(profile:OfflineProfile,confirmed:boolean):boolean{
 if(!confirmed||!validProfile(profile)||profile.pbOn!==null&&profile.pbOn>calendarDay(new Date().toISOString())!)return false
 const previous=readOfflineProfile(profile.athleteId),r:ProfileRecord={id:crypto.randomUUID(),createdAt:new Date().toISOString(),profile,confirmed:true,supersedes:previous?.id??null}
 return appendJournal(OFFLINE_PROFILE_PREFIX,r.id,r)
}

export type DataSufficiency={level:'L1'|'L2'|'L3'|'L4';meaning:string;validRows:number;recordedSessions:number;comparableSessions:number;spanDays:number|null;missing:string[];abilityScore:null;medicalScore:null}
const actual=(s:EvolutionSnapshot)=>s.active.filter(e=>e.athleteId===s.athleteId&&e.source!=='PLAN'&&e.source!=='THIRD_PARTY'&&e.value!==null&&Date.parse(e.recordedAt)<=Date.parse(s.asOf)&&Date.parse(e.eventAt)<=Date.parse(s.asOf))
function comparableSessions(s:EvolutionSnapshot,occurrenceId:string|null){
 if(!occurrenceId||s.quarantined.length||s.scopeConflictCount)return []
 const rows=actual(s)
 const key=(id:string)=>{
  const mine=rows.filter(r=>r.occurrenceId===id),work=mine.filter(r=>r.metric==='SPLIT_SECONDS'),rest=mine.filter(r=>r.metric==='REST_SECONDS')
  if(!work.length||!rest.length||[...work,...rest].some(r=>r.confirmation!=='CONFIRMED')||work.some(r=>!comparisonProtocol(r.context)||!r.measurement?.method||/UNKNOWN|未核验/.test(r.measurement.method)))return null
  return JSON.stringify([work.map(r=>[r.context,r.unit,r.source,r.measurement!.method]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),rest.map(r=>[r.context,r.value,r.unit,r.source]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))])
 }
 const target=key(occurrenceId);if(!target)return []
 return [...new Set(rows.map(r=>r.occurrenceId))].filter(id=>key(id)===target)
}
/** Thresholds here describe available records, never athlete readiness or performance. */
export function assessDataSufficiency(s:EvolutionSnapshot,occurrenceId:string|null):DataSufficiency{
 const rows=actual(s),ids=[...new Set(rows.map(r=>r.occurrenceId))],comparable=comparableSessions(s,occurrenceId)
 const days=[...new Set(rows.map(r=>calendarDay(r.eventAt)!))].sort(),span=days.length?daysBetweenCalendarDates(days[0],days.at(-1)!):null
 const dimensions=new Set(rows.map(r=>r.metric));let level:DataSufficiency['level']=rows.length?'L2':'L1'
 if(comparable.length>=2&&new Set(rows.filter(r=>comparable.includes(r.occurrenceId)).map(r=>calendarDay(r.eventAt))).size>=2)level='L3'
 if(level==='L3'&&comparable.length>=3&&days.length>=6&&(span??0)>=28&&dimensions.has('SESSION_RPE')&&(dimensions.has('SLEEP_HOURS')||dimensions.has('SUBJECTIVE_RECOVERY')))level='L4'
 const meaning={L1:'少量背景可用于列出初步观察；不要求填齐所有指标。',L2:'可计算已给出的课次指标；缺失指标仅限制相关结论。',L3:'有日期不同、记录协议与恢复一致的历史，可描述个人变化；环境与目的仍需核对。',L4:'有跨至少28天的多维记录与可比课次，可讨论长期响应；不是因果或医学结论。'}[level]
 return {level,meaning,validRows:rows.length,recordedSessions:ids.length,comparableSessions:comparable.length,spanDays:span,missing:[...s.missing],abilityScore:null,medicalScore:null}
}

const purposes:Record<string,string>={EASY_AEROBIC:'轻松有氧',LONG:'长距离',TEMPO_THRESHOLD:'节奏/阈值练习（非已测阈值）',INTERVAL:'间歇',REPETITION_SPEED:'重复跑/速度',HILL:'坡跑',RACE:'比赛',OTHER:'其他目的（需进一步确认）'}
export function identifyTrainingPurpose(profile:OfflineProfile,asOf:string,plan:RunningPlanSnapshot|null,occurrenceId:string|null,declared?:{text:string;sourceId:string}){
 const validPlan=plan&&plan.trainingOccurrenceId===occurrenceId&&validTime(plan.capturedAt)&&Date.parse(plan.capturedAt)<=Date.parse(asOf)?plan:null
 const known=[...new Set(validPlan?.components.flatMap(c=>c.modality==='RUNNING'&&purposes[c.purpose]?[purposes[c.purpose]]:[])??[])]
 const days=profile.competitionDate?daysBetweenCalendarDates(calendarDay(asOf)!,profile.competitionDate):null
 const stage=profile.stage, purpose=known.length?known.join('、'):declared?.text&&declared.sourceId?declared.text:'UNKNOWN'
 const conditions=['基础期','储备/基础期','冬训期'].includes(stage)?'基础准备阶段评价这节课时，重点核对原目标下的稳定完成、动作和恢复，不要求逐组更快。':stage==='专项准备期'?'专项准备阶段评价这节课时，重点比较原目标配速、实际恢复与专项任务；不能凭课型证明刺激达标。':['备赛期','备赛期/减量','比赛期'].includes(stage)?'备赛阶段评价这节课时，重点核对原定节奏、动作质量和恢复代价，不用加组证明状态。':stage==='过渡期'?'赛后过渡阶段重点观察恢复、活动耐受和训练意愿；具体课目目的仍以原计划为准。':'阶段 UNKNOWN；比赛倒计时与课目距离都不能替代已确认的阶段和目的。'
 const question=purpose==='UNKNOWN'?'原计划或教练对这节课最重要的目的是什么？':stage==='UNKNOWN'?'当前原计划处于哪个阶段，最近比赛的重要程度如何？':null
 return {stage,purpose,declaredIntent:profile.coachIntent,competitionDays:days,competitionPriority:profile.competitionPriority,sourceIds:validPlan?[validPlan.runningSnapshotId]:declared?[declared.sourceId]:[],conditions,question,status:purpose==='UNKNOWN'?'UNKNOWN' as const:known.length?'PLAN_DECLARED' as const:'USER_REPORTED' as const}
}

export type OfflineReview={version:string;athleteId:string;occurrenceId:string|null;asOf:string;basis:ReasoningBasis;profileId:string|null;data:DataSufficiency;comparableOccurrenceIds:string[];historyMetrics:ComputedFact[];purpose:ReturnType<typeof identifyTrainingPurpose>;facts:string;metrics:ReasoningFrame['computed'];hypotheses:{id:string;explanation:string;support:string[];against:string[];sourceIds:string[]}[];knowledge:ResearchHit[];missing:string[];nextObservation:string;safetyRestricted:boolean;text:string;details:string;signals:NumericSignal[];ruleCalculations?:QuantResult[];recoveryContext?:RecoveryContext;development?:DevelopmentProjection;planWrite:false;abilityScoreChange:0}
export function buildOfflineReview(input:{snapshot:EvolutionSnapshot;occurrenceId:string|null;question:string;profile?:ProfileRecord|null;frame?:ReasoningFrame;plan?:RunningPlanSnapshot|null;rounds?:RunningRoundAnalysis|null;sessionLoad?:{value:SessionLoad;sourceIds:string[]};chat?:ChatTraining;metricRequests?:readonly AbilityMetricRequest[];approvedCourses?:readonly ApprovedCourse[];invalidatedSources?:readonly {id:string;sourceId:string;occurrenceId:string}[];purposeContext?:{text:string;sourceId:string;occurrenceId:string};recoveryContext?:RecoveryContext|null}):OfflineReview{
 const {occurrenceId:occ,question}=input
 const quality=sanitizeOfflineSnapshot(input.snapshot),s=quality.snapshot
 const recovery=validRecoveryContext(input.recoveryContext??undefined,s)?input.recoveryContext!:undefined
 const recoveryLines=recovery?recoveryContextLines(recovery):[]
 const profile=input.profile?.profile.athleteId===s.athleteId&&validTime(input.profile.createdAt)&&Date.parse(input.profile.createdAt)<=Date.parse(s.asOf)?input.profile:null
 const frame=(!quality.issues.length?input.frame:null)??buildReasoningFrame({snapshot:s,question,scopeOccurrenceIds:occ?[occ]:[]})
 const purposeText=/目的/.test(question)?question:input.purposeContext?.occurrenceId===occ?input.purposeContext.text:input.chat?.id===occ?input.chat.raw:question
 const purposeStatement=purposeText.match(/(?:本课|这节课|原计划|教练(?:说|的安排)?)(?:的)?(?:训练)?目的(?:是|为|[:：])\s*([^，,。；;？?]{2,60})/)
 const declared=purposeStatement&&!/假设|如果|是否|不是|不清楚|未知|没说/.test(purposeText.slice(0,(purposeStatement.index??0)+purposeStatement[0].length))&&!/[？?]/.test(purposeText.slice((purposeStatement.index??0)+purposeStatement[0].length,(purposeStatement.index??0)+purposeStatement[0].length+1))?{text:purposeStatement[1],sourceId:purposeText===question?input.chat?.id??'current-purpose-report':input.purposeContext?.sourceId??input.chat?.id??'current-purpose-report'}:undefined
 const p=profile?.profile??emptyOfflineProfile(s.athleteId),purpose=identifyTrainingPurpose(p,s.asOf,input.plan??null,occ,declared),data=assessDataSufficiency(s,occ)
 const red=detectRedFlags(question),restricted=red.level!=='NONE'||frame.safety.mustRetain||recovery?.safetyHold===true
 const comparableOccurrenceIds=comparableSessions(s,occ)
 const historyMetrics=restricted?[]:computeV4Facts({...s,active:s.active.filter(e=>comparableOccurrenceIds.includes(e.occurrenceId))},occ).facts.filter(f=>f.kind==='VS_SIMILAR')
 const historicalCites=new Set(historyMetrics.flatMap(f=>f.cites))
 const historyScope=[...new Set(s.active.filter(e=>historicalCites.has(e.sourceId)).map(e=>e.occurrenceId))]
 const knownProfile=[p.event?`本人确认主项 ${p.event}`:null,p.pbSeconds!==null?`自报PB ${p.pbSeconds}秒；日期 ${p.pbOn??'UNKNOWN'}；计时 ${p.timing}；不替代已保存训练`:null,p.age!==null?`年龄 ${p.age}岁`:null,p.experienceMonths!==null?`训练经历 ${p.experienceMonths}个月`:null].filter(Boolean).join('；')
 const structural:string[]=[]
 for(const ob of input.rounds?.observations??[]){if(ob.trainingOccurrenceId!==occ)continue
  structural.push(`原结构 ${ob.rounds.length}轮：`+ob.rounds.map(r=>`第${r.roundOrdinal}轮计划${r.plannedCount}次、完成${r.completedCount}次、跳过${r.skippedCount}次、NOT_RECORDED ${r.notRecordedCount}次、冲突${r.unresolvedCount}次`).join('；'))
  for(const r of ob.rounds)for(const t of r.timings)structural.push(`第${r.roundOrdinal}轮第${t.repeatOrdinal}次 ${t.distanceMeters}米 / ${t.durationSeconds}秒；实际−计划 ${t.deviationFromPlanSeconds===null?'UNAVAILABLE':t.deviationFromPlanSeconds+'秒'} [${t.sourceEventId}]`)
 }
 const boundLoad=input.sessionLoad&&occ&&input.sessionLoad.sourceIds.length&&input.sessionLoad.value.status==='CALCULATED'?input.sessionLoad:null
 const structureSummary=formatComputedFacts(frame).split('\n')[0]?.split(' 所选训练记录')[0]
 const facts=[knownProfile,structureSummary?.startsWith('结构：')?structureSummary:'',formatComputedFacts(frame,true),boundLoad?`${formatSessionLoad(boundLoad.value)} [${boundLoad.sourceIds.join('、')}]`:'',...structural,...historyMetrics.map(f=>`${f.text} [${f.cites.join('、')}]`)].filter(Boolean).join('\n')||'实际课次指标 UNAVAILABLE；可先确认主项、近期实际训练和本课目的，不以缺少HRV或乳酸阻止其他分析。'
 const hypotheses=restricted?[]:(frame.coachingReview?.explanations??[]).slice(0,2).map(h=>({id:h.id,explanation:h.possibility,support:[h.observation],against:[h.wouldWeaken],sourceIds:h.sourceIds}))
 if(historyMetrics.length){
  // A historical comparison depends on the rest/protocol facts that made it comparable,
  // not only on the timed points printed in the numerical result.
  const comparisonSources=s.active.filter(e=>comparableOccurrenceIds.includes(e.occurrenceId)&&['SPLIT_SECONDS','REST_SECONDS'].includes(e.metric)).map(e=>e.sourceId)
  for(const h of hypotheses){h.support.push(...historyMetrics.map(m=>'同协议历史观察：'+m.text+'；仍不能据此确认原因'));h.sourceIds=[...new Set([...h.sourceIds,...comparisonSources])]}
 }
 if(!restricted&&!hypotheses.length&&p.event&&p.pbSeconds!==null)hypotheses.push({id:'BASELINE_PROTOCOL',explanation:'这条PB可作为探索当前起点的线索，尚不能定位短板。',support:[`本人确认 ${p.event} PB ${p.pbSeconds}秒`],against:['若日期、距离或计时方式不明，或该成绩已不反映近期状态，则不能作为当前强度依据。'],sourceIds:profile?[profile.id]:[]})
 const recoveryHypothesis=hypotheses.find(h=>h.id==='SESSION_CONTEXT')
 if(!restricted&&recovery?.dependency&&recoveryLines.length&&recoveryHypothesis){
  const h=recoveryHypothesis
  h.support.push(`同日背景（未证明因果）：${recoveryLines.join('；')}`)
  h.against.push('若同协议下背景指标变化而表现未同步变化，或核对后计时、场地及任务不同，削弱恢复因素解释；缺少记录不算反证。')
  h.sourceIds=[...new Set([...h.sourceIds,recovery.sourceId])]
 }
 const signals=offlineSignals(frame,question,input.chat)
 // The review's calculation ledger contains source-bound attempts only. Fully
 // absent health inputs remain UNAVAILABLE in recoveryContext, not fact entries.
 const ruleCalculations=[...quantitativeReviewFacts(s,occ,input.chat),...(restricted?[]:recovery?.quantitative.calculations.filter(r=>r.sourceRefs.length>0)??[])]
 for(const r of ruleCalculations)if(r.status==='AVAILABLE'&&r.ruleId==='SESS_FADE')signals.push({kind:'TIME_CHANGE_RULE',value:r.value!,unit:r.unit,sourceIds:r.sourceRefs.map(s=>s.id),calculation:r,text:`同轮末段相对首段用时变化${Number(r.value!.toFixed(2))}%；这是用时变化，和速度变化分别计算`})
 if(boundLoad&&!signals.some(x=>x.kind==='AU'))signals.push({kind:'AU',value:boundLoad.value.au!,unit:'AU',sourceIds:boundLoad.sourceIds,text:formatSessionLoad(boundLoad.value)})
 const knowledge=retrieveResearchIndex({question:question+' '+signalQuery(signals),step:occ?'反馈与观察':'初步判断',sport:p.event,stage:p.stage==='UNKNOWN'?null:p.stage,age:p.age,sex:p.sex??null,experienceMonths:p.experienceMonths,purpose:purpose.purpose==='UNKNOWN'?null:purpose.purpose,safetyRestricted:restricted})
 const missing=[...(purpose.purpose==='UNKNOWN'?['课程目的 UNKNOWN']:[]),...(purpose.stage==='UNKNOWN'?['周期 UNKNOWN']:[]),...frame.unknowns]
 let nextObservation=restricted?'暂停诱发风险的训练并按安全回复处理，不安排探索性负荷测试。':frame.computed.strength.length?'下一课若无痛且日常活动正常，先在熟悉负荷下观察规范动作和剩余次数；记录同动作实际组、整课RPE及次日恢复，动作变形或疼痛即停止。':frame.computed.points.length?'下一次同目的训练记录每轮逐段用时、实际组间与轮间恢复、整课RPE和次日恢复；先核对计时、场地和起跑节奏，出现疼痛或异常反应就停止，不额外安排全力测试。':'先记录一节熟悉、可控活动的实际内容与整课感受；有不适或日常功能异常时先评估，不为了补数据安排极限测试。'
 if(!restricted&&recoveryLines.length)nextObservation+='在已有批准的同目的课程中，对照睡眠、当天感受与同条件表现；有可比设备数据时再记录同来源心率或HRV。共同变化只能支持待验证解释，不单凭一次结果改课。'
 const safety=redFlagResponse(red)??frame.safety.message??(recovery?.safetyHold?`${recovery.safetyNotes.join('')||'当天已记录疼痛。'}先核对部位和日常功能，暂停诱发不适的训练，必要时寻求专业评估。健康指标不能解除疼痛限制。`:null)
 const details=restricted?(safety??'已有健康限制，先暂停相关训练并核对专业评估。'):[
  reasoningRevisionNotice(frame),
  `数据充分性 ${data.level}：${data.meaning}不是能力评分或医学评分。`,
  `本次事实：${facts}`,
  recoveryLines.length?`当天恢复背景（${recovery!.day}，不是本课测量）：${recoveryLines.join('；')}；来源 ${recovery!.sourceId}。`:null,
  `训练目的：${purpose.purpose}；阶段 ${purpose.stage}（${purpose.stage==='UNKNOWN'?'尚无已确认阶段':'本人确认背景'}）。${purpose.declaredIntent?`教练意图自报：${purpose.declaredIntent}；尚需与本课核对。`:''}${purpose.competitionDays!==null?`距所填比赛 ${purpose.competitionDays} 天，优先级 ${purpose.competitionPriority}；不按倒计时自动定周期。`:''}${purpose.conditions}`,
  hypotheses.length?hypotheses.map((h,i)=>`可能解释${i+1}：${h.explanation}\n支持：${h.support.join('；')}\n反证或削弱条件：${h.against.join('；')}`).join('\n'):'可能解释：当前支持不足，暂不定位生理短板；保留已经能计算的事实。',
  `不确定性：${missing.slice(0,4).join('；')||'观察不能证明因果或长期适应'}。`,
  `下一步具体观察：${nextObservation}`,
  purpose.question?`最重要的确认：${purpose.question}`:frame.nextQuestion,
  ...ruleCalculations.map(r=>`${r.ruleId}：${r.status}；${r.value??'UNKNOWN'} ${r.unit}；公式 ${r.formula}；有效样本 ${r.validSamples}；缺失 ${r.missing.join('、')||'无'}；来源 ${r.sourceRefs.map(s=>s.id).join('、')}；不授权处方。`),
  knowledge.length?'研究参考（候选，未独立核验，不是自动规则）：\n'+knowledge.map(k=>`[${k.id}] ${k.summary} 反证：${k.counterevidence} 边界：${k.boundary} 来源：${k.source??'UNAVAILABLE'}`).join('\n'):'相关知识证据尚待核验；不从编辑框架推导个人剂量。',
 ].filter(Boolean).join('\n')
 const available=frame.computed.points,first=available[0]
 const rest=frame.computed.rests[0]?.seconds??input.chat?.restSeconds??null
 const purposeHint=purpose.purpose!=='UNKNOWN'?`${purpose.status==='USER_REPORTED'?'本次自报教练目的':'原计划目的'}是${purpose.purpose}`:'尚未取得本课的原计划目的'
 const race=reportedRace(question)
 const raceValidated=race?.calculation.status==='AVAILABLE'&&race.calculation.segments.length>0&&race.calculation.segments.every(seg=>frame.computed.points.some(point=>point.distanceMeters===seg.meters&&Math.abs(point.seconds-seg.seconds)<0.005))
 const raceFacts=raceValidated?`累计分段换算：${race!.calculation.segments.map(seg=>`${seg.fromM}—${seg.toM}米 ${Number(seg.seconds.toFixed(3))}秒${seg.derived?'（由总成绩相减推导）':''}`).join('；')}；后半相对前半用时差${race!.calculation.halfDifferenceSeconds===null?'UNKNOWN':Number(race!.calculation.halfDifferenceSeconds.toFixed(3))+'秒'}${race!.calculation.halfDifferencePercent!==null?'（'+Number(race!.calculation.halfDifferencePercent.toFixed(2))+'%）':''}；未填写的中间点不插值，不据此预测成绩`:null
 const targetAnalysis=input.chat?intervalTargetAnalysis(input.chat,question,purpose.purpose):null
 const summaries=signals.filter(x=>['SPLIT_CHANGE','SPEED_CHANGE','TIME_CHANGE_RULE','AU','REPORTED_MEAN','REPORTED_TOTAL'].includes(x.kind)).map(x=>x.text.replace(/（样本标准差÷均值[^）]*）/g,'').replace(/（条件计算[^）]*）/g,'；整课评分范围待确认'))
 if(!summaries.length&&first)summaries.push(`已记录${first.distanceMeters??'距离未记'}米，用时${first.seconds}秒${first.pace?`，配速${first.pace}/公里`:''}`)
 if(input.chat?.splits.some(s=>s.seconds===null))summaries.push(input.chat.splits.filter(s=>s.seconds===null).map(s=>`第${s.round}轮第${s.repeat}次用时未记录`).join('、'))
 if(input.chat?.planned!==null&&input.chat?.planned!==undefined)summaries.push(`所述计划${input.chat.rounds}轮×每轮${input.chat.perRound}次；有成绩${input.chat.splits.filter(s=>s.seconds!==null).length}/${input.chat.planned}次，缺记录${input.chat.splits.filter(s=>s.seconds===null).length}次${input.chat.splits.some(s=>s.excluded)?'；可用统计已暂不计异常段':''}`)
 if(rest!==null)summaries.push(`自报或记录组间恢复${rest}秒${input.chat?.roundRestSeconds!==null&&input.chat?.roundRestSeconds!==undefined?`，轮间恢复${input.chat.roundRestSeconds}秒`:''}`)
 if(!input.chat) summaries.push(...[knownProfile,formatComputedFacts(frame),...structural].filter(Boolean).map(cleanAthleteText))
 if(raceFacts)summaries.push(raceFacts)
 if(targetAnalysis)summaries.push(targetAnalysis.text)
 if(!restricted&&recoveryLines.length)summaries.push(`同日背景（${recovery!.day}，非本课测量）：${recoveryLines.join('；')}；这些差异不等于已确认疲劳原因`)
 const hasRpe=frame.computed.ratings.some(r=>r.metric==='SESSION_RPE')||input.chat?.rpe!==null&&input.chat?.rpe!==undefined
 const humanMissing=missing.filter(m=>!(hasRpe&&/RPE|主观强度|评分/.test(m))&&!(rest!==null&&/恢复未知|恢复时间|REST|RECOVERY_WORK/.test(m))).map(cleanAthleteText)
 const explanations=hypotheses.length?hypotheses.map((h,i)=>`可能解释${i+1}（${i===0?'一种解释':'另一种解释'}）：${cleanAthleteText(h.explanation).replace(/[。]/g,'；')}支持：${h.support.map(cleanAthleteText).join('；').replace(/[。]/g,'')}；削弱条件：${h.against.map(cleanAthleteText).join('；').replace(/[。]/g,'')}。`).join(' '):'可能解释：依据不足，先保留可确认的事实，不定位生理短板。'
 const known=knownProfile?cleanAthleteText(knownProfile)+'。':''
 const clause=(value:string)=>cleanAthleteText(value).replace(/[。\n]+/g,'；').replace(/；+$/,'')
 const text=restricted?details:[cleanAthleteText(reasoningRevisionNotice(frame)),quality.issues.length||input.chat?.issues.length?'这个数据可能有问题：'+[...quality.issues,...input.chat?.issues??[]].join(''):'',`本次事实：${input.chat?'聊天自报、未保存；':''}${clause(summaries.join('；')||facts||known)}${historyMetrics.length?'；'+clause(historyMetrics.map(h=>h.text).join('；')):''}。`,`训练目的：${purposeHint}；${clause(purpose.conditions)}。`,explanations,`不确定性：${clause(humanMissing.slice(0,4).join('；')||'环境、计时与长期响应仍需核对')}；观察不证明因果${purpose.question?'；'+purpose.question:'。'}`,`下一步具体观察：${clause(nextObservation)}。`].filter(Boolean).join('\n')
 const calculatedBasis=historyMetrics.length?createReasoningBasis(s,[...new Set([...frame.basis.scopeOccurrenceIds,...historyScope])]):frame.basis
 const basis=boundLoad?{...calculatedBasis,sources:[...calculatedBasis.sources,...boundLoad.sourceIds.map(sourceId=>({sourceId:`session-load:${sourceId}`,signature:JSON.stringify(boundLoad.value)}))]}:calculatedBasis
 const development=buildDevelopmentProjection({snapshot:s,frame,profile:p,purpose,hypotheses,occurrenceId:occ,safetyRestricted:restricted,metricRequests:input.metricRequests,approvedCourses:input.approvedCourses,invalidatedSources:input.invalidatedSources})
 if(recovery?.dependency&&!restricted){
  development.dependencies.push(recovery.dependency)
  for(const task of development.observationTasks)if(task.sourceIds.includes(recovery.sourceId))task.metrics.push('同日睡眠、主观感受及可比设备指标；保留日期、来源和测量条件')
 }
 return {version:OFFLINE_LOOP_VERSION,athleteId:s.athleteId,occurrenceId:occ,asOf:s.asOf,basis,profileId:profile?.id??null,data,comparableOccurrenceIds,historyMetrics,purpose,facts,metrics:frame.computed,hypotheses,knowledge,missing,nextObservation,safetyRestricted:restricted,text:cleanAthleteText(text),details,signals,ruleCalculations,recoveryContext:recovery,development,planWrite:false,abilityScoreChange:0}
}

export type ReviewHistory={id:string;kind:'ANALYSIS';createdAt:string;athleteId:string;review:OfflineReview;hypothesisRevisions?:HypothesisRevision[];revisions:{priorId:string;status:'RETAINED_UNCONFIRMED'|'WEAKENED'|'WITHDRAWN';reason:string}[]}|{id:string;kind:'FEEDBACK';createdAt:string;athleteId:string;reviewId:string;verdict:'SUPPORT'|'CONTRADICT'|'UNKNOWN'|'REJECT';note:string}|{id:string;kind:'HYPOTHESIS_OBSERVATION';createdAt:string;athleteId:string;observation:LinkedObservation;revision:HypothesisRevision}
/** Chat keeps the established short paragraph contract; the full review remains available in the review panel. */
export function compactOfflineReview(review:OfflineReview):string{
 const paragraphs:string[]=[]
 for(const line of review.text.split('\n').filter(Boolean)){
  if(!paragraphs.length||/^(?:数据充分性|本次事实：|训练目的：|可能解释\d?[：:]|不确定性：|下一步具体观察：|最重要的确认：|研究参考|相关知识证据)/.test(line))paragraphs.push(line)
  else paragraphs[paragraphs.length-1]+=' '+line
 }
 return paragraphs.join('\n')
}
export function readOfflineHistory(athleteId:string,asOf=new Date().toISOString()):ReviewHistory[]{
 return readJournal<ReviewHistory>(OFFLINE_REVIEW_PREFIX).filter(x=>!x.recordedAt||validTime(x.recordedAt)&&Date.parse(x.recordedAt)<=Date.parse(asOf)).map(x=>x.data).filter(r=>r?.athleteId===athleteId&&validTime(r.createdAt)&&Date.parse(r.createdAt)<=Date.parse(asOf)&&(['ANALYSIS','FEEDBACK','HYPOTHESIS_OBSERVATION'].includes(r.kind))&&(r.kind!=='ANALYSIS'||validTime(r.review.asOf)&&Date.parse(r.review.asOf)<=Date.parse(asOf)))
}
export function saveOfflineReview(review:OfflineReview):{ok:boolean;id:string|null}{
 if(review.planWrite!==false||review.abilityScoreChange!==0||!validTime(review.asOf)||Date.parse(review.asOf)>Date.now())return {ok:false,id:null}
 const knownHistory=readOfflineHistory(review.athleteId)
 const history=knownHistory.filter(r=>Date.parse(r.createdAt)<=Date.parse(review.asOf))
 const signature=(r:OfflineReview)=>JSON.stringify([r.occurrenceId,r.profileId,r.development?.dependencies??r.basis.sources,r.purpose,r.text])
 // A previously saved copy can have a commit timestamp just after its analysis cutoff.
 // It is usable for idempotency, never as future evidence for a historical revision.
 const duplicate=knownHistory.find(r=>r.kind==='ANALYSIS'&&signature(r.review)===signature(review))
 if(duplicate){registerReviewClaims(duplicate.id,review);return {ok:true,id:duplicate.id}}
 const revisions:Extract<ReviewHistory,{kind:'ANALYSIS'}>['revisions']=[]
 const hypothesisRevisions:HypothesisRevision[]=[]
 for(const prior of history.filter((r):r is Extract<ReviewHistory,{kind:'ANALYSIS'}>=>r.kind==='ANALYSIS')){
  const changes=reviseHypotheses(prior.id,prior.review,review)
  hypothesisRevisions.push(...changes)
  const allWithdrawn=changes.length>0&&changes.every(c=>c.status==='WITHDRAWN')
  revisions.push({priorId:prior.id,status:allWithdrawn?'WITHDRAWN':'RETAINED_UNCONFIRMED',reason:allWithdrawn?'各项解释的来源均已明确更正；保留旧版本。':'按单项假设保留证据。未绑定新证据的反馈、缺失或首末方向反转不自动改变判断。'})
 }
 const id=crypto.randomUUID(),record:ReviewHistory={id,kind:'ANALYSIS',createdAt:new Date().toISOString(),athleteId:review.athleteId,review,revisions,hypothesisRevisions}
 const ok=appendJournal(OFFLINE_REVIEW_PREFIX,id,record)
 if(ok)registerReviewClaims(id,review)
 return {ok,id}
}
export function saveOfflineFeedback(athleteId:string,reviewId:string,verdict:'SUPPORT'|'CONTRADICT'|'UNKNOWN'|'REJECT',note:string):boolean{
 if(!['SUPPORT','CONTRADICT','UNKNOWN','REJECT'].includes(verdict)||!note.trim()||note.length>600||!readOfflineHistory(athleteId).some(r=>r.id===reviewId&&r.kind==='ANALYSIS'))return false
 const id=crypto.randomUUID();return appendJournal<ReviewHistory>(OFFLINE_REVIEW_PREFIX,id,{id,kind:'FEEDBACK',athleteId,reviewId,verdict,note:note.trim(),createdAt:new Date().toISOString()})
}
/** Explicit evidence-linked review, persisted in the existing review journal. A bare SUPPORT click is not this contract. */
export function saveLinkedHypothesisObservation(athleteId:string,observation:LinkedObservation):boolean{
 const now=new Date().toISOString(),history=readOfflineHistory(athleteId,now)
 const prior=history.find((r):r is Extract<ReviewHistory,{kind:'ANALYSIS'}>=>r.kind==='ANALYSIS'&&r.id===observation.sourceReviewId)
 const current=history.find((r):r is Extract<ReviewHistory,{kind:'ANALYSIS'}>=>r.kind==='ANALYSIS'&&r.id===observation.observedReviewId)
 if(!prior||!current||prior.id===current.id||current.review.safetyRestricted||observation.confirmed!==true||!['SUPPORT','REFUTE','INCONCLUSIVE'].includes(observation.outcome)||!observation.reason.trim()||observation.reason.length>600)return false
 const withdrawn=history.some(r=>r.kind==='HYPOTHESIS_OBSERVATION'&&r.revision.priorReviewId===prior.id&&r.revision.hypothesisId===observation.hypothesisId&&r.revision.status==='WITHDRAWN'||r.kind==='ANALYSIS'&&r.hypothesisRevisions?.some(h=>h.priorReviewId===prior.id&&h.hypothesisId===observation.hypothesisId&&h.status==='WITHDRAWN'))
 if(withdrawn)return false
 const revision=reviseHypotheses(prior.id,prior.review,current.review,[observation],current.id,now).find(r=>r.hypothesisId===observation.hypothesisId&&r.manualObservation)
 if(!revision)return false
 const id=crypto.randomUUID();return appendJournal<ReviewHistory>(OFFLINE_REVIEW_PREFIX,id,{id,kind:'HYPOTHESIS_OBSERVATION',athleteId,createdAt:now,observation,revision})
}
export function offlineAthletePortrait(profile:ProfileRecord|null,history:ReviewHistory[]){
 const analyses=history.filter((r):r is Extract<ReviewHistory,{kind:'ANALYSIS'}>=>r.kind==='ANALYSIS')
 return {background:profile?.profile??null,judgments:analyses.map(r=>{
  const revisions=analyses.flatMap(n=>n.revisions).filter(n=>n.priorId===r.id)
  const linked=history.flatMap(n=>n.kind==='ANALYSIS'?n.hypothesisRevisions??[]:n.kind==='HYPOTHESIS_OBSERVATION'?[n.revision]:[]).filter(n=>n.priorReviewId===r.id)
  const hypothesisStates=r.review.hypotheses.map(h=>{const changes=linked.filter(n=>n.hypothesisId===h.id);const sourceRevisions=readClaimRevisions(r.athleteId).filter(n=>n.result.claimId===`${r.id}:${h.id}`);const stale=sourceRevisions.some(n=>n.result.updateAction==='MARK_STALE');const latest=changes.filter(n=>n.status!=='PENDING').at(-1);return {id:h.id,status:stale||changes.some(n=>n.status==='WITHDRAWN')?'WITHDRAWN':latest?.status??'PENDING',changes,sourceRevisions}})
  const status=hypothesisStates.length&&hypothesisStates.every(h=>h.status==='WITHDRAWN')||revisions.some(n=>n.status==='WITHDRAWN')?'WITHDRAWN':hypothesisStates.some(h=>h.status==='WEAKENED')||revisions.some(n=>n.status==='WEAKENED')?'WEAKENED':hypothesisStates.some(h=>h.status==='SUPPORTED')?'SUPPORTED':'RETAINED_UNCONFIRMED'
  return {id:r.id,occurrenceId:r.review.occurrenceId,hypotheses:r.review.hypotheses,hypothesisStates,status}
 }),abilityScore:null,automaticPlanChanges:0}
}
