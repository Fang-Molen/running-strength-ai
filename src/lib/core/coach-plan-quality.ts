import type { CoachPlanCandidate, PlanningContext } from "./coach-plan.ts"

export type CoachQualityDimension = {
  id: "EVIDENCE" | "FEASIBILITY" | "STRESS_DISTRIBUTION" | "RUN_STRENGTH_INTEGRATION" | "PERIODIZATION" | "ADAPTIVENESS" | "ATHLETE_CONTROL"
  score: number
  max: number
  notes: string[]
}

export type CoachPlanQuality = {
  score: number
  pass: boolean
  criticalIssues: string[]
  dimensions: CoachQualityDimension[]
}

const NEGATION_BEFORE = /(?:不要|不得|不可|不能|禁止|避免|别|并非|不是|勿|不到|未到|别到|非|未)$/

export function prescribesStrengthFailure(prescription: string): boolean {
  for (const match of prescription.matchAll(/力竭|做到失败|极限/g)) {
    const index = match.index ?? 0
    const before = prescription.slice(Math.max(0, index - 8), index)
    const after = prescription.slice(index + match[0].length, index + match[0].length + 4)
    if (NEGATION_BEFORE.test(before)) continue
    if (/^前(?:停止|停|结束)/.test(after)) continue
    return true
  }
  return false
}

function dimension(id: CoachQualityDimension["id"], max: number, deductions: { points: number; note: string }[]): CoachQualityDimension {
  return { id, max, score: Math.max(0, max - deductions.reduce((sum, item) => sum + item.points, 0)), notes: deductions.map((item) => item.note) }
}

