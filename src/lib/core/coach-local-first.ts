import { statedFactsSection } from '../coach/stated/compose.ts'
import { answerFromAppData } from "../health/coach-data"
import { compileC03MetricBrief, type C03MetricBrief } from '../coach/c03/evidence.ts'
import { buildC03ObservationReview } from '../coach/c03/argument.ts'
import { deliverNativeCoachDialogue } from './dialogue-e1/host.ts'
import { topicFallback, FALLBACK_TOPICS } from './coach-topic-fallback.ts';
import { answerDialogue, coachPrimaryIntent, type CoachDialogue } from './coach-dialogue.ts';
import type { ChatTraining } from './coach-chat-evidence.ts';
import { cleanAthleteText } from './coach-offline-insights.ts';
import { enrichOfflineAnswer } from './coach-offline.ts';
import type { OfflineReview } from './coach-offline-loop.ts';
import { buildPeriodReview, formatPeriodReview, periodStart, type PeriodReview } from './coach-period-review.ts';
import { calendarDay } from './coach-calendar.ts';
import { ordinaryDiscomfortAnswer } from './coach-ordinary-discomfort.ts';
import { boundedCoachMemory, type CoachContextMemory } from './coach-context-memory.ts';
import { structuredCoachingCandidate, type StructuredCoachingCandidate } from './coach-structured-candidate.ts';
import { detectRedFlags,redFlagResponse } from './coach-red-flags.ts';
import { localPlaybookLesson, localPlaybookBoundary } from "./coach-playbook.ts";
import { reportedSessionRpes, parseReportedRpes, sessionLoadAnswer } from "./coach-claim-scope.ts";
import { linkedContextText } from "./coach-linked-context.ts";
import { retrieveCurriculum, retrieveTeachingExamples, formatCurriculumGuidance, calculateStatedSessionLoads, type CurriculumSelection } from './coach-curriculum.ts';
import { auditDeviceConflict, type DeviceConflictAudit } from "./coach-device-conflict.ts";
import { explainRunningFeedback } from "./running-transaction.ts";
import { reasonCoachCognition, type CoachCognition } from "./coach-cognition.ts";
import { answerFromRecordedContext } from "./coach-record-context.ts";
import { explainTrainingMechanism, formatTrainingMechanism } from "./coach-training-mechanisms.ts";
import type { CoachBrief } from "./coach-brief.ts";
import { projectCoachNextSession } from './coach-next-session.ts';
import { classifyLocalSafety, screenLocalSafety, localSafetyAction } from "./coach-local-safety.ts";
import { contextualNutrition, type Event } from "./nutrition-context.ts";
import { formatReasoningFrame, reasoningRevisionNotice, type ReasoningFrame } from './coach-reasoning.ts';
import type { EvolutionSnapshot } from './coach-evolution-v4.ts';
import { coachQuestionIntent } from './coach-model-packet.ts';

export type LocalCoachAnswer = {
  c03?: { brief: C03MetricBrief; review: ReturnType<typeof buildC03ObservationReview> };
  expression?: { version: 'E1'; coverage: 'CONFIRMED_RECORD_INSPECTION_ONLY'; sourceRevision: string };
  dialogue?: CoachDialogue;
  chatTraining?: ChatTraining;
  text: string;
  offlineRuleIds?: string[];
  offlineReview?: OfflineReview;
  candidate?: StructuredCoachingCandidate|null;
  escalationAvailable: boolean;
  sources: string[];
  cognition?: CoachCognition;
  curriculum?: CurriculumSelection;
  teachingExampleIds?: string[];
  deviceAudit?: DeviceConflictAudit;
  recoveryDecision?: RecoveryDecision;
  reasoning?: ReasoningFrame;
};

type RecoveryObservation = { kind: 'SLEEP' | 'SESSION_RPE' | 'UNSPECIFIED_RPE' | 'SUBJECTIVE_RECOVERY' | 'FATIGUE'; origin: 'USER_REPORT' | 'BOUND_FACT'; value: number | null; text: string; sourceIds: string[] };
type RecoveryDecision = { observations: RecoveryObservation[]; conflict: boolean; decisionAuthorization: false; executable: false };

