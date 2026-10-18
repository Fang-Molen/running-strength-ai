import { dispatchEvent, loadEvents } from "./events.ts"
import { listTrainingOccurrences } from "./occurrence.ts"
import { effectiveStrengthFields } from "./training-correction.ts"
import { displayName, type Session } from "@/lib/strength/model"

export type SetSource = "user_confirmed_plan" | "user_entered"

export type SetRecord = {
  moveId: string
  name: string
  setIndex: number
  mode: "reps" | "seconds"
  plannedWeight: number
  plannedAmount: number
  restSec: number
  actualWeight: number | null
  actualAmount: number | null
  completed: boolean
  skipped: boolean
  modified: boolean
  source: SetSource | null
  timestamp: string | null
  effective?: "CORRECTED" | "UNKNOWN"
  /** 可选：本组自评 RPE（1–10，可含小数）；未填不写入。 */
  rpe?: number
  /** 可选：本组完成后实际休息秒数（引导模式记录）；未填不写入。 */
  actualRestSec?: number
}

export function emptySets(session: Session): SetRecord[] {
  return session.moves.flatMap((move) =>
    Array.from({ length: Math.max(0, move.sets) }, (_, index) => ({
      moveId: move.id,
      name: displayName(move),
      setIndex: index + 1,
      mode: move.mode,
      plannedWeight: move.weightKg,
      plannedAmount: move.amount,
      restSec: move.restSec,
      actualWeight: null,
      actualAmount: null,
      completed: false,
      skipped: false,
      modified: false,
      source: null,
      timestamp: null,
    })),
  )
}

export function deviationOf(set: SetRecord): { weightKg: number | null; amount: number | null; completion: number | null } {
  if (!set.completed || set.skipped || set.actualAmount == null || (set.mode === "reps" && set.actualWeight == null)) {
    return { weightKg: null, amount: null, completion: null }
  }
  const weightKg = set.mode === "reps" ? (set.actualWeight as number) - set.plannedWeight : 0
  const amount = set.actualAmount - set.plannedAmount
  if (set.plannedAmount <= 0) return { weightKg, amount, completion: null }
  const plannedLoad = set.plannedWeight > 0 ? set.plannedWeight * set.plannedAmount : set.plannedAmount
  const actualLoad = set.plannedWeight > 0 ? (set.actualWeight as number) * set.actualAmount : set.actualAmount
  if (plannedLoad <= 0) return { weightKg, amount, completion: null }
  return { weightKg, amount, completion: Math.round((actualLoad / plannedLoad) * 100) }
}

export function totalsOf(sets: SetRecord[]): { planned: number | null; actual: number | null; done: number; skipped: number; open: number } {
  const open = sets.filter((set) => !set.completed && !set.skipped).length
  const done = sets.filter((set) => set.completed).length
  const skipped = sets.filter((set) => set.skipped).length
  if (sets.some((set) => set.completed && set.actualAmount == null)) return { planned: null, actual: null, done, skipped, open }
  const planned = sets.reduce((sum, set) => sum + (set.plannedWeight > 0 ? set.plannedWeight * set.plannedAmount : 0), 0)
  const actual = sets.filter((set) => set.completed).reduce((sum, set) => sum + ((set.actualWeight ?? 0) > 0 ? (set.actualWeight as number) * (set.actualAmount as number) : 0), 0)
  return { planned, actual, done, skipped, open }
}

export function outcomeReason(input: { pain: boolean; stated: string | null }): "疼痛" | "Unknown" | string {
  if (input.pain) return "疼痛"
  const text = input.stated?.trim()
  return text ? text : "Unknown"
}

export function restLeft(totalSeconds: number, elapsedMs: number): number {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return 0
  return Math.max(0, totalSeconds - Math.floor(Math.max(0, elapsedMs) / 1000))
}

