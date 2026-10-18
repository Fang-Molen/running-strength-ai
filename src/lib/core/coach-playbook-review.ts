import type { EvolutionSnapshot } from './coach-evolution-v4.ts'
import type { computeReasoningFacts } from './coach-reasoning.ts'
import { COACH_PLAYBOOK_POLICY, PLAYBOOK_VERSION } from './coach-playbook.ts'

type Facts = ReturnType<typeof computeReasoningFacts>
export type CoachingExplanation={id:string;observation:string;sourceIds:string[];possibility:string;wouldWeaken:string}
export type DecisionQuestion={id:string;question:string;changesDecision:string}
export type CoachingReview={version:typeof PLAYBOOK_VERSION;observations:{text:string;sourceIds:string[]}[];explanations:CoachingExplanation[];questions:DecisionQuestion[];dataQuality:string[];stopCondition:string;followup:string;decision:'HOLD_ADJUSTMENT_PENDING_REVIEW';progressionAuthorized:false;planWrite:false}
const round=(n:number)=>Number(n.toFixed(2))
/** Focus only on the selected live snapshot. No estimates from plans, old chat or sample answers. */
export function buildCoachingReview(input:{snapshot:EvolutionSnapshot;computed:Facts;scope:readonly string[];stage:string;task:string;question:string}):CoachingReview|null{
 if(input.stage!=='EXPLAIN_EVIDENCE'||input.task==='CALCULATE'||input.scope.length!==1)return null
 const {computed:c,snapshot:s}=input,occ=input.scope[0]
 const live=s.active.filter(e=>e.occurrenceId===occ&&e.source!=='PLAN'&&e.value!==null)
 const observations:CoachingReview['observations']=[],explanations:CoachingExplanation[]=[],questions:DecisionQuestion[]=[],dataQuality:string[]=[]
 const group=c.groups.find(g=>g.occurrenceId===occ&&c.points.some(p=>g.sourceIds.includes(p.sourceId)&&p.protocol.includes(':rep:')))??c.groups.find(g=>g.occurrenceId===occ)
 if(group){
  const points=group.sourceIds.map(id=>c.points.find(p=>p.sourceId===id&&p.occurrenceId===occ)).filter((p):p is Facts['points'][number]=>!!p)
  if(points.length===group.count && points.length<=32){
   const mean=points.reduce((a,p)=>a+p.seconds,0)/points.length,first=points[0],last=points.at(-1)!,previous=points.at(-2)!
   const spread=(Math.max(...points.map(p=>p.seconds))-Math.min(...points.map(p=>p.seconds)))/mean*100
   const delta=last.seconds-previous.seconds,changePercent=delta/previous.seconds*100
   observations.push({text:`同条件${points.length}段平均用时${round(mean)}秒，平均配速${group.averagePace}/km；末段较前一段${delta<0?'快':'慢'}${round(Math.abs(delta))}秒（${round(Math.abs(changePercent))}%）；极差/均值${round(spread)}%。`,sourceIds:group.sourceIds})
   const faster=group.trend==='FASTER'||changePercent < -COACH_PLAYBOOK_POLICY.intervalChangeNoticePercent
   const slower=group.trend==='SLOWER'||changePercent > COACH_PLAYBOOK_POLICY.intervalChangeNoticePercent
   const observation=`首段${first.seconds}秒、末段${last.seconds}秒；只说明这组可比记录的变化。`
   explanations.push({id:'PACING',observation,sourceIds:group.sourceIds,
    possibility:faster?'可能是前段有所保留，也可能是计划内逐组加速。':slower?'可能是起始速度与本课目标不匹配，后段难以维持。':'可能是本课配速控制较一致；不等于刺激不足或能力已经提升。',
    wouldWeaken:faster?'若末段是临场全力冲刺，便不能把末段速度当作各组可持续水平。':slower?'若核实原计划就是减速或后段场地条件不同，则不能归因于起跑过快。':'若计时、距离或恢复口径不一致，则“控制一致”的解释变弱。'})
   explanations.push({id:'SESSION_CONTEXT',observation,sourceIds:group.sourceIds,
    possibility:'实际恢复安排、当天身体反应或记录误差也可能改变用时；当前数字不能分开这些原因。',
    wouldWeaken:'若后续在同目标、同方法与相近恢复条件下仍重复出现同样变化，则单次状态或测量波动的解释变弱。'})
   if(!/计划.{0,8}(?:均速|均匀|逐组加速)|(?:末|最后一)组.{0,8}(?:冲刺|全力)/.test(input.question))questions.push({id:'purpose',question:'这次主课要练均匀配速还是逐组加速，末段是否临场冲刺？',changesDecision:'计划内变化按目标评价；临场冲刺不作为缩短休息或加组依据。'})
  }
 }
 const strength=c.strength.filter(x=>x.occurrenceId===occ)
 if(!group&&strength.length){
  const first=strength[0]
  const strengthSources=[...new Set(strength.flatMap(x=>x.sourceIds))]
  const observation=`已记录${new Set(strength.map(x=>x.protocol)).size}个力量组；这一组${first.kg===null?'重量未知':first.kg+'kg'} × ${first.amount}${first.unit==='s'?'秒':'次'}。`
  observations.push({text:observation,sourceIds:strengthSources})
  explanations.push({id:'STRENGTH_CAPACITY',observation,sourceIds:strengthSources,possibility:'完成已记录的组可能说明当前负荷能完成；尚不能确定动作稳定或仍有余量。',wouldWeaken:'若最后几次动作变形、借力或需要他人帮助，“可稳定完成”的解释变弱。'})
  explanations.push({id:'STRENGTH_CONTEXT',observation,sourceIds:strengthSources,possibility:'较长休息、动作幅度或器械差异也可能影响完成次数，不一定是力量提高。',wouldWeaken:'若同动作标准、同器械和相近恢复下多次表现一致，这些条件差异的解释变弱。'})
  questions.push({id:'technique',question:'最后几次动作是否稳定，还能规范完成几次？',changesDecision:'动作变形先降低要求；余量仅为估计时维持重量，不直接把RIR换成新重量。'})
 }
 if(!explanations.length&&c.points.length){
  const observation=`有${c.points.length}个实际工作/连续段与${c.rests.length}个恢复记录，部分距离或可比条件待确认。`
  explanations.push({id:'STRUCTURE',observation,sourceIds:c.points.map(p=>p.sourceId),possibility:'不同段可能承担不同训练目的，不能直接当作同一配速趋势。',wouldWeaken:'若计划目的、距离与方法核对后确实一致，这种结构差异解释就减弱。'},
   {id:'MEASUREMENT',observation,sourceIds:c.points.map(p=>p.sourceId),possibility:'距离口径或计时误差也可能影响分段差异，尚不能定位到身体原因。',wouldWeaken:'若场地、圈数与计时均得到独立核实，则测量差异的解释减弱。'})
 }
 const hrs=c.heartRates.filter(h=>live.some(e=>e.sourceId===h.sourceId))
 if(hrs.length){
  dataQuality.push(hrs.some(h=>h.method==='UNKNOWN')?'已保留分段心率数值，但测量方法未记录，核对后再比较。':'平均心率含爬升阶段，不能单凭快配速/低心率判断效率改善。')
  questions.push({id:'heart-method',question:'这些心率是同设备、同时间窗的平均值，还是混有最高值？',changesDecision:'口径不一致先拆开；口径一致仍只描述观察，不直接解释为心功能或训练适应。'})
 }
 const delayed=live.filter(e=>e.metric==='SESSION_RPE'&&(Date.parse(e.recordedAt)-Date.parse(e.eventAt))/3600000>COACH_PLAYBOOK_POLICY.lateReportHours)
 if(delayed.length)dataQuality.push('RPE记录的发生时间与录入时间相隔超过24小时，存在回忆误差可能；先核对录入口径，不单凭这条延迟记录进阶。')
 if(live.some(e=>e.confirmation!=='CONFIRMED'))dataQuality.push('含自报或待核验来源，保留原值与来源状态，不把确认导入等同于设备事实已验证。')
 if(live.some(e=>e.supersedes))dataQuality.push('已按有效更正来源重算；旧值不再作为当前结论依据。')
 if(group&&group.count>32)dataQuality.push('可比分段较多，本次简要解释未展开；不把显示片段当整课趋势。')
 if(!group&&c.points.length)dataQuality.push('缺少可比的重复段，不能把连续段、不同距离或不同方法混成间歇趋势。')
 if(!c.ratings.some(r=>r.metric==='SESSION_RPE'))questions.push({id:'rpe',question:/RPE\s*(?:为|是|[:：])?\s*\d/i.test(input.question)?'消息中的评分是否针对这堂课整体，是否要在训练记录中正式保存？':'这堂课的整课RPE是多少，还是只记了某一组感受？',changesDecision:'整课与单组分开；未核实前不给进阶剂量，也不反复追问已存在的其他评分。'})
 if(!(/现在|目前|今天/.test(input.question)&&/无痛|没有疼痛|无不适/.test(input.question)&&/睡眠正常|睡得正常|精神正常|睡眠良好/.test(input.question)))questions.unshift({id:'current-state',question:'现在有无局部疼痛或不适，睡眠和精神状态相对平时怎样？',changesDecision:'有症状或明显变差先暂停强度并核对；反馈正常仍需同类课证据，不能只凭这一课加量。'})
 return {version:PLAYBOOK_VERSION,observations,explanations:explanations.slice(0,2),questions:questions.slice(0,COACH_PLAYBOOK_POLICY.maxQuestions),dataQuality,
  stopCondition:'出现局部疼痛加重、动作变形、步态改变或热身反应异常就停止相关训练；胸部不适、晕厥等立即停止并寻求急救评估。',
  followup:'下次记录逐段/逐组实际完成、整课RPE与次日恢复；新反馈与原解释不符时重新判断，不沿用旧建议。',
  decision:'HOLD_ADJUSTMENT_PENDING_REVIEW',progressionAuthorized:false,planWrite:false}
}
export function formatCoachingReview(review:CoachingReview):string{
 return [review.dataQuality.find(s=>/更正|方法未记录|24小时/.test(s))??'',
  ...review.explanations.map((h,i)=>`可能解释${i+1}：${h.possibility} 支持：${h.observation} ${h.wouldWeaken}`),
  ...review.questions.slice(0,1).map(q=>q.question)].filter(Boolean).join('\n')
}