/** Apply existing next-session limits to this turn, without inventing a bound occurrence or writing evidence. */
function recoveryDecisionAnswer(brief: CoachBrief, curriculum: CurriculumSelection): LocalCoachAnswer | null {
  const q=brief.question.normalize('NFKC');
  if (!/训练|跑|主课|间歇|力量|冲刺|高强度|下一课/.test(q) ||
      !/照常|调(?:整)?(?:吗|不)|要(?:不要)?(?:调整|改)|能.{0,12}(?:练|跑|做)|下一(?:课|次)|怎么办/.test(q) ||
      /朋友|队友|他人|假如|假设/.test(q) || /请录入|记录下来|只计算|仅计算|只看记录/.test(q)) return null;
  const observations: RecoveryObservation[]=[];
  const valid=(kind:RecoveryObservation['kind'], n:number)=>Number.isFinite(n) && (kind==='SLEEP' ? n>0&&n<=24 : n>=1&&n<=10);
  // Read only sources explicitly bound by assembleCoachBrief. Retain every conflicting record, not a representative value.
  for(const source of brief.sources??[]) {
    if(!brief.occurrenceId || source.kind!=='FACT' || !brief.sourceIds.includes(source.id))continue;
    const m=source.detail.match(/^(SLEEP|SESSION_RPE|SUBJECTIVE_RECOVERY) .*?：(\d+(?:\.\d+)?)(?:小时|\/10)/);
    if(m && valid(m[1] as RecoveryObservation['kind'],Number(m[2])))observations.push({kind:m[1] as RecoveryObservation['kind'],origin:'BOUND_FACT',value:Number(m[2]),text:source.detail,sourceIds:[source.id]});
  }
  for(const clause of q.split(/[，,。；;\n]/)) {
    // Future target effort and planned sleep are not observations of an actual session or night.
    if(/计划|目标|打算|准备|假设|未记录|没记录/.test(clause))continue;
    for(const [kind,pattern] of [
      ['SLEEP',/(?:只睡(?:了)?|睡了|睡眠(?:时长)?(?:为|是|只有|仅有)?|睡)\s*(\d+(?:\.\d+)?)\s*小时/g],
      ['SESSION_RPE',/RPE\s*(?:为|是|[:：])?\s*(\d+(?:\.\d+)?)(?![\d.])/gi],
      ['SUBJECTIVE_RECOVERY',/(?:主观恢复|恢复感)(?:评分)?\s*(?:为|是|[:：])?\s*(\d+(?:\.\d+)?)(?![\d.])/g],
    ] as const) for(const m of clause.matchAll(pattern)) {
      if(kind==='SESSION_RPE'&&!reportedSessionRpes(clause).includes(Number(m[1]))){
       const reading=parseReportedRpes(clause).find(r=>r.scope==='UNSPECIFIED'&&r.value===Number(m[1]));
       if(reading&&valid('UNSPECIFIED_RPE',reading.value))observations.push({kind:'UNSPECIFIED_RPE',origin:'USER_REPORT',value:reading.value,text:clause+'（评分范围未知，需确认整课或单组）',sourceIds:[]});
       continue;
      }
      if(valid(kind,Number(m[1])) && !/(?:没有|未|没|不)\s*$/.test(clause.slice(0,m.index)))observations.push({kind,origin:'USER_REPORT',value:Number(m[1]),text:clause,sourceIds:[]});
    }
    const fatigue=clause.match(/疲劳明显|明显疲劳|很疲劳|腿很沉|腿沉|恢复差|尚未恢复/);
    if(fatigue && !/(?:没有|无|不|并不)\s*$/.test(clause.slice(0,fatigue.index)))observations.push({kind:'FATIGUE',origin:'USER_REPORT',value:null,text:clause,sourceIds:[]});
  }
  const conflict=brief.duplicateCount>0 || ['SLEEP','SESSION_RPE','SUBJECTIVE_RECOVERY'].some(kind=>
    new Set(observations.filter(o=>o.origin==='USER_REPORT'&&o.kind===kind).map(o=>o.value)).size>1);
  // Keep the unbound status: this projection is used for its existing blockers, not as permission to execute a plan.
  const poor=observations.some(o=>o.kind==='FATIGUE' || o.kind==='UNSPECIFIED_RPE'&&o.value!==null&&o.value>=7 || projectCoachNextSession({...brief,occurrenceId:null,sources:[],duplicateCount:0,pain:false,
    sleepHours:o.kind==='SLEEP'?o.value:null, sessionRpe:o.kind==='SESSION_RPE'?o.value:null,
    subjectiveRecovery:o.kind==='SUBJECTIVE_RECOVERY'?o.value:null}).blockers.some(b=>['SHORT_SLEEP','LOW_SUBJECTIVE_RECOVERY','RECOVERY_MISSING_AFTER_HIGH_RPE'].includes(b)));
  if(!poor && !conflict)return null;
  const when=/明天|下一天|第二天/.test(q)?'明天的训练':/今天|当日/.test(q)?'今天的训练':'下一课';
  const requestedPlan=q.split(/[，,。；;\n]/).find(clause=>/计划/.test(clause)&&/训练|跑|主课|间歇|力量|高强度/.test(clause));
  const lines=[`先评估${when}，原计划的强度与完成量仍待确认，不建议直接照常全做或补加量。`,
    requestedPlan?`待评估计划（不是完成事实）：${requestedPlan}；距离和组数本身不能确定实际强度。`:'',
    ...observations.map(o=>`${o.origin==='USER_REPORT'?'本次消息自报（未保存、未绑定）':'已选训练的绑定记录'}：${o.origin==='USER_REPORT'&&/RPE/.test(o.kind)?`自报RPE ${o.value}；`:''}${o.text}${o.sourceIds.length?` [${o.sourceIds.join(',')}]`:''}。`),
    observations.some(o=>o.origin==='BOUND_FACT')?'绑定记录描述所选训练当时的情况；需核对与当前自报的时间和对应关系，不能覆盖或混为同一条。':'没有选定训练编号，不读取其他日期的记录；本次自报仍可用于条件分析。',
    '这些线索提高谨慎程度，但一次短睡眠或高RPE不能确诊过度训练，缺失反馈也不代表恢复正常。'];
  if(conflict)lines.push('证据存在重复或冲突：保留原值与来源，不平均、不选较好的值。先确认各条对应的训练/时间及有效记录；在解决前只暂缓高强度，不给执行剂量。');
  else {
    const has=(kind:RecoveryObservation['kind'])=>observations.some(o=>o.kind===kind&&o.origin==='USER_REPORT');
    const missing=['现在的精神状态、局部疼痛或不适、日常活动是否受影响',
      '近期高强度课与总负荷，以及当前周期目的和比赛期限',!has('SLEEP')?'昨晚实际睡眠及后续恢复变化':null].filter(Boolean);
    lines.push(`先补最影响决定的信息：${missing.join('；')}。`,
      observations.some(o=>o.kind==='SLEEP')?'睡眠时长需结合精神状态、近期负荷与个人连续反应；不能只按小时数发训练许可。':'高主观强度应与当前恢复反应一起看；仍需核对睡眠和24h/48h恢复的时间与口径，不能直接确认原高强度可承受。',
      brief.pain?'已有疼痛限制：暂停诱发不适的训练，必要时由运动医学或康复专业人员评估；不以轻松课代替评估。':'条件候选：若明显疲劳、精神差或热身反应异常，暂缓高强度；若无疼痛等风险且日常活动正常，可由你选择熟悉、轻松、降低要求的活动，出现不适就停止。',
      '暂缓或降低要求可能减少本次刺激，但避免为完成课表牺牲恢复；保持原课只有在恢复与当前反应核对后才可重新讨论，不是当前放行。');
  }
  if(brief.constraints.blockReason)lines.push(brief.constraints.blockReason);
  lines.push('记录实际完成情况、整课RPE与后续24h/48h恢复，再比较同类课决定下一次是否恢复原安排；不据一次反馈形成固定个人规律。',
    formatCurriculumGuidance(curriculum),'候选由你接受、拒绝或修改；没有自动修改计划或记录。');
  return {text:lines.filter(Boolean).join('\n'),recoveryDecision:{observations,conflict,decisionAuthorization:false,executable:false},curriculum,
    escalationAvailable:true,sources:[...new Set([...observations.flatMap(o=>o.sourceIds),...curriculum.lessons.map(l=>l.id)])]};
}