export function mainDeviation(sets: SetRecord[]): string {
  const hit = sets.find((set) => {
    const gap = deviationOf(set)
    return gap.amount != null && gap.amount !== 0
  })
  if (!hit) return sets.some((set) => set.skipped) ? "有组被跳过" : "Unknown"
  const gap = deviationOf(hit)
  return `第 ${hit.setIndex} 组${hit.name} ${gap.amount! > 0 ? "多" : "少"} ${Math.abs(gap.amount!)} ${hit.mode === "seconds" ? "秒" : "次"}`
}

function payloadOf(sessionId: string, decisionId: string, set: SetRecord): Record<string, unknown> {
  return { sessionId, decisionId, ...set }
}

export function stepRest(seconds: number, running: boolean): { seconds: number; running: boolean } {
  if (!running) return { seconds, running: false }
  if (seconds <= 1) return { seconds: 0, running: false }
  return { seconds: seconds - 1, running: true }
}

export function setLine(set: SetRecord): { title: string; plan: string; actual: string; gap: string; state: "已完成" | "按计划确认" | "已修改" | "跳过" | "未完成" } {
  const title = `${set.name} 第 ${set.setIndex} 组`
  const unit = set.mode === "seconds" ? "秒" : ""
  const plan = `${set.plannedWeight > 0 ? `${set.plannedWeight} kg × ` : "自重 × "}${set.plannedAmount}${unit}`
  if (set.effective === "UNKNOWN") return { title, plan, actual: "纠正值无法读取", gap: "", state: "已完成" }
  if (set.skipped) return { title, plan, actual: "跳过", gap: "", state: "跳过" }
  if (!set.completed || set.actualAmount == null) return { title, plan, actual: "未完成", gap: "", state: "未完成" }
  const gap = deviationOf(set)
  const parts: string[] = []
  const hasWeight = set.plannedWeight > 0 || (set.actualWeight != null && set.actualWeight > 0)
  if (hasWeight && gap.weightKg != null && set.mode === "reps") parts.push(`重量 ${gap.weightKg > 0 ? `+${gap.weightKg}` : gap.weightKg} kg`)
  if (gap.amount != null && set.mode === "reps") parts.push(`次数 ${gap.amount > 0 ? `+${gap.amount}` : gap.amount} 次`)
  if (gap.amount != null && set.mode === "seconds") parts.push(`时间 ${gap.amount > 0 ? `+${gap.amount}` : gap.amount} 秒`)
  const actual = `${set.actualWeight != null && set.actualWeight > 0 ? `${set.actualWeight} kg × ` : "自重 × "}${set.actualAmount}${unit}`
  const state = set.modified ? "已修改" : set.source === "user_confirmed_plan" ? "按计划确认" : "已完成"
  return { title, plan, actual, gap: parts.join(" · "), state }
}

export function feedbackOf(sessionId: string): string | null {
  const last = loadEvents().filter((event) => event.event_type === "SUBJECTIVE_FEEDBACK" && (event.payload as { sessionId?: string }).sessionId === sessionId).at(-1)
  const text = (last?.payload as { text?: unknown } | undefined)?.text
  return typeof text === "string" && text.trim() ? text : null
}

export function painOf(sessionId: string): boolean {
  return loadEvents().some((event) => event.event_type === "PAIN_RECORDED" && (event.payload as { sessionId?: string }).sessionId === sessionId)
}

export function recordSet(sessionId: string, decisionId: string, set: SetRecord) {
  const open = [...listTrainingOccurrences()].reverse().find((item) => item.sessionId === sessionId && item.lifecycle === "IN_PROGRESS")
  const payload = payloadOf(sessionId, decisionId, set)
  if (open) payload.trainingOccurrenceId = open.trainingOccurrenceId
  return dispatchEvent("TRAINING_SET_COMPLETED", payload, { source: "MANUAL", confidence: set.source === "user_entered" ? 1 : 0.8, dataQuality: set.source === "user_entered" ? "HIGH" : "MEDIUM" })
}

