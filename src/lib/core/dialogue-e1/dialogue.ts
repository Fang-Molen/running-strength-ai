import type {
  ApprovedClaim, ApprovedCoachBundle, ClaimKind, DepthMode, DialogueContext,
  DraftSegment, InternalPreview, ValidationResult
} from './contracts.ts';

const KINDS: ClaimKind[] = ['safety', 'correction', 'conclusion', 'fact', 'uncertainty', 'limit', 'decision', 'action'];
const order = (kind: ClaimKind): number => KINDS.indexOf(kind);
const textOkay = (v: string): boolean => typeof v==='string' && v.trim().length > 0 && v.length <= 2000;

/** Validates the HOST-approved input contract, not the correctness of sports medicine claims. */
export function validateBundle(bundle: ApprovedCoachBundle): ValidationResult {
  try {
    if (!bundle || typeof bundle !== 'object' || !Array.isArray(bundle.claims) ||
      bundle.claims.some(c => !c || typeof c !== 'object') ||
      (bundle.glosses !== undefined && (!Array.isArray(bundle.glosses) || bundle.glosses.some(g => !g || typeof g !== 'object'))) ||
      (bundle.followups !== undefined && (!Array.isArray(bundle.followups) || bundle.followups.some(q => !q || typeof q !== 'object'))))
      return {pass:false,errors:['INVALID_BUNDLE_SHAPE']};
    return validateBundleFields(bundle);
  } catch { return {pass:false,errors:['INVALID_BUNDLE_SHAPE']}; }
}
function validateBundleFields(bundle: ApprovedCoachBundle): ValidationResult {
  const errors: string[] = [];
  if (bundle.schemaVersion !== 'E1.0') errors.push('BAD_SCHEMA');
  if (![bundle.bundleId, bundle.factVersion, bundle.sourceRevision].every(v => typeof v === 'string' && v.trim())) errors.push('MISSING_VERSION');
  if (!['normal', 'caution', 'urgent'].includes(bundle.safetyLevel)) errors.push('BAD_SAFETY');
  if (!['simple','moderate','complex'].includes(bundle.complexity)) errors.push('BAD_COMPLEXITY');
  if (!Array.isArray(bundle.claims) || bundle.claims.length === 0 || bundle.claims.length > 32) errors.push('INVALID_CLAIM_COUNT');
  if (!Array.isArray(bundle.allowedActionClaimIds)) errors.push('MISSING_ACTION_ALLOWLIST');
  if (bundle.permissions?.planMutationAuthorized === true) errors.push('E1_DISALLOWS_PLAN_MUTATION');
  if (bundle.permissions?.maySendToAthlete === true) errors.push('E1_R13_REQUIRES_INTERNAL_PREVIEW_ONLY');
  if (bundle.permissions?.maySendToAthlete !== false || bundle.permissions?.planMutationAuthorized !== false) errors.push('UNSAFE_PERMISSION_STATE');
  const revoked = new Set(bundle.revokedSourceIds ?? []);
  const ids = new Set<string>();
  for (const c of (bundle.claims ?? [])) {
    if (typeof c.id !== 'string' || !c.id.trim() || ids.has(c.id)) errors.push('DUPLICATE_OR_EMPTY_CLAIM_ID');
    ids.add(c.id);
    if (!KINDS.includes(c.kind) || !['required','supporting','detail'].includes(c.priority)) errors.push(`BAD_CLAIM:${c.id}`);
    if (!textOkay(c.text)) errors.push(`EMPTY_OR_LONG_CLAIM:${c.id}`);
    if (!Array.isArray(c.sourceIds)) errors.push(`MISSING_SOURCE_ARRAY:${c.id}`);
    else if (c.sourceIds.some(id => typeof id !== 'string' || !id.trim())) errors.push(`INVALID_SOURCE_ID:${c.id}`);
    else if (c.sourceIds.some(id => revoked.has(id))) errors.push(`STALE_REVOKED_SOURCE:${c.id}`);
    if (c.kind === 'fact' && Array.isArray(c.sourceIds) && c.sourceIds.length === 0) errors.push(`UNSOURCED_FACT:${c.id}`);
    if (c.kind === 'action' && !(bundle.allowedActionClaimIds ?? []).includes(c.id)) errors.push(`UNAUTHORIZED_ACTION:${c.id}`);
    if (['safety','correction'].includes(c.kind) && c.priority !== 'required') errors.push(`NONREQUIRED_SAFETY_OR_CORRECTION:${c.id}`);
  }
  if (bundle.safetyLevel === 'urgent' && !(bundle.claims ?? []).some(c=>c.kind==='safety' && c.priority==='required')) errors.push('URGENT_WITHOUT_REQUIRED_SAFETY');
  if (new Set(bundle.allowedActionClaimIds ?? []).size !== (bundle.allowedActionClaimIds ?? []).length) errors.push('DUPLICATE_ALLOWED_ACTION_ID');
  if ((bundle.allowedActionClaimIds ?? []).some(id=>!(bundle.claims ?? []).some(c=>c.id===id && c.kind==='action'))) errors.push('ALLOWLIST_UNKNOWN_OR_NONACTION');
  const glossIds = new Set<string>();
  for (const g of bundle.glosses ?? []) {
    if (typeof g.id !== 'string' || !g.id.trim() || ids.has(g.id) || glossIds.has(g.id)) errors.push(`DUPLICATE_GLOSS_ID:${g.id}`);
    glossIds.add(g.id);
    if (!ids.has(g.afterClaimId) || !textOkay(g.text) || !['supporting','detail'].includes(g.priority)) errors.push(`INVALID_GLOSS:${g.id}`);
  }
  const questionIds = new Set<string>();
  for (const q of bundle.followups ?? []) {
    if (typeof q.id !== 'string' || !q.id.trim() || ids.has(q.id) || glossIds.has(q.id) || questionIds.has(q.id)) errors.push(`DUPLICATE_QUESTION_ID:${q.id}`);
    questionIds.add(q.id);
    if (!textOkay(q.text) || !q.missingField || !['blocking','optional'].includes(q.necessity)) errors.push(`INVALID_FOLLOWUP:${q.id}`);
  }
  return {pass: errors.length===0, errors};
}