/** Read-only deterministic assistance. Never authorizes a training-plan or medical change. */
function legacyAnswerLocally(brief: CoachBrief): LocalCoachAnswer {
  const q = brief.question.toLowerCase();
  const directAction=localSafetyAction(brief.question);
  if(directAction)return {text:directAction,escalationAvailable:false,sources:[]};
  const curriculum = retrieveCurriculum(brief.question);
  let curriculumUsed = false;
  const sources = (brief.sources ?? [])
    .filter((s) => brief.sourceIds.includes(s.id))
    .slice(0, 4)
    .map((s) => `${s.detail} [${s.id}]`);
  const context = brief.occurrenceId
    ? `已关联训练编号 ${brief.occurrenceId}。`
    : "尚未指定某次训练；不能把其他日期的记录当作本次证据。";
  const risk = brief.pain || brief.constraints.medicalReferral;
  const safety = classifyLocalSafety(q);
  const danger = safety === "EMERGENCY";
  const safetyDetail = screenLocalSafety(q);
  const cognition = reasonCoachCognition(brief);
  const deviceAudit = auditDeviceConflict(brief.question);
  const anemia = /贫血|铁蛋白|血红蛋白|缺铁|补铁/.test(q);
  const fuel =
    /热量|饮食|碳水|蛋白质|吃什么|赛前吃|补给|能量缺口|减脂|吃多少|怎么吃|餐|补水|电解质|脱水|体重|能量可用性|糖原/.test(
      q,
    );
  const training =
    /训练|跑步|配速|间歇|阈值|双阈值|挪威|乳酸|跑量|力量|恢复|疲劳|rpe|睡眠|疼痛/.test(q);
  const eventMatch =
    q.match(/(?:^|[^\d])(800|1500|5000|10000)\s*(?:米|m)/) || q.match(/(半马|马拉松)/);
  const event: Event = eventMatch
    ? ({
        "800": "800m",
        "1500": "1500m",
        "5000": "5000m",
        "10000": "10000m",
        半马: "half-marathon",
        马拉松: "marathon",
      }[eventMatch[1]] as Event)
    : "unknown";
  const nutrition =
    fuel || anemia ? contextualNutrition({ question: brief.question, event }) : null;
  const recorded = answerFromRecordedContext(brief);
  const mechanism = explainTrainingMechanism(brief.question);
  const recovery = !fuel && !anemia ? recoveryDecisionAnswer(brief,curriculum) : null;
  let text: string;
  if (danger || nutrition?.safety === "EMERGENCY") {
    text = safetyDetail.psychological
      ? "我很关心你现在的安全。请先暂停训练，尽快联系可信赖的人陪伴你，并联系当地危机支持；如果可能马上伤害自己或已经采取行动，请立即联系当地急救或去急诊。你现在是否安全？这比训练安排更优先。"
      : "你提到了可能需要紧急评估的症状。如果症状正在发生、明显或持续，请停止运动并及时寻求急诊/当地急救服务。不能通过聊天诊断。";
  } else if (nutrition?.safety === "URGENT_REVIEW") {
    text =
      "你描述的情况可能需要尽快医学评估，请暂停相关高强度运动并尽快就医；不要只靠饮食或补剂处理。";
  } else if (safety === "MEDICAL_REVIEW") {
    text = safetyDetail.historical.length
      ? "你描述的是既往事件，不能说你正在发生急症；但既往晕厥、胸痛或心理危机值得专业评估。请确认当前是否有症状、是否完成评估；未明确训练安全前不安排高强度。如果重新发生急性症状，应及时寻求急救。"
      : /厌食|催吐|暴食|极端少吃|每天.*吃/.test(q)
        ? "不建议极端少吃并增加训练，也不提供这种减重方案。进食和训练带来的压力值得认真支持，可以联系医生、营养师或心理专业人员一起评估；这不是诊断。"
        : /腘绳肌|大腿后侧|膝盖|疼痛[1-9]/.test(q)
          ? "走路不痛或恢复了几天，不等于已能安全全速跑。先暂停全速冲刺及诱发疼痛的专项内容，核对部位、程度、起病、功能和已有康复评估；建议运动医学或康复专业评估，再讨论循序渐进的速度与力量重建。没有据此诊断。"
          : anemia
            ? "铁缺乏与贫血需要分别评估；不能仅凭聊天或单一化验值诊断。请结合症状、血常规和铁蛋白等结果咨询医生；不要自行开始治疗剂量补铁。"
            : "这可能涉及需要专业评估的健康线索。不能仅凭聊天或单一化验值诊断，请结合症状、检查结果与运动医学或临床医生讨论；不要自行开始治疗性补剂或强行减重。";
  } else if (deviceAudit) {
    return {
      text: deviceAudit.text + "\n" + formatCurriculumGuidance(curriculum) + "\n本地分析没有修改计划或记录。",
      curriculum,
      deviceAudit,
      escalationAvailable: true,
      sources: curriculum.lessons.map(r=>r.id),
    };
  } else if (anemia) {
    text =
      "铁缺乏与贫血不是同一个诊断。需要结合血常规、血红蛋白、铁蛋白等结果和症状由医生评估；不要自行按聊天建议服用治疗剂量的铁剂。日常饮食可考虑含铁食物并搭配富含维生素C的食物。";
  } else if (/(?:教学|合成).{0,12}(?:案例|示例)|(?:案例|示例).{0,12}(?:教学|合成)/.test(brief.question) && retrieveTeachingExamples(brief.question).length) {
    const example = retrieveTeachingExamples(brief.question)[0];
    return {text:`合成教学案例，不是你的训练记录或能力：\n${example.scenario}\n参考应用（非已验证的个人处方）：${example.proposedResponse}\n改变判断的条件：${example.changeCondition}\n[${example.id}] 没有修改计划或记录。`, escalationAvailable:true,curriculum,teachingExampleIds:[example.id],sources:[example.id,...example.ruleRefs]};
  } else if (recovery) {
    return recovery;
  } else if (cognition) {
    return {
      text:
        cognition.text +
        "\n" +
        explainRunningFeedback(brief.occurrenceId ?? undefined) +
        (mechanism ? `\n${formatTrainingMechanism(mechanism)}` : "") +
        (risk
          ? "\n已有疼痛或安全限制：不建议在此基础上自动加量，必要时咨询运动医学专业人员。"
          : ""),
      cognition,
      curriculum: cognition.curriculum,
      escalationAvailable: true,
      sources: cognition.knowledge.map((k) => k.id),
    };
  } else if (curriculum.lessons.length && !/(?:查看|读取|显示|调出|找出|看一下|看).{0,12}(?:记录|课表|计划)|(?:昨天|上一节|上一次).{0,6}(?:记录|计划)|训练事实/.test(brief.question)) {
    curriculumUsed = true;
    const calculations=calculateStatedSessionLoads(brief.question);
    text = (calculations.length ? `按本次提供的整课数值：${calculations.join('；')}。\n` : '') + formatCurriculumGuidance(curriculum);
  } else if (recorded) {
    text = recorded;
  } else if (mechanism) {
    text = formatTrainingMechanism(mechanism);
  } else if (fuel) {
    text =
      "饮食应结合训练量、比赛时间、体重变化及食物耐受来判断。不能仅凭摄入热量减去运动消耗就诊断低能量可用性或 RED-S。赛前优先选择自己在训练中试过、易消化的食物，避免临时尝试新补剂。";
  } else if (training) {
    text =
      "我可以核对已保存的训练事实，但不能仅凭一次表现确定阈值、疲劳或下次训练负荷。双阈值等方法需要结合长期跑量、强度分布、恢复与个体测试，不能照搬精英课表。";
  } else {
    text =
      "今天先保持熟悉、无痛且能轻松交谈的活动，明天根据恢复再决定是否增加要求。你的主项和最近一节实际训练是什么？";
  }
  if (nutrition && !danger) {
    const facts = nutrition.facts.slice(0, 2);
    text += `\n营养知识边界：${facts.length ? facts.join("；") : "需要结合训练量、摄入记录与个人耐受；目前不足以生成个体化处方"}。`;
    if (nutrition.missing.length)
      text += `\n仍需确认：${nutrition.missing.slice(0, 3).join("；")}。`;
    if (nutrition.safety !== "NONE") text += " 如有持续症状或异常检验结果，请由专业医务人员评估。";
  }
  if (risk && !danger)
    text += " 已有疼痛或安全限制：不建议在此基础上自动加量，必要时咨询运动医学专业人员。";
  const facts = [
    brief.sessionRpe != null ? `本次 RPE ${brief.sessionRpe}/10` : null,
    brief.sleepHours != null ? `睡眠 ${brief.sleepHours} 小时` : null,
    brief.subjectiveRecovery != null ? `主观恢复 ${brief.subjectiveRecovery}/10` : null,
    brief.completedSetCount != null && brief.plannedSetCount != null
      ? `力量完成组 ${brief.completedSetCount}/${brief.plannedSetCount}`
      : null,
  ].filter(Boolean);
  return {
    text: `${text}\n${explainRunningFeedback(brief.occurrenceId ?? undefined)}\n${context}${facts.length ? ` 已记录：${facts.join("；")}。` : " 先记录下一节熟悉训练的实际内容和感受，今天不急着加量。"}${sources.length ? `\n依据：${sources.join("；")}` : ""}\n本地分析仅供参考；没有修改计划或记录。`,
    escalationAvailable: !danger && nutrition?.safety !== "EMERGENCY",
    sources: curriculumUsed ? [...sources,...curriculum.lessons.map(r=>r.id)] : sources,
    ...(curriculumUsed ? {curriculum} : {}),
  };
}
/** One coordinator for local and model requests; structured snapshots are re-audited by the caller. */
function answerLocallyCore(brief:CoachBrief,logic?:{frame:ReasoningFrame;snapshot:EvolutionSnapshot}):LocalCoachAnswer{
 const base=legacyAnswerLocally(brief)
 const multipleLoads=calculateStatedSessionLoads(brief.question)
 if(multipleLoads.length>1&&screenLocalSafety(brief.question).level==='NONE')return {text:multipleLoads.join('\n'),escalationAvailable:false,sources:[]}

 const load=screenLocalSafety(brief.question).level==='NONE'&&!logic?.frame.safety.mustRetain&&logic?.frame.stage!=='RESOLVE_CONFLICT'?sessionLoadAnswer(brief.question,brief.sessionRpe,brief.durationSec,brief.continuousCount===1&&brief.repetitionSlots===0&&logic?.frame.computed.points.length===1?logic.frame.computed.points[0].seconds:null):null
 if(load)return {text:load,escalationAvailable:false,sources:brief.sourceIds,reasoning:logic?.frame}
 const boundary=localPlaybookBoundary(brief.question)
 if(boundary && screenLocalSafety(brief.question).level==='NONE' && !brief.pain && !brief.constraints.medicalReferral && !logic?.frame.safety.mustRetain)
  return {text:boundary.text,sources:boundary.sourceIds,escalationAvailable:false}
 const lesson=localPlaybookLesson(brief.question)
 if(lesson && !base.cognition && !explainTrainingMechanism(brief.question) && !brief.pain && !brief.constraints.medicalReferral && screenLocalSafety(brief.question).level==='NONE' && !logic?.frame.safety.mustRetain)
  return {text:lesson.text,escalationAvailable:true,sources:lesson.sourceIds}
 if(!logic)return base
 const frame=logic.frame
 if(frame.safety.mustRetain)return {...base,text:formatReasoningFrame(frame,logic.snapshot),escalationAvailable:false,reasoning:frame,sources:[]}
 if(brief.pain||brief.constraints.medicalReferral||!base.escalationAvailable||coachQuestionIntent(brief.question)==='FUEL'){
  const notice=reasoningRevisionNotice(frame);return {...base,text:notice?notice+'\n'+base.text:base.text,reasoning:frame}
 }
 const scoped=frame.scopeOccurrenceIds.includes(brief.occurrenceId??'')
 if(!scoped||frame.task==='CALCULATE'){
  const notice=reasoningRevisionNotice(frame);return {...base,text:notice?notice+'\n'+base.text:base.text,reasoning:frame}
 }
 return {...base,cognition:undefined,text:formatReasoningFrame(frame,logic.snapshot),reasoning:frame,sources:[...frame.observedSourceIds],escalationAvailable:true}
}