function asSet(payload: Record<string, unknown>): SetRecord | null {
  if (typeof payload.moveId !== "string" || typeof payload.setIndex !== "number") return null
  const overlay = effectiveStrengthFields(payload)
  const timed = payload.mode === "seconds"
  let actualWeight = typeof payload.actualWeight === "number" ? payload.actualWeight : null
  let actualAmount = typeof payload.actualAmount === "number" ? payload.actualAmount : null
  let effective: "CORRECTED" | "UNKNOWN" | undefined
  if (overlay.binding === "BOUND") {
    const weightChanged = overlay.weight.status !== "ORIGINAL"
    const repsChanged = !timed && overlay.reps.status !== "ORIGINAL"
    if (weightChanged || repsChanged) {
      if (overlay.weight.status === "UNKNOWN" || (repsChanged && overlay.reps.status === "UNKNOWN")) effective = "UNKNOWN"
      else {
        if (overlay.weight.status === "CORRECTED") actualWeight = overlay.weight.value
        if (overlay.reps.status === "CORRECTED") actualAmount = overlay.reps.value
        effective = "CORRECTED"
      }
    }
  }
  return {
    moveId: payload.moveId,
    name: typeof payload.name === "string" ? payload.name : "",
    setIndex: payload.setIndex,
    mode: timed ? "seconds" : "reps",
    plannedWeight: typeof payload.plannedWeight === "number" ? payload.plannedWeight : 0,
    plannedAmount: typeof payload.plannedAmount === "number" ? payload.plannedAmount : 0,
    restSec: typeof payload.restSec === "number" ? payload.restSec : 0,
    actualWeight,
    actualAmount,
    completed: payload.completed === true,
    skipped: payload.skipped === true,
    modified: payload.modified === true,
    source: payload.source === "user_entered" || payload.source === "user_confirmed_plan" ? payload.source : null,
    timestamp: typeof payload.timestamp === "string" ? payload.timestamp : null,
    ...(effective ? { effective } : {}),
    ...(typeof payload.rpe === "number" && Number.isFinite(payload.rpe) ? { rpe: payload.rpe } : {}),
    ...(typeof payload.actualRestSec === "number" && Number.isFinite(payload.actualRestSec) ? { actualRestSec: payload.actualRestSec } : {}),
  }
}

export function executionOf(sessionId: string): { open: boolean; decisionId: string | null; sets: SetRecord[] } {
  const events = loadEvents().filter((event) => {
    const payload = event.payload as { sessionId?: string }
    return payload.sessionId === sessionId && (event.event_type === "TRAINING_STARTED" || event.event_type === "TRAINING_SET_COMPLETED" || event.event_type === "TRAINING_COMPLETED" || event.event_type === "TRAINING_INTERRUPTED")
  })
  let start = -1
  events.forEach((event, index) => {
    if (event.event_type === "TRAINING_STARTED") start = index
  })
  if (start < 0) {
    const sets = events.filter((event) => event.event_type === "TRAINING_SET_COMPLETED").map((event) => asSet(event.payload)).filter((set): set is SetRecord => set != null)
    return { open: false, decisionId: null, sets }
  }
  const slice = events.slice(start)
  const closed = slice.some((event) => event.event_type === "TRAINING_COMPLETED" || event.event_type === "TRAINING_INTERRUPTED")
  const decisionId = typeof (slice[0].payload as { decisionId?: string }).decisionId === "string" ? (slice[0].payload as { decisionId: string }).decisionId : null
  const sets = slice.filter((event) => event.event_type === "TRAINING_SET_COMPLETED").map((event) => asSet(event.payload)).filter((set): set is SetRecord => set != null)
  return { open: !closed, decisionId, sets }
}

export function mergeSets(planned: SetRecord[], logged: SetRecord[]): SetRecord[] {
  return planned.map((slot) => logged.filter((item) => item.moveId === slot.moveId && item.setIndex === slot.setIndex).at(-1) ?? slot)
}
