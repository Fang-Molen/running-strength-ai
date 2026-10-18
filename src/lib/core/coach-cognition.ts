import { retrieveCurriculum, type CurriculumSelection } from './coach-curriculum.ts'
import type { CoachBrief } from './coach-brief.ts'
import { classifyLocalSafety } from './coach-local-safety.ts'
import { detectCognitionEvents, retrieveCognitionKnowledge, COGNITION_KNOWLEDGE_VERSION, type CognitionKnowledge, type ResearchGap } from './coach-cognition-knowledge.ts'
import { parseRoundStructure, summarizeTimedReps, type TimedRep } from './coach-cognition-tools.ts'
import { loadLearning, learningSummary } from './coach-cognition-learning.ts'

export type CognitionFact = { id: string; kind: 'BOUND_FACT' | 'USER_REPORT' | 'PLAN' | 'THIRD_PARTY'; text: string; sourceIds: string[] }
export type CognitionHypothesis = { id: string; explanation: string; support: string[]; against: string[]; test: string; status: 'POSSIBLE' | 'CONFOUNDED' }
export type CognitionOption = { id: 'HOLD_VERIFY' | 'RECOVERY_REVIEW' | 'QUALITY_REVIEW'; direction: string; reason: string; tradeoff: string; requiresConfirmation: true; executable: false }
export type CoachCognition = {
  version: string; events: string[]; intents: string[]; facts: CognitionFact[]; calculations: string[]
  curriculum?: CurriculumSelection;
  knowledge: CognitionKnowledge[]; hypotheses: CognitionHypothesis[]; unknowns: string[]; options: CognitionOption[]
  safety: ReturnType<typeof classifyLocalSafety>; increaseBlocked: boolean; confidence: 'LOW'; diagnosis: null; decisionAuthorization: false
  researchGaps: ResearchGap[]; learning: string; text: string
}
const num = (n: number) => Number(n.toFixed(2)).toString()
const reportId = (q: string) => { let h=2166136261; for(const c of q) h=Math.imul(h^c.charCodeAt(0),16777619); return `statement:${(h>>>0).toString(16)}` }
/** A deterministic, evidence-explicit reasoning slice, not a general language model. No writes. */
export function reasonCoachCognition(brief: CoachBrief): CoachCognition | null {
  const q=brief.question
  const events=detectCognitionEvents(q)
  const reps: TimedRep[]=[]
  for (const r of brief.running ?? []) {
    if (r.kind==='RECOVERY' || r.status!=='COMPLETED' || !brief.occurrenceId || brief.duplicateCount>0) continue
    const validIds=r.sourceEventIds.filter(id => brief.sourceIds.includes(id) && brief.sources?.some(s=>s.id===id && s.kind==='FACT'))
    const actual=r.actual.match(/^(\d+(?:\.\d+)?)米\/(\d+(?:\.\d+)?)秒$/)
    const plan=r.planned.match(/^(\d+(?:\.\d+)?)米\/(\d+(?:\.\d+)?)秒$/)
    if(actual && validIds.length && Number(actual[1])>0 && Number(actual[2])>0) reps.push({ distanceMeters:Number(actual[1]), actualSeconds:Number(actual[2]), plannedSeconds:plan && Number(plan[1])===Number(actual[1]) ? Number(plan[2]) : null, sourceIds:validIds, position:r.position })
  }
  if (!events.length && reps.some(r=>r.distanceMeters===400) && /跑|训练|分段|复盘|调整|恢复|成绩|为什么|掉速/.test(q)) events.push('400米')
  if (!events.length) return null
  const intentReview=/掉速|变慢|分段|前200|前程|停滞|分析|复盘|成绩|不足|下降/.test(q) || reps.length>0
  const intentPlan=/计划|安排|每周|主课|几组|目标|怎么练|训练选择/.test(q)
  const intentAdjust=/调整|加量|加一|增加|减量|恢复|RPE|睡眠|腿沉|比赛|调吗/i.test(q)
  const intents=[intentReview?'REVIEW':null,intentPlan?'PLAN':null,intentAdjust?'ADJUST':null].filter((s):s is string=>s!=null)
  const id=reportId(q), third=/朋友|他人|队友|甲|乙/.test(q), planned=/计划|目标|课表|将要|未来|草稿|想把.*跑到|想跑进|帮我安排/.test(q) && !/实际|跑了|完成|上次|昨天|录过|前200|过去|评分|成绩|最好|电子计时|记录/.test(q)
  const facts: CognitionFact[]=[{id,kind:third?'THIRD_PARTY':planned?'PLAN':'USER_REPORT',text:q,sourceIds:[id]}]
  for (const r of reps) facts.push({ id:r.sourceIds[0],kind:'BOUND_FACT',text:`${r.position} 实际${r.distanceMeters}米/${r.actualSeconds}秒${r.plannedSeconds!=null?`；计划${r.plannedSeconds}秒`:''}`,sourceIds:r.sourceIds })
  const bound=(type:string,value:number|null|undefined,label:string)=>{
    const ids=(brief.sources??[]).filter(s=>brief.sourceIds.includes(s.id)&&s.kind==='FACT'&&s.detail.startsWith(type+' ')).map(s=>s.id)
    if(value!=null && ids.length===1 && brief.occurrenceId && brief.duplicateCount===0) facts.push({id:ids[0],kind:'BOUND_FACT',text:`${label}${value}`,sourceIds:ids})
  }
  bound('SESSION_RPE',brief.sessionRpe,'本次RPE '); bound('SLEEP',brief.sleepHours,'绑定睡眠小时 '); bound('SUBJECTIVE_RECOVERY',brief.subjectiveRecovery,'绑定主观恢复 ')
  const calculations: string[]=[]
  let timed= summarizeTimedReps(reps)
  // Only explicitly labelled actual times in text are interpreted. Never turn a target list into completion.
  const list=q.match(/(?:实际(?:成绩|用时|分段)?|每组(?:用时|成绩)?|跑了)\s*[:：为是]?\s*((?:\d+(?:\.\d+)?\s*(?:秒)?\s*[,，、+＋]\s*){1,}\d+(?:\.\d+)?\s*秒?)/)
  const distance=q.match(/(?:原计划|计划|实际|重复跑)\s*(\d+)\s*(?:米|m)\s*[×x*]/i) || q.match(/(?:^|[^\d])(\d+)\s*(?:米|m)(?:重复跑|间歇|[×x*]|训练|跑)?/i)
  const actualClause=q.split(/实际完成[：:]/)[1]?.split(/整课|请计算|请分析/)[0]
  const labelled=actualClause ? [...actualClause.matchAll(/第(?:[一二三四五六七八九十]|\d+)组\s*(\d+(?:\.\d+)?)秒/g)].map(m=>Number(m[1])) : []
  if(!timed && labelled.length && distance && !third && !/OCR|照片|识别|截图/.test(q)) {
    const range=q.match(/每组目标\s*(\d+(?:\.\d+)?)[—–~-](\d+(?:\.\d+)?)秒/)
    const upper=range?Number(range[2]):null
    timed=summarizeTimedReps(labelled.map((t,i)=>({distanceMeters:Number(distance[1]),actualSeconds:t,plannedSeconds:upper,sourceIds:[id],position:`用户自报第${i+1}组`})))
    if(range) calculations.push(`计划用时范围${range[1]}–${range[2]}秒；下面偏差按上限计算。`)
  }
  if (!timed && list && distance && !planned && !third && !/OCR|照片|识别|截图/.test(q)) {
    const values=list[1].match(/\d+(?:\.\d+)?/g)?.map(Number)??[]
    timed=summarizeTimedReps(values.map((t,i)=>({distanceMeters:Number(distance[1]),actualSeconds:t,plannedSeconds:null,sourceIds:[id],position:`用户自报第${i+1}组`})))
  }
  if(timed) {
    calculations.push(`${timed.distanceMeters}米已记录${timed.count}组，平均${num(timed.meanSeconds)}秒（仅这些记录，不宣称整课完整）。`)
    if(timed.firstMeanSeconds!=null && timed.lastMeanSeconds!=null) calculations.push(`前${Math.min(2,Math.floor(timed.count/2))}组均值${num(timed.firstMeanSeconds)}秒；末组窗口均值${num(timed.lastMeanSeconds)}秒；用时差${num(timed.timeIncreaseSeconds!)}秒，用时增加${num(timed.timeIncreasePercent!)}%，等距离速度下降${num(timed.speedDeclinePercent!)}%。`)
    if(timed.deviations.some(n=>n!=null)) calculations.push(`实际−计划偏差（秒）：${timed.deviations.map(n=>n==null?'UNKNOWN':num(n)).join('、')}。`)
  }
  const means=q.match(/前两组(?:均值|平均)(?:为|是)?\s*(\d+(?:\.\d+)?)秒.{0,35}(?:末|后)两组(?:均值|平均)(?:为|是)?\s*(\d+(?:\.\d+)?)秒/)
  if(means && !timed && !planned) { const a=Number(means[1]),b=Number(means[2]); if(a>0 && b>0) calculations.push(`自报窗口均值${num(a)}→${num(b)}秒；用时差${num(b-a)}秒，用时增加${num((b/a-1)*100)}%，等距离速度下降${num((1-a/b)*100)}%；没有补造中间各组。`) }
  const halves=q.match(/前\s*200\s*(?:米|m)?\s*(\d+(?:\.\d+)?)秒.{0,20}后\s*200\s*(?:米|m)?\s*(\d+(?:\.\d+)?)秒/i)
  if(halves && !planned) {const a=Number(halves[1]),b=Number(halves[2]);if(a>0&&b>0) calculations.push(`自报400米两半合计${num(a+b)}秒，后半比前半多${num(b-a)}秒；这不是已确诊的速度耐力缺陷。`) }
  const equalHalves=q.match(/800\s*(?:米|m).*?(?:前)?400\s*(?:米|m)(?:分段|用时)?\s*(\d+(?:\.\d+)?)秒.{0,20}后400\s*(?:米|m)(?:分段|用时)?\s*(\d+(?:\.\d+)?)秒/i)
  if(equalHalves&&!planned&&!third&&!/假设|例如|如果|截图|OCR/.test(q)){const a=Number(equalHalves[1]),b=Number(equalHalves[2]);if(a>0&&b>0)calculations.push(`聊天自报800米两半合计${num(a+b)}秒，后400米比前400米多${num(b-a)}秒；等距离速度变化${num((a/b-1)*100)}%，不能据此定位某肌群薄弱或有氧不足。`)}
  const structure=parseRoundStructure(q)
  if(structure) calculations.push(`结构：${structure.rounds}轮×每轮${structure.repeats}个${structure.distanceMeters}米（总${structure.totalReps}次），保留轮间恢复；计划结构不等于实际完成。`)
  const daysText=q.match(/(\d+)\s*天后(?:就)?(?:比赛|要比赛)|(?:距(?:离)?(?:重要)?比赛|比赛(?:只)?(?:还)?(?:剩|还有)|还有)\s*(\d+)\s*天|(?:\s|^)(\d+)天后.*比赛/)
  const days=daysText ? Number(daysText[1]??daysText[2]??daysText[3]) : brief.daysToCompetition
  const near=days!=null && days>=0 && days<=28
  const deload=brief.week===4 || brief.bias==='deload' || /(?:现在|当前|本周|这周|本次).{0,8}(?:第[4４]周|调整周|减量周|deload)|^(?:第[4４]周|调整周|减量周|deload)/i.test(q)
  const safety=classifyLocalSafety(q)
  const hasBound=(label:string)=>facts.some(f=>f.kind==='BOUND_FACT'&&f.text.startsWith(label))
  const poor=/RPE\s*(?:为|是|[:：])?\s*(?:8|9|10)|只睡\s*[1-5](?:\.\d+)?\s*小时|睡眠差|腿沉|腿很沉|腿部仍然沉重|疲劳明显|主观恢复(?:评分)?(?:为|是)?\s*[1-3]|恢复\s*[1-3]\s*\/\s*10/i.test(q) || (hasBound('本次RPE ')&&brief.sessionRpe!=null&&brief.sessionRpe>=8) || (hasBound('绑定睡眠小时 ')&&brief.sleepHours!=null&&brief.sleepHours<6) || (hasBound('绑定主观恢复 ')&&brief.subjectiveRecovery!=null&&brief.subjectiveRecovery<=3)
  const restChanged=/休息.*(?:缩|变|改|从|不同)|间歇.*(?:缩|变|不同)/.test(q)
  const conflict=brief.duplicateCount>0 || /RPE\s*6.*(?:9|冲突)|没说哪个是更正|两条冲突/.test(q)
  const increaseBlocked=safety!=='NONE'||brief.pain||brief.constraints.increaseBlocked||near||deload||poor||conflict||events.length>1
  const curriculum=retrieveCurriculum(q)
  const arithmeticOnly=/(?:只|仅)(?:求|算|计算)|不要分析原因/.test(q) && calculations.length>0
  const knowledge=retrieveCognitionKnowledge(events,q)
  if(arithmeticOnly) {
    const mathKnowledge=knowledge.filter(k=>k.teachingRuleId==='FK5R1:C02');
    return {version:COGNITION_KNOWLEDGE_VERSION,events,intents:['CALCULATE'],facts,calculations,knowledge:mathKnowledge,curriculum,
      hypotheses:[],unknowns:[],options:[],safety,increaseBlocked:true,confidence:'LOW',diagnosis:null,decisionAuthorization:false,
      researchGaps:[],learning:'本次数值计算不形成个人训练规律。',
      text:`按你这次提供的数字（自报，不冒充已保存训练）：\n${calculations.join('\n')}\n只完成计算，不推断生理原因或改变训练计划。[FK5R1:C02] 没有修改计划或记录。`}
  }

  const unknowns=['近期同项目实际成绩、日期及计时方式（电子/手计）','目标比赛日期与当前周期阶段','近4–8周主课、训练经验、周频与可用时间','疼痛/不适、睡眠和24h/48h恢复','组间/轮间休息、场地天气、训练目的与技术观察']
  if(days!=null) unknowns[1]=`距比赛${days}天；仍需确认实际赛程与既往负荷`
  if(restChanged) unknowns.push('休息条件已改变，不能把本次变慢直接解释为能力下降')
  if(conflict) unknowns.push('重复或冲突证据必须显式更正，不能平均或选最新一条用于学习')
  if(brief.runningTruncated) unknowns.push('展示包被截短，无法核实整课完成或整课均值')
  if(events.length>1) unknowns.push(`涉及${events.join('与')}；跨距离/跨项目不可直接迁移恢复规律或成绩预测`)
  if(third) unknowns.push('第三方资料只能作比较，不能并入本人AthleteState或个人记忆')
  const decline=(timed?.timeIncreaseSeconds??0)>0 || !!means || !!halves || /掉速|变慢|下降|停滞/.test(q)
  const hypotheses: CognitionHypothesis[] = [
    { id:'PACING_REST',explanation:'前程配速或恢复间隔与课的目的不匹配',support:restChanged?['用户明确说休息条件改变']:decline?['观察到输出下降，但不能确认其原因']:[],against:['尚未提供前程能力、完整休息和同条件对照'],test:'在原有安全范围内核对完整休息和前程分段；只改变一个条件比较，其他条件不同时不归因',status:restChanged?'CONFOUNDED':'POSSIBLE' },
    { id:'RECOVERY',explanation:'当天恢复状态或近期累积负担影响输出',support:poor?['存在高主观强度/短睡眠/腿沉线索']:[],against:['单次RPE或HRV不能诊断疲劳；缺少连续恢复趋势'],test:'记录实际观察时间、睡眠、主观恢复和症状，比较同类课；恢复正常时若仍下降则削弱该解释',status:'POSSIBLE'},
    { id:'SPECIFICITY_TECHNIQUE',explanation:`${knowledge.find(k=>k.verification==='CANDIDATE'&&!k.teachingRuleId)?.claim??'专项速度保持与技术'}可能限制表现`,support:decline?['分段表现为调查方向，尚非能力诊断']:[],against:['缺少可比成绩、技术视频和多次独立观察；不能由总成绩定位短板'],test:'比较同条件分段并让教练观察技术；若充分恢复且配速受控后仍反复下降，再检验专项刺激',status:'POSSIBLE'},
  ]
  if(arithmeticOnly || safety!=='NONE') hypotheses.splice(0)
  if(arithmeticOnly) unknowns.splice(0)
  const options: CognitionOption[] = arithmeticOnly || safety!=='NONE' || brief.pain ? [] : [
    {id:'HOLD_VERIFY',direction:'保留原计划作为候选基准，先补齐可比证据再决定',reason:conflict?'存在证据冲突，应先核对原始记录':'当前尚不能确认表现下降的原因',tradeoff:'可能暂缓调整，但避免把测量和恢复差异当能力变化',requiresConfirmation:true,executable:false},
    {id:poor||near||deload?'RECOVERY_REVIEW':'QUALITY_REVIEW',direction:poor||near||deload?'候选：优先恢复与赛期质量，评估减少总量或暂缓新增高强度':'候选：在既有安全剂量内评估配速/恢复或技术质量，只改变一个条件',reason:near?`比赛窗口${days}天，28天保护禁止依据一次表现自动加量`:deload?'本周调整期，单日好状态不能取消恢复目的':poor?'恢复风险线索优先，不能依据目标成绩堆积刺激':'竞争假设需要可证伪的对照',tradeoff:'减少刺激可能影响短期训练量；保留质量也需要确认症状与原有耐受',requiresConfirmation:true,executable:false},
  ]
  const researchGaps: ResearchGap[] = knowledge.filter(k=>k.verification==='CANDIDATE').map(k=>({id:`gap:${k.id}`,event:k.event,question:`${k.event}针对当前人群与阶段的干预剂量和效果，需要原文核验`,status:'GAP',url:null,methodNotes:null,blindTestEvidence:null,reviewer:null,version:1}))
  const learning=learningSummary(loadLearning(),events[0],brief.occurrenceId)
  const lines=[`${events.join(' / ')}本地认知分析：${intents.join('、')||'知识理解'}；置信度低。`,
    `事实来源：${facts.map(f=>`${f.kind} ${f.text} [${f.sourceIds.join(',')}]`).join('\n')}`,
    calculations.length?`可核对计算：\n${calculations.join('\n')}`:'当前没有足够的同距离实际分段来计算下降；目标不当作完成事实。',
    `知识依据：\n${knowledge.map(k=>`${k.id} [${k.verification}] ${k.claim} 适用：${k.population}；局限：${k.limitations}${k.url?` 来源：${k.url}`:''}`).join('\n')}`,
    arithmeticOnly?'按本次自报数据完成计算；不为算术问题凑原因或训练调整。':safety!=='NONE'?'风险优先：停止训练优化，按安全分级处理；具体情况需专业评估。':`竞争假设（不是诊断）：\n${hypotheses.map(h=>`${h.explanation}。支持：${h.support.join('；')||'目前无特异支持'}；反证/限制：${h.against.join('；')}；验证：${h.test}。`).join('\n')}`,
    `待确认：${unknowns.join('；')}。`,
    arithmeticOnly?'':options.length?`候选决策与取舍：\n${options.map(o=>`${o.direction}。理由：${o.reason}。取舍：${o.tradeoff}。`).join('\n')}`:'暂不提供高强度训练候选。',
    arithmeticOnly?'':increaseBlocked?'本轮禁止自动增加负荷；安全/恢复/赛期或冲突约束尚未解除。':'没有生成精确训练剂量；补齐已核验能力与原有负荷后再审查。个人适应结论仍为UNKNOWN。',
    `${/三次|3次/.test(q)?'你自报的三次记录还需核实独立训练编号、目的、强度、休息和实际观察时间；数量达到三次也不能确认稳定规律。反例应降低或撤回规律，不能删除不符合预测的观察。':''}反馈学习：${learning}。可记录预测与24h/48h实际观察，至少三次独立可比记录才形成低置信个人响应；反例与撤回保留。`,
    researchGaps.length?'知识缺口已列出：检索原文→核验人群和方法→候选知识→未见题测试→人工审批→版本化启用。当前候选卡不授权处方。':'',
    /(?:完整|逐日|详细|每次).*(?:计划|课表)|(?:周|天).*(?:计划|课表)/.test(q)?'本轮尚未生成完整逐日周期处方；候选方向不能替代含距离、秒数、组次、休息与退出条件的正式训练计划。':'',
    '候选调整必须由你明确确认；接受、拒绝或重改均不由这次问答自动写入正式课表。没有修改计划或记录。',
  ]
  return {version:COGNITION_KNOWLEDGE_VERSION,curriculum,events,intents,facts,calculations,knowledge,hypotheses,unknowns,options,safety,increaseBlocked,confidence:'LOW',diagnosis:null,decisionAuthorization:false,researchGaps,learning,text:lines.filter(Boolean).join('\n')}
}