/** Deliberately conservative: explicit feelings only, never speculate on diagnosis or motives. */
function empathyOpening(user: string): string | null {
  if (/沮丧|失望|崩溃|难过|很烦|挫败/.test(user)) return '听得出来，这件事让你挺不好受。我们先看能确认的部分。';
  if (/焦虑|紧张|害怕比赛|压力很大/.test(user)) return '有压力可以理解，我们先把眼前能确认的事情说清楚。';
  if (/兴奋|太开心|特别高兴/.test(user)) return '看到你这么开心，挺好。我们也看看这次训练实际说明了什么。';
  return null;
}

export function chooseMode(bundle: ApprovedCoachBundle, ctx: DialogueContext): DepthMode {
  const t = ctx.latestUserText;
  if (ctx.depthPreference === 'short' || /不需要详细|不用详细|别详细|别长篇/.test(t)) return 'brief';
  if (ctx.depthPreference === 'detailed' || /不要简单说|别简单说/.test(t)) return 'deep';
  if (/一句话|简短|简单说|说重点|不要展开|简要说|直接结论/.test(t)) return 'brief';
  if (/详细解释|仔细分析|从原理|深入分析|展开讲讲|讲透/.test(t)) return 'deep';
  if (bundle.complexity === 'complex') return 'deep';
  if (bundle.complexity === 'simple') return 'brief';
  return 'standard';
}

function isSelected(c: ApprovedClaim, mode: DepthMode, urgent: boolean): boolean {
  if (c.priority === 'required') return true;
  if (urgent) return false;
  if (mode === 'brief') return false;
  if (mode === 'standard') return c.priority === 'supporting';
  return true;
}

function selectQuestion(bundle: ApprovedCoachBundle, ctx: DialogueContext): { id:string; text:string } | null {
  const already = new Set(ctx.alreadyAskedQuestionIds ?? []);
  const followups = bundle.followups ?? [];
  const q = followups.find(x => x.necessity==='blocking' && !already.has(x.id)
    && (bundle.safetyLevel !== 'urgent' || x.permissibleDuringUrgency===true))
    ?? (ctx.allowOptionalFollowup && bundle.safetyLevel==='normal'
      ? followups.find(x=>x.necessity==='optional' && !already.has(x.id)) : undefined);
  return q ? {id:q.id, text:q.text} : null;
}

