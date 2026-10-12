import { addRun } from "@/lib/nutrition/day"
import { recordAudit } from "./audit.ts"
import { loadDecisions, markDecision, proposeDecision } from "./decisions.ts"
import { markDraftConfirmed, parseRunUtterance, prefillRun } from "./drafts.ts"
import { dispatchEvent, loadEvents } from "./events.ts"
import { abilityUnchangedBySession, deriveAthleteState, refreshAthleteState } from "./state.ts"
import type { AbilitySnapshot, DecisionRecord, OverrideReason, RiskLevel, RunDraft, SafetyStatus } from "./types.ts"

export function receiveInput(text: string) {
  return { text: text.trim().slice(0, 200) }
}

export function normalizeInput(text: string) {
  return parseRunUtterance(text)
}

export function createDraft(text: string): RunDraft {
  return prefillRun(text)
}

export function confirmDraft(draft: RunDraft | null, edited: { km: number; seconds: number; note: string; rpe: number | null }) {
  if (draft && draft.distanceKm != null && draft.distanceKm !== edited.km) {
    recordOverride({
      originalValue: `${draft.distanceKm}公里`,
      newValue: `${edited.km}公里`,
      reason: "OTHER",
      risk: "LOW",
      decisionId: draft.id,
    })
  }
  if (draft) markDraftConfirmed(draft.id)
  addRun({ km: edited.km, seconds: edited.seconds, note: edited.note.slice(0, 40) })
  if (edited.rpe != null) dispatchEvent("RPE_RECORDED", { rpe: edited.rpe, km: edited.km })
  if (draft) dispatchEvent("USER_ACCEPTED", { draftId: draft.id })
  try {
    refreshAthleteState()
  } catch {
    /* the run fact is already stored */
  }
  return loadEvents().filter((event) => event.event_type === "RUN_COMPLETED").at(-1) ?? null
}

export function buildState() {
  return refreshAthleteState()
}

function increasesLoad(action: Record<string, unknown>): boolean {
  const text = JSON.stringify(action)
  if (/不加|保持|减/.test(text) && !/加重|加量|加组/.test(text)) return false
  const sets = Number(action.setsDelta ?? 0)
  const weight = Number(action.weightDelta ?? 0)
  const km = Number(action.kmDelta ?? 0)
  if (sets > 0 || weight > 0 || km > 0) return true
  return action.load === "increase" || /加重|加量|加组|跑更/.test(text)
}

function touchesProtectedFact(decision: DecisionRecord): boolean {
  return /PROFILE|BODY|GOAL|CALORIE_TARGET/.test(decision.decision_type)
}

export function validateDecision(decision: DecisionRecord, fatigue = deriveAthleteState().recovery.fatigueScore, pain = deriveAthleteState().recovery.pain): { allowed: boolean; risk: RiskLevel; safety_status: SafetyStatus; reason: string } {
  if (pain || decision.decision_type === "INJURY") {
    return { allowed: false, risk: "CRITICAL", safety_status: "CRITICAL", reason: "有疼痛或伤病。这里不诊断，也不把这次放进普通加量。需要的话去做运动医学或康复评估。" }
  }
  if (touchesProtectedFact(decision)) {
    return { allowed: false, risk: "HIGH", safety_status: "BLOCKED", reason: "个人情况、身体记录和热量规则不能由建议改写。" }
  }
  if ((fatigue ?? 0) >= 48 && increasesLoad(decision.recommended_action)) {
    return { allowed: false, risk: "HIGH", safety_status: "BLOCKED", reason: "疲劳偏高或很高，不能加重。" }
  }
  if (decision.risk === "CRITICAL") {
    return { allowed: false, risk: "CRITICAL", safety_status: "CRITICAL", reason: "这个建议碰到安全边界，确认也不能执行。" }
  }
  if (increasesLoad(decision.recommended_action)) {
    return { allowed: false, risk: "MODERATE", safety_status: "REVIEW", reason: "加量不会从建议直接写进课表。" }
  }
  return { allowed: decision.risk === "LOW", risk: decision.risk, safety_status: decision.risk === "LOW" ? "CLEAR" : "REVIEW", reason: "可以记下，但不会改旧的课表和记录。" }
}

export function requestDecision(input: Parameters<typeof proposeDecision>[0] & { fatigue?: number; pain?: boolean }): DecisionRecord | null {
  const created = proposeDecision(input)
  if (!created) return null
  const check = validateDecision(created, input.fatigue, input.pain)
  return markDecision(created.decision_id, "OPEN", { risk: check.risk, safety_status: check.safety_status, reasoning: check.reason, required_confirmation: check.risk !== "LOW" })
}

export function confirmDecision(id: string): DecisionRecord | null {
  const found = markDecision(id, "ACCEPTED")
  if (!found) return null
  dispatchEvent("USER_ACCEPTED", { decisionId: id })
  return found
}

export function executeDecision(id: string, confirmed = false): { ok: boolean; reason: string } {
  const decision = loadDecisions().find((item) => item.decision_id === id)
  if (!decision) return { ok: false, reason: "没有这条建议" }
  if (decision.safety_status === "CRITICAL" || decision.safety_status === "BLOCKED") {
    return { ok: false, reason: decision.reasoning || "这条建议不能执行" }
  }
  const check = validateDecision(decision)
  if (decision.required_confirmation && !confirmed && decision.risk !== "LOW") {
    return { ok: false, reason: "还没确认" }
  }
  dispatchEvent("AI_DECISION_EXPIRED", { decisionId: id, executed: false, note: "低风险建议只留记录，不改课表" })
  return { ok: true, reason: check.reason }
}

export function recordOutcome(decisionId: string, note: string) {
  return dispatchEvent("TRAINING_COMPLETED", { decisionId, note, outcome: true }, { source: "SYSTEM", confidence: 0.5, dataQuality: "MEDIUM" })
}

export function recordOverride(input: { originalValue: string; newValue: string; reason: OverrideReason; risk?: RiskLevel; decisionId?: string; overridden?: boolean }) {
  const eventType = input.overridden ? "USER_OVERRIDDEN" : "USER_MODIFIED"
  recordAudit({
    source: "USER",
    action: eventType,
    originalValue: input.originalValue,
    newValue: input.newValue,
    reason: input.reason,
    risk: input.risk === "CRITICAL" || input.risk === "MODERATE" ? "HIGH" : input.risk === "HIGH" ? "HIGH" : "LOW",
    decisionId: input.decisionId ?? "",
  })
  return dispatchEvent(eventType, { originalValue: input.originalValue, newValue: input.newValue, reason: input.reason, risk: input.risk ?? "LOW", decisionId: input.decisionId ?? "" })
}

export function interruptDecision(id: string) {
  markDecision(id, "EXPIRED")
  return dispatchEvent("AI_DECISION_INTERRUPTED", { decisionId: id })
}

export function rejectDecision(id: string) {
  markDecision(id, "REJECTED")
  return dispatchEvent("USER_REJECTED", { decisionId: id })
}

export function sessionDoesNotChangeAbility(ability: AbilitySnapshot) {
  return abilityUnchangedBySession(ability)
}
