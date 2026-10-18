import { currentStoredDecision } from "./coach-view.ts"
import { confirmDecision, recordOverride, rejectDecision, validateDecision } from "./control.ts"
import { loadDecisions, markDecision, proposeDecision } from "./decisions.ts"
import { dispatchEvent, loadEvents } from "./events.ts"
import { refreshAthleteState } from "./state.ts"
import { readEnvelope } from "./storage.ts"
import {
  assessOutcome,
  firstPlannedSet,
  generateTrainingAdjustment,
  readTrainingContext,
  recordLearning,
  validateTrainingDecision,
  type PlannedSet,
  type TrainingContext,
} from "./training-decision.ts"
import type { AthleteState, DecisionRecord, RiskLevel } from "./types.ts"
import type { Plan } from "@/lib/strength/model"

export const TRAINING_DECISION_TYPES = ["KEEP_PLAN", "MODIFY_SESSION", "ADJUST_LOAD", "REDUCE_VOLUME", "INCREASE_VOLUME", "SKIP_SESSION", "RECOVERY_SESSION"] as const

export type TrainingDecisionType = (typeof TRAINING_DECISION_TYPES)[number]

export type CandidateDecision = {
  candidateId: string
  decisionType: TrainingDecisionType
  target: string
  rationale: string
  evidence: string[]
  counterEvidence: string[]
  confidence: number
  uncertainty: string
  risk: RiskLevel
  expectedOutcome: string
}

const TRAINING = new Set<string>(TRAINING_DECISION_TYPES)

export function missingStatements(state: Pick<AthleteState, "recovery" | "performance"> | null): string[] {
  const lines: string[] = []
  if (!state || state.recovery.HRV == null) lines.push("HRV 未记录，无法使用 HRV 判断恢复状态。")
  if (!state || state.recovery.restingHR == null) lines.push("静息心率未记录。")
  if (!state || state.performance.rpe == null) lines.push("RPE 未记录。")
  if (!state || state.performance.recentPace == null) lines.push("当前证据不足以判断耐力变化。")
  return lines
}

function ruleType(ctx: TrainingContext, planned: PlannedSet): TrainingDecisionType {
  const adjustment = generateTrainingAdjustment(ctx, planned)
  if (adjustment.readiness === "PAIN_REPORTED" || adjustment.readiness === "REHAB") return "RECOVERY_SESSION"
  if (adjustment.change === "drop-set") return "REDUCE_VOLUME"
  return "KEEP_PLAN"
}

function candidate(type: TrainingDecisionType, ctx: TrainingContext, planned: PlannedSet, gaps: string[]): CandidateDecision {
  const adjustment = generateTrainingAdjustment(ctx, planned)
  const uncertainty = ctx.fatigue == null || adjustment.readiness === "UNKNOWN" ? "高" : gaps.length && adjustment.readiness !== "READY" ? "中" : "低"
  return {
    candidateId: `cand-${type}`,
    decisionType: type,
    target: planned.name,
    rationale: adjustment.reason,
    evidence: adjustment.evidence,
    counterEvidence: [...adjustment.counterEvidence, ...gaps],
    confidence: adjustment.confidence,
    uncertainty,
    risk: type === "RECOVERY_SESSION" ? "MODERATE" : adjustment.risk === "CRITICAL" ? "MODERATE" : adjustment.risk,
    expectedOutcome: "这是建议，不是已经发生的结果。",
  }
}

export function buildCandidates(ctx: TrainingContext, planned: PlannedSet, gaps: string[] = []): CandidateDecision[] {
  const preferred = ruleType(ctx, planned)
  const types = new Set<TrainingDecisionType>([preferred, "KEEP_PLAN"])
  if (ctx.pain || ctx.rehab) {
    types.add("RECOVERY_SESSION")
    types.add("REDUCE_VOLUME")
    types.add("SKIP_SESSION")
  }
  if (preferred === "REDUCE_VOLUME") types.add("REDUCE_VOLUME")
  return [...types].map((type) => candidate(type, ctx, planned, gaps))
}

export function filterTrainingCandidates(candidates: CandidateDecision[], ctx: TrainingContext, planned: PlannedSet): CandidateDecision[] {
  return candidates.filter((item) => {
    if (item.decisionType === "INCREASE_VOLUME") {
      return validateTrainingDecision(ctx, planned, { sets: planned.sets + 1, amount: planned.amount, weightKg: planned.weightKg }).allowed
    }
    if (item.decisionType === "ADJUST_LOAD") {
      return validateTrainingDecision(ctx, planned, { sets: planned.sets, amount: planned.amount, weightKg: planned.weightKg + 1 }).allowed
    }
    if (item.decisionType === "SKIP_SESSION") return ctx.pain || ctx.rehab
    return true
  })
}