/** v86（R1.1）：题面里给出的数字和否定条件由 coach-stated 区块统一核算，所有非急救回答都先列出这些事实。
 * 急救回答保持原样（不分散注意力）；医疗/疼痛安全回答在前，事实在后。只读，不写存储。 */
export function answerLocally(brief:CoachBrief,logic?:{frame:ReasoningFrame;snapshot:EvolutionSnapshot},memory:readonly CoachContextMemory[]=[],periodReview?:PeriodReview,dialogue?:CoachDialogue):LocalCoachAnswer{
 const answer=answerLocallyR(brief,logic,memory,periodReview,dialogue)
 const red=detectRedFlags(brief.question)
 if(red.level==='EMERGENCY'||answer.dialogue?.emergency||FALLBACK_TOPICS.INJECTION.match.test(brief.question))return answer
 // 可疑数据（单位/GPS跳点/心率伪影）已由对话层保留原值并排除后核算；这里不再拿可疑值重算一遍。
 if(/这个数据可能有问题/.test(answer.text))return answer
 const stated=statedFactsSection(brief.question)
 if(!stated.text)return answer
 const [visible,...rest]=answer.text.split('\n依据：')
 const safetyFirst=red.level!=='NONE'||brief.pain||!!answer.dialogue?.medicalHold||!!logic?.frame.safety.mustRetain
 const text=(safetyFirst?visible+'\n'+stated.text:stated.text+'\n'+visible)+(rest.length?'\n依据：'+rest.join('\n依据：'):'')
 return {...answer,text}
}
function answerLocallyR(brief:CoachBrief,logic?:{frame:ReasoningFrame;snapshot:EvolutionSnapshot},memory:readonly CoachContextMemory[]=[],periodReview?:PeriodReview,dialogue?:CoachDialogue):LocalCoachAnswer{
 const original = answerLocallyBase(brief,logic,memory,periodReview,dialogue)
 if (FALLBACK_TOPICS.INJECTION.match.test(brief.question) || detectRedFlags(brief.question).level!=='NONE'
   || brief.pain || brief.constraints.medicalReferral || logic?.frame.safety.mustRetain
   || original.dialogue?.emergency || original.dialogue?.medicalHold || original.chatTraining) return original
 // Only an explicit, scoped replay reaches C03. Simple calculations, original-record
 // inspection, teaching examples and future-course selection keep their existing path.
 const explicitReplay = /复盘|(?:分析|解释).{0,10}(?:本次|这次|训练表现|掉速|变慢|原因)|(?:为何|为什么).{0,12}(?:掉速|变慢)|(?:掉速|变慢).{0,8}(?:原因|为何|为什么)/.test(brief.question)
 const otherTask = /只算|仅算|计算|负荷|配速是多少|(?:查看|核对|读取|列出).{0,12}(?:实际记录|训练记录|完成记录|记录事实)|教学|合成|案例|假设|举例|下一课|明天|改期|挪到|移到|调整|安排|加量|减量|选课/.test(brief.question)
 if (explicitReplay && !otherTask && brief.occurrenceId && logic
   && logic.snapshot.athleteId === (original.dialogue?.athleteId ?? logic.snapshot.athleteId)
   && logic.frame.scopeOccurrenceIds.includes(brief.occurrenceId)) {
  const c03Brief = compileC03MetricBrief(logic.snapshot, brief.occurrenceId)
  if (c03Brief.state !== 'BLOCKED' && c03Brief.groups.length) {
   const purpose = original.offlineReview?.purpose
   const review = buildC03ObservationReview(c03Brief, purpose?.purpose === 'UNKNOWN' ? null : purpose?.purpose)
   const metricLabels: Record<string, string> = { REST_SECONDS: '实际恢复时间', STRENGTH_KG: '力量实际外加负重',
    STRENGTH_REPS: '力量实际次数', STRENGTH_SECONDS: '力量实际持续时间', SESSION_RPE: '整课RPE',
    SLEEP_HOURS: '睡眠记录', SUBJECTIVE_RECOVERY: '主观恢复', SORENESS: '酸痛自报', PAIN_SCORE: '疼痛自报', HR_AVG_BPM: '平均心率' }
   const remainingFacts = c03Brief.numbers.filter(n => n.kind === 'SOURCE' && n.metric !== 'SPLIT_SECONDS')
    .map(n => `${metricLabels[n.metric] ?? '已记录指标'}：${n.value}${n.unit === 'score' ? '/10' : ` ${n.unit}`}（来源 ${n.sourceIds.join('、')}）`)
   const text = [
    `本次事实：${[...review.facts, ...remainingFacts].join('\n')}`,
    `训练目的：${review.purpose}。${purpose?.conditions ?? '先核对原计划目的、实际强度与恢复；不凭距离或课名推断。'}`,
    ...review.explanations.map((h, i) => `可能解释${i + 1}：${h.explanation}\n支持：${h.support.join('；')}\n反证或削弱条件：${h.against.join('；')}`),
    `不确定性：${[...review.missing, ...review.explanations.flatMap(h => h.missing)].join('；') || '观察不能证明因果或能力缺陷'}。`,
    `下一步具体观察：${review.nextObservation}`,
    brief.constraints.blockReason ? `现有训练限制仍保留：${brief.constraints.blockReason}` : '',
    review.purpose === 'UNKNOWN' ? '最重要的确认：原计划或教练对这节课最重要的目的是什么？' : '',
    '以上是本地事实与待验证解释；没有修改正式计划、训练记录或能力评分。',
   ].filter(Boolean).join('\n')
   return { ...original, text, candidate: null, c03: { brief: c03Brief, review },
    sources: [...new Set(c03Brief.numbers.flatMap(n => n.sourceIds))] }
  }
 }
 if (original.candidate) return original
 const expression = deliverNativeCoachDialogue({ question: brief.question, occurrenceId: brief.occurrenceId,
   asOf: logic?.snapshot.asOf ?? new Date().toISOString() })
 if (expression.status!=='DELIVERABLE_FACTS_ONLY') return original
 return {...original,text:expression.text,sources:expression.sourceIds,
   expression:{version:'E1',coverage:expression.trace.coverage,sourceRevision:expression.trace.sourceRevision}}
}

