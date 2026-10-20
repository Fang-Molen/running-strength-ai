import { isCompleteKnowledgePreviewRequest } from '../coach/knowledge/complete.ts'
import { statedDirectAnswer } from '../coach/stated/compose.ts'
import { parseRoundStructure } from './coach-cognition-tools.ts'
import type { CoachBrief } from './coach-brief.ts'
import type { LocalCoachAnswer } from './coach-local-first.ts'
import { selectPlaybookLessons, PLAYBOOK_LESSONS } from './coach-playbook.ts'
import { retrieveCurriculum } from './coach-curriculum.ts'
import { retrieveResearchCandidates } from './research-knowledge-registry.ts'
import { detectRedFlags } from './coach-red-flags.ts'
import { calculateSessionLoad, formatSessionLoad } from './coach-session-load.ts'
import { formatComputedFacts, type ReasoningFrame } from './coach-reasoning.ts'
import { computeV4Facts } from './coach-v4-computed.ts'
import type { EvolutionSnapshot } from './coach-evolution-v4.ts'
import { buildOfflineReview, compactOfflineReview, readOfflineProfile } from './coach-offline-loop.ts'
import { getRunningPlanSnapshot } from './running-plan.ts'
import { listTrainingOccurrences } from './occurrence.ts'
import { loadEvents } from './events.ts'
import { projectRunningRepetitions } from './running-execution.ts'
import { analyzeRunningRounds } from './running-round-analysis.ts'
import {readRecoveryContext,recoveryDayForReview} from './coach-recovery-context.ts'

