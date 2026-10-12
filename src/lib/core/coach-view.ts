import type { AbilitySnapshot, DecisionRecord } from "./types.ts"
import type { OutcomeQuality, Readiness, TrainingDecision } from "./training-decision.ts"
import { loadEvents } from "./events.ts"
import { effectiveStrengthFields, occurrenceVoided, type EffectiveNumber } from "./training-correction.ts"

export type Tone = "normal" | "caution" | "risk" | "unknown"
export type ConfidenceWord = "LOW" | "MEDIUM" | "HIGH"
export type Adopted = "AI_RECOMMENDED" | "ORIGINAL_PLAN" | "USER_MODIFIED"
export type ReasonCode = "planned" | "fatigue" | "recovery" | "pain" | "pacing" | "fitness" | "nutrition" | "competition" | "load" | "unknown"

export type SessionFacts = {
  name: string
  plannedSets: number | null
  plannedAmount: number | null
  plannedWeight: number | null
  actualSets: number | null
  actualAmount: number | null
  actualWeight: number | null
  rpe: number | null
  pain: boolean
  interrupted: boolean
  completion: boolean
  modified: boolean
  adopted: Adopted | null
  decisionId: string | null
  fatigue: number | null
}

export type Deviation = {
  sets: number | null
  reps: number | null
  loadKg: number | null
  duration: null
  intensity: null
}

export type SessionView = {
  goal: string
  actual: string
  deviation: Deviation
  reasonCode: ReasonCode
  reason: string
  quality: OutcomeQuality
  next: string
  adopted: Adopted | null
  adoptedLabel: string
  decisionId: string | null
}

const ADOPTED: Record<Adopted, string> = {
  AI_RECOMMENDED: "AI 建议",
  ORIGINAL_PLAN: "原计划",
  USER_MODIFIED: "用户修改",
}

function line(name: string, sets: number | null, amount: number | null, weight: number | null) {
  if (sets == null || amount == null || weight == null) return `${name} 未记录`
  return `${name} ${weight > 0 ? `${weight}kg × ` : ""}${sets} × ${amount}`
}

export function deviationsOf(facts: SessionFacts): Deviation {
  const sets = facts.plannedSets != null && facts.actualSets != null ? facts.actualSets - facts.plannedSets : null
  const reps = facts.plannedAmount != null && facts.actualAmount != null ? facts.actualAmount - facts.plannedAmount : null
  const ready = [facts.plannedSets, facts.plannedAmount, facts.plannedWeight, facts.actualSets, facts.actualAmount, facts.actualWeight].every((item) => item != null)
  const loadKg = ready
    ? (facts.actualSets ?? 0) * (facts.actualAmount ?? 0) * (facts.actualWeight ?? 0) - (facts.plannedSets ?? 0) * (facts.plannedAmount ?? 0) * (facts.plannedWeight ?? 0)
    : null
  return { sets, reps, loadKg, duration: null, intensity: null }
}

export function describeSession(facts: SessionFacts): SessionView {
  const deviation = deviationsOf(facts)
  let reasonCode: ReasonCode = "unknown"
  let reason = "信息不足"
  let quality: OutcomeQuality = "UNKNOWN"
  let next = "先不改重量。"
  if (facts.pain) {
    reasonCode = "pain"
    reason = "疼痛"
    quality = "UNKNOWN"
    next = "不加量。疼就停。"
  } else if (facts.interrupted) {
    reasonCode = facts.fatigue != null && facts.fatigue >= 48 ? "fatigue" : "unknown"
    reason = reasonCode === "fatigue" ? "疲劳" : "信息不足"
    quality = "UNKNOWN"
    next = "下次维持，不增加。"
  } else if (!facts.completion || facts.actualSets == null) {
    reasonCode = "unknown"
    reason = "信息不足"
  } else if (deviation.sets === 0 && deviation.reps === 0 && deviation.loadKg === 0 && !facts.modified) {
    reasonCode = "planned"
    reason = "按计划完成"
    quality = facts.rpe != null && facts.rpe <= 7 && facts.fatigue != null && facts.fatigue < 48 ? "EXCELLENT" : "GOOD"
    next = "维持。"
  } else if (deviation.sets != null && deviation.sets < 0) {
    if (facts.fatigue != null && facts.fatigue >= 48) {
      reasonCode = "fatigue"
      reason = "当前疲劳较高"
    } else {
      reasonCode = "unknown"
      reason = "信息不足"
    }
    quality = "ACCEPTABLE"
    next = "下次维持，不增加。"
  } else if (facts.modified) {
    reasonCode = facts.fatigue != null && facts.fatigue >= 48 ? "fatigue" : "unknown"
    reason = reasonCode === "fatigue" ? "疲劳" : "信息不足"
    quality = "ACCEPTABLE"
    next = "下次维持，不增加。"
  }
  return {
    goal: line(facts.name, facts.plannedSets, facts.plannedAmount, facts.plannedWeight),
    actual: facts.actualSets == null ? `${facts.name} 未记录` : line(facts.name, facts.actualSets, facts.actualAmount, facts.actualWeight),
    deviation,
    reasonCode,
    reason,
    quality,
    next,
    adopted: facts.adopted,
    adoptedLabel: facts.adopted ? ADOPTED[facts.adopted] : "未记录",
    decisionId: facts.decisionId,
  }
}

