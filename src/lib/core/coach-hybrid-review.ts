import type { CoachPlanCandidate, PlanningContext } from './coach-plan.ts'

export type HybridReview = {
  primary: 'RUNNING' | 'STRENGTH' | 'UNSPECIFIED'; maintenance: 'STRENGTH' | 'RUNNING' | 'UNSPECIFIED'
  observations: string[]; questions: string[]
  options: { kind: 'KEEP' | 'REVIEW_PLACEMENT'; days: number[]; explanation: string }[]
  decisionAuthorization: false; writes: 0
}
/** Scheduling observations, not a physiological recovery timer or new training-dose rule. */
export function reviewHybridWeek(candidate: CoachPlanCandidate, context?: Pick<PlanningContext, 'goal' | 'pain' | 'rehab'>): HybridReview {
  const week = candidate.firstWeek
  const run = week.filter(s => s.type === 'QUALITY_RUN' || s.type === 'LONG_RUN')
  const strength = week.filter(s => s.type === 'STRENGTH')
  const primary = context?.goal.distanceMeters != null ? 'RUNNING' as const : 'UNSPECIFIED' as const
  const observations: string[] = [], questions: string[] = [], options: HybridReview['options'] = []
  if (run.length && strength.length) {
    observations.push('本周同时包含关键跑课与力量课；先核对主要目标及力量训练涉及的部位。')
    for (const a of run) for (const b of strength) if (Math.abs(a.day - b.day) <= 1) {
      observations.push(`第 ${a.day} 天关键跑课与第 ${b.day} 天力量课安排相近；这里只描述日程，不判定恢复不足。`)
      options.push({ kind: 'REVIEW_PLACEMENT', days: [...new Set([a.day, b.day])], explanation: '若力量课明显使用下肢或影响关键课表现，可讨论错开或降低要求；若以上肢为主且反馈稳定，可保留并观察。具体改动仍需核对可用日期。' })
    }
    questions.push('这周期优先改善跑步还是力量，另一项希望维持到什么程度？', '相邻力量课的主要动作、实际感受，以及还有哪些未进入计划的运动？')
  } else observations.push('当前候选没有同时包含关键跑课与力量课，暂不推断两者的安排冲突。')
  if (!options.length) options.push({ kind: 'KEEP', days: [], explanation: '未发现需要提出位置核对的相邻组合；这不等于已经确认恢复充分。' })
  if (context?.pain || context?.rehab) { options.length = 0; questions.unshift('已有疼痛或康复限制，先沿用现有安全复核流程，不用调课代替评估。') }
  return { primary, maintenance: primary === 'RUNNING' && strength.length ? 'STRENGTH' : 'UNSPECIFIED', observations, questions, options, decisionAuthorization: false, writes: 0 }
}
