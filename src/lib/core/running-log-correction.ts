/** Audit-only corrections for an unambiguously bound running repetition.
 * Does not mutate original events, running execution, AthleteState or Decision.
 */
import { appendCorrection, listCorrections } from './training-correction.ts'
import type { RunningRepetitionSlot } from './running-execution.ts'
import type { FormalEvidenceRow } from './coach-v4-c11-adapter.ts'
import { runningSlotKey } from './coach-v4-formal-rows.ts'
import { strictIso } from './coach-v4-c11-adapter.ts'

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

/** Read-only coach view. Original events and execution projections remain intact.
 * Once an applicable correction exists, only the formal, uniquely active row
 * may provide actual values. Unmapped edits cannot silently fall back to raw values.
 */
export function effectiveRunningRepetition(slot: RunningRepetitionSlot, rows: readonly FormalEvidenceRow[], asOf: string): RunningRepetitionSlot {
  const affected=listCorrections(slot.trainingOccurrenceId).some(c=>c.kind==='FIELD'&&(c.field==='duration'||c.field==='distance')&&(!c.recordedAt||!strictIso(c.recordedAt)||Date.parse(c.recordedAt)<=Date.parse(asOf)))
  if(!affected||slot.status!=='COMPLETED')return slot
  const superseded=new Set(rows.map(r=>r.supersedesRecordId).filter(Boolean))
  const base=`running:${slot.componentId}:${runningSlotKey(slot)}`
  const active=rows.filter(r=>r.trainingOccurrenceId===slot.trainingOccurrenceId&&r.metric==='SPLIT_SECONDS'&&r.status==='OBSERVED'&&!superseded.has(r.recordId)&&Date.parse(r.knownAt)<=Date.parse(asOf)&&(r.protocol===base||r.protocol?.startsWith(`${base}:`)))
  const row=active.length===1?active[0]:null
  const suffix=row?.protocol?.slice(base.length).match(/^:(\d+(?:\.\d+)?)m$/)
  const distance=suffix?Number(suffix[1]):null,seconds=row?.value??null
  const source=row?.sourceEventId??null
  return {...slot,actualDistanceMeters:distance,actualDurationSeconds:seconds,sourceEventIds:source?[source]:[],derivedPaceSecPerMeter:distance&&seconds?seconds/distance:null,paceDistanceSourceEventId:distance?source:null,paceDurationSourceEventId:seconds?source:null}
}
