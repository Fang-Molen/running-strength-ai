import { daysUntil } from "@/lib/strength/agent"
import { loadCoach, recordedCoachFatigue } from "@/lib/strength/coach"
import { loadDay } from "@/lib/nutrition/day"
import { loadProfile } from "@/lib/strength/profile"
import type { Plan, Session } from "@/lib/strength/model"
import { phaseOf } from "@/lib/strength/model"
import { dispatchEvent, loadEvents } from "./events.ts"
import { listTrainingOccurrences } from "./occurrence.ts"
import { excludeVoidedTrainingEvents, effectiveStrengthFields } from "./training-correction.ts"
import { readEnvelope, writeEnvelope } from "./storage.ts"
import type { EventType, RiskLevel } from "./types.ts"

export type Readiness = "READY" | "CAUTION" | "FATIGUED" | "HIGH_FATIGUE" | "PAIN_REPORTED" | "REHAB" | "UNKNOWN"

export type TrainingContext = {
  fatigue: number | null
  pain: boolean
  rehab: boolean
  sleepHours: number | null
  recentRunKm: number | null
  recentRunRpe: number | null
  daysToCompetition: number | null
  week: 1 | 2 | 3 | 4 | null
  bias: "build" | "hold" | "deload" | null
  previousFeel: "easy" | "ok" | "hard" | "pain" | "skip" | null
  facts: number
  hrv?: RecordedValue | null
  restingHeartRate?: RecordedValue | null
  snapshot?: ContextSnapshot
}

export type RecordedValue = { value: number; recordedAt: string; source: string }

export type RunSnapshot = {
  km: number | null
  seconds: number | null
  paceSecPerKm: number | null
  recordedAt: string
}

export type StrengthSnapshot = {
  plannedSets: number | null
  completedSets: number | null
  plannedReps: number | null
  completedReps: number | null
  plannedWeight: number | null
  completedWeight: number | null
  completionStatus: string | null
  strengthRpe: number | null
}

export type ContextSnapshot = {
  sleepHours: number | null
  hrv: RecordedValue | null
  restingHeartRate: RecordedValue | null
  fatigue: number | null
  rpe: number | null
  recentRunKm: number | null
  recentRunDuration: number | null
  recentRunPace: number | null
  recentRunRpe: number | null
  recentRuns: RunSnapshot[]
  todayRunKm: number | null
  strength: StrengthSnapshot
  pain: boolean
  painLocation: string[] | null
  painRecordedAt: string | null
  trainingInterrupted: boolean
  injuryReported: boolean
  rehab: boolean
  week: 1 | 2 | 3 | 4 | null
  bias: "build" | "hold" | "deload" | null
  phase: string | null
  daysToCompetition: number | null
}

export type PlannedSet = { name: string; sets: number; amount: number; weightKg: number }

export type TrainingAdjustment = {
  readiness: Readiness
  change: "none" | "hold" | "drop-set"
  sets: number
  amount: number
  weightKg: number
  reason: string
  evidence: string[]
  counterEvidence: string[]
  risk: RiskLevel
  confidence: number
  monitor: string[]
  interrupt: string[]
  next: string
}

export type TrainingDecision = TrainingAdjustment & {
  decision_id: string
  status: "PENDING_CONFIRMATION" | "ACCEPTED" | "REJECTED" | "EXECUTED" | "INTERRUPTED" | "VALIDATED"
  createdAt: string
  expiry: string
  target: string
}

export type OutcomeQuality = "POOR" | "ACCEPTABLE" | "GOOD" | "EXCELLENT" | "UNKNOWN"
export type OutcomeAssessment = "COMPLETED_AS_PLANNED" | "COMPLETED_WITH_MODIFICATION" | "PARTIALLY_COMPLETED" | "INTERRUPTED" | "NOT_COMPLETED"

const MONITOR = ["训练中的 RPE", "有没有疼"]
const INTERRUPT = ["出现疼痛", "动作明显变形"]

export function evaluateTrainingReadiness(ctx: TrainingContext): Readiness {
  if (ctx.rehab) return "REHAB"
  if (ctx.pain || ctx.previousFeel === "pain") return "PAIN_REPORTED"
  if (ctx.fatigue == null && ctx.facts < 2) return "UNKNOWN"
  if ((ctx.fatigue ?? 0) >= 72) return "HIGH_FATIGUE"
  if ((ctx.fatigue ?? 0) >= 48 || (ctx.recentRunRpe ?? 0) >= 8) return "FATIGUED"
  if (ctx.fatigue == null) return "UNKNOWN"
  if (ctx.fatigue >= 28) return "CAUTION"
  return "READY"
}

