/** R7 field-scoped, read-only correction audit. No fact writes or plan changes. */
export type Revision = string | number;
export type FactOrigin = 'DEVICE' | 'USER_REPORT' | 'COACH_OBSERVATION' | 'PLAN';
export type ClaimStatus = 'DRAFT' | 'SUPPORTED_FACT' | 'ACTIVE_HYPOTHESIS' | 'WEAKENED'
  | 'RETRACTED' | 'SUPERSEDED' | 'STALE_NEEDS_REVIEW' | 'UNRESOLVED';
export type UpdateAction = 'KEEP' | 'MARK_STALE' | 'REVIEW_REQUIRED' | 'BLOCK';
export type ClaimDependency = { sourceId: string; revision: Revision; fieldPaths: readonly string[] };
export type VersionedFact = {
  sourceId: string; revision: Revision; origin: FactOrigin;
  /** Paths known to exist; no inferred measurement provenance. */
  fieldPaths: readonly string[];
};
export type FieldCorrection = {
  sourceId: string; fromRevision: Revision; toRevision: Revision;
  sourceOrigin: FactOrigin; changedFieldPaths: readonly string[];
};
export type AuditedClaim = {
  claimId: string; status: ClaimStatus; dependencies: readonly ClaimDependency[];
  candidateIds?: readonly string[];
};
export type ClaimCorrectionResult = {
  claimId: string; status: ClaimStatus; updateAction: UpdateAction;
  reason: string; affectedPaths: string[]; invalidatedCandidateIds: string[];
  /** An audit recommendation only; never changes plan/claims itself. */
  planWriteAuthorized: false;
};
const pathValid = (p: string): boolean => /^[A-Za-z_$][\w$]*(?:\[\d+\]|\.[A-Za-z_$][\w$]*)*$/.test(p);
const overlaps = (a: string, b: string): boolean =>
  a === b || a.startsWith(b + '.') || a.startsWith(b + '[') || b.startsWith(a + '.') || b.startsWith(a + '[');
const same = (a: Revision, b: Revision): boolean => a === b;
const report = (c: AuditedClaim, status: ClaimStatus, action: UpdateAction, reason: string, fields: string[] = []): ClaimCorrectionResult => ({
  claimId: c.claimId, status, updateAction: action, reason,
  affectedPaths: fields, invalidatedCandidateIds: action === 'MARK_STALE' ? [...new Set(c.candidateIds ?? [])] : [],
  planWriteAuthorized: false,
});
/**
 * Only a known same-source correction of an actual previous revision can
 * invalidate claims. Unknown links stay unresolved and cannot be described as
 * device-verified. A new session/source never rewrites an older event.
 */
export function auditClaimCorrection(
  c: AuditedClaim, oldFact: VersionedFact | null, correction: FieldCorrection,
): ClaimCorrectionResult {
  if (!c.claimId || !correction.sourceId || !correction.changedFieldPaths.length ||
      !c.dependencies.length || c.dependencies.some(d=>!d.sourceId||!d.fieldPaths.length||d.fieldPaths.some(p=>!pathValid(p))) ||
      (typeof correction.fromRevision==='number' && typeof correction.toRevision==='number' && correction.toRevision<=correction.fromRevision) ||
      correction.changedFieldPaths.some(p => !pathValid(p)) ||
      !String(correction.toRevision).trim() || same(correction.fromRevision, correction.toRevision))
    return report(c, 'UNRESOLVED', 'REVIEW_REQUIRED', 'MALFORMED_CORRECTION');
  if (!oldFact || oldFact.sourceId !== correction.sourceId ||
      !same(oldFact.revision, correction.fromRevision) || oldFact.origin !== correction.sourceOrigin ||
      !oldFact.fieldPaths.length || correction.changedFieldPaths.some(p => !oldFact.fieldPaths.some(f => overlaps(f, p))))
    return report(c, 'UNRESOLVED', 'REVIEW_REQUIRED', 'SOURCE_CHAIN_NOT_VERIFIED');
  // A reported activity never becomes a device-verified activity via this audit.
  const deps = c.dependencies.filter(d => d.sourceId === correction.sourceId &&
    same(d.revision, correction.fromRevision));
  const touched = [...new Set(correction.changedFieldPaths.filter(f =>
    deps.some(d => d.fieldPaths.some(x => pathValid(x) && overlaps(x, f)))))];
  if (!touched.length) return report(c, c.status, 'KEEP', 'NO_DEPENDENCY_ON_CHANGED_FIELD');
  if (c.status === 'RETRACTED' || c.status === 'SUPERSEDED')
    return report(c, c.status, 'KEEP', 'HISTORICAL_CLAIM_ALREADY_CLOSED');
  return report(c, 'STALE_NEEDS_REVIEW', 'MARK_STALE',
    `CORRECTED_FIELDS:${correction.sourceId}@${String(correction.fromRevision)}->${String(correction.toRevision)}`, touched);
}
/** Safety is an independent action gate: it blocks training candidates without
 * rewriting historical observations or pretending to deliver medical clearance. */
export function safetyCandidateGate(safetyHold: boolean, candidateIds: readonly string[]) {
  return { blockedCandidateIds: safetyHold ? [...new Set(candidateIds)] : [],
    trainingPlanWriteAuthorized: false as const,
    medicalClearanceProvided: false as const };
}
