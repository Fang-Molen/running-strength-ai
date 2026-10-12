// Curated general knowledge. This is never occurrence-bound athlete evidence.
export const COACH_KNOWLEDGE_VERSION = "2026-10-08.19" as const
export type KnowledgeMode = "PLAN" | "REVIEW"
export type CoachingBackground = {
  sex: "UNKNOWN" | "FEMALE" | "MALE"
  support: "NONE" | "RACE_NERVES" | "CONFIDENCE" | "CONSISTENCY"
}
export type CoachKnowledgeCard = {
  id: string
  title: string
  principle: string
  limit: string
  sourceTitle: string
  url: string
  population: string
  reviewedAt: string
}
const acsm = {
  sourceTitle: "ACSM Resistance Training Position Stand (2026)",
  url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/",
  population: "健康成年人的阻力训练；不作为伤病、孕产期或未成年人的直接处方",
}
const menstrual = {
  sourceTitle: "Australian Sports Commission — The menstrual cycle",
  url: "https://www.ausport.gov.au/clearinghouse/evidence/women-in-sport/factors/menstrual-cycle",
  population: "女性运动参与与月经相关研究；个体与研究间存在差异",
}
const mental = {
  sourceTitle: "IOC Mental Health in Elite Athletes Toolkit (2021), sections 3.2 and 4.1",
  url: "https://img.olympics.com/images/image/private/w_auto/primary/uebomv9r2ebqu0qepcsb",
  population: "精英运动员及其支持团队；普通训练者的应用需谨慎",
}
export const COACH_KNOWLEDGE: readonly CoachKnowledgeCard[] = [
  { id: "knowledge:strength", title: "力量训练与保留余力", ...acsm,
    principle: "健康成人的力量训练不必每组做到力竭才有收益。按目标、经验和动作质量安排训练。",
    limit: "研究结论不是个人最大重量、具体组次或恢复时长的来源；原有余力与停止条件合同优先。", reviewedAt: "2026-10-08" },
  { id: "knowledge:specificity", title: "专项刺激与个体化", ...acsm,
    principle: "训练应考虑专项目标和可持续参与。单次表现不能代替长期适应证据。",
    limit: "不能从一次短距离成绩推出长距离能力、阈值配速或必然进步；具体处方仍需个人可靠来源。", reviewedAt: "2026-10-08" },
  { id: "knowledge:load", title: "训练与生活负担", sourceTitle: "IOC consensus — How much is too much? Part 1 (2016)", url: "https://pubmed.ncbi.nlm.nih.gov/27535989/", population: "运动员负荷管理与伤病研究",
    principle: "训练、比赛及心理负担需要结合身心状态观察；恢复和近期变化应一起核对。",
    limit: "不制造负荷分、疲劳分、个人伤病概率或固定安全增量；相关性不能说明个人掉速的原因。", reviewedAt: "2026-10-08" },
  { id: "knowledge:energy", title: "能量可用性", sourceTitle: "IOC consensus on Relative Energy Deficiency in Sport (2023)", url: "https://pubmed.ncbi.nlm.nih.gov/37752011/", population: "男女运动员；REDs 的临床评估由专业人员完成",
    principle: "有问题的低能量可用性可能涉及男女运动员的健康与表现，需要多方面评估。",
    limit: "部分饮食记录不等于全天摄入，也不能单凭热量差诊断 REDs、激素异常或解释掉速；先核对记录完整性。", reviewedAt: "2026-10-08" },
  { id: "knowledge:individual", title: "性别与个体生理", ...menstrual,
    principle: "月经相关症状和对训练的影响因人而异，不宜按周期阶段给所有人统一处方。",
    limit: "性别标签不能推断月经、激素、怀孕、力量上限或恢复速度。相关症状可自愿说明，孕产或明显异常需专业个体评估。", reviewedAt: "2026-10-08" },
  { id: "knowledge:sleep", title: "睡眠的持续观察", sourceTitle: "Australian Institute of Sport — I want to track my sleep", url: "https://www.ausport.gov.au/ais/gmr/mental_performance_in_competition/science/wearables/scenario/i-want-to-track-my-sleep", population: "运动员睡眠记录与可穿戴设备使用",
    principle: "观察持续且有意义的睡眠变化，并核对设备记录是否准确。",
    limit: "一晚睡眠不能诊断睡眠障碍或证明掉速原因；缺失不代表正常，穿戴分数不能等同医学恢复许可。", reviewedAt: "2026-10-08" },
  { id: "knowledge:psychology", title: "支持式执教", ...mental,
    principle: "教练应倾听、尊重、支持求助并减少污名。表现波动不等于意志薄弱。",
    limit: "训练支持不是心理诊断或治疗；不能从成绩推断焦虑、抑郁或懒惰。持续困扰或影响日常功能时建议专业支持。", reviewedAt: "2026-10-08" },
] as const

