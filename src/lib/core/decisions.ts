import { dispatchEvent } from "./events.ts"
import { readEnvelope, writeEnvelope } from "./storage.ts"
import type { DecisionRecord, RiskLevel } from "./types.ts"

export const DECISIONS_KEY = "fr255-decisions-v1"

export function loadDecisions(): DecisionRecord[] {
  const data = readEnvelope<DecisionRecord[]>(DECISIONS_KEY, []).data
  return Array.isArray(data) ? data : []
}

export function proposeDecision(input: {
  decisionType: string
  recommended: Record<string, unknown>
  confidence?: number
  uncertainty?: string
  risk?: RiskLevel
  expiryHours?: number
  target?: string
  currentState?: string
  reasoning?: string
  evidence?: string[]
  counterEvidence?: string[]
}): DecisionRecord | null {
  const now = new Date()
  const decision: DecisionRecord = {
    decision_id: `dec-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
    cycle_id: "local-cycle",
    athlete_id: "local",
    decision_type: input.decisionType,
    target: input.target ?? "",
    current_state: input.currentState ?? "",
    reasoning: input.reasoning ?? "尚未执行。建议不是事实。",
    evidence: input.evidence ?? [],
    counter_evidence: input.counterEvidence ?? [],
    recommended_action: input.recommended,
    alternative_actions: [],
    confidence: input.confidence ?? 0.5,
    uncertainty: input.uncertainty ?? "规则以外的建议，尚未执行",
    risk: input.risk ?? "LOW",
    safety_status: "REVIEW",
    strategy_alignment: "未核对",
    required_confirmation: true,
    reversibility: "EASY",
    monitoring_conditions: ["下一节的感觉", "疼痛"],
    interrupt_conditions: ["疼痛", "疲劳很高"],
    expected_outcome: "确认前不改变课表、跑量、热量或身体记录",
    expiry: new Date(now.getTime() + (input.expiryHours ?? 18) * 3600 * 1000).toISOString(),
    created_at: now.toISOString(),
    status: "OPEN",
  }
  const saved = writeEnvelope(DECISIONS_KEY, [...loadDecisions(), decision].slice(-200))
  if (!saved) return null
  dispatchEvent("AI_DECISION_CREATED", { decision_id: decision.decision_id, decision_type: decision.decision_type }, { source: "SYSTEM", confidence: decision.confidence, dataQuality: "MEDIUM" })
  return decision
}

export function markDecision(id: string, status: DecisionRecord["status"], patch?: Partial<DecisionRecord>): DecisionRecord | null {
  const all = loadDecisions()
  const found = all.find((item) => item.decision_id === id)
  if (!found) return null
  Object.assign(found, patch, { status })
  const saved = writeEnvelope(DECISIONS_KEY, all)
  return saved ? found : null
}
