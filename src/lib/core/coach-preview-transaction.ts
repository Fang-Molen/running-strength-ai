/** BUILD 38: preview-only plan transaction. No browser storage or production mutation. */
import { authorizePreviewPlanEdit, type PreviewPermission } from './coach-permission-gate.ts'
import type { CoachPlanProposalInput } from './coach-plan-governance.ts'

export type PreviewPlan = { id: string; revision: number; session: { repeats: number; distanceMeters: number; intensity: 'EASY' | 'MODERATE' | 'HARD' | 'UNKNOWN' }; completed: boolean }
export type PreviewAudit = { id: string; planId: string; proposalId: string; before: PreviewPlan; after: PreviewPlan; action: 'APPLY' | 'ROLLBACK'; timestamp: string }
export type PreviewState = { plans: Record<string, PreviewPlan>; audit: PreviewAudit[] }
export type PreviewResult = { ok: true; state: PreviewState; audit: PreviewAudit } | { ok: false; reason: string; state: PreviewState }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const fail = (state: PreviewState, reason: string): PreviewResult => ({ ok: false, reason, state })
export function applyPreviewPlanChange(state: PreviewState, input: CoachPlanProposalInput, permission: PreviewPermission, replacement: PreviewPlan['session'], timestamp: string): PreviewResult {
  const gate = authorizePreviewPlanEdit(input, permission)
  if (!gate.allowed) return fail(state, gate.reason)
  const current = state.plans[input.planId]
  if (!current || current.completed) return fail(state, '计划不存在或已完成，不允许修改历史训练')
  if (current.revision !== gate.expectedRevision || input.actualRevision !== current.revision) return fail(state, '计划版本冲突，请重新生成提案')
  if (!Number.isInteger(replacement.repeats) || replacement.repeats < 1 || !Number.isFinite(replacement.distanceMeters) || replacement.distanceMeters <= 0) return fail(state, '新训练结构无效')
  if (replacement.intensity !== 'EASY' && replacement.repeats * replacement.distanceMeters >= 20000) return fail(state, '新训练总量异常，不能写入')
  if (input.injurySignals?.focalBonePain || input.injurySignals?.alteredGait || (input.injurySignals?.painDuringRunning && replacement.intensity === 'HARD')) return fail(state, '新训练与疼痛风险冲突')
  if (input.proposedAction === 'INCREASE' || replacement.repeats * replacement.distanceMeters > current.session.repeats * current.session.distanceMeters) return fail(state, '预览阶段不允许增加训练量')
  if (!Number.isFinite(Date.parse(timestamp))) return fail(state, '审计时间无效')
  const before = clone(current)
  const after = { ...clone(current), revision: current.revision + 1, session: clone(replacement) }
  const audit: PreviewAudit = { id: `audit:${input.planId}:${after.revision}`, planId: input.planId, proposalId: gate.proposalId, before, after: clone(after), action: 'APPLY', timestamp }
  return { ok: true, state: { plans: { ...state.plans, [input.planId]: after }, audit: [...state.audit, audit] }, audit }
}
export function rollbackPreviewPlanChange(state: PreviewState, auditId: string, timestamp: string): PreviewResult {
  const record = state.audit.find(a => a.id === auditId && a.action === 'APPLY')
  if (!record) return fail(state, '找不到原始修改记录')
  const current = state.plans[record.planId]
  if (!current || current.completed || current.revision !== record.after.revision) return fail(state, '计划已变化或已完成，禁止覆盖新修改')
  if (!Number.isFinite(Date.parse(timestamp))) return fail(state, '审计时间无效')
  const after: PreviewPlan = { ...clone(record.before), revision: current.revision + 1 }
  const audit: PreviewAudit = { id: `rollback:${record.id}:${after.revision}`, planId: record.planId, proposalId: record.proposalId, before: clone(current), after: clone(after), action: 'ROLLBACK', timestamp }
  return { ok: true, state: { plans: { ...state.plans, [record.planId]: after }, audit: [...state.audit, audit] }, audit }
}