function answerLocallyBase(brief:CoachBrief,logic?:{frame:ReasoningFrame;snapshot:EvolutionSnapshot},memory:readonly CoachContextMemory[]=[],periodReview?:PeriodReview,dialogue?:CoachDialogue):LocalCoachAnswer{
 // Explicit daily questions may use health facts; never replace session replay or a medical hold.
 const dailyPain=brief.appData?.fatigue.state==='PAIN_REVIEW'
 // A saved health/device preference must not hijack an explicit load calculation.
 if(coachPrimaryIntent(brief.question)!=='LOAD'&&!FALLBACK_TOPICS.INJECTION.match.test(brief.question)&&detectRedFlags(brief.question).level==='NONE'
   &&!brief.pain&&(!brief.constraints.medicalReferral||dailyPain)&&!logic?.frame.safety.mustRetain&&!dialogue?.emergency&&!dialogue?.medicalHold){
   const text=answerFromAppData(brief)
   if(text)return {text,dialogue,sources:[brief.appData!.sourceId],escalationAvailable:false,candidate:null}
 }
 // Explicit record inspection must not be replaced by the dialogue intake fallback.
 // These remain read-only context, and every existing medical hold takes priority.
 const recordSources=(brief.sources??[]).filter(s=>s.kind==='CONTEXT'&&/^linked:(?:meal:|measurement:|fieldwork-draft:|fieldwork-drafts-unavailable)/.test(s.id));
 if(recordSources.length&&/(?:核对|查看|读取|检查).*(?:饮食|营养|餐|体重|腰围|实测|待练|草稿)/.test(brief.question)
  &&!FALLBACK_TOPICS.INJECTION.match.test(brief.question)&&detectRedFlags(brief.question).level==='NONE'
  &&!brief.pain&&!brief.constraints.medicalReferral&&!logic?.frame.safety.mustRetain&&!dialogue?.emergency&&!dialogue?.medicalHold){
  const drafts=recordSources.some(s=>s.id.startsWith('linked:fieldwork'));
  return {dialogue,text:'先核对当前本地只读记录：\n'+recordSources.map(s=>s.detail).join('\n')+'\n'+(drafts?'下一步先确认草稿的原定训练目的、个人适用性和批准状态；数量或休息缺失时保留待确认，不补写训练剂量。':'下一步核对餐食是否记录完整及实测日期；缺失营养素仍为未记录。仅凭这些记录不能判断恢复、供能不足或训练表现原因。')+'\n没有修改正式计划或训练记录。',sources:recordSources.map(s=>s.id),escalationAvailable:false,candidate:null};
 }
 if(!FALLBACK_TOPICS.INJECTION.match.test(brief.question)){
  const current=answerDialogue(brief,logic,dialogue)
  if(current){
   const notes=!current.dialogue.emergency&&!current.dialogue.medicalHold&&!brief.pain&&logic?boundedCoachMemory(memory,logic.snapshot.athleteId,logic.snapshot.asOf):[]
   const [visible,...references]=current.text.split('\n依据：')
   const recovery=!current.dialogue.emergency&&!current.dialogue.medicalHold&&detectRedFlags(brief.question).level==='NONE'&&!brief.pain&&!brief.constraints.medicalReferral&&!logic?.frame.safety.mustRetain?recoveryDecisionAnswer(brief,retrieveCurriculum(brief.question)):null
   const safe=!current.dialogue.emergency&&!current.dialogue.medicalHold&&detectRedFlags(brief.question).level==='NONE'&&!brief.pain&&!brief.constraints.medicalReferral&&!logic?.frame.safety.mustRetain
   const deviceAudit=safe?auditDeviceConflict(brief.question):null
   const cognition=brief.pain?reasonCoachCognition(brief)??undefined:undefined
   const curriculum=recovery?.curriculum??(safe?retrieveCurriculum(brief.question):undefined)
   const recoverySummary=recovery&&!current.offlineReview?'\n恢复核对：'+recovery.recoveryDecision!.observations.map(o=>`${o.origin==='BOUND_FACT'?'绑定记录':'当前自报（未保存）'}${o.text}`).join('；')+'；先核对当前精神状态、近期负荷与周期目的，明显疲劳或不适时暂缓高强度，不能按单个数值放行。':''
   const detail=[...references,current.offlineReview?.signals.map(s=>s.text).join('\n'),recovery?.text,deviceAudit?.text,curriculum?formatCurriculumGuidance(curriculum):null,safe&&!references.length?'知识边界：这是待核对的训练观察，不是个人诊断；没有修改计划或记录。':null].filter(Boolean).join('\n')
   return {...current,cognition,curriculum,deviceAudit:deviceAudit??undefined,recoveryDecision:recovery?.recoveryDecision,sources:[...new Set([...current.sources,...recovery?.sources??[],...curriculum?.lessons.map(l=>l.id)??[]])],text:visible+recoverySummary+(notes.length?'\n已保存的安排偏好：'+notes.map(n=>n.text).join('；')+'；没有据此自动改课。':'')+(safe?linkedContextText(brief):'')+(detail?'\n依据：'+detail:'')}
  }
 }
 const red=detectRedFlags(brief.question);
 if(red.level==='EMERGENCY'||red.level==='URGENT_MEDICAL'||red.level==='MEDICAL_REVIEW'&&red.classes.includes('ENERGY'))return {text:redFlagResponse(red)!,escalationAvailable:false,sources:[],candidate:null};
 if(FALLBACK_TOPICS.INJECTION.match.test(brief.question))return {text:topicFallback(brief.question).text,escalationAvailable:false,sources:[],candidate:null};
 const ordinary=red.level==='NONE'&&!logic?.frame.safety.mustRetain&&!brief.pain&&!brief.constraints.medicalReferral?ordinaryDiscomfortAnswer(brief.question):null;
 if(ordinary)return {text:ordinary,escalationAvailable:false,sources:[],candidate:null};
 const mechanism=red.level==='NONE'&&!logic?.frame.safety.mustRetain&&!brief.pain&&!brief.constraints.medicalReferral?explainTrainingMechanism(brief.question):null
 if(mechanism)return {text:cleanAthleteText(formatTrainingMechanism(mechanism))+'\n没有修改计划或记录。',sources:[],escalationAvailable:false,candidate:null}
 const periodIntent = brief.question.trim().match(/^(?:请)?复盘最近\s*(7|28)\s*天[。？?]?$/);
 if(periodIntent && logic && red.level==='NONE' && !logic.frame.safety.mustRetain && !brief.pain && !brief.constraints.medicalReferral){
  const end=calendarDay(logic.snapshot.asOf)!;
  const start=periodStart(end,Number(periodIntent[1]));
  const report=periodReview?.athleteId===logic.snapshot.athleteId&&periodReview?.asOf===logic.snapshot.asOf&&periodReview.start===start&&periodReview.end===end?periodReview:buildPeriodReview(logic.snapshot,start,end,logic.frame.basis.complete?0:1);
  return {text:formatPeriodReview(report),sources:report.sourceIds,escalationAvailable:false,candidate:null};
 }
 const answer=enrichOfflineAnswer(brief,answerLocallyCore(brief,logic),logic)
 const safeContext=red.level==='NONE'&&!brief.pain&&!brief.constraints.medicalReferral&&!logic?.frame.safety.mustRetain;
 const notes=safeContext&&logic&&/安排|偏好|排课|计划|记得|训练|怎么练|练什么|跑什么|时间|哪天|有空/.test(brief.question)?boundedCoachMemory(memory,logic.snapshot.athleteId,logic.snapshot.asOf):[];
 const noteText=notes.length?'\n已保存的安排上下文（本人提供，不是表现事实）：\n'+notes.map(n=>`${n.text}${n.expiresOn?`（有效至 ${n.expiresOn}）`:''}`).join('\n')+'\n具体安排仍需结合可用日期与当前身体反馈核对；没有据此自动改课。':'';
 // Keep preferences in the visible answer, before the UI's folded “依据” suffix.
 return {...answer,candidate:logic?structuredCoachingCandidate(logic.frame):null,text:cleanAthleteText((noteText?noteText.trim()+'\n':'')+answer.text+(logic?.frame.safety.mustRetain||screenLocalSafety(brief.question).level==='EMERGENCY'?"":linkedContextText(brief)))}
}
