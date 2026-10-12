import { auditAthleteEvidence, type AthleteEvidence } from './athlete-evidence-audit.ts'

/** Read-only, deterministic chronological evidence projection. No inference of fitness or diagnosis. */
export type EvidenceTimeline = {
  ordered: AthleteEvidence[]
  quarantinedIds: string[]
  rejected: {id:string;reason:string}[]
  conflicts: {ids:string[];reason:string}[]
  latestByKind: Partial<Record<AthleteEvidence['kind'], AthleteEvidence>>
  missing: string[]
  currentPerformanceKnown: false
  trainingDecisionAuthorized: false
}
const validDay = (date:string):boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [y,m,d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y,m-1,d))
  return t.getUTCFullYear()===y && t.getUTCMonth()===m-1 && t.getUTCDate()===d
}
export function projectAthleteEvidence(items:readonly AthleteEvidence[]):EvidenceTimeline {
  const checked = auditAthleteEvidence(items.filter(x=>validDay(x.date)))
  const rejected = [...items.filter(x=>!validDay(x.date)).map(x=>({id:x.id,reason:'INVALID_CALENDAR_DATE'})),...checked.rejected]
  const quarantine = new Set(checked.conflicts.flatMap(c=>c.ids))
  // Conflicting ID records are excluded rather than arbitrarily choosing the first value.
  const ordered = checked.accepted.filter(x=>!quarantine.has(x.id)).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
  const latestByKind: EvidenceTimeline['latestByKind'] = {}
  for(const item of ordered) latestByKind[item.kind]=item
  const missing:string[]=[]
  if(!latestByKind.SESSION) missing.push('NO_UNCONFLICTED_SESSION')
  if(!latestByKind.RECOVERY) missing.push('NO_UNCONFLICTED_RECOVERY')
  if(!latestByKind.SYMPTOM) missing.push('NO_UNCONFLICTED_SYMPTOM_RECORD')
  missing.push('NO_VALIDATED_CURRENT_PERFORMANCE_MODEL')
  return {ordered,quarantinedIds:[...quarantine].sort(),rejected,conflicts:checked.conflicts,latestByKind,missing,currentPerformanceKnown:false,trainingDecisionAuthorized:false}
}
