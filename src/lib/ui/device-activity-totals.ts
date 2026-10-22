import { normalizeTrainingImportCandidate } from '../core/training-import'

/** Compare source values in the same representation used by confirmed imports.
 * For example, a watch's zero-distance strength activity is stored as an
 * unavailable distance by the existing import contract, not as a new revision. */
export function normalizedDeviceActivityTotals(durationSec: number | null, distanceM: number | null) {
  const field = (value: number | null) => ({ value, status: value === null ? 'ABSENT' : 'RECORDED', sourceIds: ['user-confirmed'] })
  const normalized = normalizeTrainingImportCandidate({ durationSeconds: field(durationSec), totalDistanceMeters: field(distanceM) })
  return { durationSec: normalized.durationSeconds.value, distanceM: normalized.totalDistanceMeters.value }
}
