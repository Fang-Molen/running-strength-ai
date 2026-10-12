/** BUILD 30: proposal-only coach governance. Does not mutate plans or diagnose injury. */
import { arbitratePlanChange, type PlanChangeRequest } from './adaptive-plan-permissions.ts'

export type CoachPlanProposalInput = PlanChangeRequest & {
  session?: { repeats: number; distanceMeters: number; intensity: 'EASY' | 'MODERATE' | 'HARD' | 'UNKNOWN' }
  injurySignals?: { painDuringRunning: boolean; focalBonePain: boolean; alteredGait: boolean }
  userRequestedChange: boolean
  planId: string
}
export type CoachPlanProposal = {
  kind: 'PLAN_CHANGE_PROPOSAL'
  proposalId: string
  planId: string
  status: 'BLOCK_FOR_SAFETY' | 'CLARIFY_EXTREME_SESSION' | 'AWAIT_USER_CONFIRMATION' | 'REPLAN_REVIEW' | 'REJECT_CONFLICT'
  requiresUserConfirmation: true
  canApplyAutomatically: false
  plannedFastMeters: number | null
  rationale: string
  evidenceIds: string[]
  expectedRevision: number
}
export function proposeCoachPlanChange(input: CoachPlanProposalInput): CoachPlanProposal {
  if (!input.planId.trim()) throw new Error('missing plan ID')
  const permission = arbitratePlanChange(input)
  const session = input.session
  if (session && (!Number.isInteger(session.repeats) || session.repeats < 1 || !Number.isFinite(session.distanceMeters) || session.distanceMeters <= 0)) throw new Error('invalid session')
  const plannedFastMeters = session ? session.repeats * session.distanceMeters : null
  if (plannedFastMeters !== null && !Number.isFinite(plannedFastMeters)) throw new Error('invalid volume')
  const safety = input.injurySignals
  const highRisk = !!(safety?.focalBonePain || safety?.alteredGait || safety?.painDuringRunning && (session?.intensity === 'HARD' || input.nextSessionIntensity === 'HARD'))
  let status: CoachPlanProposal['status']
  let rationale: string
  if (permission.status === 'REJECT_CONFLICT') { status = 'REJECT_CONFLICT'; rationale = permission.explanation }
  else if (highRisk || permission.status === 'SAFETY_REVIEW') { status = 'BLOCK_FOR_SAFETY'; rationale = '存在疼痛或功能风险：暂停高风险训练建议，必要时寻求运动医学评估。用户确认不能解除安全拦截。' }
  else if (session && session.intensity !== 'EASY' && plannedFastMeters !== null && plannedFastMeters >= 20000) { status = 'CLARIFY_EXTREME_SESSION'; rationale = `该课包含${plannedFastMeters}米重复跑，请先确认是否输入错误、训练目的和承受能力；不得直接执行或自动安排。` }
  else if (permission.status === 'REPLAN_REVIEW') { status = 'REPLAN_REVIEW'; rationale = permission.explanation }
  else { status = 'AWAIT_USER_CONFIRMATION'; rationale = '保留原周期计划；修改必须展示前后差异、依据及影响，并由用户确认。' }
  return { kind: 'PLAN_CHANGE_PROPOSAL', proposalId: `proposal:${input.planId}:${input.expectedRevision}`, planId: input.planId, status, requiresUserConfirmation: true, canApplyAutomatically: false, plannedFastMeters, rationale, evidenceIds: [...new Set(input.evidenceIds)], expectedRevision: input.expectedRevision }
}