export function generateTrainingAdjustment(ctx: TrainingContext, planned: PlannedSet): TrainingAdjustment {
  const readiness = evaluateTrainingReadiness(ctx)
  const near = ctx.daysToCompetition != null && ctx.daysToCompetition >= 0 && ctx.daysToCompetition <= 28
  const evidence: string[] = []
  if (ctx.fatigue != null) evidence.push(`疲劳 ${ctx.fatigue}`)
  if (ctx.recentRunKm != null) evidence.push(`最近跑了 ${ctx.recentRunKm} 公里`)
  if (ctx.recentRunRpe != null) evidence.push(`跑步 RPE ${ctx.recentRunRpe}`)
  if (ctx.week != null) evidence.push(`第 ${ctx.week} 周`)
  if (near) evidence.push(`离成绩期限 ${ctx.daysToCompetition} 天`)
  const base = {
    readiness,
    sets: planned.sets,
    amount: planned.amount,
    weightKg: planned.weightKg,
    evidence,
    counterEvidence: ctx.previousFeel === "easy" ? ["上一节偏轻松，但开练前不因此加重量"] : [],
    monitor: MONITOR,
    interrupt: INTERRUPT,
    confidence: ctx.fatigue == null ? 0.3 : 0.7,
  }
  if (readiness === "UNKNOWN") {
    return { ...base, change: "none", risk: "LOW", reason: "数据不够，不做激进调整。", next: "先按原计划，缺的数记上再看。" }
  }
  if (readiness === "PAIN_REPORTED" || readiness === "REHAB") {
    return { ...base, change: "hold", risk: "CRITICAL", confidence: 0.8, reason: "有疼痛或在康复。停止普通加量，这里不诊断。", next: "不加重量、不加组。疼就停。" }
  }
  if (readiness === "HIGH_FATIGUE" && ctx.week !== 4 && ctx.bias !== "deload") {
    return {
      ...base,
      change: "drop-set",
      sets: Math.max(2, planned.sets - 1),
      risk: "LOW",
      reason: "疲劳很高。只少一组，重量和次数不动。",
      next: "下次先维持这个重量。",
    }
  }
  if (readiness === "FATIGUED" || readiness === "HIGH_FATIGUE" || near || ctx.bias === "hold" || ctx.bias === "deload" || ctx.week === 4) {
    const why = near
      ? "成绩期限在 28 天内，不因为一次表现去加负荷。"
      : ctx.week === 4 || ctx.bias === "deload"
        ? "这周已经是减量，开练前不再改重量。"
        : "恢复不够，不增加重量、组数或次数。"
    return { ...base, change: "hold", risk: near ? "MODERATE" : "LOW", reason: why, next: "下次维持重量。" }
  }
  return { ...base, change: "none", risk: "LOW", reason: "状态够做原计划，所以不改。", next: "维持。" }
}

export function validateTrainingDecision(ctx: TrainingContext, planned: PlannedSet, next: { sets: number; amount: number; weightKg: number }): { allowed: boolean; risk: RiskLevel; reason: string } {
  const increases = next.weightKg > planned.weightKg || next.sets > planned.sets || next.amount > planned.amount
  const readiness = evaluateTrainingReadiness(ctx)
  const near = ctx.daysToCompetition != null && ctx.daysToCompetition >= 0 && ctx.daysToCompetition <= 28
  if ((readiness === "PAIN_REPORTED" || readiness === "REHAB") && increases) {
    return { allowed: false, risk: "CRITICAL", reason: "疼痛或康复期间不能确认通过加量。" }
  }
  if (increases && (readiness === "FATIGUED" || readiness === "HIGH_FATIGUE" || readiness === "UNKNOWN" || near)) {
    return { allowed: false, risk: "HIGH", reason: "现在不能加负荷。" }
  }
  return { allowed: !increases || readiness === "READY", risk: increases ? "MODERATE" : "LOW", reason: increases ? "加量不在开练前自动做。" : "没有加重。" }
}