export function arbitrateCandidates(candidates: CandidateDecision[], ctx: TrainingContext, planned: PlannedSet): { primary: CandidateDecision; alternatives: string[] } {
  const preferred = ruleType(ctx, planned)
  const rank = (type: TrainingDecisionType) => {
    if (ctx.pain || ctx.rehab) {
      if (type === "RECOVERY_SESSION") return 0
      if (type === "REDUCE_VOLUME") return 1
      if (type === "KEEP_PLAN") return 2
      if (type === "SKIP_SESSION") return 3
    }
    if (preferred === "REDUCE_VOLUME") {
      if (type === "REDUCE_VOLUME") return 0
      if (type === "KEEP_PLAN") return 1
    }
    if (type === "KEEP_PLAN") return 0
    if (type === preferred) return 1
    return 5
  }
  const ordered = [...candidates].sort((a, b) => rank(a.decisionType) - rank(b.decisionType))
  const primary = ordered[0] ?? candidate("KEEP_PLAN", ctx, planned, [])
  return { primary, alternatives: ordered.slice(1).map((item) => item.decisionType) }
}

function needsConfirmation(type: TrainingDecisionType): boolean {
  return type !== "KEEP_PLAN"
}

export function publishFromContext(ctx: TrainingContext, planned: PlannedSet, gaps: string[] = []): DecisionRecord | null {
  const filtered = filterTrainingCandidates(buildCandidates(ctx, planned, gaps), ctx, planned)
  const { primary, alternatives } = arbitrateCandidates(filtered, ctx, planned)
  const adjustment = generateTrainingAdjustment(ctx, planned)
  const created = proposeDecision({
    decisionType: primary.decisionType,
    recommended: {
      decisionType: primary.decisionType,
      change: adjustment.change,
      sets: adjustment.sets,
      plannedSets: planned.sets,
      amount: adjustment.amount,
      plannedAmount: planned.amount,
      weightKg: adjustment.weightKg,
      plannedWeightKg: planned.weightKg,
    },
    confidence: primary.confidence,
    uncertainty: primary.uncertainty,
    risk: primary.risk,
    target: planned.name,
    currentState: `疲劳 ${ctx.fatigue == null ? "未记录" : ctx.fatigue}`,
    reasoning: `${primary.rationale} 这是建议，不是已经发生的结果。`,
    evidence: primary.evidence,
    counterEvidence: primary.counterEvidence,
  })
  if (!created) return null
  const check = validateDecision(created, ctx.fatigue ?? undefined, false)
  const blocked = primary.decisionType === "INCREASE_VOLUME" || primary.decisionType === "ADJUST_LOAD" || !check.allowed && increases(created.recommended_action)
  return markDecision(created.decision_id, needsConfirmation(primary.decisionType) ? "PENDING_CONFIRMATION" : "CREATED", {
    alternative_actions: alternatives,
    required_confirmation: needsConfirmation(primary.decisionType),
    safety_status: blocked ? "BLOCKED" : needsConfirmation(primary.decisionType) ? "REVIEW" : "CLEAR",
    risk: blocked ? "HIGH" : primary.risk,
    strategy_alignment: "最小必要调整",
    monitoring_conditions: adjustment.monitor,
    interrupt_conditions: adjustment.interrupt,
    expected_outcome: primary.expectedOutcome,
    reasoning: blocked ? check.reason : created.reasoning,
  })
}

function increases(action: Record<string, unknown>): boolean {
  const sets = Number(action.sets ?? 0)
  const plannedSets = Number(action.plannedSets ?? sets)
  const weight = Number(action.weightKg ?? 0)
  const plannedWeight = Number(action.plannedWeightKg ?? weight)
  const amount = Number(action.amount ?? 0)
  const plannedAmount = Number(action.plannedAmount ?? amount)
  return sets > plannedSets || weight > plannedWeight || amount > plannedAmount
}

function expireTrainingDecisions(now = Date.now()) {
  for (const decision of loadDecisions()) {
    if (!TRAINING.has(decision.decision_type)) continue
    if (decision.status === "EXPIRED" || decision.status === "REJECTED" || decision.status === "EXECUTED" || decision.status === "VALIDATED" || decision.status === "ACCEPTED" || decision.status === "MODIFIED" || decision.status === "INTERRUPTED") continue
    const expiry = Date.parse(decision.expiry)
    if (!Number.isNaN(expiry) && expiry <= now && (decision.status === "OPEN" || decision.status === "CREATED" || decision.status === "PENDING_CONFIRMATION")) {
      markDecision(decision.decision_id, "EXPIRED")
      if (!hasDecisionEvent(decision.decision_id, "AI_DECISION_EXPIRED")) dispatchEvent("AI_DECISION_EXPIRED", { decisionId: decision.decision_id })
    }
  }
}