export function toneFor(readiness: Readiness | "UNKNOWN"): Tone {
  if (readiness === "UNKNOWN") return "unknown"
  if (readiness === "PAIN_REPORTED" || readiness === "REHAB" || readiness === "HIGH_FATIGUE") return "risk"
  if (readiness === "FATIGUED" || readiness === "CAUTION") return "caution"
  return "normal"
}

export function confidenceWord(value: number | null, evidenceCount: number): ConfidenceWord {
  if (value == null || evidenceCount < 2) return "LOW"
  if (evidenceCount >= 6 && value != null) return "HIGH"
  return "MEDIUM"
}

const ABILITY_LABELS = [
  ["speed", "速度"],
  ["aerobic", "有氧"],
  ["strength", "力量"],
  ["power", "爆发"],
  ["endurance", "耐力"],
  ["runningEconomy", "跑步经济性"],
  ["sportSpecificAbility", "专项能力"],
] as const

export type AbilityRow = {
  key: string
  label: string
  value: number | null
  confidence: ConfidenceWord
  trend: "数据不足"
  evidenceCount: number
  lastUpdated: string | null
}

export function abilityRows(ability: Partial<AbilitySnapshot> | null, evidenceCount = 0, lastUpdated: string | null = null): AbilityRow[] {
  return ABILITY_LABELS.map(([key, label]) => {
    const raw = ability?.[key]
    const value = typeof raw === "number" ? raw : null
    return { key, label, value, confidence: confidenceWord(value, evidenceCount), trend: "数据不足", evidenceCount, lastUpdated }
  })
}

export function limiterFrom(input: { pain: boolean; fatigue: number | null }): "疼痛" | "恢复" | "未知" {
  if (input.pain) return "疼痛"
  if (input.fatigue != null && input.fatigue >= 48) return "恢复"
  return "未知"
}

export function trendText(historyPoints: number) {
  if (historyPoints < 2) {
    return { days7: "数据不足", days28: "数据不足", cycle: "数据不足", note: "当前没有足够历史数据判断长期趋势。" }
  }
  return { days7: "有记录，但这里不推测方向", days28: "有记录，但这里不推测方向", cycle: "有记录，但这里不推测方向", note: "有历史，也不把一次课画成涨跌。" }
}

export function competitionView(input: { target: string; date: string | null; days: number | null; week: number | null; bias: string | null }) {
  if (!input.date || input.days == null || input.days < 0) return null
  const strategy = input.week === 4 || input.bias === "deload" ? "减量" : input.bias === "hold" ? "保持" : input.days <= 14 ? "比赛准备" : "发展"
  return { target: input.target || "已设日期，成绩还没写", date: input.date, days: input.days, strategy }
}

const CLOSED = new Set(["EXPIRED", "INTERRUPTED", "REJECTED", "VALIDATED"])

export function currentStoredDecision(items: DecisionRecord[], now = Date.now()): DecisionRecord | null {
  const open = items.filter((item) => {
    if (CLOSED.has(item.status)) return false
    if (item.status !== "OPEN" && item.status !== "PENDING_CONFIRMATION" && item.status !== "CREATED") return false
    const expiry = Date.parse(item.expiry)
    return Number.isNaN(expiry) || expiry > now
  })
  return open.at(-1) ?? null
}

export function suggestionAddsLoad(decision: Pick<TrainingDecision, "change" | "sets" | "amount" | "weightKg">, planned: { sets: number; amount: number; weightKg: number }) {
  return decision.change !== "none" && decision.change !== "hold" && decision.change !== "drop-set"
    ? true
    : decision.weightKg > planned.weightKg || decision.sets > planned.sets || decision.amount > planned.amount
}

export function completionOccurrenceId(payload: Record<string, unknown> | undefined): string | null {
  const key = payload?.idempotencyKey
  if (typeof key !== "string" || !key.startsWith("occurrence:")) return null
  const id = key.slice("occurrence:".length).trim()
  return id || null
}

export function latestReviewableCompletion<T extends { event_type: string; payload?: Record<string, unknown> }>(events: T[]): T | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event || event.event_type !== "TRAINING_COMPLETED") continue
    const id = completionOccurrenceId(event.payload)
    if (id && occurrenceVoided(id)) continue
    return event
  }
  return null
}