export function auditCoachPlan(context: PlanningContext, candidate: CoachPlanCandidate): CoachPlanQuality {
  const criticalIssues: string[] = []
  const citedSessions = candidate.firstWeek.filter((item) => item.citations.length > 0).length
  const evidenceDeductions: { points: number; note: string }[] = []
  if (citedSessions !== candidate.firstWeek.length) evidenceDeductions.push({ points: 12, note: "有训练日没有来源" })
  if (candidate.phases.some((item) => item.citations.length === 0)) evidenceDeductions.push({ points: 8, note: "有周期阶段没有来源" })

  const feasibilityDeductions: { points: number; note: string }[] = []
  const training = candidate.firstWeek.filter((item) => item.type !== "REST")
  if (training.length > context.availableDays) { feasibilityDeductions.push({ points: 20, note: "训练天数超过可用时间" }); criticalIssues.push("TOO_MANY_DAYS") }
  if (candidate.firstWeek.some((item) => item.durationMinutes != null && item.durationMinutes > context.minutesPerDay)) { feasibilityDeductions.push({ points: 20, note: "单次训练超过时间上限" }); criticalIssues.push("SESSION_TOO_LONG") }

  const stressDeductions: { points: number; note: string }[] = []
  const hardDays = candidate.firstWeek.filter((item) => item.intensity === "HARD").map((item) => item.day)
  if (hardDays.length > 2) { stressDeductions.push({ points: 20, note: "一周硬课超过两次" }); criticalIssues.push("TOO_MANY_HARD_DAYS") }
  if (hardDays.some((day) => hardDays.includes(day + 1))) { stressDeductions.push({ points: 20, note: "出现连续硬课" }); criticalIssues.push("BACK_TO_BACK_HARD") }
  const occupied = new Set(candidate.firstWeek.filter((item) => item.type !== "REST").map((item) => item.day))
  if (occupied.size === 7 && !candidate.firstWeek.some((item) => item.type === "RECOVERY" || item.type === "REST")) stressDeductions.push({ points: 8, note: "没有恢复或休息日" })
  const highRunDays = candidate.firstWeek.filter((item) => item.type === "QUALITY_RUN" || item.type === "LONG_RUN").map((item) => item.day)
  const strengthDays = candidate.firstWeek.filter((item) => item.type === "STRENGTH").map((item) => item.day)
  if (strengthDays.some((day) => highRunDays.includes(day - 1) || highRunDays.includes(day + 1))) stressDeductions.push({ points: 4, note: "力量与质量跑/长距离相邻，需要解释恢复安排" })

  const integrationDeductions: { points: number; note: string }[] = []
  if (context.strengthDays > 0 && !candidate.firstWeek.some((item) => item.type === "STRENGTH")) integrationDeductions.push({ points: 7, note: "允许力量训练但第一周没有力量安排" })
  if (!candidate.firstWeek.some((item) => item.type === "EASY_RUN")) integrationDeductions.push({ points: 7, note: "第一周没有轻松跑" })
  if (candidate.firstWeek.filter((item) => item.type === "STRENGTH").length > context.strengthDays) { integrationDeductions.push({ points: 15, note: "力量天数超过用户条件" }); criticalIssues.push("TOO_MANY_STRENGTH_DAYS") }
  if (candidate.firstWeek.some((item) => item.type === "STRENGTH" && prescribesStrengthFailure(item.prescription))) { integrationDeductions.push({ points: 10, note: "跑步周期力量课不应默认安排力竭" }); criticalIssues.push("STRENGTH_TO_FAILURE") }

  const periodizationDeductions: { points: number; note: string }[] = []
  if (candidate.horizonWeeks >= 4 && !candidate.phases.some((item) => item.progression === "DELOAD" || item.progression === "TAPER")) periodizationDeductions.push({ points: 10, note: "四周以上周期没有减量或赛前收量阶段" })
  if (context.daysToCompetition != null && context.daysToCompetition <= 28 && !candidate.phases.some((item) => item.progression === "TAPER" || item.progression === "HOLD" || item.progression === "DELOAD")) { periodizationDeductions.push({ points: 15, note: "赛前窗口没有保持或减量" }); criticalIssues.push("RACE_WINDOW_UNSAFE") }
  if (context.daysToCompetition != null && context.daysToCompetition >= 0 && context.daysToCompetition <= 28 && candidate.phases.some((phase) => phase.progression === "BUILD")) { periodizationDeductions.push({ points: 15, note: "赛前候选后续阶段仍安排BUILD，不能预先承诺赛后进阶" }); criticalIssues.push("RACE_WINDOW_BUILD_BLOCKED") }
  if (candidate.phases.reduce((sum, item) => sum + item.weeks, 0) !== candidate.horizonWeeks) { periodizationDeductions.push({ points: 15, note: "阶段周数与总周期不一致" }); criticalIssues.push("PHASE_MISMATCH") }

  const adaptiveDeductions: { points: number; note: string }[] = []
  if (!/(?:RPE|恢复|睡眠|疼痛|完成)/i.test(candidate.progressionRule)) adaptiveDeductions.push({ points: 7, note: "进阶规则没有使用训练反馈" })
  if (!/(?:减量|降低|减少|保持|恢复)/.test(candidate.deloadRule)) adaptiveDeductions.push({ points: 5, note: "减量规则不明确" })
  if (context.recoveryStatus !== "AVAILABLE" && /(?:必须|直接|确定).{0,8}(?:加量|提高|增加)/.test(candidate.progressionRule)) { adaptiveDeductions.push({ points: 12, note: "缺恢复证据却承诺进阶" }); criticalIssues.push("RECOVERY_IGNORED") }

  const controlDeductions: { points: number; note: string }[] = []
  if (candidate.status !== "DRAFT_PENDING_CONFIRMATION" || candidate.acceptanceRequired !== true) { controlDeductions.push({ points: 10, note: "候选计划绕过人工确认" }); criticalIssues.push("USER_CONTROL_MISSING") }

  const dimensions = [
    dimension("EVIDENCE", 15, evidenceDeductions),
    dimension("FEASIBILITY", 15, feasibilityDeductions),
    dimension("STRESS_DISTRIBUTION", 20, stressDeductions),
    dimension("RUN_STRENGTH_INTEGRATION", 15, integrationDeductions),
    dimension("PERIODIZATION", 15, periodizationDeductions),
    dimension("ADAPTIVENESS", 10, adaptiveDeductions),
    dimension("ATHLETE_CONTROL", 10, controlDeductions),
  ]
  const score = dimensions.reduce((sum, item) => sum + item.score, 0)
  return { score, pass: criticalIssues.length === 0 && score >= 78, criticalIssues: [...new Set(criticalIssues)], dimensions }
}

export const COACHING_DOCTRINE = {
  version: "2026-10-08",
  principles: [
    "负荷进阶必须建立在个体历史、恢复和训练反应上，不能靠固定百分比替代证据。",
    "跑步质量课、长距离和力量课需要作为同一周的总刺激协调，避免无解释地堆叠高压力日。",
    "四周以上计划必须说明减量或收量逻辑；赛前窗口优先保持专项强度并降低总量，而不是临时加量。",
    "力量训练是跑步计划的组成部分，但不能自动等于力竭训练，也不能挤占恢复。",
    "疼痛、康复、冲突或缺失恢复证据时，计划必须降级为追问、保持、减量或恢复边界。",
    "所有计划都是候选；运动员始终保留接受、拒绝、修改和 Override 权。",
  ],
  evidenceNotes: [
    "系统综述支持力量训练可改善中长跑运动员的跑步经济性，但具体方法与剂量仍需个体化。",
    "耐力项目收量研究支持赛前降低训练量同时保留一定强度与频率，不能机械套用到每个人。",
    "IOC 负荷共识强调负荷历史、个体差异与持续监测，不支持用单个比值或单次表现下诊断。",
  ],
} as const
