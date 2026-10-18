import type { EvolutionSnapshot } from './coach-evolution-v4.ts'
import type { OriginalPlanSnapshot } from './canonical.ts'
import { strictIso } from './coach-v4-c11-adapter.ts'

export type StrengthExecutionReview = {
  occurrenceId: string; targetSnapshotId: string | null
  sets: { moveId: string; setIndex: number; actualKg: number | null; actualAmount: number | null; targetKg: number; targetAmount: number; status: 'RECORDED_TARGET_MET' | 'RECORDED_BELOW_TARGET' | 'UNKNOWN'; sourceIds: string[] }[]
  status: 'NO_HISTORICAL_TARGET' | 'INCOMPLETE' | 'TARGET_RECORDED' | 'REVIEW_EXECUTION'
  candidate: { decision: 'HOLD'; changedVariable: null; reason: string; automaticProgression: false }
  decisionAuthorization: false; writes: 0
}
/** Only the occurrence's immutable start snapshot is a target. Today's plan is never a fallback. */
export function reviewStrengthExecution(snapshot: EvolutionSnapshot, occurrenceId: string, target: OriginalPlanSnapshot | null, startedAt: string | null): StrengthExecutionReview {
  const rows = snapshot.active.filter(e => e.athleteId === snapshot.athleteId && e.occurrenceId === occurrenceId && e.source !== 'PLAN' && e.source !== 'THIRD_PARTY')
  const usable = target && startedAt && strictIso(startedAt) && strictIso(target.capturedAt) && Date.parse(target.capturedAt) <= Date.parse(startedAt) && Date.parse(startedAt) <= Date.parse(snapshot.asOf)
  const sets: StrengthExecutionReview['sets'] = []
  if (usable) for (const set of target.sets) {
    const protocol = `strength:${encodeURIComponent(set.moveId)}:${set.setIndex}`
    const amount = rows.filter(e => e.context === protocol && e.metric === (set.mode === 'reps' ? 'STRENGTH_REPS' : 'STRENGTH_SECONDS'))
    const weight = rows.filter(e => e.context === protocol && e.metric === 'STRENGTH_KG')
    const known = amount.length === 1 && weight.length === 1 && [...amount, ...weight].every(e => e.value !== null && e.confirmation === 'CONFIRMED') &&
      target.sets.filter(s => s.moveId === set.moveId && s.setIndex === set.setIndex).length === 1 &&
      Number.isFinite(set.weightKg) && set.weightKg >= 0 && Number.isFinite(set.amount) && set.amount > 0 && !snapshot.quarantined.length && !snapshot.scopeConflictCount
    sets.push({ moveId: set.moveId, setIndex: set.setIndex, actualKg: known ? weight[0].value : null, actualAmount: known ? amount[0].value : null,
      targetKg: set.weightKg, targetAmount: set.amount, status: !known ? 'UNKNOWN' : weight[0].value! >= set.weightKg && amount[0].value! >= set.amount ? 'RECORDED_TARGET_MET' : 'RECORDED_BELOW_TARGET', sourceIds: known ? [...amount, ...weight].map(e => e.sourceId) : [] })
  }
  const status = !usable || !sets.length ? 'NO_HISTORICAL_TARGET' : sets.some(s => s.status === 'UNKNOWN') ? 'INCOMPLETE' : sets.every(s => s.status === 'RECORDED_TARGET_MET') ? 'TARGET_RECORDED' : 'REVIEW_EXECUTION'
  const reason = status === 'NO_HISTORICAL_TARGET' ? '没有这次训练当时的处方快照，不能拿当前计划追判过去表现。' : status === 'INCOMPLETE' ? '部分工作组缺少有效实际值；未记录不等于失败，也不能算全部达标。' : status === 'TARGET_RECORDED' ? '已记录工作组达到当时重量与次数要求；动作质量、余量和当前恢复仍需核对，不据此自动加重量。' : '部分已记录工作组未达到当时目标；先核对动作标准、临时调整和实际原因，不直接归因于能力不足。'
  return { occurrenceId, targetSnapshotId: usable ? target.snapshotId : null, sets, status, candidate: { decision: 'HOLD', changedVariable: null, reason, automaticProgression: false }, decisionAuthorization: false, writes: 0 }
}