/** Read-only coordination of existing facts and teaching references. No training authority. */
export type OfflineTopic = 'INTERVAL'|'TEMPO'|'EASY'|'LONG'|'SPRINT'|'STRENGTH'|'ZONES'|'WEEK'|'LOAD'|'RECOVERY'|'NEXT'|'ENVIRONMENT'|'DEVICE'|'CHOICE'|'STRUCTURE'
export type OfflineRule = {
 id:string; topic:OfflineTopic; match:RegExp; condition:string; conclusion:string; template:string;
 sourceIds:string[]; verification:'TEACHING_CANDIDATE'|'VERIFIED_ARITHMETIC'; verificationScope:string;
 decisionAuthorization:false;
}
const rule=(topic:OfflineTopic,match:RegExp,condition:string,conclusion:string,template:string,sourceIds:string[],arithmetic=false):OfflineRule=>({
 id:`OFFLINE-${topic}`,topic,match,condition,conclusion,template,sourceIds,
 verification:arithmetic?'VERIFIED_ARITHMETIC':'TEACHING_CANDIDATE',
 verificationScope:arithmetic?'仅算术与单位核验，不代表运动科学因果或个人训练许可':'手册提供，未独立复核；只作保守的教学候选',decisionAuthorization:false,
})
/** Auditable table: selectors do not turn the user's question into an observed fact. */
export const OFFLINE_COACH_RULES:readonly OfflineRule[]=[
 rule('ENVIRONMENT',/高温|热天/,'热环境会影响同配速反应；天气与身体状态分别核对','热天心率变化不能只解释为体能下降。','选择凉爽时段或减少热暴露，结合主观感受降低要求；记录气温、日晒、水分背景和实际反应，不用手机气温伪造WBGT。',['PB-HEAT','PB-HEART']),
 rule('DEVICE',/换了.*(?:手表|设备)|功率/,'设备、固件和算法改变时不能直接比较旧值','先核对测量口径，设备数值升高不代表能力提高。','记录型号、固件、算法、坡度和统计时间窗；若可行在同条件下同步对照，保留两个来源，不直接更改旧记录。',['PB-HEART','PB-GPS']),
 rule('CHOICE',/拒绝建议/,'本人拒绝候选建议','拒绝建议不会自动改变原计划或形成欠课。','在复盘中保存拒绝原因或不适用条件，下次按新反馈重新讨论；不自动追补或生成新剂量。',['FK5R1:D04','FK5R1:D06']),
 rule('STRUCTURE',/\d+\s*(?:m|米)?\s*[×x*]\s*\d+\s*[×x*]\s*\d+/i,'只解析明确的结构描述；实际完成需独立记录','轮数和每轮次数分别保留，结构不是完成事实。','下一次记录每轮逐段实际用时，并分别记录组间和轮间休息；缺段标 NOT_RECORDED，不展平、不补造。',['PB-INTERVAL']),
 rule('NEXT',/下一课|下次|明天.*(?:练|跑)|怎么安排|怎么练|练什么|跑什么/,'询问下一次训练；仍服从已绑定风险与计划限制','下一课先核对当前恢复与训练目的，再选择可回退的安排。','先检查睡眠、局部疼痛和日常活动；若无不适且热身反应正常，可选择熟悉的轻松活动或动作练习，暂不叠加速度、组数和重量；反应异常就停止，次日复查。',['FK5R1:D03','FK5R1:D06','PB-SLEEP']),
 rule('WEEK',/周量|周跑量|本周.*上周|上周.*本周|跑量变化/,'同单位、明确窗口的实际总量；记录不完整只描述已记录部分','周量变化先看统计口径，百分比不能单独决定加量。','先核对两周记录是否齐全，以及长距离和强度课是否集中；增加时先不叠加新的强度刺激，观察睡眠、疼痛和次日反应，不用补课凑周量。',['PB-LOAD','FK5R1:D04']),
 rule('RECOVERY',/静息心率|rhr|恢复检查|睡眠|睡了|只睡|疲劳|腿沉/i,'当前自报或带时间的恢复记录；不同时间和设备分开','恢复要结合个人基线、睡眠和当前功能一起看。','在相同时间和测量条件下复测静息心率，核对昨夜睡眠、白天精神和局部不适；明显变差先暂缓高强度，症状持续或影响日常活动时就医评估。',['PB-SLEEP','PB-HEART','PB-PAIN']),
 rule('ZONES',/区间|^(?:我的|今天|这次|本次)?(?:平均)?(?:心率|配速)/,'有同口径实测值和明确区间才比较；无个人边界不推算','配速或心率只能与已明确的区间比较，不能由一次表现反推阈值。','先核对区间来源、设备和统计窗口；轻松课可结合交谈与主观感受调低要求，短间歇不要为追心率临时提速；不适时停止。',['PB-HEART']),
 rule('INTERVAL',/间歇|重复跑/,'同课次、轮次、实际距离和方法的分段','间歇复盘先看分段与恢复，掉速原因仍需区分。','核对首段是否偏快、实际组间恢复及末组动作；下次先按同一目的记录这些条件，仅在无痛且恢复核对后讨论一个变量，动作明显变形或不适时结束。',['PB-INTERVAL']),
 rule('TEMPO',/节奏跑|阈值跑/,'明确课次目的；配速不自动等于生理阈值','节奏跑重在持续可控，单次配速不能确认阈值。','复查前后段配速、主观用力和环境；若起跑过快或后段明显失控，下次先放缓开段，不同时延长时长；不适时停止并在次日复查恢复。',['PB-INTERVAL','PB-HEART']),
 rule('EASY',/轻松跑|慢跑/,'以轻松活动为目的；无当前高风险信号','轻松跑优先看是否轻松可控，不为追配速增加负担。','若交谈明显费力，先放慢或转步行；天气热时选择凉爽时段，记录整课感受；疼痛、头晕或异常气短时停止并按症状评估。',['PB-HEART','PB-HEAT']),
 rule('LONG',/长距离|长跑/,'实际距离与近期已记录最长单次分开','长距离复盘要同时看持续时间、后段反应和次日恢复。','先核对后段是否明显掉速、补给耐受及次日局部疼痛；恢复异常时撤下追加的长距离，不把未记录日期算休息，也不把每周10%当安全许可。',['PB-LOAD','PB-SLEEP']),
 rule('SPRINT',/冲刺|短跑|加速跑/,'短段记录；明确计时、距离、风与恢复','冲刺复盘优先检查计时口径和动作质量。','把每次实际用时、充分恢复后的动作与疼痛记清；明显减速或动作失控就结束质量段，不通过缩短恢复硬凑次数；下次先核对恢复和目的。',['PB-STRIDES','PB-INTERVAL']),
 rule('STRENGTH',/力量|深蹲|卧推|硬拉|负重|rir/i,'实际组、重量、次数；只记时长不能推组量或1RM','力量复盘先看实际组和动作质量，时长不代表组量。','记录同一动作的重量、次数、规范动作余量与疼痛；动作变形就停止该组或降低要求，先在熟悉负荷下核对技术，次日看恢复，不因一次完成自动加重量。',['PB-STRENGTH']),
 rule('LOAD',/整课|session.?rpe|\bau\b|训练负荷/i,'明确整课时长和整课RPE；冲突先核对','AU可本地计算，但不能代表伤病概率或恢复许可。','确认包含热身、组间恢复与整理的整课时长，评分针对整课；要比较时保持相同口径，并结合次日反馈。',['PB-RPE'],true),
]

