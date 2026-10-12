import { retrieveCurriculum, retrieveTeachingExamples, formatCurriculumGuidance, calculateStatedSessionLoads, type CurriculumSelection } from './coach-curriculum.ts';
import { auditDeviceConflict, type DeviceConflictAudit } from "./coach-device-conflict.ts";
import { explainRunningFeedback } from "./running-transaction.ts";
import { reasonCoachCognition, type CoachCognition } from "./coach-cognition.ts";
import { answerFromRecordedContext } from "./coach-record-context.ts";
import { explainTrainingMechanism, formatTrainingMechanism } from "./coach-training-mechanisms.ts";
import type { CoachBrief } from "./coach-brief.ts";
import { projectCoachNextSession } from './coach-next-session.ts';
import { classifyLocalSafety, screenLocalSafety } from "./coach-local-safety.ts";
import { contextualNutrition, type Event } from "./nutrition-context.ts";

export type LocalCoachAnswer = {
  text: string;
  escalationAvailable: boolean;
  sources: string[];
  cognition?: CoachCognition;
  curriculum?: CurriculumSelection;
  teachingExampleIds?: string[];
  deviceAudit?: DeviceConflictAudit;
  recoveryDecision?: RecoveryDecision;
};

type RecoveryObservation = { kind: 'SLEEP' | 'SESSION_RPE' | 'SUBJECTIVE_RECOVERY' | 'FATIGUE'; origin: 'USER_REPORT' | 'BOUND_FACT'; value: number | null; text: string; sourceIds: string[] };
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
      if(valid(kind,Number(m[1])) && !/(?:没有|未|没|不)\s*$/.test(clause.slice(0,m.index)))observations.push({kind,origin:'USER_REPORT',value:Number(m[1]),text:clause,sourceIds:[]});
    }
    const fatigue=clause.match(/疲劳明显|明显疲劳|很疲劳|腿很沉|腿沉|恢复差|尚未恢复/);
    if(fatigue && !/(?:没有|无|不|并不)\s*$/.test(clause.slice(0,fatigue.index)))observations.push({kind:'FATIGUE',origin:'USER_REPORT',value:null,text:clause,sourceIds:[]});
  }
  const conflict=brief.duplicateCount>0 || ['SLEEP','SESSION_RPE','SUBJECTIVE_RECOVERY'].some(kind=>
    new Set(observations.filter(o=>o.origin==='USER_REPORT'&&o.kind===kind).map(o=>o.value)).size>1);
  // Keep the unbound status: this projection is used for its existing blockers, not as permission to execute a plan.
  const poor=observations.some(o=>o.kind==='FATIGUE' || projectCoachNextSession({...brief,occurrenceId:null,sources:[],duplicateCount:0,pain:false,
    sleepHours:o.kind==='SLEEP'?o.value:null, sessionRpe:o.kind==='SESSION_RPE'?o.value:null,
    subjectiveRecovery:o.kind==='SUBJECTIVE_RECOVERY'?o.value:null}).blockers.some(b=>['SHORT_SLEEP','LOW_SUBJECTIVE_RECOVERY','RECOVERY_MISSING_AFTER_HIGH_RPE'].includes(b)));
  if(!poor && !conflict)return null;
  const when=/明天|下一天|第二天/.test(q)?'明天的训练':/今天|当日/.test(q)?'今天的训练':'下一课';
  const requestedPlan=q.split(/[，,。；;\n]/).find(clause=>/计划/.test(clause)&&/训练|跑|主课|间歇|力量|高强度/.test(clause));
  const lines=[`先评估${when}，原计划的强度与完成量仍待确认，不建议直接照常全做或补加量。`,
    requestedPlan?`待评估计划（不是完成事实）：${requestedPlan}；距离和组数本身不能确定实际强度。`:'',
    ...observations.map(o=>`${o.origin==='USER_REPORT'?'本次消息自报（未保存、未绑定）':'已选训练的绑定记录'}：${o.text}${o.sourceIds.length?` [${o.sourceIds.join(',')}]`:''}。`),
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
export function answerLocally(brief: CoachBrief): LocalCoachAnswer {
  const q = brief.question.toLowerCase();
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
      "我可以帮助核对训练、恢复、身体和饮食记录。请告诉我想分析的具体训练或问题；对于开放式复杂推理，可以由你主动申请线上大模型。";
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
    text: `${text}\n${explainRunningFeedback(brief.occurrenceId ?? undefined)}\n${context}${facts.length ? ` 已记录：${facts.join("；")}。` : " 当前关联的量化证据不足。"}${sources.length ? `\n依据：${sources.join("；")}` : ""}\n本地分析仅供参考；没有修改计划或记录。`,
    escalationAvailable: !danger && nutrition?.safety !== "EMERGENCY",
    sources: curriculumUsed ? [...sources,...curriculum.lessons.map(r=>r.id)] : sources,
    ...(curriculumUsed ? {curriculum} : {}),
  };
}
