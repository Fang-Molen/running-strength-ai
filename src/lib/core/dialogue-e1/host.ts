import { currentAthleteId } from '../events.ts'
import { calendarDay } from '../coach-calendar.ts'
import { openCoachEvidenceTools } from '../coach-evidence-tools.ts'
import { detectRedFlags } from '../coach-red-flags.ts'
import { strictIso } from '../coach-v4-c11-adapter.ts'
import { makeInternalPreview, validateBundle, verifyInternalPreview } from './dialogue.ts'
import type { ApprovedCoachBundle, ApprovedClaim, DialogueContext, InternalPreview } from './contracts.ts'

/** Enabled for native confirmed-record expression. No URL or message can widen its scope. */
export const COACH_DIALOGUE_E1_FLAGS: Readonly<{ coachDialogueE1: boolean }> = Object.freeze({ coachDialogueE1: true })
type Flags = typeof COACH_DIALOGUE_E1_FLAGS
type Tools = ReturnType<typeof openCoachEvidenceTools>
const hostToken: unique symbol = Symbol('native-e1-host')
export type NativeHostDecision = Readonly<{ [hostToken]: true }>
type HostState = { tools: Tools; bundle: ApprovedCoachBundle; question: string; occurrenceId: string; subjectId: string }
// Unserializable, process-local receipts. JSON/client claims cannot become host approvals.
const decisions = new WeakMap<NativeHostDecision, HostState>()
const labels: Record<string, string> = {
  SPLIT_SECONDS: '实际分段用时', STRENGTH_KG: '实际外加重量', STRENGTH_REPS: '实际次数',
  STRENGTH_SECONDS: '实际持续时间', REST_SECONDS: '实际休息', SESSION_RPE: '整课用力感',
  SLEEP_HOURS: '睡眠记录', SUBJECTIVE_RECOVERY: '主观恢复自报', SORENESS: '酸痛自报',
  PAIN_SCORE: '疼痛自报', HR_AVG_BPM: '心率记录',
}
const boundary = { label: 'NOT_DELIVERABLE', authorizedForDelivery: false, modifiesPlan: false, didCallModel: false } as const
const blocked = (code: string) => ({ ...boundary, status: 'BLOCKED' as const, code })

/** A complete review or a training decision must retain the original reasoning path. */
export function isNativeRecordInspection(question: string) {
  return /(?:查看|核对|读取|列出).{0,16}(?:实际记录|训练记录|完成记录|记录事实)/.test(question)
    && !/复盘|为什么|为何|原因|短板|建议|加量|减量|停训|调整|怎么练|如何练|算.*负荷/.test(question)
}

/** Host-owned factual inspection only. It never promotes an old free-text response,
 * research verdict, unconfirmed import, or generated action into an approved claim.
 * The full scientific-decision approval contract remains unavailable in this host. */
