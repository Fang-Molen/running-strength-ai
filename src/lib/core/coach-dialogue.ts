import {reportedPbs,explicitlyReviewsRecord,reportedRace} from './coach-specialty-analysis.ts'
import type {CoachBrief} from './coach-brief.ts'
import type {EvolutionSnapshot} from './coach-evolution-v4.ts'
import type {ReasoningFrame} from './coach-reasoning.ts'
import {detectRedFlags,redFlagResponse,RED_FLAG_PRIORITY,type RedFlagResult} from './coach-red-flags.ts'
import {parseChatTraining,chatEvolution,rounded,savedChatReceipt,type ChatTraining} from './coach-chat-evidence.ts'
import {readOfflineWorkspace} from './coach-offline-workspace.ts'
import {buildOfflineReview,emptyOfflineProfile,readOfflineProfile,type OfflineProfile,type OfflineReview} from './coach-offline-loop.ts'
import {offlineSignals,signalQuery,cleanAthleteText} from './coach-offline-insights.ts'
import {buildReasoningFrame} from './coach-reasoning.ts'
import {retrieveResearchIndex} from './coach-research-index.ts'
import {ordinaryDiscomfortAnswer} from './coach-ordinary-discomfort.ts'
import {explainTrainingMechanism} from './coach-training-mechanisms.ts'
import {calculateStatedSessionLoads} from './coach-curriculum.ts'
import type {StructuredCoachingCandidate} from './coach-structured-candidate.ts'
import {clarifyChatRpe,requestedActionText,type PendingCoachQuestion} from './coach-dialogue-understanding.ts'
import {readRecoveryContext,recoveryDayForReview} from './coach-recovery-context.ts'
import {parseStatedFacts,hasStatedNumbers} from '../coach/stated/parse.ts'