export function createTrainingDecision(ctx: TrainingContext, planned: PlannedSet): TrainingDecision {
  const adjustment = generateTrainingAdjustment(ctx, planned)
  const now = new Date()
  return {
    ...adjustment,
    decision_id: `td-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
    status: "PENDING_CONFIRMATION",
    createdAt: now.toISOString(),
    expiry: new Date(now.getTime() + 18 * 3600 * 1000).toISOString(),
    target: "完成本节力量课",
  }
}

export function applyAdjustment(session: Session, decision: TrainingDecision): Session {
  if (decision.change !== "drop-set") return session
  return { ...session, moves: session.moves.map((move) => ({ ...move, sets: Math.max(2, move.sets - 1) })) }
}

export function chooseAction(decisionId: string, action: "AI_RECOMMENDED" | "ORIGINAL_PLAN" | "USER_MODIFIED") {
  if (action === "ORIGINAL_PLAN") dispatchEvent("USER_REJECTED", { decisionId })
  if (action === "USER_MODIFIED") dispatchEvent("USER_MODIFIED", { decisionId, originalValue: "建议", newValue: "自己改", reason: "EXERCISE_PREFERENCE" })
  if (action === "AI_RECOMMENDED") dispatchEvent("USER_ACCEPTED", { decisionId })
  return action
}

export function startTraining(input: { decisionId: string; sessionId: string; action: "AI_RECOMMENDED" | "ORIGINAL_PLAN" | "USER_MODIFIED" }) {
  return dispatchEvent("TRAINING_STARTED", { ...input, planVersion: "fr255-strength-plan-v3", selectedAction: input.action })
}

export function interruptTraining(decisionId: string, sessionId: string) {
  dispatchEvent("AI_DECISION_INTERRUPTED", { decisionId })
  return dispatchEvent("TRAINING_INTERRUPTED", { decisionId, sessionId })
}

export function recordPain(decisionId: string, sessionId: string) {
  dispatchEvent("AI_DECISION_INTERRUPTED", { decisionId, reason: "pain" })
  return dispatchEvent("PAIN_RECORDED", { decisionId, sessionId })
}

function completionIdentity(sessionId: string, decisionId: string): string {
  const rows = listTrainingOccurrences().filter((item) => item.sessionId === sessionId)
  const open = [...rows].reverse().find((item) => item.lifecycle === "IN_PROGRESS")
  const target = open ?? rows.at(-1)
  return target ? `occurrence:${target.trainingOccurrenceId}` : `decision:${decisionId}:${sessionId}`
}

export function completeTraining(input: {
  decisionId: string
  sessionId: string
  planned: PlannedSet | null
  actualSets: number | null
  actualAmount: number | null
  actualWeightKg: number | null
  rpe: number | null
  pain: boolean
  modified: boolean
  interrupted: boolean
  partial?: boolean
}) {
  const idempotencyKey = completionIdentity(input.sessionId, input.decisionId)
  const existing = loadEvents().find((event) => event.event_type === "TRAINING_COMPLETED" && event.payload.idempotencyKey === idempotencyKey)
  if (existing) return existing
  return dispatchEvent("TRAINING_COMPLETED", {
    decisionId: input.decisionId,
    sessionId: input.sessionId,
    planned: input.planned,
    actual: input.actualSets == null ? null : { sets: input.actualSets, amount: input.actualAmount, weightKg: input.actualWeightKg },
    duration: null,
    setsCompleted: input.actualSets,
    setsPlanned: input.planned?.sets ?? null,
    loadPlanned: input.planned?.weightKg ?? null,
    loadActual: input.actualWeightKg,
    rpe: input.rpe,
    pain: input.pain,
    difficulty: null,
    completion: !input.interrupted && input.partial !== true,
    ...(input.partial === true ? {completionStatus: "PARTIAL"} : {}),
    modifications: input.modified,
    interruptions: input.interrupted,
    idempotencyKey,
  })
}

export function assessOutcome(input: { completion: boolean; interrupted: boolean; setsPlanned: number | null; setsCompleted: number | null; modified: boolean }): { assessment: OutcomeAssessment; quality: OutcomeQuality; deviation: string; next: string } {
  if (input.interrupted) return { assessment: "INTERRUPTED", quality: "UNKNOWN", deviation: "训练中断", next: "下次维持重量，不把这次记成能力下降。" }
  if (!input.completion) return { assessment: "NOT_COMPLETED", quality: "UNKNOWN", deviation: "没有完成记录", next: "先不改重量。" }
  if (input.setsPlanned == null || input.setsCompleted == null) {
    return { assessment: "COMPLETED_WITH_MODIFICATION", quality: "UNKNOWN", deviation: "组数没记全", next: "下次维持重量。" }
  }
  if (input.setsCompleted === input.setsPlanned && !input.modified) {
    return { assessment: "COMPLETED_AS_PLANNED", quality: "GOOD", deviation: "无", next: "维持。" }
  }
  if (input.setsCompleted < input.setsPlanned) {
    return { assessment: "PARTIALLY_COMPLETED", quality: "ACCEPTABLE", deviation: `少 ${input.setsPlanned - input.setsCompleted} 组`, next: "下次维持重量。" }
  }
  return { assessment: "COMPLETED_WITH_MODIFICATION", quality: "ACCEPTABLE", deviation: "和原计划不一样", next: "下次维持重量。" }
}

export function recordLearning(input: { decisionId: string; prediction: string; actual: string; success: boolean }) {
  const current = readEnvelope<{ notes?: unknown[]; learning?: unknown[]; ability?: unknown }>("fr255-memory-v1", { notes: [], learning: [] }).data
  const learning = Array.isArray(current.learning) ? current.learning : []
  writeEnvelope("fr255-memory-v1", {
    ...current,
    learning: [...learning, { ...input, at: new Date().toISOString() }].slice(-50),
  })
  return { ability: current.ability ?? null }
}

const RECENT_RUNS = 7

function payloadNumber(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return null
}

function latestOf(type: EventType) {
  return loadEvents().filter((event) => event.event_type === type).at(-1) ?? null
}

function recorded(type: EventType, keys: string[]): RecordedValue | null {
  const event = latestOf(type)
  if (!event) return null
  const value = payloadNumber(event.payload, keys)
  if (value == null) return null
  return { value, recordedAt: event.timestamp, source: event.source }
}

function runSnapshot(payload: Record<string, unknown>, recordedAt: string): RunSnapshot {
  const km = payloadNumber(payload, ["km"])
  const seconds = payloadNumber(payload, ["seconds"])
  const paceSecPerKm = km != null && km > 0 && seconds != null && seconds > 0 ? Math.round(seconds / km) : null
  return { km, seconds: seconds != null && seconds > 0 ? seconds : null, paceSecPerKm, recordedAt }
}

function emptyStrength(): StrengthSnapshot {
  return {
    plannedSets: null,
    completedSets: null,
    plannedReps: null,
    completedReps: null,
    plannedWeight: null,
    completedWeight: null,
    completionStatus: null,
    strengthRpe: null,
  }
}

function sameNumber(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value != null)
  if (known.length === 0 || known.length !== values.length) return null
  return known.every((value) => value === known[0]) ? known[0] : null
}

function actualField(payload: Record<string, unknown>, field: "weight" | "reps"): number | null {
  const overlay = effectiveStrengthFields(payload)
  if (field === "weight") {
    if (overlay.binding !== "BOUND" || overlay.weight.status === "ORIGINAL") return payloadNumber(payload, ["actualWeight"])
    return overlay.weight.value
  }
  if (payload.mode === "seconds" || overlay.binding !== "BOUND" || overlay.reps.status === "ORIGINAL") return payloadNumber(payload, ["actualAmount"])
  return overlay.reps.value
}

function strengthSnapshot(events = excludeVoidedTrainingEvents(loadEvents())): StrengthSnapshot {
  const sets = events.filter((event) => event.event_type === "TRAINING_SET_COMPLETED")
  if (sets.length === 0) return emptyStrength()
  const sessionId = sets.at(-1)?.payload.sessionId
  const mine = typeof sessionId === "string" ? sets.filter((event) => event.payload.sessionId === sessionId) : sets
  const reps = mine.filter((event) => event.payload.mode !== "seconds")
  const plannedRepValues = reps.map((event) => payloadNumber(event.payload, ["plannedAmount"]))
  const completedRepSets = reps.filter((event) => event.payload.completed === true && event.payload.skipped !== true)
  const completedRepValues = completedRepSets.map((event) => actualField(event.payload, "reps"))
  const done = mine.filter((event) => event.payload.completed === true && event.payload.skipped !== true).length
  const skipped = mine.filter((event) => event.payload.skipped === true).length
  const finished = events.filter((event) => event.event_type === "TRAINING_COMPLETED" && (typeof sessionId !== "string" || event.payload.sessionId === sessionId)).at(-1)
  const strengthRpe = finished ? payloadNumber(finished.payload, ["rpe"]) : null
  let completionStatus: string | null = null
  if (finished?.payload.interruptions === true) completionStatus = "interrupted"
  else if (finished?.payload.completion === true && skipped === 0) completionStatus = "completed"
  else if (skipped > 0 || (done > 0 && done < mine.length)) completionStatus = "partial"
  else if (finished?.payload.completion === false) completionStatus = "not_completed"
  return {
    plannedSets: mine.length,
    completedSets: done,
    plannedReps: plannedRepValues.every((value) => value != null) && plannedRepValues.length > 0 ? plannedRepValues.reduce((sum, value) => sum + (value as number), 0) : null,
    completedReps: completedRepValues.length > 0 && completedRepValues.every((value) => value != null) ? completedRepValues.reduce((sum, value) => sum + (value as number), 0) : null,
    plannedWeight: sameNumber(reps.map((event) => payloadNumber(event.payload, ["plannedWeight"]))),
    completedWeight: completedRepSets.length > 0 ? sameNumber(completedRepSets.map((event) => actualField(event.payload, "weight"))) : null,
    completionStatus,
    strengthRpe,
  }
}

export function readTrainingContext(plan: Plan | null): TrainingContext {
  const events = excludeVoidedTrainingEvents(loadEvents())
  const coach = loadCoach()
  const fatigue = recordedCoachFatigue(coach)
  const day = loadDay()
  const profile = loadProfile()
  const deadlines = profile.marks.map((mark) => daysUntil(mark.deadline)).filter((dayCount): dayCount is number => dayCount !== null)
  const soon = deadlines.length ? Math.min(...deadlines) : null
  const lastLog = plan?.cycle?.logs.at(-1)
  const rpeEvent = [...events].reverse().find((event) => event.event_type === "RPE_RECORDED") ?? null
  const rpeValue = rpeEvent ? payloadNumber(rpeEvent.payload, ["rpe"]) : null
  const recentEnough = rpeEvent ? Date.now() - new Date(rpeEvent.timestamp).getTime() < 36 * 3600 * 1000 : false
  const todayRuns = day.runs
  const run = todayRuns.at(-1)
  const sleep = recorded("SLEEP_RECORDED", ["hours", "value"])
  const hrv = recorded("HRV_RECORDED", ["hrv", "value"])
  const restingHeartRate = recorded("RHR_RECORDED", ["bpm", "rhr", "value"])
  const runEvents = events.filter((event) => event.event_type === "RUN_COMPLETED").slice(-RECENT_RUNS)
  const recentRuns = runEvents.map((event) => runSnapshot(event.payload, event.timestamp))
  const latestRun = recentRuns.at(-1) ?? null
  const todaySeconds = run && run.seconds > 0 ? run.seconds : null
  const painEvent = [...events].reverse().find((event) => event.event_type === "PAIN_RECORDED") ?? null
  const eventPlaces = Array.isArray(painEvent?.payload.moveIds) ? painEvent.payload.moveIds.filter((item): item is string => typeof item === "string") : []
  const logPlaces = lastLog?.feel === "pain" ? lastLog.painIds.filter((item) => item) : []
  let facts = 0
  if (fatigue != null) facts += 1
  if (todayRuns.length) facts += 1
  if (day.burn != null) facts += 1
  if (plan) facts += 1
  const pain = (coach.notes ?? []).some((note) => note.pain) || lastLog?.feel === "pain"
  const rehab = /康复|伤/.test(profile.limit)
  const week = plan?.cycle?.week ?? null
  const bias = plan?.cycle?.bias ?? null
  const recentRunRpe = recentEnough ? rpeValue : null
  const snapshot: ContextSnapshot = {
    sleepHours: sleep?.value ?? null,
    hrv,
    restingHeartRate,
    fatigue,
    rpe: rpeValue,
    recentRunKm: latestRun?.km ?? run?.km ?? null,
    recentRunDuration: latestRun?.seconds ?? todaySeconds,
    recentRunPace: latestRun?.paceSecPerKm ?? (run && run.km > 0 && todaySeconds != null ? Math.round(todaySeconds / run.km) : null),
    recentRunRpe,
    recentRuns,
    todayRunKm: todayRuns.length ? todayRuns.reduce((sum, item) => sum + item.km, 0) : null,
    strength: strengthSnapshot(events),
    pain,
    painLocation: eventPlaces.length ? eventPlaces : logPlaces.length ? logPlaces : null,
    painRecordedAt: painEvent?.timestamp ?? null,
    trainingInterrupted: events.some((event) => event.event_type === "TRAINING_INTERRUPTED"),
    injuryReported: events.some((event) => event.event_type === "INJURY_REPORTED"),
    rehab,
    week,
    bias,
    phase: week == null ? null : phaseOf(week).label,
    daysToCompetition: soon,
  }
  return {
    fatigue,
    pain,
    rehab,
    sleepHours: snapshot.sleepHours,
    recentRunKm: run?.km ?? null,
    recentRunRpe,
    daysToCompetition: soon,
    week,
    bias,
    previousFeel: lastLog?.feel ?? null,
    facts,
    hrv,
    restingHeartRate,
    snapshot,
  }
}

export function firstPlannedSet(session: Session | null): PlannedSet | null {
  const move = session?.moves[0]
  if (!move) return null
  return { name: move.customName || move.catalogId || "动作", sets: move.sets, amount: move.amount, weightKg: move.weightKg }
}