export function prepareNativeHostDecision(input: {
  question: string; occurrenceId: string | null; asOf: string;
  intent: 'CONFIRMED_RECORD_INSPECTION' | 'HOST_APPROVAL_UNAVAILABLE'
}) {
  if (!input || typeof input.question !== 'string' || !input.question.trim()) return blocked('INVALID_TURN')
  if (input.intent !== 'CONFIRMED_RECORD_INSPECTION') return blocked('HOST_APPROVED_CLAIMS_UNAVAILABLE')
  if (!input.occurrenceId || !strictIso(input.asOf)) return blocked('MISSING_SCOPE_OR_VERSION')
  if (detectRedFlags(input.question).level !== 'NONE') return blocked('PRESERVE_HOST_SAFETY_PATH')
  try {
    const subjectId = currentAthleteId(), end = calendarDay(input.asOf)
    if (!end) return blocked('INVALID_CUTOFF')
    const tools = openCoachEvidenceTools(end, 366, input.asOf), view = tools.readView()
    if (!view.ok) return blocked(view.code)
    const { rows, sessions, audit } = view.data
    if (audit.safety !== 'NONE' || audit.quarantined.length || audit.scopeConflictCount)
      return blocked('PRESERVE_HOST_SAFETY_OR_CONFLICT_PATH')
    if (!sessions.some(s => s.occurrenceId === input.occurrenceId)) return blocked('OUTSIDE_FROZEN_SCOPE')
    const scoped = rows.filter(r => r.occurrenceId === input.occurrenceId)
    if (!scoped.length || scoped.length > 29) return blocked('INCOMPLETE_OR_OVERSIZED_APPROVAL')
    if (scoped.some(r => r.athleteId !== subjectId || r.source !== 'TRAINING_FACT' || r.confirmation !== 'CONFIRMED' ||
      !r.sourceId || !r.unit || !labels[r.metric] || r.value === null || !Number.isFinite(r.value)))
      return blocked('UNCONFIRMED_OR_MISSING_FACT')
    if (new Set(scoped.map(r => r.id)).size !== scoped.length) return blocked('AMBIGUOUS_FACT_ID')
    // Exact, native numeric facts; no new calculation, dose, causal claim or scientific approval.
    const claims: ApprovedClaim[] = scoped.map(r => ({ id: `fact:${r.id}`, kind: 'fact', priority: 'required',
      text: `${labels[r.metric]}：${r.value} ${r.unit}；记录时间 ${r.eventAt}；记录口径 ${r.context}。`, sourceIds: [r.sourceId] }))
    const revised = scoped.filter(r => r.supersedes)
    if (revised.length) claims.unshift({ id: 'formal-correction', kind: 'correction', priority: 'required',
      sourceIds: [...new Set(revised.map(r => r.sourceId))],
      text: '所选实际记录包含已入库更正；以下只引用当前有效版本。表达层没有把聊天中的口头纠正写入训练记录。' })
    claims.push({ id: 'scope-limit', kind: 'uncertainty', priority: 'required', sourceIds: [],
      text: '这里只核对所选训练中已有来源的实际记录；未记录的内容仍未知，不能据此判断整课完整性、能力短板或训练效果。' })
    const bundle: ApprovedCoachBundle = { schemaVersion: 'E1.0', bundleId: `e1:${tools.snapshotId}:${input.occurrenceId}`,
      factVersion: tools.snapshotId, sourceRevision: tools.snapshotId, safetyLevel: 'normal', complexity: 'moderate',
      claims, allowedActionClaimIds: [], permissions: { maySendToAthlete: false, planMutationAuthorized: false },
      // No approved glossary/question registry in the current native factual adapter.
      glosses: [], followups: [], revokedSourceIds: [] }
    const valid = validateBundle(bundle)
    if (!valid.pass) return blocked('INVALID_NATIVE_BUNDLE')
    if (!tools.readView().ok) return blocked('STALE_SNAPSHOT')
    const handle: NativeHostDecision = Object.freeze({ [hostToken]: true as const })
    decisions.set(handle, { tools, bundle, question: input.question, occurrenceId: input.occurrenceId, subjectId })
    return { ...boundary, status: 'PREPARED' as const, handle }
  } catch { return blocked('HOST_EVIDENCE_UNAVAILABLE') }
}

/** Only native in-memory receipts are accepted; return a detached copy for audit. */
export function hostDecisionToApprovedCoachBundle(handle: NativeHostDecision) {
  const state = decisions.get(handle)
  if (!state) return blocked('UNTRUSTED_HOST_DECISION')
  if (currentAthleteId() !== state.subjectId) return blocked('SUBJECT_CHANGED')
  const view = state.tools.readView()
  if (!view.ok) return blocked(view.code)
  return { status: 'APPROVED_FACTS_ONLY' as const, bundle: structuredClone(state.bundle),
    coverage: 'CONFIRMED_RECORD_INSPECTION_ONLY' as const, planVersion: 'NOT_USED' as const }
}