export function issueTrainingDecision(plan: Plan | null, state?: AthleteState | null): DecisionRecord | null {
  expireTrainingDecisions()
  const training = loadDecisions().filter((item) => TRAINING.has(item.decision_type))
  const open = currentStoredDecision(training)
  if (open) return open
  const latest = training.at(-1)
  if (latest) return latest
  const planned = firstPlannedSet(plan?.sessions[0] ?? null)
  if (!planned) return null
  return publishFromContext(readTrainingContext(plan), planned, missingStatements(state ?? null))
}

function eventDecisionId(payload: Record<string, unknown>): string | null {
  if (typeof payload.decisionId === "string") return payload.decisionId
  if (typeof payload.decision_id === "string") return payload.decision_id
  return null
}

function hasDecisionEvent(id: string, type: "USER_ACCEPTED" | "USER_REJECTED" | "USER_MODIFIED" | "USER_OVERRIDDEN" | "TRAINING_MODIFIED" | "AI_DECISION_EXPIRED"): boolean {
  return loadEvents().some((event) => event.event_type === type && eventDecisionId(event.payload) === id)
}

function newerTrainingDecision(decision: DecisionRecord): boolean {
  const all = loadDecisions().filter((item) => TRAINING.has(item.decision_type))
  const index = all.findIndex((item) => item.decision_id === decision.decision_id)
  return index >= 0 && index < all.length - 1
}

function alreadyExecuted(decision: DecisionRecord): boolean {
  return decision.status === "EXECUTED" || decision.status === "ACCEPTED" || decision.status === "VALIDATED" || hasDecisionEvent(decision.decision_id, "USER_ACCEPTED")
}

export function acceptIssued(id: string): { ok: boolean; reason: string } {
  const decision = loadDecisions().find((item) => item.decision_id === id)
  if (!decision) return { ok: false, reason: "没有这条建议" }
  if (decision.status === "REJECTED" || hasDecisionEvent(id, "USER_REJECTED")) {
    if (decision.status !== "REJECTED") markDecision(id, "REJECTED")
    return { ok: false, reason: "这条建议已经拒绝，不会再执行。" }
  }
  if (decision.status === "MODIFIED" || hasDecisionEvent(id, "USER_OVERRIDDEN") || hasDecisionEvent(id, "USER_MODIFIED")) {
    if (decision.status !== "MODIFIED") markDecision(id, "MODIFIED")
    return { ok: false, reason: "已经按你的修改记下，不会再执行原来的调整。" }
  }
  if (alreadyExecuted(decision)) {
    if (decision.decision_type !== "KEEP_PLAN" && !hasDecisionEvent(id, "TRAINING_MODIFIED")) {
      dispatchEvent("TRAINING_MODIFIED", { decisionId: id, suggested: decision.recommended_action, appliedToPlan: false })
    }
    if (decision.status !== "EXECUTED" && decision.status !== "VALIDATED") markDecision(id, "EXECUTED")
    return { ok: true, reason: "这条建议已经执行过，不会再执行一次。" }
  }
  if (newerTrainingDecision(decision)) return { ok: false, reason: "这是更早的建议，不能再执行。" }
  if (decision.status === "EXPIRED" || Date.parse(decision.expiry) <= Date.now()) {
    if (decision.status !== "EXPIRED") markDecision(id, "EXPIRED")
    if (!hasDecisionEvent(id, "AI_DECISION_EXPIRED")) dispatchEvent("AI_DECISION_EXPIRED", { decisionId: id })
    return { ok: false, reason: "这条建议已经过期。要按现在的状态重新看。" }
  }
  if (decision.safety_status === "BLOCKED" || decision.safety_status === "CRITICAL" || increases(decision.recommended_action)) {
    return { ok: false, reason: "这条建议不会加重，也不会改课表。" }
  }
  confirmDecision(id)
  if (decision.decision_type !== "KEEP_PLAN" && !hasDecisionEvent(id, "TRAINING_MODIFIED")) {
    dispatchEvent("TRAINING_MODIFIED", { decisionId: id, suggested: decision.recommended_action, appliedToPlan: false })
  }
  markDecision(id, "EXECUTED")
  try {
    refreshAthleteState()
  } catch {
    /* the event is already stored */
  }
  return { ok: true, reason: "已记下。原来的课表没有改。" }
}

