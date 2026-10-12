import { projectAthleteEvidence } from './athlete-longitudinal-evidence.ts'
import type { AthleteEvidence } from './athlete-evidence-audit.ts'
/** Evidence availability, not a fatigue score, diagnosis or training decision. */
export function assessEvidenceReadiness(items: readonly AthleteEvidence[], asOfDay: string) {
  const timeline = projectAthleteEvidence(items)
  const today = Date.parse(`${asOfDay}T00:00:00Z`)
  if (!Number.isFinite(today) || new Date(today).toISOString().slice(0,10) !== asOfDay) {
    return {status:'INVALID_REFERENCE_DATE' as const, missing:['INVALID_REFERENCE_DATE'], decisionAuthorization:false}
  }
  const missing = [...timeline.missing]
  for (const kind of ['SESSION','RECOVERY'] as const) {
    const item = timeline.latestByKind[kind]
    if (item) {
      const days = Math.round((today-Date.parse(`${item.date}T00:00:00Z`))/86400000)
      if (days < 0) missing.push(`FUTURE_${kind}_EVIDENCE`)
      if (days > 7) missing.push(`STALE_${kind}_EVIDENCE`)
    }
  }
  if (timeline.conflicts.length) missing.push('UNRESOLVED_EVIDENCE_CONFLICT')
  return {status:missing.length?'EVIDENCE_GAPS' as const:'EVIDENCE_PRESENT' as const,missing,decisionAuthorization:false}
}
