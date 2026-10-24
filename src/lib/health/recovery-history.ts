import { readRecoveryProjection } from './recovery-host-u11'
import { localDay } from './observation'

export type RecoveryHistoryStatus = 'RECENT_EXPOSURE' | 'HISTORICAL' | 'DETAILS_NEEDED'
/** Read-only history. A wider display range never widens the 72-hour muscle map. */
export function readRecoveryTrainingHistory(day = localDay(), asOf = new Date().toISOString(), hours = 168) {
  if (![72, 168, 336].includes(hours)) throw Error('INVALID_HISTORY_RANGE')
  const projection = readRecoveryProjection(day, asOf, hours)
  const used = new Set(projection.review.regions.flatMap(r => [...r.runEventIds, ...r.strengthEventIds]))
  const recentStart = Date.parse(projection.review.asOf) - 72 * 3600000
  const rows = projection.sources.flatMap(source => {
    const modality = source.id.endsWith('|RUN') ? 'RUN' : source.id.endsWith('|STRENGTH') ? 'STRENGTH' : null
    if (!modality) return []
    const status: RecoveryHistoryStatus = source.occurredAt && Date.parse(source.occurredAt) < recentStart
      ? 'HISTORICAL' : used.has(source.id) ? 'RECENT_EXPOSURE' : 'DETAILS_NEEDED'
    return [{ ...source, modality, status }]
  }).sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''))
  return { projection, rows, hours }
}
