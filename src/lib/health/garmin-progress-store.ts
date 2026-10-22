import { currentStore, type MemoryStore } from '../core/storage'
import { shortHash, validDay } from './observation'
import type { GarminDailyProgress } from './garmin-daily-progress'

const keyFor = (scope: string, subjectId: string) => `fk-garmin-daily-progress:${shortHash(scope)}:${encodeURIComponent(subjectId)}`
const dates = (value: unknown): value is string[] => Array.isArray(value) && value.every(day => typeof day === 'string' && validDay(day))
function validProgress(value: unknown): value is GarminDailyProgress {
  if (!value || typeof value !== 'object') return false
  const p = value as GarminDailyProgress
  return dates(p.checkedDays) && dates(p.pendingDays)
    && (p.intradayCheckedDays === undefined || dates(p.intradayCheckedDays))
    && (p.lastSyncAt === null || typeof p.lastSyncAt === 'string' && Number.isFinite(Date.parse(p.lastSyncAt)))
}

/** Receipts acknowledge completed reads, never infer them from existing health values. */
export function readGarminDailyProgress(scope: string, subjectId: string, store: MemoryStore | null = currentStore()): GarminDailyProgress | null {
  if (!scope || !subjectId || !store) return null
  try {
    const record = JSON.parse(store.getItem(keyFor(scope, subjectId)) ?? 'null')
    return record?.version === 1 && record.scope === scope && record.subjectId === subjectId && validProgress(record.progress) ? record.progress : null
  } catch { return null }
}

/** Verify the write before the runner announces saved progress. Pending dates are not clipped. */
export function writeGarminDailyProgress(scope: string, subjectId: string, progress: GarminDailyProgress, store: MemoryStore | null = currentStore()): void {
  if (!scope || !subjectId || !validProgress(progress)) throw new Error('健康同步进度无效，未保存')
  try {
    if (!store) throw new Error()
    const key = keyFor(scope, subjectId)
    const previous = store.getItem(key)
    if (previous) {
      let record: { scope?: string; subjectId?: string } | null = null
      try { record = JSON.parse(previous) } catch { /* Invalid receipts may be replaced after a verified new read. */ }
      if (record && (record.scope !== scope || record.subjectId !== subjectId)) throw new Error()
    }
    const raw = JSON.stringify({ version: 1, scope, subjectId, progress })
    store.setItem(key, raw)
    if (store.getItem(key) !== raw) throw new Error()
  } catch { throw new Error('健康同步进度保存失败，下次将重试未确认日期') }
}
