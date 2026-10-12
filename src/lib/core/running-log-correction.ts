/** Audit-only corrections for an unambiguously bound running repetition.
 * Does not mutate original events, running execution, AthleteState or Decision.
 */
import { appendCorrection, listCorrections } from './training-correction.ts'
import type { RunningRepetitionSlot } from './running-execution.ts'

export type RunningLogMetric = 'distance' | 'duration'
export function runningCorrectionKey(slot: RunningRepetitionSlot): string | null {
  return slot.status === 'COMPLETED' && slot.sourceEventIds.length === 1 ? `run-event:${slot.sourceEventIds[0]}` : null
}
export function correctedRunningMetric(slot: RunningRepetitionSlot, metric: RunningLogMetric): { value: number | null; corrected: boolean } {
  const original = metric === 'distance' ? slot.actualDistanceMeters : slot.actualDurationSeconds
  const key = runningCorrectionKey(slot)
  if (!key) return { value: original, corrected: false }
  const corrections = listCorrections(slot.trainingOccurrenceId).filter(row => row.kind === 'FIELD' && row.setKey === key && row.field === metric)
  const latest = corrections.at(-1)
  if (!latest) return { value: original, corrected: false }
  const number = Number(latest.newValue)
  return Number.isFinite(number) && number > 0 ? { value: number, corrected: true } : { value: original, corrected: false }
}
export function correctRunningMetric(slot: RunningRepetitionSlot, metric: RunningLogMetric, value: number, reason: string): boolean {
  const key = runningCorrectionKey(slot)
  if (!key || !Number.isFinite(value) || value <= 0 || !reason.trim()) return false
  const previous = correctedRunningMetric(slot, metric).value
  return appendCorrection({ trainingOccurrenceId: slot.trainingOccurrenceId, kind: 'FIELD', field: metric, setKey: key, originalValue: previous == null ? '' : String(previous), newValue: String(value), reason }) !== null
}
