/** BUILD 37: opt-in preview-only authorization gate. Pure function; no persistence. */
import { proposeCoachPlanChange, type CoachPlanProposalInput } from './coach-plan-governance.ts'
export type PreviewPermission = { previewMode: boolean; ownerApprovedUnlock: boolean; athleteConfirmed: boolean; confirmationProposalId: string | null; originalPlanPreserved: boolean; originalPlanRevision: number; planChangeKind: 'TODAY' | 'NEAR_TERM' | 'CYCLE'; medicalReviewRequired: boolean }
export type PreviewGateResult = { allowed: boolean; reason: string; proposalId: string; expectedRevision: number }
export function authorizePreviewPlanEdit(input: CoachPlanProposalInput, permission: PreviewPermission): PreviewGateResult {
  const proposal = proposeCoachPlanChange(input)
  const deny = (reason: string): PreviewGateResult => ({allowed:false, reason, proposalId:proposal.proposalId, expectedRevision:proposal.expectedRevision})
  if (!permission.previewMode || !permission.ownerApprovedUnlock) return deny('仅独立预览副本可在所有者授权后解锁')
  if (!permission.originalPlanPreserved) return deny('必须保留不可变原计划快照及审计记录')
  if (permission.originalPlanRevision !== input.actualRevision) return deny('计划版本已变化，必须重新确认')
  if (proposal.status !== 'AWAIT_USER_CONFIRMATION') return deny(`提案状态不允许写入：${proposal.status}`)
  if (permission.medicalReviewRequired) return deny('医学风险尚未完成评估')
  if (permission.planChangeKind === 'CYCLE') return deny('整周期改写仍须单独审查')
  if (input.proposedAction === 'INCREASE') return deny('自动加量仍冻结，需独立负荷审核')
  if (!permission.athleteConfirmed || permission.confirmationProposalId !== proposal.proposalId) return deny('用户必须针对当前提案明确确认')
  return {allowed:true, reason:'仅授权当前预览提案进入事务写入层；写入前仍须校验最新版本', proposalId:proposal.proposalId, expectedRevision:proposal.expectedRevision}
}
