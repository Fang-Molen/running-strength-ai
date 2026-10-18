import type { EvolutionSnapshot } from './coach-evolution-v4.ts'
import { computeReasoningFacts } from './coach-reasoning.ts'
import { strictIso } from './coach-v4-c11-adapter.ts'

/** Research R13 adapted to the existing native fact projection. Not a server auth contract.
 * The current host has no complete approved-course registry: only hold/ask may be reviewed. */
export type DecisionEvidenceDraft = {
  selectedOption: 'HOLD' | 'ASK_FOR_CONTEXT'
  numericReasons: { evidenceId: string; value: number; unit: string; role: 'SUPPORT' | 'CAUTION' }[]
  hypotheses: { id: string; supportIds: string[]; counterIds: string[]; missing: string[];
    observation: { metric: string; protocol: string; supportOutcome: string; refuteOutcome: string } }[]
}
export function reviewDecisionEvidence(snapshot: EvolutionSnapshot, scope: readonly string[], draft: DecisionEvidenceDraft) {
  const boundary = { maySendToAthlete: false, planMutationAuthorized: false, didWrite: false, didCallModel: false,
    semanticCorrectnessEvaluated: false, qualifiedCoachReviewRequired: true } as const
  const blocked = (reason: string) => ({ ...boundary, status: 'BLOCKED' as const, findings: [reason], metrics: [] })
  if (!strictIso(snapshot.asOf) || snapshot.safety !== 'NONE' || snapshot.quarantined.length || snapshot.scopeConflictCount)
    return blocked('SAFETY_OR_EVIDENCE_CONFLICT')
  if (!scope.length || new Set(scope).size !== scope.length) return blocked('INVALID_SCOPE')
  const rows = snapshot.active.filter(e => scope.includes(e.occurrenceId) && e.athleteId === snapshot.athleteId &&
    e.source === 'TRAINING_FACT' && e.confirmation === 'CONFIRMED' && e.value !== null && Number.isFinite(e.value) &&
    strictIso(e.recordedAt) && strictIso(e.eventAt) && Date.parse(e.recordedAt) <= Date.parse(snapshot.asOf) && Date.parse(e.eventAt) <= Date.parse(snapshot.asOf))
  const evidence = new Map(rows.map(r => [r.id, r]))
  if (evidence.size !== rows.length || new Set(rows.map(r => `${r.sourceId}|${r.metric}`)).size !== rows.length) return blocked('AMBIGUOUS_SOURCE')
  if (!draft || !['HOLD', 'ASK_FOR_CONTEXT'].includes(draft.selectedOption) || !Array.isArray(draft.numericReasons) ||
    !Array.isArray(draft.hypotheses) || draft.numericReasons.length > 80 || draft.hypotheses.length > 2) return blocked('INVALID_DRAFT_OR_UNAPPROVED_COURSE')
  const used = new Set<string>()
  for (const n of draft.numericReasons) {
    const r = n && evidence.get(n.evidenceId)
    if (!r || used.has(n.evidenceId) || !['SUPPORT', 'CAUTION'].includes(n.role) || r.value !== n.value || r.unit !== n.unit) return blocked('INVENTED_OR_MISMATCHED_NUMBER')
    used.add(n.evidenceId)
  }
  const findings: string[] = [], seen = new Set<string>(), signatures = new Set<string>()
  if (rows.length && !used.size) findings.push('NUMERIC_FACTS_NOT_USED')
  for (const h of draft.hypotheses) {
    if (!h || !h.id || seen.has(h.id) || !Array.isArray(h.supportIds) || !Array.isArray(h.counterIds) || !Array.isArray(h.missing) ||
      [...h.supportIds, ...h.counterIds].some(id => !evidence.has(id)) || h.supportIds.some(id => h.counterIds.includes(id))) return blocked('INVALID_HYPOTHESIS_EVIDENCE')
    seen.add(h.id)
    if (!h.supportIds.length || !h.counterIds.length && !h.missing.some(x => typeof x === 'string' && x.trim())) findings.push('MISSING_SUPPORT_OR_COUNTER_EVIDENCE')
    if (h.supportIds.some(id => !used.has(id))) findings.push('HYPOTHESIS_NUMBER_NOT_APPLIED')
    const o = h.observation
    if (!o || [o.metric, o.protocol, o.supportOutcome, o.refuteOutcome].some(x => typeof x !== 'string' || !x.trim()) || o.supportOutcome === o.refuteOutcome)
      findings.push('MISSING_DISCRIMINATING_OBSERVATION')
    else signatures.add(JSON.stringify([o.metric.trim(), o.protocol.trim(), o.supportOutcome.trim(), o.refuteOutcome.trim()]))
  }
  if (draft.hypotheses.length > 1 && signatures.size < draft.hypotheses.length) findings.push('FOLLOWUPS_NOT_DISTINGUISHABLE')
  // Arithmetic-only requests need no invented hypotheses. Empty facts remain insufficient.
  if (!rows.length) findings.push('INSUFFICIENT_FORMAL_FACTS')
  const metrics = computeReasoningFacts({ ...snapshot, active: rows }, scope).points.filter(p => p.distanceMeters !== null).map(p => ({
    occurrenceId: p.occurrenceId, sourceId: p.sourceId, distanceMeters: p.distanceMeters,
    durationSeconds: rows.find(r => r.sourceId === p.sourceId && r.metric === 'SPLIT_SECONDS')!.value,
    paceSecondsPerKm: p.paceSecondsPerKm, unit: 's/km', formula: 'seconds * 1000 / meters', provenance: 'SAME_FORMAL_SOURCE_ROW',
  }))
  if (metrics.some(m => !Number.isFinite(m.paceSecondsPerKm) || !Number.isFinite(m.distanceMeters))) return blocked('INVALID_DERIVED_NUMBER')
  return { ...boundary, status: findings.length ? 'REQUIRES_REASONING_REVISION' as const : 'READY_FOR_QUALIFIED_COACH_REVIEW' as const,
    findings: [...new Set(findings)], checkedNumericFacts: used.size, metrics }
}