function compose(bundle: ApprovedCoachBundle, ctx: DialogueContext): {mode:DepthMode; segments:DraftSegment[]; questionId:string|null} {
  const mode = chooseMode(bundle, ctx);
  const selected = bundle.claims.filter(c => isSelected(c, mode, bundle.safetyLevel==='urgent'))
    .sort((a,b)=>order(a.kind)-order(b.kind));
  const segments: DraftSegment[] = [];
  const opening = !ctx.disableEmpathy && bundle.safetyLevel==='normal' ? empathyOpening(ctx.latestUserText) : null;
  if (opening) segments.push({id:'opening', kind:'opening', text:opening});
  for (const c of selected) {
    segments.push({id:c.id, kind:'claim', text:c.text, sourceId:c.id});
    if (bundle.safetyLevel === 'urgent') continue;
    for (const g of (bundle.glosses ?? []).filter(g=>g.afterClaimId===c.id)) {
      if (mode==='deep' || (mode==='standard' && g.priority==='supporting')) {
        segments.push({id:g.id, kind:'gloss', text:g.text, sourceId:c.id});
      }
    }
  }
  const q = selectQuestion(bundle, ctx);
  if (q) segments.push({id:q.id, kind:'question', text:q.text});
  return {mode, segments, questionId:q?.id ?? null};
}

/** Canonical renderer is the ONLY text that may go to the next host gate. */
export function makeInternalPreview(bundle: ApprovedCoachBundle, ctx: DialogueContext): InternalPreview {
  const valid = validateBundle(bundle);
  if (!valid.pass) throw new Error(`BUNDLE_INVALID:${valid.errors.join(',')}`);
  const composed = compose(bundle, ctx);
  const text = composed.segments.map(s=>s.text).join('\n');
  return {
    schemaVersion:'E1.0', bundleId:bundle.bundleId, factVersion:bundle.factVersion, sourceRevision:bundle.sourceRevision,
    mode:composed.mode, segments:composed.segments, renderedText:text,
    usedApprovedClaimIds:composed.segments.filter(s=>s.kind==='claim').map(s=>s.id),
    selectedQuestionId:composed.questionId,
    authorizedForDelivery:false, modifiesPlan:false
  };
}

/** Reject tampered drafts. The host must STILL check semantic safety of the approved source content. */
export function verifyInternalPreview(bundle: ApprovedCoachBundle, ctx: DialogueContext, candidate: InternalPreview): ValidationResult {
  const errors: string[] = [];
  let canonical: InternalPreview;
  try { canonical = makeInternalPreview(bundle, ctx); }
  catch (e) { return {pass:false,errors:[String(e)]}; }
  if (!candidate || !Array.isArray(candidate.segments)) return {pass:false,errors:['INVALID_PREVIEW_SHAPE']};
  if (candidate.schemaVersion!==canonical.schemaVersion || candidate.bundleId!==canonical.bundleId || candidate.factVersion!==canonical.factVersion) errors.push('VERSION_OR_BUNDLE_MISMATCH');
  if (candidate.sourceRevision!==canonical.sourceRevision) errors.push('SOURCE_REVISION_MISMATCH');
  if (candidate.authorizedForDelivery!==false || candidate.modifiesPlan!==false) errors.push('UNAUTHORIZED_DELIVERY_OR_MUTATION');
  if (candidate.mode!==canonical.mode) errors.push('MODE_CHANGED');
  if (candidate.segments.length!==canonical.segments.length) errors.push('SEGMENT_COUNT_CHANGED');
  for (let i=0;i<Math.min(candidate.segments.length,canonical.segments.length);i++) {
    const a=candidate.segments[i], b=canonical.segments[i];
    if (a?.id!==b?.id || a?.kind!==b?.kind || a?.text!==b?.text || a?.sourceId!==b?.sourceId) errors.push(`SEGMENT_TAMPERED:${i}`);
  }
  if (candidate.renderedText!==canonical.renderedText) errors.push('RENDERED_TEXT_CHANGED');
  if (JSON.stringify(candidate.usedApprovedClaimIds)!==JSON.stringify(canonical.usedApprovedClaimIds)) errors.push('CLAIM_TRACE_CHANGED');
  if (candidate.selectedQuestionId!==canonical.selectedQuestionId) errors.push('QUESTION_CHANGED');
  return {pass:errors.length===0,errors};
}
