import { loadCommittedEventRecords } from "./events.ts"
import { projectRunningExecution, type RunningExecutionProjection } from "./running-execution.ts"
import { listCorrections } from "./training-correction.ts"
import { buildFormalEvidenceRows, type FormalRowsResult } from "./coach-v4-formal-rows.ts"
import { coachImports, importedFormalRows } from "./coach-import-evidence.ts"
import { strictIso } from "./coach-v4-c11-adapter.ts"

/** Browser-side read-only reader: committed events + corrections + running projection -> FormalEvidenceRow. No writes. */
export function readFormalEvidenceRows(athleteId: string, asOf: string = new Date().toISOString()): FormalRowsResult {
  const committed = loadCommittedEventRecords()
  // Construct the running projection from what was known then, not today's full history.
  const visible = committed.filter(r => r.event.athlete_id === athleteId && r.recordedAt && strictIso(r.recordedAt) &&
    strictIso(r.event.timestamp) && Date.parse(r.recordedAt) <= Date.parse(asOf) && Date.parse(r.event.timestamp) <= Date.parse(asOf))
  const events = visible.map((r) => r.event)
  const running: Record<string, RunningExecutionProjection> = {}
  for (const r of visible) {
    if (r.event.event_type !== "TRAINING_STARTED" || r.event.athlete_id !== athleteId) continue
    try { running[r.event.event_id] = projectRunningExecution(r.event.event_id, events) } catch { /* unavailable projection => no running rows */ }
  }
  const corrections=listCorrections()
  const result=buildFormalEvidenceRows({ athleteId, asOf, committed, corrections, running })
  result.rows.push(...importedFormalRows(coachImports(athleteId,asOf),athleteId,asOf,corrections))
  return result
}