export function rejectIssued(id: string) {
  const decision = loadDecisions().find((item) => item.decision_id === id)
  if (!decision) return null
  if (alreadyExecuted(decision)) return null
  if (decision.status === "REJECTED" || hasDecisionEvent(id, "USER_REJECTED")) {
    if (decision.status !== "REJECTED") markDecision(id, "REJECTED")
    return loadEvents().find((event) => event.event_type === "USER_REJECTED" && eventDecisionId(event.payload) === id) ?? null
  }
  if (decision.status === "EXPIRED" || Date.parse(decision.expiry) <= Date.now()) {
    if (decision.status !== "EXPIRED") markDecision(id, "EXPIRED")
    if (!hasDecisionEvent(id, "AI_DECISION_EXPIRED")) dispatchEvent("AI_DECISION_EXPIRED", { decisionId: id })
    return null
  }
  return rejectDecision(id)
}

export function overrideIssued(id: string, text: string) {
  const decision = loadDecisions().find((item) => item.decision_id === id)
  if (!decision) return null
  if (alreadyExecuted(decision) || decision.status === "REJECTED" || decision.status === "EXPIRED" || Date.parse(decision.expiry) <= Date.now()) return null
  if (decision.status === "MODIFIED" || hasDecisionEvent(id, "USER_OVERRIDDEN") || hasDecisionEvent(id, "USER_MODIFIED")) {
    if (decision.status !== "MODIFIED") markDecision(id, "MODIFIED")
    return loadEvents().find((event) => (event.event_type === "USER_OVERRIDDEN" || event.event_type === "USER_MODIFIED") && eventDecisionId(event.payload) === id) ?? null
  }
  const event = recordOverride({
    originalValue: decision.reasoning || "原建议",
    newValue: text,
    reason: "COACH_DISAGREEMENT",
    risk: "LOW",
    decisionId: id,
    overridden: true,
  })
  markDecision(id, "MODIFIED")
  return event
}

export function outcomeFeedback(decisionId: string): string | null {
  const done = loadEvents().filter((event) => event.event_type === "TRAINING_COMPLETED" && (event.payload as { decisionId?: string }).decisionId === decisionId).at(-1)
  if (!done) return null
  const payload = done.payload as { setsPlanned?: number | null; setsCompleted?: number | null; rpe?: number | null; pain?: boolean; modifications?: boolean; interruptions?: boolean; completion?: boolean }
  const assessed = assessOutcome({
    completion: payload.completion !== false,
    interrupted: payload.interruptions === true,
    setsPlanned: typeof payload.setsPlanned === "number" ? payload.setsPlanned : null,
    setsCompleted: typeof payload.setsCompleted === "number" ? payload.setsCompleted : null,
    modified: payload.modifications === true,
  })
  const memory = readEnvelope<{ learning?: { decisionId?: string }[]; ability?: unknown }>("fr255-memory-v1", { learning: [] }).data
  const learning = Array.isArray(memory.learning) ? memory.learning : []
  if (!learning.some((item) => item.decisionId === decisionId)) {
    // Adherence is not a prospective prediction. No testable pre-registered outcome exists here.
    recordLearning({ decisionId, prediction: "未登记可检验的事前预期", actual: assessed.assessment, success: null, validation: "NOT_TESTABLE" })
  }
  const rpe = typeof payload.rpe === "number" ? `RPE ${payload.rpe}` : "RPE 未记录。"
  const pain = payload.pain === true ? "有疼痛记录。这里不诊断。" : "疼痛未记成有。"
  return `事实：完成情况 ${assessed.assessment}。${rpe}${pain} 判断：${assessed.deviation}。建议：${assessed.next} 一次训练不改变长期能力。`
}

export function inboxCopy(decision: DecisionRecord): { headline: string; action: string; reason: string; confidence: string; uncertainty: string; needsConfirm: boolean } {
  const action =
    decision.decision_type === "REDUCE_VOLUME"
      ? "建议减少本次训练量"
      : decision.decision_type === "RECOVERY_SESSION"
        ? "建议按恢复来练，今天不加量"
        : decision.decision_type === "SKIP_SESSION"
          ? "建议这次先不练"
          : "按原计划训练"
  const confidence = decision.confidence >= 0.75 ? "高" : decision.confidence >= 0.5 ? "中" : "低"
  return {
    headline: "今日训练建议",
    action,
    reason: decision.reasoning,
    confidence,
    uncertainty: decision.uncertainty || "低",
    needsConfirm: decision.required_confirmation,
  }
}