export type CoachIntent='REVIEW'|'NEXT'|'INCREASE'|'CONFLICT'|'WEEK'|'PAIN'|'DISCOMFORT'|'ANOMALY'|'LOAD'|'TEST'|'COACHING'
export type CoachDialogue={version:1;athleteId:string;profile:OfflineProfile;goal:string|null;goalTarget?:{meters:number;fromSeconds:number|null;toSeconds:number;sourceText:string};pbs:{meters:number;seconds:number}[];injury:string|null;asked:string[];phase:'INTAKE'|'JUDGMENT'|'TEST'|'FEEDBACK'|'RETEST';lastTraining:ChatTraining|null;lastPurpose?:{trainingId:string;text:string;sourceId:string};pendingQuestion?:PendingCoachQuestion;emergency:RedFlagResult|null;medicalHold?:RedFlagResult|null;reportedNextCourse?:{text:string;source:'USER_REPORT';recordedAt:string}|null;previousDecision:string|null;turns:number}
export const emptyDialogue=(athleteId='local'):CoachDialogue=>({version:1,athleteId,profile:emptyOfflineProfile(athleteId),goal:null,pbs:[],injury:null,asked:[],phase:'INTAKE',lastTraining:null,emergency:null,previousDecision:null,turns:0})
export function validDialogue(value:unknown):value is CoachDialogue{
 const s=value as CoachDialogue|undefined
 // A malformed optional follow-up is discarded by clarifyChatRpe, never by resetting medical history.
 return !!s&&s.version===1&&typeof s.athleteId==='string'&&s.profile?.athleteId===s.athleteId&&Array.isArray(s.pbs)&&s.pbs.every(p=>Number.isFinite(p.meters)&&Number.isFinite(p.seconds))&&Array.isArray(s.asked)&&['INTAKE','JUDGMENT','TEST','FEEDBACK','RETEST'].includes(s.phase)&&Number.isFinite(s.turns)&&(s.emergency===null||s.emergency?.level==='EMERGENCY')&&(!s.medicalHold||['URGENT_MEDICAL','MEDICAL_REVIEW'].includes(s.medicalHold.level)&&Array.isArray(s.medicalHold.classes)&&Array.isArray(s.medicalHold.evidence))&&(!s.reportedNextCourse||s.reportedNextCourse.source==='USER_REPORT'&&typeof s.reportedNextCourse.text==='string'&&Number.isFinite(Date.parse(s.reportedNextCourse.recordedAt)))&&(!s.lastPurpose||typeof s.lastPurpose.trainingId==='string'&&typeof s.lastPurpose.text==='string'&&typeof s.lastPurpose.sourceId==='string')&&(s.lastTraining===null||Array.isArray(s.lastTraining?.splits))
}
export function coachPrimaryIntent(q:string):CoachIntent{
 // The user's requested action outranks incidental numbers, AU and device names.
 q=requestedActionText(q)
 if(/加(?:组|量|强度|重量)|再(?:来|做|跑).{0,4}(?:组|趟)|多(?:跑|练)|加多了|是不是太多/.test(q))return /这周|本周|周量/.test(q)&&/多了|太多|加多/.test(q)?'WEEK':'INCREASE'
 if(/听(?:手表|感觉|教练)|手表.{0,18}(?:感觉|疲劳|很累)|感觉.{0,18}(?:手表|恢复)|冲突|取舍/.test(q))return 'CONFLICT'
 if(/复测|测试安排|测什么|怎么测|测试课|观察课/.test(q))return 'TEST'
 if(/明天|下一课|下次(?:练|跑|怎么)|练什么|跑什么|怎么安排|下周怎么练|下周练什么/.test(q))return 'NEXT'
 // Weekly context is secondary when the user supplies actual splits and asks for this session's review.
 if(/复盘|练得|表现|怎么样|如何|分析/.test(q)&&parseChatTraining(q).splits.some(s=>s.seconds!==null))return 'REVIEW'
 if(/这周|本周|周量|周负荷|急慢性/.test(q)&&/多|变化|判断|怎样|怎么样|合理|负荷|比/.test(q))return 'WEEK'
 if(/跟腱|拉伤|膝外侧|走路痛|骨点痛|疼痛|痛经|月经|晨僵/.test(q))return 'PAIN'
 if(/岔气|酸痛|抽筋|轻微头晕/.test(q))return 'DISCOMFORT'
 if(/异常|跳点|不可能|平台|缺圈/.test(q))return 'ANOMALY'
 if(/(?:算|计算).{0,8}(?:负荷|AU)|RPE/i.test(q)&&!/练得|表现|怎么样|如何|复盘|分段|[×x*]|\d+[m米]/i.test(q))return 'LOAD'
 if(/复盘|练得|成绩|分段|完成|跑了|[×x*]/i.test(q))return 'REVIEW'
 return 'COACHING'
}
/** Profile slots accept self-reports only; other people's numbers never become this athlete's PB. */
function selfProfileStatements(q:string){
 let subject:'SELF'|'OTHER'='SELF'
 return q.normalize('NFKC').split(/[，,。；;！？!?\n]/).filter(part=>{
  if(/(?:我的?(?:朋友|队友|同学|学生)|(?:朋友|队友|同学|学生|他|她|他们|她们)(?:的)?|某(?:人|运动员)|这(?:位|个)运动员)/.test(part))subject='OTHER'
  else if(/(?:^|但|而|至于)\s*(?:我|本人)/.test(part))subject='SELF'
  return subject==='SELF'&&!/不是|并非|没有|未曾|不曾|假设|如果|假如/.test(part)
 }).join('，')
}
function updateSlots(q:string,prior:CoachDialogue){
 const s:CoachDialogue={...prior,profile:{...prior.profile},pbs:[...prior.pbs],asked:[...prior.asked],turns:prior.turns+1}
 const profileText=selfProfileStatements(q)
 const age=profileText.match(/(?:我|本人|今年)?\s*(\d{1,2})\s*岁/);if(age)s.profile.age=Number(age[1])
 if(/女生|女性|女运动员|我是女|性别女/.test(profileText))s.profile.sex='FEMALE';else if(/男生|男性|男运动员|我是男|性别男/.test(profileText))s.profile.sex='MALE'
 const event=profileText.match(/(?:主项|专项|目标项目|练的是|跑的是)\s*(60|100|200|400|800|1500|3000|5000|10000)(?!\d)\s*(?:米|m)?/i)??(/^\s*(?:是|我练)?\s*(60|100|200|400|800|1500|3000|5000|10000)\s*(?:米|m)?[。！!]?\s*$/i.test(profileText)?profileText.match(/(60|100|200|400|800|1500|3000|5000|10000)/):null)
 if(event){const nextEvent=event[1]+'米';if(nextEvent!==s.profile.event)s.profile.pbSeconds=s.pbs.find(p=>p.meters===Number(event[1]))?.seconds??null;s.profile.event=nextEvent}
 // A recall question is not a new goal or an injury assertion.
 // v86 (R1.1 C05): a per-rep session target (“5×400目标86秒”, “目标均260秒”) is not a season goal, and the goal
 // distance is never borrowed from the main event. Only an explicit “目标/想跑进 + 距离 + 秒” self-report is kept.
 const goal=[...profileText.matchAll(/(?:目标(?:是|为)?|想跑进|希望跑进|想达到)\s*(?:(60|100|200|400|800|1500)\s*(?:米|m)\s*)?(\d+(?:\.\d+)?)\s*秒/gi)]
  .find(m=>!!m[1]&&!/(?:\d+\s*[×x*]\s*\d+(?:\.\d+)?\s*(?:米|m|公里|km)?|课|本课|每段|每次|每组|各|均)\s*$/i.test(profileText.slice(Math.max(0,(m.index??0)-14),m.index)))
 if(goal){const meters=Number(goal[1]);if(meters>0){s.goalTarget={meters,fromSeconds:s.pbs.find(p=>p.meters===meters)?.seconds??s.profile.pbSeconds,toSeconds:Number(goal[2]),sourceText:goal[0]};s.goal=`目标${meters}米${goal[2]}秒`}}
 const stage=profileText.match(/储备(?:期)?|基础期|冬训(?:期)?|专项准备期|备赛期|减量期|比赛期|过渡期/)
 if(stage)s.profile.stage=({'储备':'储备/基础期','储备期':'储备/基础期','基础期':'储备/基础期','冬训':'冬训期','冬训期':'冬训期','减量期':'备赛期/减量','备赛期':'备赛期/减量'} as Record<string,OfflineProfile['stage']>)[stage[0]]??stage[0] as OfflineProfile['stage']
 if(/(?:本|这个)?赛季(?:刚|已经|已)?结束|赛后过渡/.test(profileText)&&!/假设|如果|还没|尚未|没有结束/.test(profileText))s.profile.stage='过渡期'
 const experience=profileText.match(/训练(?:了|年限|经历)?\s*(\d+(?:\.\d+)?)\s*(年|个月|月)/);if(experience)s.profile.experienceMonths=Number(experience[1])*(experience[2]==='年'?12:1)
 for(const pb of reportedPbs(profileText)){s.pbs=s.pbs.filter(x=>x.meters!==pb.meters).concat({meters:pb.meters,seconds:pb.seconds});if(!s.profile.event)s.profile.event=pb.meters+'米';if(s.profile.event===pb.meters+'米')s.profile.pbSeconds=pb.seconds}
 if(s.goalTarget&&s.profile.pbSeconds!==null&&s.profile.event===s.goalTarget.meters+'米')s.goalTarget={...s.goalTarget,fromSeconds:s.profile.pbSeconds}
 const approved=q.match(/(?:教练|用户|我)(?:已经|已)?(?:明确)?批准(?:了)?(?:明天|下一课|下周)?(?:的)?(?:课程|原课|训练)?[：:，,\s]*([^。？?]{2,160})/)
 if(approved&&!/假设|如果|没有批准|未批准|是否|撤回|取消/.test(q))s.reportedNextCourse={text:approved[1],source:'USER_REPORT',recordedAt:new Date().toISOString()}
 if(/(?:撤回|取消).{0,10}(?:批准|下一课|明天课程)/.test(q))s.reportedNextCourse=null
 if(/(?:没有|无)(?:伤病|疼痛)/.test(q))s.injury='未报告当前伤病'
 else if(/(?:我|今天|现在|跑到|跑了|走路|刚|目前).{0,35}(?:拉伤|跟腱.{0,8}(?:疼|痛|僵)|膝外侧.{0,8}(?:疼|痛)|疼痛)/.test(q)&&!/假设|如果|是否|有没有|有无|那个|要紧吗/.test(q))s.injury=q.slice(0,260)
 return s
}
function painAnswer(q:string):string|null{
 if(/拉伤/.test(q)&&/走路.{0,3}(?:痛|疼)|跛/.test(q))return '今天停止跑跳、冲刺及诱发疼痛的动作，尽快去运动医学或康复门诊评估。走路仍痛说明日常负重尚受影响，可能有组织损伤或负荷不耐受，不能靠忍痛完成测试；明显肿胀、无法负重或加重时应及时就医。明天先看日常行走反应，不安排强度课。'
 if(/跟腱.*晨僵|晨僵.*跟腱/.test(q))return '今天先减少诱发跟腱不适的跑跳，暂不加速或加量。晨僵可能与近期腱负荷和恢复有关，也可能有其他局部问题；观察起床僵硬持续多久及走路反应，不能仅凭晨僵确诊。明天若仍僵硬或痛，先暂停相关训练并安排评估；突然弹响、明显肿胀或不能正常行走需及时就医。'
 if(/膝外侧/.test(q))return '今天在膝外侧痛出现前结束跑步，先撤掉诱发疼痛的距离或下坡。重复负荷、动作控制或局部组织刺激都可能相关，不能远程认定具体结构；记录从第几公里开始、路面和停跑后变化。明天若日常行走无痛，可选不诱发症状的轻活动；反复、肿胀、卡住或走路痛时应就医评估。'
 if(/月经期|经期|痛经/.test(q)&&!/闭经|停经|不来|没来/.test(q))return '今天不因教练要求就强行加量，先按痛经程度和个人反应调整。月经本身并不要求所有人停训；若疼痛轻、日常活动正常，可选熟悉的轻松活动，痛明显则休息，并把症状告诉教练。异常大量出血、晕厥或持续剧痛需要就医；明天依据实际反应再讨论恢复原课。'
 return null
}