export function sanitizeCoachingBackground(raw: unknown): CoachingBackground {
  if (raw == null) return { sex: "UNKNOWN", support: "NONE" }
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid coaching background")
  const input = raw as Partial<CoachingBackground>
  if (!["UNKNOWN", "FEMALE", "MALE"].includes(input.sex ?? "") || !["NONE", "RACE_NERVES", "CONFIDENCE", "CONSISTENCY"].includes(input.support ?? "")) throw new Error("invalid coaching background")
  // Explicit whitelist: no symptom, score, clearance or instruction can be smuggled in.
  return { sex: input.sex!, support: input.support! }
}

export function profileSexLabel(raw: unknown): string {
  return raw === "female" ? "女" : raw === "male" ? "男" : "性别未填写"
}

// Fixed route-level selection is an auditable knowledge policy, not an NLP agent.
export function selectCoachKnowledge(mode: KnowledgeMode): readonly CoachKnowledgeCard[] {
  const selected = mode === "PLAN" ? ["strength", "specificity", "individual", "psychology", "load"] : ["strength", "load", "energy", "sleep", "individual", "psychology"]
  return selected.map((id) => COACH_KNOWLEDGE.find((card) => card.id === `knowledge:${id}`)!)
}

export function coachKnowledgePrompt(mode: KnowledgeMode, rawBackground?: unknown): string {
  const background = sanitizeCoachingBackground(rawBackground)
  const support: Record<CoachingBackground["support"], string> = {
    NONE: "未主动提出心理支持需求，不推断情绪。",
    RACE_NERVES: "用户希望支持赛前紧张：尊重感受，可提出一个可控的准备步骤；不诊断焦虑，不保证比赛结果。",
    CONFIDENCE: "用户希望支持训练信心：讨论可核对的完成事实与下一步，不用单次快慢评价人格或天赋。",
    CONSISTENCY: "用户希望支持训练习惯：尊重现实时间，提出可选择的小步骤；不使用羞辱或惩罚性加练。",
  }
  return [
    `一般执教知识 ${COACH_KNOWLEDGE_VERSION}（GENERAL_KNOWLEDGE，不是个人 FACT）：`,
    "优先级：冻结安全合同 > 可靠个人证据 > 一般知识。知识不能填补 UNKNOWN、绑定训练或成为定量处方的 citations。所有 citations 仍只能用输入个人 sources。",
    ...selectCoachKnowledge(mode).map((card) => `${card.id}：${card.principle} 边界：${card.limit}`),
    "以上含研究归纳与本产品应用限制，不代表专业人士已审核此人的处方。可解释一般原理，但不得据此断言个人因果。",
    `自愿资料背景 sex=${background.sex}；不作为训练成绩、症状或定量处方证据。不能按男女固定比例增减训练，也不能按日历猜月经阶段。`,
    `心理支持偏好（不是症状或诊断）：${support[background.support]} 只能在现有解释字段中简短体现，不新增课表、不写入分数。`,
  ].join("\n")
}