export function offlineCapability(question:string):{independent:boolean;topics:OfflineTopic[];complex:boolean}{
 // v87：待审知识资料预览、单纯换算、无候选的剩余任务只在本地回答，不走付费模型。
 if(isCompleteKnowledgePreviewRequest(question)||statedDirectAnswer(question))return {independent:true,topics:[],complex:false}
 const topics=OFFLINE_COACH_RULES.filter(r=>r.match.test(question)).map(r=>r.topic)
 const complex=/复杂|多周|跨周|多周期|长期周期|赛季|综合.{0,8}(?:周期|多次)|比较.{0,12}(?:三|四|多)次/.test(question)
 const safety=detectRedFlags(question).level!=='NONE'||/酸痛|抽筋|岔气|轻度头晕/.test(question)
 return {independent:safety||!complex&&(topics.length>0||/复盘最近\s*(7|28)\s*天/.test(question)),topics,complex}
}

const fmt=(n:number)=>Number(n.toFixed(2)).toString()
const pace=(seconds:number)=>{const n=Math.round(seconds);return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`}
/** Explicit chat reports stay unsaved. No inference from plans, examples, devices or other people. */
export function offlineReportedFacts(question:string):string[]{
 const q=question.normalize('NFKC').split(/[，,。；;]|但是|但/).filter(c=>!/没有|未记录|没填|并非/.test(c)).join('，'), facts:string[]=[]
 if(/朋友|队友|他人|同伴|假设|假如|如果|比如|例如|截图|OCR|识别|计划|目标|准备|打算|没跑|未完成/.test(q))return facts
 const actual=/今天|昨天|昨晚|这次|本次|我|实际|完成|跑了|练了|本周|上周/.test(q)
 if(!actual)return facts
 const runs=[...q.matchAll(/(?:跑了|实际跑|完成了?)\s*(\d+(?:\.\d+)?)\s*(公里|km|米|m)[，,\s]*(?:用时|耗时|花了)\s*(\d+(?:\.\d+)?)\s*(分钟|分|秒)/gi)]
 if(runs.length===1){const m=runs[0],meters=Number(m[1])* (/公里|km/i.test(m[2])?1000:1),seconds=Number(m[3])*(m[4]==='秒'?1:60)
  if(meters>0&&meters<=500000&&seconds>0&&seconds<=86400)facts.push(`本次聊天自报未保存：${fmt(meters)}米 / ${fmt(seconds)}秒，平均配速 ${pace(seconds/meters*1000)}/km；不是已测个人阈值。`)
 }
 const week=(label:string)=>[...q.matchAll(new RegExp(`${label}(?:实际)?(?:跑量|跑了|累计|总量|合计|跑)?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:公里|km)`,'gi'))].map(m=>Number(m[1]))
 const now=week('本周'),prior=week('上周')
 if(now.length===1&&prior.length===1&&now[0]>=0&&prior[0]>0&&Math.max(...now,...prior)<=1500){
  facts.push(`聊天自报未保存：上周 ${fmt(prior[0])} km → 本周 ${fmt(now[0])} km，差 ${fmt(now[0]-prior[0])} km（${fmt((now[0]/prior[0]-1)*100)}%）；本周可能未结束，不能直接视为同长度完整周趋势或安全许可。`)
 }else if(prior.length===1&&prior[0]===0)facts.push('上周自报为0，变化百分比无定义；不计算增幅，也不把漏记视为零。')
 const rhr=[...q.matchAll(/(?:静息心率|RHR)(?:是|为)?\s*(\d+(?:\.\d+)?)/gi)].map(m=>Number(m[1]))
 if(rhr.length===1&&rhr[0]>=20&&rhr[0]<=250){
  const baseline=q.match(/(?:平时|基线)(?:静息心率|RHR)?(?:是|为)?\s*(\d+(?:\.\d+)?)/i)
  const b=baseline?Number(baseline[1]):null
  facts.push(`聊天自报静息心率 ${fmt(rhr[0])} bpm${b!==null&&b>=20&&b<=250?`，相对自报平时 ${fmt(b)} bpm 差 ${fmt(rhr[0]-b)} bpm`:''}；未保存，测量时间、方法与连续性待核对，不能诊断恢复状态。`)
 }
 for(const m of q.matchAll(/(?:睡了|睡|睡眠(?:时长)?(?:是|为|只有)?)\s*(\d+(?:\.\d+)?)\s*小时/g))if(Number(m[1])>0&&Number(m[1])<=24)facts.push(`聊天自报睡眠 ${m[1]} 小时，未保存；不能单凭时长放行训练。`)
 // Explicit user-supplied zone, never 220-age or an inferred threshold.
 const hr=q.match(/(?:本次|今天|这次)(?:平均)?心率(?:是|为)?\s*(\d+(?:\.\d+)?)/),hz=q.match(/心率区间(?:是|为)?\s*(\d+)\s*[-~～—至]\s*(\d+)/)
 if(hr&&hz){const v=Number(hr[1]),a=Number(hz[1]),b=Number(hz[2]);if(a>=20&&b<=250&&a<b&&v>=20&&v<=250)facts.push(`自报心率 ${fmt(v)} bpm 对照自报区间 ${a}–${b} bpm：${v<a?'低于':v>b?'高于':'在'}该区间${v<a?` ${fmt(a-v)} bpm`:v>b?` ${fmt(v-b)} bpm`:''}；仅做数值比较，区间来源与平均/最高口径待核对。`)}
 const pv=q.match(/(?:本次|今天|这次)(?:平均)?配速(?:是|为)?\s*(\d{1,2}):([0-5]\d)/),pz=q.match(/配速区间(?:是|为)?\s*(\d{1,2}):([0-5]\d)\s*[-~～—至]\s*(\d{1,2}):([0-5]\d)/)
 if(pv&&pz){const v=Number(pv[1])*60+Number(pv[2]),a=Number(pz[1])*60+Number(pz[2]),b=Number(pz[3])*60+Number(pz[4]);if(a>0&&a<b&&v>0)facts.push(`自报配速 ${pace(v)}/km 对照自报区间 ${pace(a)}–${pace(b)}/km：${v<a?'快于区间':v>b?'慢于区间':'在该区间内'}；仅比较数值，不证明阈值或达成课次目标。`)}
 return facts
}

export function offlineKnowledge(question:string,sourceIds:readonly string[]=[]){
 const lessons=[...new Map([...sourceIds.flatMap(id=>PLAYBOOK_LESSONS.filter(l=>l.id===id)),...selectPlaybookLessons(question,2)].map(l=>[l.id,l])).values()].slice(0,3)
 const curriculum=retrieveCurriculum(question,1).lessons
 const research=retrieveResearchCandidates(question).slice(0,1)
 return [
  ...lessons.map(l=>({id:l.id,status:'教学候选；手册提供，未独立复核',summary:`${l.title}：${l.guidance} ${l.boundary}`,source:`好教练手册参考编号 ${l.refs.join('、')}`})),
  ...curriculum.map(l=>({id:l.id,status:'教学候选；不是正式个人决策规则',summary:`${l.title}：${l.guidance}`,source:l.evidenceRefs.join('、')})),
  ...research.map(r=>({id:r.id,status:`继承核验记录 ${r.verification}；本轮未独立复核`,summary:`${r.claim} ${r.transferBoundary}`,source:r.url??r.title})),
 ]
}

export function enrichOfflineAnswer(brief:CoachBrief,base:LocalCoachAnswer,logic?:{frame:ReasoningFrame;snapshot:EvolutionSnapshot}):LocalCoachAnswer{
 const q=brief.question, matched=OFFLINE_COACH_RULES.filter(r=>r.match.test(q))
 // Existing exact arithmetic and protective boundary answers take precedence over presentation enrichment.
 if(!base.escalationAvailable)return base
 if(logic&&/复盘|分析|训练怎么样|这次训练|短板/.test(q)&&!brief.pain&&!brief.constraints.medicalReferral&&!base.deviceAudit&&!base.recoveryDecision&&!['RESOLVE_CONFLICT','RESOLVE_TIME_REFERENCE'].includes(logic.frame.stage)){
  const profile=readOfflineProfile(logic.snapshot.athleteId,logic.snapshot.asOf)
  if(brief.occurrenceId||profile){
   const snap=brief.occurrenceId?getRunningPlanSnapshot(brief.occurrenceId):null
   const occ=listTrainingOccurrences().find(o=>o.trainingOccurrenceId===brief.occurrenceId)
   const original=snap&&occ?.startedAt&&Date.parse(snap.capturedAt)<=Date.parse(occ.startedAt)?snap:null
   const rounds=brief.occurrenceId&&original?analyzeRunningRounds(projectRunningRepetitions(brief.occurrenceId,loadEvents()),original):null
   const recoveryContext=readRecoveryContext(logic.snapshot.athleteId,recoveryDayForReview(logic.snapshot,brief.occurrenceId,q,false,occ?.startedAt),logic.snapshot.asOf)
   const review=buildOfflineReview({snapshot:logic.snapshot,frame:logic.frame,occurrenceId:brief.occurrenceId,question:q,profile,plan:original,rounds,sessionLoad:{value:calculateSessionLoad(q,brief.sessionRpe,brief.durationSec),sourceIds:brief.sourceIds},recoveryContext})
   return {...base,offlineReview:review,sources:[...base.sources,...(review.recoveryContext?.dependency?[review.recoveryContext.sourceId]:[])],offlineRuleIds:matched.map(r=>r.id),text:compactOfflineReview(review)}
  }
 }
 if(!matched.length||brief.pain||brief.constraints.medicalReferral||base.deviceAudit||base.recoveryDecision||detectRedFlags(q).level!=='NONE'||logic?.frame.safety.mustRetain||logic?.frame.stage==='RESOLVE_CONFLICT'||logic?.frame.stage==='RESOLVE_TIME_REFERENCE')return base
 const load=calculateSessionLoad(q,brief.sessionRpe,brief.durationSec)
 const onlyLoad=!/复盘|分析|短板/.test(q)&&(/^整课|AU|整课负荷|session.?RPE/i.test(q)||load.status==='CALCULATED'&&/整课RPE/i.test(q))
 const primary=(onlyLoad?matched.find(r=>r.topic==='LOAD'):null)??matched[0]
 const facts=offlineReportedFacts(q)
 const structure=parseRoundStructure(q)
 if(structure){facts.push(`输入结构：${structure.rounds}轮 × 每轮${structure.repeats}次${structure.distanceMeters}米；未记录的实际段为 NOT_RECORDED，不将其当作已完成。`)
  for(const [label,re] of [['组间',/组间(?:休息|恢复)?\s*(\d+(?:\.\d+)?)\s*(分钟|秒)/],['轮间',/(?:轮间|大组)(?:休息|恢复)?\s*(\d+(?:\.\d+)?)\s*(分钟|秒)/]] as const){const m=q.match(re);if(m)facts.push(`输入${label}休息 ${m[1]}${m[2]}（${Number(m[1])*(m[2]==='分钟'?60:1)}秒）；口径待确认，不能视为已经执行。`)}
 }
 if(logic&&logic.frame.scopeOccurrenceIds.includes(brief.occurrenceId??'')){
  const computed=formatComputedFacts(logic.frame,true);if(computed)facts.unshift(computed)
  if(primary.topic==='WEEK')facts.push(...computeV4Facts(logic.snapshot,brief.occurrenceId).facts.filter(f=>f.kind==='WEEKLY_LOAD').map(f=>f.text))
 }
 if(onlyLoad)facts.push(formatSessionLoad(load))
 const knowledge=offlineKnowledge(q,primary.sourceIds)
 // Keep existing detailed reasoning and revisions; no competing dose generator.
 const preserve=base.cognition||logic?.frame.scopeOccurrenceIds.length||/知识|原理|解释|什么/.test(q)
 const rationale=preserve?base.text.replaceAll('\n依据：','\n记录来源：'):`${primary.condition}。${primary.verificationScope}；${brief.constraints.blockReason??'未据此修改计划或训练记录'}。`
 const missing=onlyLoad&&load.status==='CALCULATED'?'整课数值已用于计算；仍需确认统计口径及记录归属，不重复询问已给出的数值。':logic?.frame.scopeOccurrenceIds.length?logic.frame.nextQuestion:'请确认课次目的、记录是否完整以及当前身体反应；这些会改变下一步选择。'
 const suggestion=brief.constraints.increaseBlocked?`${brief.constraints.blockReason}先完成相关核对；不增加剂量，原高强度也不是自动获准执行。`:primary.template
 return {...base,offlineRuleIds:matched.map(r=>r.id),sources:[...new Set([...base.sources,...knowledge.map(k=>k.id)])],text:[
  `结论：${primary.conclusion}`,
  `关键事实：${facts.length?facts.join('\n'):'当前没有选定可引用的实际课次；可以先按下列步骤核对，不把计划写成已完成。'}`,
  `判断依据：${rationale}`,
  `下次建议：${suggestion}`,
  `缺失数据/待确认：${missing}`,
  knowledge.length?'本地知识摘要：\n'+knowledge.map(k=>`[${k.id}] ${k.status}。${k.summary}（${k.source}）`).join('\n'):'本地知识摘要：未检索到直接相关的已收录段落；保留问题为待研究，不补造证据。',
 ].join('\n')}
}

export type CoachFailure='NO_KEY'|'UPSTREAM'|'TIMEOUT'|'NETWORK'|'INTERRUPTED'|'LOCKED'
export function localModelFallback(local:LocalCoachAnswer,reason:CoachFailure):{text:string;notice:string}{
 const labels:Record<CoachFailure,string>={NO_KEY:'模型未配置',UPSTREAM:'模型服务失败',TIMEOUT:'模型超时',NETWORK:'网络不可用',INTERRUPTED:'连接中断',LOCKED:'模型尚未授权'}
 // Separate notice preserves the emergency sentence limit and the factual answer.
 return {text:local.text,notice:`${labels[reason]}，已使用本地分析；没有修改课表或训练记录。`}
}