/** Internal preview only; old user-facing answer is never replaced by this return value. */
export function dialogueExpress(handle: NativeHostDecision, ctx: DialogueContext, flags: Flags = COACH_DIALOGUE_E1_FLAGS) {
  if (flags.coachDialogueE1 !== true) return { ...boundary, status: 'OFF' as const }
  try {
    const state = decisions.get(handle)
    if (!state || ctx.latestUserText !== state.question) return blocked('TURN_OR_HOST_MISMATCH')
    const approved = hostDecisionToApprovedCoachBundle(handle)
    if (approved.status !== 'APPROVED_FACTS_ONLY') return approved
    const preview = makeInternalPreview(approved.bundle, ctx)
    const validation = verifyDialogueE1Preview(handle, ctx, preview)
    if (!validation.pass) return blocked(validation.errors.join(','))
    return { ...boundary, status: 'INTERNAL_PREVIEW' as const, preview,
      trace: { bundleId: approved.bundle.bundleId, sourceRevision: approved.bundle.sourceRevision,
        usedClaimIds: preview.usedApprovedClaimIds, mode: preview.mode, questionId: preview.selectedQuestionId,
        coverage: approved.coverage, professionalDecisionApproved: false, planVersion: approved.planVersion } }
  } catch { return blocked('E1_PREVIEW_ERROR') }
}

export function verifyDialogueE1Preview(handle: NativeHostDecision, ctx: DialogueContext, preview: InternalPreview) {
  try {
    const state = decisions.get(handle)
    if (!state || ctx.latestUserText !== state.question) return { pass: false, errors: ['TURN_OR_HOST_MISMATCH'] }
    const current = hostDecisionToApprovedCoachBundle(handle)
    if (current.status !== 'APPROVED_FACTS_ONLY') return { pass: false, errors: [current.code] }
    return verifyInternalPreview(current.bundle, ctx, preview)
  } catch { return { pass: false, errors: ['E1_VALIDATION_ERROR'] } }
}

export function previewNativeCoachDialogue(input: Parameters<typeof prepareNativeHostDecision>[0], flags: Flags = COACH_DIALOGUE_E1_FLAGS) {
  if (flags.coachDialogueE1 !== true) return { ...boundary, status: 'OFF' as const }
  const host = prepareNativeHostDecision(input)
  if (host.status !== 'PREPARED') return host
  return dialogueExpress(host.handle, { latestUserText: input.question, allowOptionalFollowup: false }, flags)
}

/** The native host, not the research renderer, authorizes delivery of exact recorded facts.
 * No externally supplied text/bundle can enter this path. Recheck the live receipt at delivery. */
export function deliverNativeCoachDialogue(input: Omit<Parameters<typeof prepareNativeHostDecision>[0], 'intent'>,
  flags: Flags = COACH_DIALOGUE_E1_FLAGS) {
  if (!flags.coachDialogueE1) return { ...boundary, status: 'OFF' as const }
  if (!isNativeRecordInspection(input.question)) return blocked('KEEP_ORIGINAL_REASONING')
  const host = prepareNativeHostDecision({ ...input, intent: 'CONFIRMED_RECORD_INSPECTION' })
  if (host.status !== 'PREPARED') return host
  const ctx = { latestUserText: input.question, allowOptionalFollowup: false }
  const result = dialogueExpress(host.handle, ctx, flags)
  if (result.status !== 'INTERNAL_PREVIEW') return result
  const current = hostDecisionToApprovedCoachBundle(host.handle)
  if (current.status !== 'APPROVED_FACTS_ONLY') return current
  if (!verifyDialogueE1Preview(host.handle, ctx, result.preview).pass) return blocked('STALE_DELIVERY')
  return { status: 'DELIVERABLE_FACTS_ONLY' as const, authorizedForDelivery: true as const,
    modifiesPlan: false as const, didCallModel: false as const, text: result.preview.renderedText,
    sourceIds: [...new Set(current.bundle.claims.flatMap(c => c.sourceIds))], trace: result.trace }
}
