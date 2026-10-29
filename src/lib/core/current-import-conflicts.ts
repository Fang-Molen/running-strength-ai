import { currentAthleteId } from './events'
import { currentStore } from './storage'
import type { ConfirmedTrainingImport } from './training-import'
import { garminViewKey } from '../health/garmin-view-scope'

export type CurrentImportConflict = {
  occurrenceId: string
  duration: boolean
  distance: boolean
  observedAt: string
  cacheKnownAt: null
  usableAsHistoricalEvidence: false
  note: string
}
const known = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const differs = (a: unknown, b: unknown) => known(a) && known(b) && Math.round(a * 100) !== Math.round(b * 100)

/** Present-time uncertainty only: the view cache has no reliable commit time.
 * Callers supply already-visible imports; cache values never replace their
 * history, become dated observations, or leave this helper as numeric facts. */
export function readCurrentImportConflicts(records: readonly ConfirmedTrainingImport[]): Map<string, CurrentImportConflict> {
  const conflicts = new Map<string, CurrentImportConflict>(), owner = currentAthleteId()
  let cache: Record<string, unknown>[]
  try {
    const raw: unknown = JSON.parse(currentStore()?.getItem(garminViewKey('fk-garmin-acts-v1')) ?? '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return conflicts
    cache = Object.values(raw).filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row) &&
      ((row as { athleteId?: unknown }).athleteId ?? 'local') === owner)
  } catch { return conflicts }
  const observedAt = new Date().toISOString()
  for (const record of records) {
    if ((record.athleteId ?? 'local') !== owner || !record.sourceRecordIdentity) continue
    const same = cache.filter(row => row.sourceIdentity === record.sourceRecordIdentity)
    const duration = record.durationSeconds.status === 'RECORDED' && same.some(row => differs(record.durationSeconds.value, row.dur))
    const distance = record.totalDistanceMeters.status === 'RECORDED' && same.some(row => differs(record.totalDistanceMeters.value, row.dist))
    if (duration || distance) conflicts.set(record.confirmedImportId, { occurrenceId: record.confirmedImportId, duration, distance, observedAt,
      cacheKnownAt: null, usableAsHistoricalEvidence: false,
      note: '当前同一活动的手表缓存与已确认导入总量存在冲突；缓存录入时间未知，不作为历史事实，相关总量待核对。' })
  }
  return conflicts
}