export function answerDialogue(brief:CoachBrief,logic:{frame:ReasoningFrame;snapshot:EvolutionSnapshot}|undefined,previous?:CoachDialogue){
 const q=brief.question,athleteId=logic?.snapshot.athleteId??previous?.athleteId??'local',asOf=logic?.snapshot.asOf??new Date().toISOString()
 const old=validDialogue(previous)&&previous.athleteId===athleteId?previous:emptyDialogue(athleteId)
 const stored=old.turns===0?readOfflineProfile(athleteId,asOf):null
 const state=updateSlots(q,stored?{...old,profile:{...stored.profile}}:old)
 const retainRecordedPain=(evidence:string[])=>{
  const hold:RedFlagResult=state.medicalHold??{level:'MEDICAL_REVIEW',subject:'SELF',negated:false,temporal:'HISTORY',classes:[],evidence:[]}
  state.medicalHold={...hold,classes:[...new Set([...hold.classes,'PAIN' as const])],evidence:[...new Set([...hold.evidence,...evidence])]}
 }
 // Every response consumes the old question; only an emitted new question can renew it.
 state.pendingQuestion=undefined
 const red=detectRedFlags(q,{ageYears:state.profile.age??undefined})
 const evaluated=/(?:已经|已|刚刚|刚)(?:去医院|到医院|就医|在急诊|经医生评估)|医生(?:已经|已)评估/.test(q)&&!/(?:没|未|没有).{0,3}(?:就医|医院|评估)|假设|如果/.test(q)
 if(evaluated){state.emergency=null;if(old.emergency)state.medicalHold={...old.emergency,level:'URGENT_MEDICAL'}}
 if(red.level==='EMERGENCY')state.emergency=red
 if(red.level==='URGENT_MEDICAL'||red.level==='MEDICAL_REVIEW'&&red.classes.some(c=>c==='ENERGY'||c==='PAIN'))state.medicalHold=old.medicalHold?{...red,level:RED_FLAG_PRIORITY[old.medicalHold.level]>RED_FLAG_PRIORITY[red.level]?old.medicalHold.level:red.level,classes:[...new Set([...old.medicalHold.classes,...red.classes])],evidence:[...new Set([...old.medicalHold.evidence,...red.evidence])]}:red
 // An unresolved medical concern survives ordinary follow-ups and symptom denial.
 // It is not an exercise clearance channel, even after a medical visit.
 const response=(text:string,review?:OfflineReview,chat?:ChatTraining,candidate:StructuredCoachingCandidate|null=null)=>({text:cleanAthleteText(text).replace(/。{2,}/g,'。'),sources:[...review?.basis.sources.map(s=>s.sourceId)??[],...(review?.recoveryContext&&(review.recoveryContext.dependency||review.recoveryContext.safetyHold)?[review.recoveryContext.sourceId]:[])],escalationAvailable:false,offlineRuleIds:['R14-DIALOGUE'],dialogue:state,offlineReview:review,chatTraining:chat,candidate})
 if(state.emergency)return response(redFlagResponse(state.emergency)!)
 if(evaluated&&old.emergency)return response('先按刚才就医得到的明确医嘱处理，今天不要自行恢复训练。已就医不等于已获运动许可；请核对医生给出的活动限制和复诊安排。')
 if(state.medicalHold&&red.level==='NONE'){
  const asksRecovery=/恢复|状态|睡眠|疲劳|身体怎么样/.test(q)
  if(asksRecovery){
   const stated=parseStatedFacts(q)
   const facts=[...(stated.sleepHours!==null?[`本轮未保存自报睡眠 ${stated.sleepHours} 小时；与旧记录不同时需正式更正`]:brief.sleepHours!=null?[`已有睡眠记录 ${brief.sleepHours} 小时`]:[]),...(stated.recovery10!==null?[`本轮未保存主观恢复 ${stated.recovery10}/10`]:brief.subjectiveRecovery!=null?[`已有主观恢复 ${brief.subjectiveRecovery}（量表按原记录，不等同组织恢复）`]:[]),...(brief.appData?.health.filter(h=>h.state==='AVAILABLE'&&!(stated.sleepHours!==null&&h.metric==='SLEEP')).map(h=>h.detail)??[])]
   return response('原有健康限制仍保留，未核对专业运动许可前不安排测试课或升级。\n本次恢复依据：'+(facts.join('；')||'当前没有可核对的睡眠、主观恢复或功能记录，不能判定已恢复')+'。\n这些读数只能描述目前记录；即使感觉改善，也不能解除既有疼痛或医学限制。下一步记录当下症状与日常功能变化，并核对原专业评估要求；不以加速或负重试探恢复。')
  }
  return response('之前报告的健康线索仍需专业评估，后续成绩或一般感觉不能解除限制。'+redFlagResponse(state.medicalHold)!+'未核对专业运动许可前，不安排测试课或训练升级。')
 }
 if(red.level==='URGENT_MEDICAL'||red.level==='MEDICAL_REVIEW'&&red.classes.includes('ENERGY'))return response(redFlagResponse(red)!)
 const pain=painAnswer(q);if(pain)return response(pain)
 let chat=parseChatTraining(q),intent=coachPrimaryIntent(q)
 const race=reportedRace(q)
 if(race&&race.calculation.status==='AVAILABLE'){
  chat.total={meters:race.eventMeters,seconds:race.totalSeconds};chat.splits=race.calculation.segments.map((seg,i)=>({round:1,repeat:i+1,meters:seg.meters,seconds:seg.seconds,heartRate:null,excluded:null}));chat.hasActual=true
 }else if(race){chat.issues.push('累计分段与总成绩不一致，保留原始输入，先核对而不猜算。')}

 const contextPresent=!!previous||state.profile.event!==null||state.goal!==null||state.pbs.length>0
 if(red.level==='MEDICAL_REVIEW'||brief.pain||brief.constraints.medicalReferral||logic?.frame.safety.mustRetain){
  const recordedPain=logic?.snapshot.active.filter(e=>e.athleteId===athleteId&&e.source!=='PLAN'&&e.source!=='THIRD_PARTY'&&e.metric==='PAIN_SCORE'&&(e.value??0)>0&&Date.parse(e.eventAt)<=Date.parse(asOf)&&Date.parse(e.recordedAt)<=Date.parse(asOf))??[]
  const dailyPain=brief.appData?.fatigue.state==='PAIN_REVIEW'
  // A medical routing flag alone is not a pain diagnosis. Preserve only explicit
  // saved pain signals, including rejected numeric pain records retained by the audit.
  const rejectedPain=logic?.snapshot.safety==='MEDICAL_REVIEW'&&/疼痛风险线索/.test(logic.snapshot.safetyMessage??'')
  if(brief.pain||dailyPain||recordedPain.length||rejectedPain)retainRecordedPain([
   '已有疼痛记录或风险线索待核对',
   ...(brief.sources??[]).filter(s=>/^PAIN\s/.test(s.detail)||s.id==='context:pain').map(s=>s.id),
   ...recordedPain.map(e=>e.sourceId),...(dailyPain?[brief.appData!.sourceId]:[]),
  ])
  return response((redFlagResponse(red)??'今天先停止诱发不适的训练，核对已有疼痛或健康限制；持续或影响日常功能时联系运动医学或康复专业人员评估。')+(brief.pain?`${brief.sessionRpe!==null?`已记录 RPE ${brief.sessionRpe}，` : ''}已有疼痛，不建议加量或安排全力测试。`:''))
 }
 const clarification=old.lastTraining?clarifyChatRpe(q,old.lastTraining,old.pendingQuestion,state.turns,asOf):null
 if(clarification&&old.lastTraining){
  // A record saved or corrected since the question must use the formal correction flow.
  if(savedChatReceipt(old.lastTraining,athleteId,asOf))return response('这节训练已保存；补充口径不能直接覆盖正式记录。请在对应记录中核对或更正整课评分，再重新复盘。')
  chat=clarification;intent=old.pendingQuestion!.intent
  if(old.lastPurpose?.trainingId===old.lastTraining.id)state.lastPurpose={...old.lastPurpose,trainingId:chat.id}
 }
 const ordinary=!chat.splits.some(s=>s.seconds!==null)?ordinaryDiscomfortAnswer(q):null;if(ordinary)return response(ordinary)
 if(!chat.hasActual&&explainTrainingMechanism(q))return null
 if(!chat.hasActual&&/节奏跑/.test(q)&&/感受|累|喘|难|轻松|怎么样|复盘/.test(q))return response('节奏跑的感受需要结合原定强度评价，单说累不能判定有氧不足或训练无效。先看是否按目标完成、后段是否变慢，以及休息后能否恢复日常活动；下一次原课程记录用时与整课感受，先不据此改课。这节课实际配速和原定目标相差多少？')
 if(!chat.hasActual&&/力量|深蹲|硬拉/.test(q)&&/感受|累|吃力|轻松|怎么样|复盘/.test(q))return response(parseStatedFacts(q).strength.length?'力量部分按上面写明的重量×次数×组数核算；练得累不等于力量已提高，下一次同动作保留同样记录（重量、次数、组数、组间休息、动作深度）和次日反应，再比较。跑步与力量分开评价，不合成一个总负荷分。':'力量课先看同动作的实际重量、完成组次和动作质量，练得累不等于力量已提高。可能是本次动作或负荷较陌生，也可能是近期恢复影响表现；下一次原课程保留同动作记录与次日反应，不能据单次感受判断跑步迁移。最吃力的一组实际重量和完成次数是多少？')
 if(!chat.hasActual&&!chat.issues.length&&!contextPresent&&!['INCREASE','NEXT','CONFLICT','WEEK','PAIN','DISCOMFORT','ANOMALY','TEST'].includes(intent))return null
 let review:OfflineReview|undefined
 const active=chat.hasActual?chat:explicitlyReviewsRecord(q)?old.lastTraining:null
 const saved=active&&!chat.hasActual?savedChatReceipt(active,athleteId,asOf):null
 if(saved?.voided){state.lastTraining=null;return response('这节训练已作废，旧聊天内容仍保留，但不能继续作为当前事实或能力判断的依据；请从记录中选择有效课程，或确认新的实际记录。')}
 const purposeContext=active?{occurrenceId:saved?.occurrenceId??active.id,text:state.lastPurpose?.trainingId===active.id?state.lastPurpose.text:active.raw,sourceId:state.lastPurpose?.trainingId===active.id?state.lastPurpose.sourceId:active.id}:undefined
 const savedWorkspace=saved?readOfflineWorkspace(null,athleteId,saved.occurrenceId,q,asOf,{purposeContext}):null
 if(active){
  const snapshot=chatEvolution(active,athleteId,asOf)
  const recoveryContext=savedWorkspace?null:readRecoveryContext(athleteId,recoveryDayForReview(snapshot,active.id,q,chat.hasActual&&!clarification),asOf)
  review=savedWorkspace?.review??buildOfflineReview({snapshot,question:q,occurrenceId:active.id,purposeContext,profile:{id:'conversation-background',createdAt:asOf,profile:state.profile,confirmed:true,supersedes:null},chat:active,recoveryContext})
  state.lastTraining=saved?{...active,savedOccurrenceId:saved.occurrenceId}:active
  if(/目的/.test(q))state.lastPurpose={trainingId:active.id,text:q,sourceId:`${active.id}:purpose-turn-${state.turns}`}
  else if(state.lastPurpose?.trainingId!==active.id)state.lastPurpose=undefined
 }
 if(review?.recoveryContext?.safetyHold){
  retainRecordedPain([`${review.recoveryContext.day} 已保存疼痛反馈`,review.recoveryContext.sourceId])
  return response(review.text,review)
 }
 const snapshot=savedWorkspace?.logic.snapshot??(review?chatEvolution(active!,athleteId,asOf):logic?.snapshot??chatEvolution(chat,athleteId,asOf))
 const frame=savedWorkspace?.logic.frame??buildReasoningFrame({snapshot,question:q,scopeOccurrenceIds:active?[active.id]:logic?.frame.scopeOccurrenceIds??[]})
 const signals=saved&&review?review.signals:offlineSignals(frame,q,active??undefined)
 const currentRpe=saved?frame.computed.ratings.find(r=>r.metric==='SESSION_RPE')?.value??null:active?.rpe??null
 const currentSplitCount=saved&&review?review.metrics.points.length:active?.splits.filter(s=>s.seconds!==null&&!s.excluded).length??0
 const facts=signals.filter(x=>!['SPLIT_CHANGE','SPEED_CHANGE'].includes(x.kind)).map(x=>x.text)
 const context=[state.profile.age!==null?`${state.profile.age}岁`:null,state.profile.sex==='FEMALE'?'女性':state.profile.sex==='MALE'?'男性':null,state.profile.event?`主项${state.profile.event}`:null,state.profile.stage!=='UNKNOWN'?state.profile.stage:null,state.goal,state.injury&&state.injury!=='未报告当前伤病'?`之前提到：${state.injury}`:null].filter(Boolean).join('，')
 const population=state.profile.age!==null&&(state.profile.age<18||state.profile.age>=50)?`考虑到你${state.profile.age<18?'仍是青少年，安排请监护人和现场教练参与':'属于大师组，恢复节奏需更保守'}，本轮只保留一次熟悉的质量观察，质量课间隔由现场教练根据原计划、项目与恢复核定；不安排连续高强度。`:''
 const poor=/很累|明显疲劳|疲劳明显|腿沉|没恢复|恢复差/.test(q)&&!/(?:没有|无|并不)(?:明显)?(?:疲劳|很累|腿沉)/.test(q)
 let text=''
 let nextCandidate:StructuredCoachingCandidate|null=null
 if(intent==='INCREASE')text=`今天不建议加组或加量：不能仅凭这次表现批准额外刺激${/备赛|减量|比赛|赛前/.test(q+' '+state.profile.stage)?'，先核对赛前原计划目的':''}。${facts.join('；')}。${poor?'你报告的疲劳需要先核对日常活动和热身反应':'先保留原计划与本次完成量分别比较'}；增加要求只能作为待确认候选，先记录当前恢复和下一次同协议表现。`
 else if(intent==='CONFLICT')text=`今天先听身体的疲劳反应，不用手表的“已恢复”覆盖实际不适。${facts.join('；')}。若只是一般疲劳且无痛，选择休息或熟悉的轻松活动；热身后仍沉重就结束，明天再核对感觉和同条件测量。设备可能受算法、佩戴和测量时间影响，不能据一个读数放行强度。`
 else if(intent==='NEXT'){
  const course=state.reportedNextCourse?.recordedAt.slice(0,10)===asOf.slice(0,10)?state.reportedNextCourse:null
  const when=/下周/.test(q)?'下周第一课':'明天'
  text=course?`${when}建议按你明确报告已批准的原课程执行：${course.text}；这是你的批准转述，尚未升级为设备核验或医学许可。若考虑减量、换课或延长休息，先把候选改动交给你确认。`:`${when}的课程尚未确认，先形成具体观察任务：从你已有批准课程中选与${state.profile.event??'当前主项'}目标相符的一课，保留原组次和休息，记录首末用时、原目标偏差及次日反应；没有批准课程时先核对课程与目的，不编造剂量，也不因缺资料默认开休息处方。${state.profile.stage!=='UNKNOWN'?`当前处于${state.profile.stage}，候选需核对比赛优先级与原计划。`:''}`
  if(course&&poor)text=`你报告明显疲劳，${when}建议先暂缓这节原课并休息，作为仅建议、可撤回的调整候选。原已批准课程是${course.text}，是否确认本次暂缓？确认前保留正式原计划，先核对日常活动和热身反应，不顶着疲劳完成。`
  text+=`${facts.length?facts.join('；')+'。':''}${active?`前次有效记录有${currentSplitCount}段用时${currentRpe!==null?`、RPE ${currentRpe}`:''}；`:''}下一次记录日常活动、疲劳变化和疼痛反应，以判断是否继续保留建议。疼痛加重、胸闷、头晕或日常功能异常时停止活动并按安全提示处理。单一RPE、负荷比例或未经核准的阈值不自动决定减量；正式计划未改动。`
  if(course&&!chat.issues.length&&!active?.issues.length)nextCandidate={decision:course&&!poor?'CONDITIONAL_REPEAT':'CONDITIONAL_ADJUST',changed_variable:course&&!poor?null:'next_session',from:course&&poor?course.text:null,to:course&&!poor?null:'REST',unchanged:['正式训练计划及已批准课程版本'],stop_conditions:['疼痛加重','胸闷或胸痛','头晕或日常功能异常'],preconditions:['仅建议、可撤回','课程转述不等于医学许可','任何原课程改动须用户确认'],rule_ids:['R189-APPROVED-COURSE','FK-NO-AUTO-WRITE']}
 }
 else if(intent==='WEEK')text=`这周先别据单个变化比例决定加量或减量。${facts.join('；')||'目前没有同口径的两周总量，暂不能计算周量变化'}。先核对记录是否齐全、增加的是距离还是强度，再对照睡眠、主观恢复和同类课表现。变化比例本身不是伤病概率，也不能单独决定维持、减量或休息；下一步记录增加集中在哪一课及次日反应，调整仅作为待确认候选。`
 else if(intent==='LOAD'){const loads=calculateStatedSessionLoads(q);text=`${loads.length>1?loads.map((l,i)=>`第${i+1}条：${l}`).join('；'):facts.find(x=>/AU/.test(x))??'目前尚不能给出整课AU，请先确认评分范围'}。这个数只描述所报负荷，不是疲劳分、伤病概率或停训阈值；下一步确认整课口径并记录恢复。`}
 else if(intent==='TEST'){
  state.phase=old.phase==='TEST'||old.phase==='FEEDBACK'?'RETEST':'TEST'
  text=`先准备一次观察与后续复核；时间由原计划与当前恢复决定。在无痛、日常活动正常且原课程已批准时，选一节已经熟悉的${state.profile.event&&/^(100|200|400)米$/.test(state.profile.event)?'短跑技术或可控重复跑':'轻松训练'}，保留原有组数与恢复，不全力测试；记录每段用时、组间和轮间休息、整课RPE及次日感觉。在恢复正常、原课程与观察安排获确认后在同场地、同计时、同恢复条件下复测一次；若仍疲劳或有痛则延期并评估。先区分起跑节奏或恢复不足与后段动作控制变化，不因一课结果改变长期能力评分。`
 }else if(review){
  state.phase=old.phase==='TEST'||old.lastTraining?'FEEDBACK':'JUDGMENT'
  text=review.text
  const background=signals.filter(s=>!['SPLIT_CHANGE','SPEED_CHANGE','AU'].includes(s.kind));if(background.length){const lines=text.split('\n');const index=lines.findIndex(l=>l.startsWith('本次事实：'));if(index>=0)lines[index]=lines[index].replace(/。$/,'')+'；附加背景：'+background.map(s=>s.text.replace(/。/g,'；')).join('；')+'；单独不能批准减量或停训。';text=lines.join('\n')}
 }else{
  state.phase=state.pbs.length?'JUDGMENT':'INTAKE'
  const pb200=state.pbs.find(p=>p.meters===200),pb400=state.pbs.find(p=>p.meters===400)
  const stated=state.pbs.map(p=>`${p.meters}米${rounded(p.seconds)}秒（自报，时间和计时方式待核对）`).join('、')
  const frequency=q.match(/每周(?:训练|练|跑)?\s*(\d+)\s*(?:次|天|课)/)?.[1]
  const comparison=pb200?`你给的200米${pb200.seconds}秒，等速两倍是400米${rounded(pb200.seconds*2)}秒，仅是算术参照，不是400米预测或可执行配速${pb400?`；与已报400米${pb400.seconds}秒相差${rounded(pb400.seconds-pb200.seconds*2)}秒`:''}。一种解释是速度储备与目标有差距，另一种解释是后程节奏、恢复或动作保持影响表现；需要同协议400米分段区分，不能从单个200米给出可信成绩区间。`:state.goalTarget?`已记住目标：${state.goalTarget.meters}米${state.goalTarget.fromSeconds!==null?`从${state.goalTarget.fromSeconds}秒到`:''}${state.goalTarget.toSeconds}秒；这是目标，不是已经达到的能力。`:state.pbs.length?`已知${stated}${frequency?`，每周${frequency}次训练`:''}；先用原始成绩描述起点，不生成经验能力分。速度与后程保持需要分别观察：如果同协议前段节奏改变后后段改善，支持配速解释；如果前段一致仍连续变慢，则应核对恢复、环境和动作控制，仍不能诊断生理缺陷。`:(hasStatedNumbers(parseStatedFacts(q))?'上面的数字来自你这次的描述（只在本次回答里核算，没有保存为训练记录）。':'目前尚无可核对的近期实际表现；先在已批准原课程记录一项具体指标，例如首末用时差或同重量完成次数，作为可撤回判断的起点。')
  text=comparison+'下一次在一节已批准的原课程中，保留实际分段、休息与整课感受；若同条件后段改善，节奏或恢复解释得到支持，若仍变慢，则需核对计时、环境和动作观察。'
 }
 if(/就说|行不行|能跑完吗|能继续吗/.test(q)&&!chat.hasActual)text='有条件可以做熟悉的轻活动：无痛、日常活动正常且热身不加重；今天不加组、不顶着疲劳跑完，出现不适立即停止。'+text
 const issues=[...chat.issues]
 if(issues.length&&!text.startsWith('这个数据可能有问题'))text='这个数据可能有问题：'+issues.join('')+'\n'+text
 if(clarification)text='已把这次补充关联到刚才那节训练；原始输入和补充依据均保留，仍为未保存自报。'+(clarification.rpe===null?'你确认的是单组或单段评分，不能乘整课时长计算负荷。':'')+'\n'+text
 const questions:{key:string;text:string;pending?:PendingCoachQuestion}[]=[]
 const rpeKey=active?`rpeScope:${active.id}`:''
 if(active?.rpeAssumed&&!saved&&!state.asked.includes(rpeKey))questions.push({key:rpeKey,text:'这里的RPE是整课评分吗？',pending:{kind:'RPE_SCOPE',trainingId:active.id,askedTurn:state.turns,askedAt:asOf,intent:intent==='LOAD'?'LOAD':'REVIEW'}})
 if(!state.profile.event&&!state.asked.includes('event'))questions.push({key:'event',text:'你的主项是什么？'})
 if(!state.goal&&!state.asked.includes('goal')&&intent==='COACHING')questions.push({key:'goal',text:'目前最想达到什么目标？'})
 if(!questions.length&&state.injury===null&&!state.asked.includes('injury')&&['COACHING','TEST','NEXT'].includes(intent))questions.push({key:'injury',text:'目前有没有疼痛或影响日常活动的伤病？'})
 const emitted=questions.slice(0,Math.max(0,(review?1:2)-(text.match(/[？?]/g)?.length??0)))
 for(const question of emitted){state.asked.push(question.key);if(question.pending)state.pendingQuestion=question.pending}
 const knowledge=review?.knowledge??retrieveResearchIndex({question:q+' '+signalQuery(signals),step:state.phase==='TEST'?'测试性训练':state.phase==='FEEDBACK'?'反馈与观察':'初步判断',sport:state.profile.event,stage:state.profile.stage==='UNKNOWN'?null:state.profile.stage,age:state.profile.age,sex:state.profile.sex??null,experienceMonths:state.profile.experienceMonths,purpose:review?.purpose.purpose??null,safetyRestricted:false})
 state.previousDecision=text.split('。')[0]
 const body=[text,!review&&context?`结合你已说过的背景：${context}。`:'',population,emitted.map(question=>question.text).join('')].filter(Boolean).join('\n')
 const result=response(body,review,chat.hasActual?chat:undefined,nextCandidate)
 return {...result,text:result.text+'\n依据：本地知识与教学候选仅帮助解释，没有修改计划或记录。'+(knowledge.length?'\n'+knowledge.map(k=>`${k.id}｜研究候选，未独立核验。${k.summary}；适用限制：${k.boundary}`).join('\n'):''),sources:[...result.sources,...knowledge.map(k=>k.id)]}
}
