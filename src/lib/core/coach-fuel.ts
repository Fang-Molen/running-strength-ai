import type { FoodEntry } from "@/lib/nutrition/log"
import { calendarDay } from "./coach-calendar.ts"

export type CoachFuel = {
  trainingDay: string | null
  todayDay: string
  targetKcal: number | null
  entries: { id: string; kcal: number }[]
  recordedKcal: number | null
  status: "SAME_DAY_RECORDED" | "NO_RECORD" | "DIFFERENT_DAY"
  logSourceId: string | null
  targetSourceId: string | null
}

export function fuelForTraining(startedAt: string | null, now: string, allEntries: FoodEntry[], targetKcal: number | null): CoachFuel {
  const trainingDay = startedAt ? calendarDay(startedAt) : null
  const todayDay = calendarDay(now) ?? ""
  const sameDay = Boolean(trainingDay && trainingDay === todayDay)
  const entries = sameDay
    ? allEntries.filter((entry): entry is FoodEntry & {kcal:number} => typeof entry.kcal === "number" && entry.date === todayDay && typeof entry.id === "string" && Number.isFinite(entry.kcal) && entry.kcal >= 0).slice(0, 200).map((entry) => ({ id: entry.id.slice(0, 80), kcal: entry.kcal }))
    : []
  const status = !sameDay ? "DIFFERENT_DAY" : entries.length ? "SAME_DAY_RECORDED" : "NO_RECORD"
  const target = sameDay && targetKcal != null && Number.isFinite(targetKcal) && targetKcal > 0 ? Math.round(targetKcal) : null
  return {
    trainingDay, todayDay, targetKcal: target, entries,
    recordedKcal: entries.length ? Math.round(entries.reduce((sum, item) => sum + item.kcal, 0)) : null,
    status,
    logSourceId: entries.length ? `nutrition:log:${todayDay}` : null,
    targetSourceId: target != null ? `context:fuel-target:${todayDay}` : null,
  }
}

export function assertCoachFuel(fuel: CoachFuel | null | undefined): void {
  if (fuel == null) return
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fuel.todayDay) || (fuel.trainingDay !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fuel.trainingDay)) ||
    !Array.isArray(fuel.entries) || fuel.entries.length > 200 || fuel.entries.some((entry) => !entry || typeof entry.id !== "string" || entry.id.length > 80 || !Number.isFinite(entry.kcal) || entry.kcal < 0 || entry.kcal > 10000) ||
    (fuel.targetKcal !== null && (!Number.isInteger(fuel.targetKcal) || fuel.targetKcal < 1 || fuel.targetKcal > 10000))) throw new Error("bad fuel packet")
  const sameDay = fuel.trainingDay === fuel.todayDay
  const expectedStatus = !sameDay ? "DIFFERENT_DAY" : fuel.entries.length ? "SAME_DAY_RECORDED" : "NO_RECORD"
  const expectedRecorded = fuel.entries.length ? Math.round(fuel.entries.reduce((sum, entry) => sum + entry.kcal, 0)) : null
  if (fuel.status !== expectedStatus || fuel.recordedKcal !== expectedRecorded ||
    fuel.logSourceId !== (fuel.entries.length ? `nutrition:log:${fuel.todayDay}` : null) ||
    fuel.targetSourceId !== (fuel.targetKcal != null ? `context:fuel-target:${fuel.todayDay}` : null) ||
    (!sameDay && (fuel.entries.length > 0 || fuel.targetKcal !== null))) throw new Error("bad fuel packet")
}

export function fuelClaimNeedsSource(text: string): boolean {
  return /\d+\s*(?:千卡|kcal)|热量目标|摄入(?:量|记录)/i.test(text)
}

export function unsupportedFuelConclusion(text: string): boolean {
  const negated = text.replace(/(?:不能|无法|尚不能|不足以|不等于|不代表|并非|不是|不应|不可)(?:据此|确定|判断|认为|证明|推断|确认)?[^，。；!?]{0,18}(?:热量赤字|能量赤字|摄入不足|营养不足|吃得太少|没吃够|能力不够|能力不足|热量导致掉速|摄入导致掉速)/g, "")
  return /热量赤字|能量赤字|全天(?:实际)?摄入不足|(?:实际)?摄入不足|营养不足|吃得太少|没吃够|(?:掉速|变慢).{0,12}(?:是因为|由于|归因于|证明).{0,12}(?:热量|能量|摄入|能力不够|能力不足)|(?:热量|能量|摄入).{0,12}(?:导致|造成|解释了).{0,12}(?:掉速|变慢)/i.test(negated)
}
