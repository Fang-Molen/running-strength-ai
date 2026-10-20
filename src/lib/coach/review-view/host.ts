/** 复盘选课的数据读取（只读，区块 review-view 入口之一）：把已绑定训练变成可读的选项。不写任何存储。 */
import type { Plan } from '@/lib/strength/model'
import { listBoundTrainings, formatTrainingWhen } from '../../core/coach-compare.ts'
import { coachImports } from '../../core/coach-import-evidence.ts'
import type { ConfirmedTrainingImport } from '../../core/training-import.ts'
import { loadEvents } from '../../core/events.ts'
import { projectRunningExecution } from '../../core/running-execution.ts'
import { getRunningPlanSnapshot } from '../../core/running-plan.ts'
import { trainingSummary } from '../../core/training-summary.ts'
import { runningActualTotals } from '../../ui/running-actual-totals.ts'
import { describeSession, sortNewestFirst, type ReviewSessionSummary } from './session-option.ts'
import type { PlannedRepeats } from './plain-review.ts'

export type ReviewSessionOption = { id: string; startedAt: string; label: string; summary: ReviewSessionSummary }
const rec = <T,>(f: { status: string; value: T | null } | undefined): T | null => f && f.status === 'RECORDED' ? f.value : null

function sameDistanceRepeats(rows: { distanceM: number | null; sec: number | null }[]): ReviewSessionSummary['repeats'] {
  if (rows.length < 2) return null
  const d = rows[0].distanceM
  if (d === null || rows.some(r => r.distanceM !== d)) return null
  return { count: rows.length, distanceM: d, workSec: rows.every(r => r.sec !== null) ? rows.reduce((n, r) => n + r.sec!, 0) : null }
}

export function summaryFromImport(r: ConfirmedTrainingImport): ReviewSessionSummary {
  const reps = r.runningSegments.filter(s => s.kind === 'REPETITION' && s.completion === 'COMPLETED')
  const repeats = sameDistanceRepeats(reps.map(s => ({ distanceM: rec(s.distanceMeters), sec: rec(s.durationSeconds) })))
  const sets = r.strengthSets.filter(s => s.completion === 'COMPLETED').length
  const kind: ReviewSessionSummary['kind'] = r.sport === 'STRENGTH' ? 'STRENGTH' : r.sport === 'MIXED' ? 'MIXED' : r.sport === 'RUNNING' ? (reps.length >= 2 ? 'RUN_REPEATS' : 'RUN') : 'OTHER'
  return { id: r.confirmedImportId, startedAt: r.occurredAt.value!, kind, title: rec(r.title), planName: null, distanceM: rec(r.totalDistanceMeters), durationSec: rec(r.durationSeconds), repeats, strengthSets: sets || null }
}

function summaryFromNative(id: string, startedAt: string, sessionId: string, plan: Plan, events: ReturnType<typeof loadEvents>): ReviewSessionSummary {
  const planName = plan.sessions.find(s => s.id === sessionId)?.name ?? null
  const snapshot = getRunningPlanSnapshot(id)
  const running = snapshot?.components.some(c => c.modality === 'RUNNING') ?? false
  const strength = snapshot?.components.some(c => c.modality === 'STRENGTH') ?? !running
  if (running) {
    const view = projectRunningExecution(id, events), totals = runningActualTotals(view)
    const done = view.repetitions.filter(s => s.status === 'COMPLETED')
    const repeats = sameDistanceRepeats(done.map(s => ({ distanceM: s.actualDistanceMeters, sec: s.actualDurationSeconds })))
    return { id, startedAt, kind: strength ? 'MIXED' : view.repetitions.length >= 2 ? 'RUN_REPEATS' : 'RUN', planName, distanceM: totals.distanceM, durationSec: totals.durationSec, repeats }
  }
  const sets = trainingSummary([id]).completedSetCount
  return { id, startedAt, kind: 'STRENGTH', planName, strengthSets: sets }
}

/** 已绑定训练 → 选项（新的在前）。读取失败的单条退回“日期 · 训练”，不影响其他条。 */
export function listReviewSessions(plan: Plan): ReviewSessionOption[] {
  const bound = listBoundTrainings()
  const imports = new Map(coachImports().map(r => [r.confirmedImportId, r]))
  let events: ReturnType<typeof loadEvents> | null = null
  const rows = bound.map(b => {
    let summary: ReviewSessionSummary
    try {
      const imp = imports.get(b.trainingOccurrenceId)
      summary = imp ? summaryFromImport(imp) : summaryFromNative(b.trainingOccurrenceId, b.startedAt, b.sessionId, plan, events ??= loadEvents())
    } catch { summary = { id: b.trainingOccurrenceId, startedAt: b.startedAt, kind: 'OTHER' } }
    return { id: b.trainingOccurrenceId, startedAt: b.startedAt, summary, label: describeSession(summary, formatTrainingWhen(b.startedAt)) }
  })
  return sortNewestFirst(rows)
}

/** 原计划里的重复跑结构（只认单一距离的重复段）；没有计划快照就返回 null。 */
export function plannedRepeatsFor(occurrenceId: string | null): PlannedRepeats | null {
  if (!occurrenceId) return null
  const snap = getRunningPlanSnapshot(occurrenceId)
  const steps = snap?.components.flatMap(c => c.modality === 'RUNNING' && c.structure.kind === 'REPEATED' ? c.structure.blocks.flatMap(b => b.steps.map(s => ({ ...s, rounds: b.roundCount }))) : []) ?? []
  if (steps.length !== 1 || steps[0].plannedDistanceMeters === null) return null
  const s = steps[0]
  return { count: s.repeatCount * s.rounds, distanceM: s.plannedDistanceMeters!, targetSec: s.plannedDurationSeconds, restSec: s.recoveryAfterRepeatSeconds }
}
