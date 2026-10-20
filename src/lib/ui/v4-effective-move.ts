/**
 * V4 imported plan effective-schedule projection (candidate R1).
 * Original plan400-v4.json and actual event records are immutable.
 * A moved scheduled entry keeps its stable original V4 ID.
 * This module never writes storage or infers a move from matching titles.
 */
import type { ScheduleEntry } from './day-schedule-rules.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/
export const v4ScheduleId = (originDate: string) => `plan400:${originDate}:strength`
export type V4MovedPart = 'run' | 'strength' | 'mixed'
export type V4MoveView = {
  sourceDate: string
  effectiveDate: string
  scheduleId: string
  part: V4MovedPart
  label: string
}
function isDay(v: string): boolean {
  return DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
}
const partOf = (entry: ScheduleEntry): V4MovedPart => entry.trainingType === 'mixed' ? 'mixed' : entry.modality === 'run' ? 'run' : 'strength'
/** Original-date view. An old V4 plan remains visible, but no longer executable there. */
export function v4MovedOut(originDate: string, entries: readonly ScheduleEntry[]): V4MoveView | null {
  if (!isDay(originDate)) return null
  const entry = entries.find(e => e.id === v4ScheduleId(originDate))
  if (!entry || !isDay(entry.date) || entry.date === originDate) return null
  const part = partOf(entry)
  return {
    sourceDate: originDate,
    effectiveDate: entry.date,
    scheduleId: entry.id,
    part,
    label: `${part === 'mixed' ? '整节组合课' : part === 'run' ? '跑步' : '力量'}已调整至 ${entry.date.slice(5)}`,
  }
}
/** New-date view. Show moved entries even if the target day also has a V4 original plan. */
export function v4MovedIn(targetDate: string, entries: readonly ScheduleEntry[]): V4MoveView[] {
  if (!isDay(targetDate)) return []
  return entries.filter(e => e.date === targetDate && /^plan400:\d{4}-\d{2}-\d{2}:strength$/.test(e.id))
    .map(e => ({ sourceDate: e.id.slice(8, 18), effectiveDate: targetDate, scheduleId: e.id, part: partOf(e), label: '' }))
    .filter(e => isDay(e.sourceDate) && e.sourceDate !== targetDate)
    .map(e => ({ ...e, label: `由 ${e.sourceDate.slice(5)} 调整而来` }))
}
/** Prevent ensurePlan400Entry(originalDate) from silently resurrecting an already moved task. */
export function canEnsureV4Original(originDate: string, entries: readonly ScheduleEntry[]): boolean {
  return v4MovedOut(originDate, entries) === null
}
export type MovePreview =
  | { ok: true; entryId: string; from: string; to: string; part: V4MovedPart; targetDayExisting: string[] }
  | { ok: false; reason: 'INVALID_DATE' | 'NO_ENTRY' | 'ACTIVE_OR_DONE' | 'SPLIT_REQUIRED' | 'ALREADY_ON_DATE' | 'CONFLICTED_IDENTITY' }
/** Read-only preview; target-day conflict must be shown before any host-side write. */
export function previewV4Move(entries: readonly ScheduleEntry[], entryId: string, targetDate: string, requestedPart: V4MovedPart): MovePreview {
  if (!isDay(targetDate)) return { ok: false, reason: 'INVALID_DATE' }
  const matches = entries.filter(e => e.id === entryId)
  if (matches.length > 1) return { ok: false, reason: 'CONFLICTED_IDENTITY' }
  const entry = matches[0]
  if (!entry || !/^plan400:\d{4}-\d{2}-\d{2}:strength$/.test(entryId)) return { ok: false, reason: 'NO_ENTRY' }
  if (entry.actual || entry.status === 'done' || entry.status === 'skipped' || entry.status === 'rejected') return { ok: false, reason: 'ACTIVE_OR_DONE' }
  if (entry.date === targetDate) return { ok: false, reason: 'ALREADY_ON_DATE' }
  const actualPart = partOf(entry)
  if (actualPart !== requestedPart) return { ok: false, reason: 'SPLIT_REQUIRED' }
  return { ok: true, entryId, from: entry.date, to: targetDate, part: actualPart,
    targetDayExisting: entries.filter(e => e.date === targetDate && e.id !== entryId && e.status !== 'rejected').map(e => e.id) }
}
/** Pure rehearsal only: host must persist via its versioned transaction after explicit user confirmation. */
export function rehearseV4Move(entries: readonly ScheduleEntry[], preview: Extract<MovePreview, {ok: true}>): ScheduleEntry[] {
  return entries.map(e => e.id === preview.entryId && e.date === preview.from
    ? { ...e, date: preview.to, movedFrom: e.movedFrom ?? preview.from }
    : e)
}
