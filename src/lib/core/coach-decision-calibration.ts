/**
 * P7 experimental, local-only decision calibration. No automatic plan changes,
 * no model calls, and no claims of causal training effects.
 * Pure functions; persistence is delegated to the existing versioned journal.
 */
export type DecisionActor = 'FANGKUN' | 'HUMAN_COACH' | 'BASELINE';
export type AuditState = 'INVALID' | 'PENDING' | 'EVALUABLE' | 'INCONCLUSIVE' | 'SUPERSEDED';
export type ForecastDirection = 'LOWER_BETTER' | 'HIGHER_BETTER';
export type SourceVersion = { sourceId: string; revision: string };
export type DecisionSnapshot = {
  id: string;
  athleteId: string;
  actor: DecisionActor;
  caseId: string;
  createdAt: string;
  evidenceCutoff: string;
  sources: SourceVersion[];
  hypothesis: string;
  alternative: string;
  metricId: string;
  protocolKey: string;
  unit: string;
  forecastValue: number | null;
  forecastDirection: ForecastDirection;
  observationDueAt: string;
  uncertaintyNote: string;
  safetyHold: boolean;
  planWrite: false;
  /** Optional R187 candidate knowledge provenance, never rule approval. */
  knowledgeEvidenceIds?: string[];
  knowledgeVersion?: string;
};
export type OutcomeSnapshot = {
  id: string;
  athleteId: string;
  caseId: string;
  observedAt: string;
  recordedAt: string;
  source: SourceVersion;
  metricId: string;
  protocolKey: string;
  unit: string;
  value: number | null;
  measurementValid: boolean;
};
export type AuditResult = {
  decisionId: string;
  state: AuditState;
  error: number | null;
  absoluteError: number | null;
  reason: string;
};
const validTime = (s: string): boolean => Number.isFinite(Date.parse(s)) && /(?:Z|[+-]\d\d:\d\d)$/.test(s);
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
export function auditDecision(
  d: DecisionSnapshot,
  o: OutcomeSnapshot | null,
  currentVersions: Readonly<Record<string, string>>,
): AuditResult {
  const result = (state: AuditState, reason: string, error: number | null = null): AuditResult =>
    ({ decisionId: d.id, state, reason, error, absoluteError: error === null ? null : Math.abs(error) });
  if (!d.id || !d.athleteId || !d.caseId || !d.metricId || !d.protocolKey || !d.unit ||
      !d.hypothesis || !d.alternative || !d.sources.length || d.planWrite !== false ||
      !validTime(d.createdAt) || !validTime(d.evidenceCutoff) || !validTime(d.observationDueAt) ||
      Date.parse(d.evidenceCutoff) > Date.parse(d.createdAt) ||
      Date.parse(d.observationDueAt) <= Date.parse(d.createdAt) ||
      d.sources.some(s => !s.sourceId || !s.revision) ||
      (d.forecastValue !== null && !Number.isFinite(d.forecastValue)))
    return result('INVALID', 'INVALID_PRECOMMITTED_DECISION');
  if (d.sources.some(s => currentVersions[s.sourceId] !== s.revision))
    return result('SUPERSEDED', 'EVIDENCE_REVISION_CHANGED');
  if (d.safetyHold) return result('INCONCLUSIVE', 'SAFETY_HOLD_NO_PERFORMANCE_EVALUATION');
  if (!o) return result('PENDING', 'OUTCOME_NOT_RECORDED');
  if (o.athleteId !== d.athleteId || o.caseId !== d.caseId ||
      o.metricId !== d.metricId || o.protocolKey !== d.protocolKey || o.unit !== d.unit)
    return result('INVALID', 'OUTCOME_BINDING_OR_PROTOCOL_MISMATCH');
  if (!validTime(o.observedAt) || !validTime(o.recordedAt) ||
      Date.parse(o.observedAt) <= Date.parse(d.createdAt) ||
      Date.parse(o.recordedAt) < Date.parse(o.observedAt) ||
      Date.parse(o.recordedAt) < Date.parse(d.createdAt))
    return result('INVALID', 'OUTCOME_TIMELINE_INVALID');
  if (!o.source.sourceId || currentVersions[o.source.sourceId] !== o.source.revision)
    return result('SUPERSEDED', 'OUTCOME_SOURCE_REVISION_CHANGED');
  if (!o.measurementValid || !finite(o.value) || !finite(d.forecastValue))
    return result('INCONCLUSIVE', 'MISSING_VALID_NUMERIC_FORECAST_OR_OUTCOME');
  // Signed forecast error = predicted minus observed; sign is not a quality label.
  return result('EVALUABLE', 'MATCHED_PRECOMMITTED_FORECAST', d.forecastValue - o.value);
}
export type CalibrationSummary = {
  status: 'DESCRIPTIVE_ONLY' | 'INSUFFICIENT_EVIDENCE';
  eligibleCount: number;
  excludedCount: number;
  mae: number | null;
  bias: number | null;
  /** A descriptive error summary is never an autonomous learning/approval trigger. */
  autonomousRuleUpdateAuthorized: false;
};
export function summarizeCalibration(results: readonly AuditResult[]): CalibrationSummary {
  const good = results.filter(r => r.state === 'EVALUABLE' && finite(r.error));
  const n = good.length;
  return {
    status: n > 0 ? 'DESCRIPTIVE_ONLY' : 'INSUFFICIENT_EVIDENCE',
    eligibleCount: n, excludedCount: results.length - n,
    mae: n ? good.reduce((s, r) => s + Math.abs(r.error!), 0) / n : null,
    bias: n ? good.reduce((s, r) => s + r.error!, 0) / n : null,
    autonomousRuleUpdateAuthorized: false,
  };
}
export type PairedJudgment = { caseId: string; athleteId: string; fangkun: AuditResult; human: AuditResult };
export function compareBlindPairs(pairs: readonly PairedJudgment[]) {
  const valid = pairs.filter(p => p.fangkun.state === 'EVALUABLE' && p.human.state === 'EVALUABLE' &&
    finite(p.fangkun.absoluteError) && finite(p.human.absoluteError));
  const n = valid.length;
  const meanDifference = n ? valid.reduce((s, p) => s + p.fangkun.absoluteError! - p.human.absoluteError!, 0) / n : null;
  return { status: 'DESCRIPTIVE_ONLY' as const, pairedN: n, excludedN: pairs.length - n,
    meanAbsoluteErrorDifference: meanDifference, superiorityEstablished: false as const };
}
