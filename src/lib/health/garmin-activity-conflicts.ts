import { currentAthleteId } from '../core/events'
import { currentStore } from '../core/storage'
import { coachImports } from '../core/coach-import-evidence'
import { normalizedDeviceActivityTotals } from '../ui/device-activity-totals'

/** Recheck stored source differences without another network request. The raw
 * activity view is evidence of what the source said, never a completed import.
 * Base confirmed records remain authoritative; manual corrections stay separate. */
export function readGarminActivityConflicts(accountScope: string, subjectId: string): string[] {
  if (!accountScope || !subjectId || currentAthleteId() !== subjectId) return []
  const store = currentStore()
  if (!store) return []
  const raw = store.getItem(`fk-garmin-acts-v1:${encodeURIComponent(subjectId)}:${accountScope}`)
  if (!raw) return []
  const view: unknown = JSON.parse(raw)
  if (!view || typeof view !== 'object' || Array.isArray(view)) throw new Error('活动核对记录无法读取')
  const byIdentity = new Map<string, ReturnType<typeof coachImports>[number]>()
  for (const record of coachImports()) if (record.sourceRecordIdentity && !byIdentity.has(record.sourceRecordIdentity)) byIdentity.set(record.sourceRecordIdentity, record)
  const conflicts = new Set<string>()
  for (const entry of Object.values(view)) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as { sourceIdentity?: unknown; dur?: unknown; dist?: unknown }
    if (typeof source.sourceIdentity !== 'string') continue
    const previous = byIdentity.get(source.sourceIdentity)
    if (!previous) continue
    if (!(source.dur === null || typeof source.dur === 'number' && Number.isFinite(source.dur)) || !(source.dist === null || typeof source.dist === 'number' && Number.isFinite(source.dist))) continue
    const totals = normalizedDeviceActivityTotals(source.dur, source.dist)
    if (previous.durationSeconds.value !== totals.durationSec || previous.totalDistanceMeters.value !== totals.distanceM) conflicts.add(source.sourceIdentity)
  }
  return [...conflicts]
}
