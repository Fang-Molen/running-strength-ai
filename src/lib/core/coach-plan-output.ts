import type { PlanningContext } from "./coach-plan.ts"

export function coachPlanOutputContract(context: PlanningContext): string {
  const nearRace = context.daysToCompetition != null && context.daysToCompetition >= 0 && context.daysToCompetition <= 28
  return [
    "输出紧凑完整的 schema JSON：阶段最多4个，firstWeek只列实际安排的训练日，不重复抄写休息日；总天数仍服从可用时间。",
    "阶段目的、每课解释各用一句短句；prescription概括，细节放结构字段，避免同一处方重复三次。安全条件、来源、热身冷身、组次余力休息都不能省略。",
    "恢复AVAILABLE表示本次填写了一条记录，不能说已恢复或无痛；两条待核对不能平均或代选。",
    "力量用LEAVE_3_REPS、LEAVE_2_REPS或受控技术动作说明余力，停止条件明确，不安排做到失败。",
    ...(nearRace ? ["赛前28天内整个候选的每个阶段只能HOLD、DELOAD或TAPER，不得把BUILD藏到第二阶段。赛后进阶需要重新核对，不在本次候选预先承诺。"] : []),
  ].join("\n")
}