function readable(field: EffectiveNumber): boolean {
  return field.status !== "UNKNOWN" && field.value != null
}

function reviewActual(payload: Record<string, unknown>, actualAmount: number | null, actualWeight: number | null): { actualAmount: number | null; actualWeight: number | null; detail: string | null } {
  const occurrenceId = completionOccurrenceId(payload)
  if (!occurrenceId) return { actualAmount, actualWeight, detail: null }
  const sets = loadEvents().filter((event) => {
    const row = event.payload
    return event.event_type === "TRAINING_SET_COMPLETED" && row.trainingOccurrenceId === occurrenceId && row.completed === true && row.skipped !== true
  })
  if (sets.length === 0) return { actualAmount, actualWeight, detail: null }
  const rows = sets.map((event) => ({ payload: event.payload, overlay: effectiveStrengthFields(event.payload) }))
  if (rows.some((item) => item.overlay.binding !== "BOUND")) return { actualAmount, actualWeight, detail: null }
  const changed = rows.some((item) => item.overlay.weight.status !== "ORIGINAL" || (item.payload.mode !== "seconds" && item.overlay.reps.status !== "ORIGINAL"))
  if (!changed) return { actualAmount, actualWeight, detail: null }
  const reps = rows.filter((item) => item.payload.mode !== "seconds")
  const first = reps[0]
  const uniform = rows.length === reps.length && first != null && reps.every((item) => readable(item.overlay.weight) && readable(item.overlay.reps) && item.overlay.weight.value === first.overlay.weight.value && item.overlay.reps.value === first.overlay.reps.value)
  if (uniform && first) return { actualAmount: first.overlay.reps.value, actualWeight: first.overlay.weight.value, detail: null }
  if (reps.some((item) => !readable(item.overlay.weight) || !readable(item.overlay.reps))) return { actualAmount: null, actualWeight: null, detail: null }
  const detail = rows.map((item) => {
    const name = typeof item.payload.name === "string" && item.payload.name ? item.payload.name : "动作"
    const index = typeof item.payload.setIndex === "number" ? item.payload.setIndex : "?"
    if (item.payload.mode === "seconds") {
      const seconds = typeof item.payload.actualAmount === "number" ? item.payload.actualAmount : "未记录"
      const weight = item.overlay.weight.status === "UNKNOWN" ? "未记录" : item.overlay.weight.value
      return `${name} 第${index}组 ${weight}kg × ${seconds}秒`
    }
    return `${name} 第${index}组 ${item.overlay.weight.value}kg × ${item.overlay.reps.value}次`
  }).join("；")
  return { actualAmount, actualWeight, detail }
}

export function sessionFromCompleted(payload: Record<string, unknown>, fatigue: number | null): SessionView | null {
  if (completionOccurrenceId(payload) && occurrenceVoided(completionOccurrenceId(payload) as string)) return null
  const planned = payload.planned as { name?: string; sets?: number; amount?: number; weightKg?: number } | null
  const actual = payload.actual as { sets?: number; amount?: number; weightKg?: number } | null
  if (!planned && payload.setsCompleted == null) return null
  const amount = actual?.amount ?? planned?.amount ?? null
  const weight = actual?.weightKg ?? (typeof payload.loadActual === "number" ? payload.loadActual : null)
  const corrected = reviewActual(payload, typeof amount === "number" ? amount : null, typeof weight === "number" ? weight : null)
  const view = describeSession({
    name: planned?.name || "这次训练",
    plannedSets: planned?.sets ?? (typeof payload.setsPlanned === "number" ? payload.setsPlanned : null),
    plannedAmount: planned?.amount ?? null,
    plannedWeight: planned?.weightKg ?? (typeof payload.loadPlanned === "number" ? payload.loadPlanned : null),
    actualSets: actual?.sets ?? (typeof payload.setsCompleted === "number" ? payload.setsCompleted : null),
    actualAmount: corrected.actualAmount,
    actualWeight: corrected.actualWeight,
    rpe: typeof payload.rpe === "number" ? payload.rpe : null,
    pain: payload.pain === true,
    interrupted: payload.interruptions === true,
    completion: payload.completion !== false,
    modified: payload.modifications === true,
    adopted: payload.selectedAction === "AI_RECOMMENDED" || payload.selectedAction === "ORIGINAL_PLAN" || payload.selectedAction === "USER_MODIFIED" ? payload.selectedAction : null,
    decisionId: typeof payload.decisionId === "string" ? payload.decisionId : null,
    fatigue,
  })
  if (!corrected.detail) return view
  return {
    ...view,
    actual: corrected.detail,
    deviation: { sets: null, reps: null, loadKg: null, duration: null, intensity: null },
    reasonCode: "unknown",
    reason: "各组纠正值不同，不合并成一个重量",
    quality: "UNKNOWN",
    next: "先不改重量。",
  }
}
