import { COACH_KNOWLEDGE, type CoachKnowledgeCard } from "./coach-knowledge.ts"

/** Offline, deterministic question triage. No LLM, no diagnosis or plan authorization. */
export type CoachQuestionAssessment = {
  intent: "SAFETY" | "DATA_INTERPRETATION" | "TRAINING_DESIGN" | "PERFORMANCE_TRANSFER" | "EVIDENCE" | "RACE_STRATEGY" | "NUTRITION" | "PSYCHOLOGY" | "ENVIRONMENT" | "META" | "UNKNOWN"
  safety: "EMERGENCY" | "MEDICAL_REVIEW" | "CAUTION" | "NONE"
  safetyReason: string
  knowledge: { id: string; principle: string; limit: string; sourceTitle: string; url: string; verification: "CURATED_NOT_INDEPENDENTLY_VERIFIED" }[]
  hypotheses: string[]
  missingEvidence: string[]
  nextQuestion: string | null
  evidenceGap: "PERSONAL_DATA" | "RESEARCH" | "CONTEXT" | "NONE"
  confidence: "LOW" | "MODERATE"
  confidenceReason: string
  decisionAuthorization: false
  diagnosis: null
}
const has = (s: string, p: RegExp) => p.test(s)
export function assessCoachQuestion(question: string): CoachQuestionAssessment {
  const q = question.trim()
  // Clause-level symptom handling: negation/history must not erase a later active symptom.
  // A conservative heuristic only; ambiguous clinical statements still require review.
  const clauses = q.split(/[，,。；;！!？?\n]|但是|但现在|不过|然而/).filter(Boolean)
  const emergencyTokens = /胸痛|胸口痛|胸口压榨样疼痛|训练时心脏疼|胸闷.{0,8}(?:喘不上气|呼吸困难)|喘不上气|心脏.{0,8}(?:压住|压迫).{0,4}(?:痛|疼)|晕倒|晕厥|昏厥|呼吸困难|训练时头晕|运动时突然头晕|运动中.{0,12}头晕|运动中.{0,12}心率突然很高|(?:昨天跑步头晕今天还头晕)|跑步时眼前一黑|跑步时气短.{0,8}胸闷/
  const isNegated = (c: string) => /(?:没有|无|未出现|未发生|否认|并无)(?:任何|明显|过)?(?:胸痛|胸口痛|晕倒|晕厥|昏厥|呼吸困难|头晕)/.test(c)
  const isResolvedHistory = (c: string) => /(?:去年|以前|曾经|过去|上周|两年前|三年前)/.test(c) && /(?:现在没有|目前没有|目前无|今天已经好了|已经好了|现在完全没症状|现在无症状|已完成医学评估|已经完成医学评估|已排除)/.test(q)
  const emergency = clauses.some(c => {
    const matches = [...c.matchAll(new RegExp(emergencyTokens.source, 'g'))]
    return matches.some(m => {
      const before = c.slice(Math.max(0, (m.index ?? 0)-10),m.index ?? 0)
      if (/(?:没有|无|未出现|未发生|否认|并无)(?:任何|明显|过)?$/.test(before)) return false
      if (isNegated(c) && matches.length===1) return false
      if (isResolvedHistory(c)) return false
      return true
    })
  })
  const clinical = has(q, /应力性骨折|骨折|拉伤|腘绳肌.*伤|跟腱.*(?:疼|痛)|停经|月经停|铁蛋白|哮喘|产后|多囊|贫血|小腿疼|扭伤|连续几天足底疼|家族心脏病|足底筋膜炎|确诊|诊断|封闭|止痛药|EPO|未知.*补剂|不知道成分/iu)
  const swelling = clauses.some(c => /(?:肿起来|肿胀|明显肿|肿了)/.test(c) && !/(?:没有|无|未出现).{0,8}肿/.test(c))
  const injuryConcern = /带伤|受伤后|是否需要复查|需不需要复查|(?:上周|去年|过去|以前).{0,12}(?:胸痛|晕厥|昏厥).{0,24}(?:能跑|恢复|复查)/.test(q)
  const pain = clauses.some(c => {
    if (/(?:没有|无|未出现).{0,8}(?:肿胀|疼痛|疼|痛)/.test(c) || /(?:胸口|胸部).{0,3}不痛/.test(c)) return false
    const cleaned = c.replace(/(?:没有|无|未出现|未发生|否认|并无)(?:任何|明显|过)?(?:疼痛|疼|痛|肿胀|肿|受伤|伤病)/g, "")
    return /疼|痛|肿|受伤|伤病|跟腱不舒服/.test(cleaned) && !isNegated(c) && !isResolvedHistory(c)
  })
  const safety = emergency ? "EMERGENCY" : clinical ? "MEDICAL_REVIEW" : (pain || swelling || /带伤/.test(q)) ? "CAUTION" : "NONE"
  const safetyReason = emergency ? "运动相关胸痛、晕厥或突发严重症状属于潜在急症；停止运动并及时急救评估" : clinical ? "需要专业医学或康复评估；不能凭天数或聊天信息放行训练" : pain ? "需先确认症状、功能及危险信号，不能直接确认训练安全" : "未从问题文字识别出明确医疗危险信号，不等于已经完成风险筛查"
  const performancePrediction = has(q, /(?:PB|个人最好|成绩).{0,20}(?:半马|全马|3000|5000|10公里|三千|五千).{0,20}(?:多少|预测)|(?:半马|全马|3000|5000|10公里|三千|五千).{0,25}(?:能跑多少|可能多少|预测)/) || has(q, /(?:预测|估计|能跑多少|跑多少|成绩换算).{0,15}(?:3000|5000|1500|三千|五千)|(?:3000|5000|1500).{0,15}(?:预测|估计|能跑多少|跑多少|成绩换算)/)
  const splitAnalysis = has(q, /(?:每组|后两组|越跑越慢|掉速|分段|重复跑).{0,30}(?:怎么解释|为什么|分析|说明)|(?:为什么|解释).{0,25}(?:间歇|越跑越慢|掉速)/)
  const monitor = has(q, /HRV|ACWR|VO2max|晨脉|心率|手表|GPS|功率|触地时间|睡眠效率|乳酸阈|阈值配速|乳酸|Fitness.*Freshness/iu)
  const transfer = has(q, /深蹲.*(涨|提升|进步)|硬拉.*(?:进步|提升).*速度|力量.*(跑得|成绩)|力量训练没用|力量.*变慢/)
  const race = has(q, /(?:800米|1500米|3000米).{0,15}(?:最后200米|最后一圈|配速分配)|比赛.*(第一圈|最后一圈|配速|战术|决赛|逆风|上坡|下坡|轮次|掉速)|决赛.*(?:最后一圈|战术)|400m栏.*步幅|半马.*掉速/)
  const nutrition = has(q, /补给|碳水|蛋白|喝水|补水|咖啡因|BCAA|维生素|补铁|营养|糖原/iu)
  const psych = has(q, /担心比赛失利|紧张|焦虑|动力|兴趣|心态|害怕再次受伤|强迫自己|教练总是批评|冥想/)
  const environment = has(q, /昆明|高原|热适应|炎热|新加坡|时差|飞.*小时|空气污染|AQI|下雨|冬天|桑拿|陌生床|比赛城市/iu)
  const meta = has(q, /你对.*确定|你的建议|你的知识|你的回答|你能确诊|你能给.*处方|AI教练|听谁的|你.*可能错|相反的研究/iu)
  const design = has(q, /连续.{0,12}跑量|跑量增加|周跑量|训练量|间歇|加跑量|加强度|赛前|训练计划|减量|800m|400m|100m|马拉松|增强式|深蹲|硬拉/)
  const evidence = has(q.replace(/请说明还缺什么证据[。！!？?]?/g, ""), /研究|Meta|证据|哪篇|来源|可靠|有用吗|哪个更好/iu)
  const intent = (safety !== "NONE" || injuryConcern) && !(safety === "CAUTION" && /害怕再次受伤|恢复信心/.test(q)) ? "SAFETY" : performancePrediction ? "PERFORMANCE_TRANSFER" : splitAnalysis ? "DATA_INTERPRETATION" : meta ? "META" : monitor ? "DATA_INTERPRETATION" : transfer ? "PERFORMANCE_TRANSFER" : psych ? "PSYCHOLOGY" : nutrition ? "NUTRITION" : environment ? "ENVIRONMENT" : race ? "RACE_STRATEGY" : /(?:哪篇研究|研究支持|研究证据)/.test(q) ? "EVIDENCE" : /(?:怎么分析|如何分析|说明.*(?:提高|提升)|是否说明)/.test(q) && /(?:400米|800米|200米|间歇|配速|重复跑)/.test(q) ? "DATA_INTERPRETATION" : design ? "TRAINING_DESIGN" : evidence ? "EVIDENCE" : "UNKNOWN"
  const ids: string[] = []
  if (has(q, /力量|深蹲|硬拉|增强式|冲刺|专项/)) ids.push("knowledge:strength", "knowledge:specificity")
  if (has(q, /训练|跑量|ACWR|疲劳|恢复|间歇|比赛/)) ids.push("knowledge:load")
  if (has(q, /睡眠|手表|失眠/)) ids.push("knowledge:sleep")
  if (has(q, /月经|停经|铁蛋白|能量|碳水|营养/)) ids.push("knowledge:energy")
  if (has(q, /焦虑|紧张|压力|心态|兴趣|动力|批评/)) ids.push("knowledge:psychology")
  const knowledge = [...new Set(ids)].map(id => COACH_KNOWLEDGE.find(k => k.id === id)).filter((k): k is CoachKnowledgeCard => !!k).map(k => ({ id:k.id, principle:k.principle, limit:k.limit, sourceTitle:k.sourceTitle, url:k.url, verification:"CURATED_NOT_INDEPENDENTLY_VERIFIED" as const }))
  const specific: Record<string, [string[], string[], CoachQuestionAssessment["evidenceGap"]]> = {
    PERFORMANCE_TRANSFER: [["最大力量提高不一定转化为专项速度", "专项速度刺激、动作技术或恢复可能限制迁移", "计时条件和比赛环境可能不同"], ["最近3次专项计时及测试条件", "速度分段与力量训练安排", "训练后的恢复趋势"], "PERSONAL_DATA"],
    DATA_INTERPRETATION: [["设备测量误差或正常日内波动", "训练、睡眠和环境变化", "持续趋势可能与个人基线不同"], ["最近7至14天同条件测量与个人基线", "设备型号、测量方法和症状", "近期训练和主观恢复"], "PERSONAL_DATA"],
    TRAINING_DESIGN: [["专项刺激可能不匹配", "训练负荷增长可能超过既往耐受", "恢复和比赛时间影响安排"], ["最近4至8周训练结构", "专项目标与比赛日期", "RPE、疼痛和恢复记录"], "PERSONAL_DATA"],
    RACE_STRATEGY: [["目标配速可能与当前能力不匹配", "环境、对手与赛制改变战术选择"], ["近期比赛和分段成绩", "目标赛事赛制、场地及天气"], "CONTEXT"],
    NUTRITION: [["需求取决于训练量、饮食总量及个体耐受", "补剂不能替代基础饮食和睡眠"], ["训练持续时间与体重", "现有饮食、胃肠耐受及相关医学情况"], "PERSONAL_DATA"],
    PSYCHOLOGY: [["压力、恢复和训练环境都可能影响体验", "一次状态不代表长期心理问题"], ["困扰持续时间和日常功能影响", "本人希望获得哪类支持"], "CONTEXT"],
    ENVIRONMENT: [["温度、海拔和旅行负担可能改变表现", "适应程度和个体耐受存在差异"], ["目的地环境、到达日期和比赛时间", "以往热、高原或旅行反应"], "CONTEXT"],
    SAFETY: [["症状可能有多种原因，不能据此确诊"], ["症状开始时间、程度及功能受限", "是否有胸痛、晕厥、呼吸困难等危险信号", "已有医学评估结论"], "CONTEXT"],
    EVIDENCE: [["不同研究可能使用不同人群、干预和结局", "单项研究不能证明对当前运动员有效"], ["可核验的研究原文与比较结局", "运动员背景及干预阶段"], "RESEARCH"],
    META: [["当前规则模型可能遗漏上下文和研究", "个人证据与一般研究不能混为一谈"], ["所问建议的原始证据和适用条件"], "RESEARCH"],
    UNKNOWN: [[], ["明确问题所属项目、目标和上下文"], "CONTEXT"]
  }
  const [hypotheses, baseMissingEvidence, evidenceGap] = specific[intent]
  const missingEvidence = performancePrediction ? ["PB取得日期、当时训练状态与比赛条件", "最近4至8周跑量和关键训练", "最近的3000米或5000米测试及恢复情况"] : baseMissingEvidence
  const nextQuestion = emergency ? "症状现在是否仍在发生？若有运动相关胸痛、晕厥或严重呼吸困难，请立即停止运动并寻求急救，不要等待回复。" : missingEvidence.length ? `请先提供：${missingEvidence[0]}。` : null
  return { intent, safety, safetyReason, knowledge, hypotheses, missingEvidence, nextQuestion, evidenceGap, confidence:"LOW", confidenceReason:"只使用问题文字及少量未独立核验的本地策展卡；未接入个人完整训练历史或已验证文献检索", decisionAuthorization:false, diagnosis:null }
}
