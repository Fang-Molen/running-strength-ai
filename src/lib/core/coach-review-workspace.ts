import { readFormalEvidenceRows } from './coach-v4-formal-rows-store.ts'
import { reviewFormalEvidence } from './coach-v4-c11-adapter.ts'
import { buildPeriodReview, periodStart } from './coach-period-review.ts'
import { readCoachMemory } from './coach-context-memory.ts'
import { getTrainingPlanSnapshot, listTrainingOccurrences } from './occurrence.ts'
import { reviewStrengthExecution } from './coach-strength-review.ts'
import { readPeriodContext } from './coach-period-context.ts'
import type { DeviceConfirmed } from './device-image-evidence.ts'

/** One read of the existing effective projection. No parallel fact store, migration or write on opening. */
export function readCoachReviewWorkspace(athleteId: string, endDay: string, days = 7, asOf = new Date().toISOString(), devices: readonly DeviceConfirmed[] = [], deviceReadFailed = false) {
  const formal = readFormalEvidenceRows(athleteId, asOf)
  const review = reviewFormalEvidence({ athleteId, asOf, question: '只读训练复盘', rows: formal.rows })
  const snapshot = review.audit.snapshot
  const period = buildPeriodReview(snapshot, periodStart(endDay, days), endDay, formal.unknownCommitTime.length + review.audit.issues.length, readPeriodContext(athleteId, asOf, devices, deviceReadFailed))
  const occurrences = listTrainingOccurrences()
  const strength = period.sessions.filter(s => s.strengthSets > 0).map(s => {
    const occurrence = occurrences.find(o => o.trainingOccurrenceId === s.occurrenceId)
    const target = occurrence?.planKnowledge === 'KNOWN' && occurrence.trainingPlanSnapshotId ? getTrainingPlanSnapshot(occurrence.trainingPlanSnapshotId) : null
    return reviewStrengthExecution(snapshot, s.occurrenceId, target, occurrence?.startedAt ?? null)
  })
  return { period, strength, memory: readCoachMemory(athleteId, asOf, snapshot), safety: snapshot.safety, safetyMessage: snapshot.safetyMessage,
    sourceCounts: { visible: snapshot.active.length, excluded: formal.excluded.length + review.adapter.excluded.length, conflicts: snapshot.quarantined.length + review.audit.issues.length, unknownCommitTime: formal.unknownCommitTime.length }, writes: 0 as const }
}
