import { bandOf, daysUntil, type FatigueBand } from "@/lib/strength/agent"
import { loadCoach, recordedCoachFatigue } from "@/lib/strength/coach"
import { loadPlan } from "@/lib/strength/model"
import { loadProfile } from "@/lib/strength/profile"
import { bodyTrend } from "@/lib/nutrition/body"
import { computePlan, todayEatTarget } from "@/lib/nutrition/calc"
import { formatDuration, loadDay } from "@/lib/nutrition/day"
import { todayEaten, todayEntries } from "@/lib/nutrition/log"
import { loadEvents, onAppEvent } from "./events.ts"
import { excludeVoidedTrainingEvents, occurrenceVoided } from "./training-correction.ts"
import { readEnvelope, writeEnvelope } from "./storage.ts"
import { SCHEMA_VERSION, type AbilitySnapshot, type AthleteState, type DataQuality } from "./types.ts"

export const STATE_KEY = "fr255-state-v1"

export function emptyAbility(): AbilitySnapshot {
  return {
    speed: null,
    aerobic: null,
    strength: null,
    power: null,
    endurance: null,
    runningEconomy: null,
    sportSpecificAbility: null,
    limiter: null,
    confidence: 0,
  }
}

/** One run, one miss, or one good day does not change underlying ability. */
export function abilityUnchangedBySession(ability: AbilitySnapshot): AbilitySnapshot {
  return { ...ability }
}

function recoveryLabel(band: FatigueBand): string {
  if (band === "fresh") return "恢复较好"
  if (band === "ready") return "正常"
  if (band === "tired") return "疲劳"
  return "高疲劳"
}

function todayUsable(band: FatigueBand): string {
  if (band === "tired" || band === "cooked") return "结合已记录的疲劳和症状评估本次表现；长期能力仍需同协议数据。"
  return "今天的表现单独看；恢复记录不能换算长期能力分。"
}

export function emptyAthleteState(): AthleteState {
  return {
    physical: { weight: null, bodyFat: null, muscleMass: null, bmi: null, bodyTrend: "还没有体测", confidence: 0 },
    training: {
      weeklySessions: null,
      recentTrainingLoad: null,
      recentRunningVolume: null,
      strengthLoad: null,
      trainingDensity: null,
      monotony: null,
      consistency: null,
      currentCycle: null,
      currentWeek: null,
      confidence: 0,
    },
    recovery: { fatigueScore: null, recoveryStatus: "未知", sleep: null, restingHR: null, HRV: null, soreness: null, pain: false, confidence: 0 },
    nutrition: {
      calorieTarget: null,
      caloriesConsumed: null,
      proteinTarget: null,
      proteinConsumed: null,
      energyAvailability: "未知",
      deficitOrSurplus: null,
      confidence: 0,
    },
    performance: {
      recentRuns: "",
      recentPace: null,
      recentDuration: null,
      rpe: null,
      performanceTrend: "",
      targetStatus: "",
      todayUsable: "今天的表现单独看，不改能力",
      confidence: 0,
    },
    ability: emptyAbility(),
    competition: { target: "", date: null, daysRemaining: null, criticality: "未知" },
    environment: { weather: null, heat: null, humidity: null, surface: null, equipment: null, schedule: null },
    uncertainty: { overall: "UNKNOWN", missingData: [], conflictingData: [], outOfModel: false },
    generatedAt: "",
    schemaVersion: SCHEMA_VERSION,
  }
}

function quality(filled: number): DataQuality {
  if (filled >= 4) return "HIGH"
  if (filled >= 2) return "MEDIUM"
  if (filled >= 1) return "LOW"
  return "UNKNOWN"
}

function lastNumber(type: string): number | null {
  const source = type === "RPE_RECORDED" || type === "PAIN_RECORDED" ? excludeVoidedTrainingEvents(loadEvents()) : loadEvents()
  const found = [...source].reverse().find((event) => {
    if (event.event_type !== type) return false
    const bound = typeof event.payload.trainingOccurrenceId === "string" ? event.payload.trainingOccurrenceId : ""
    return !(bound && occurrenceVoided(bound))
  })
  if (!found) return null
  const payload = found.payload as Record<string, unknown>
  const value = payload.rpe ?? payload.hours ?? payload.hrv ?? payload.bpm ?? payload.value
  return typeof value === "number" ? value : null
}

/** State is derived. It is not a fact, and it does not write back into logs. */
export function deriveAthleteState(): AthleteState {
  const state = emptyAthleteState()
  try {
    const coach = loadCoach()
    const fatigue = recordedCoachFatigue(coach)
    const band = fatigue == null ? null : (coach.band || bandOf(coach.fatigue))
    const profile = loadProfile()
    const plan = loadPlan()
    const day = loadDay()
    const body = bodyTrend()
    const missing = ["跑步只有当天记录，没有长期历史", "没有睡眠", "没有 HRV", "没有静息心率"]
    const painKnown = coach.notes.length > 0
    state.recovery.fatigueScore = fatigue
    state.recovery.recoveryStatus = band == null ? "未知" : recoveryLabel(band)
    state.recovery.pain = painKnown ? coach.notes.some((note) => note.pain) : false
    state.recovery.sleep = lastNumber("SLEEP_RECORDED")
    state.recovery.HRV = lastNumber("HRV_RECORDED")
    state.recovery.restingHR = lastNumber("RHR_RECORDED")
    if (state.recovery.sleep != null) missing.splice(missing.indexOf("没有睡眠"), 1)
    if (state.recovery.HRV != null) missing.splice(missing.indexOf("没有 HRV"), 1)
    if (state.recovery.restingHR != null) missing.splice(missing.indexOf("没有静息心率"), 1)
    if (fatigue == null) missing.push("疲劳未记录，默认值不是恢复证据")
    if (!painKnown) missing.push("疼痛未记录，不能当成没有疼痛")
    state.recovery.confidence = fatigue == null ? 0 : 0.8
    if (plan?.cycle) {
      state.training.currentCycle = plan.cycle.block
      state.training.currentWeek = plan.cycle.week
      state.training.recentTrainingLoad = plan.cycle.logs.length
      const asked = plan.cycle.week === 4 && plan.sessions.length > 2 ? plan.sessions.length - 1 : plan.sessions.length
      state.training.consistency = asked > 0 ? plan.cycle.logs.length / asked : null
      state.training.strengthLoad = plan.sessions.reduce((sum, session) => sum + session.moves.reduce((inner, move) => inner + move.sets, 0), 0)
    }
    state.training.weeklySessions = profile.days || null
    state.training.recentRunningVolume = day.runs.reduce((sum, run) => sum + run.km, 0) || null
    state.training.confidence = day.runs.length ? 0.4 : 0.2
    const nutrition = computePlan(profile)
    const eaten = todayEaten()
    const protein = todayEntries().reduce((sum, item) => sum + (item.protein ?? 0), 0)
    if (nutrition) {
      const target = todayEatTarget(nutrition)
      state.nutrition.calorieTarget = target
      state.nutrition.proteinTarget = nutrition.protein
      state.nutrition.deficitOrSurplus = Math.round(eaten - target)
      state.nutrition.energyAvailability = day.burn != null ? "按运动设备总消耗" : "按公式"
      state.nutrition.confidence = 0.7
    }
    state.nutrition.caloriesConsumed = eaten
    state.nutrition.proteinConsumed = Math.round(protein)
    const latest = body.latest
    const profileKg = Number(profile.weightKg)
    state.physical.weight = latest?.weight ?? (profileKg >= 35 ? profileKg : null)
    state.physical.bodyFat = latest?.fat ?? (Number(profile.bodyFat) > 0 ? Number(profile.bodyFat) : null)
    state.physical.muscleMass = latest?.muscle ?? null
    state.physical.bmi = latest?.bmi ?? null
    const bits = []
    if (body.delta != null) bits.push(`比上次 ${body.delta >= 0 ? "+" : ""}${body.delta.toFixed(1)}`)
    if (body.avg7 != null) bits.push(`近 7 天 ${body.avg7.toFixed(1)}`)
    if (body.weekDelta != null) bits.push(`比前一周 ${body.weekDelta >= 0 ? "+" : ""}${body.weekDelta.toFixed(1)}`)
    state.physical.bodyTrend = bits.join("，") || "还没有足够的称重"
    state.physical.confidence = latest ? 0.8 : 0.3
    if (latest && profileKg >= 35 && Math.abs(latest.weight - profileKg) >= 1) {
      state.uncertainty.conflictingData.push("体测体重和个人情况里的体重不一致，没有互相覆盖")
    }
    const stored = readEnvelope<{ ability?: AbilitySnapshot }>("fr255-memory-v1", {}).data.ability
    state.ability = stored ? { ...emptyAbility(), ...stored } : emptyAbility()
    state.performance.todayUsable = band == null ? "疲劳未记录，不能当成恢复充分" : todayUsable(band)
    state.performance.recentRuns = day.runs.map((run) => `${run.note ? `${run.note} ` : ""}${run.km}公里${run.seconds ? ` ${formatDuration(run.seconds)}` : ""}`).join("；")
    const timed = day.runs.find((run) => run.km > 0 && run.seconds > 0)
    if (timed) {
      const pace = Math.round(timed.seconds / timed.km)
      state.performance.recentPace = `${Math.floor(pace / 60)}分${String(pace % 60).padStart(2, "0")}/公里`
      state.performance.recentDuration = formatDuration(timed.seconds)
    }
    state.performance.rpe = lastNumber("RPE_RECORDED")
    state.performance.performanceTrend = state.performance.recentRuns || "今天还没有跑步"
    const marks = profile.marks.filter((mark) => mark.goal || mark.recent || mark.deadline)
    state.performance.targetStatus = marks.map((mark) => `${mark.meters}米 目标 ${mark.goal || "未设"}`).join("；")
    state.performance.confidence = day.runs.length ? 0.5 : 0.2
    const deadlines = profile.marks.map((mark) => ({ mark, days: daysUntil(mark.deadline) })).filter((item): item is { mark: (typeof profile.marks)[number]; days: number } => item.days !== null)
    if (deadlines.length) {
      const soon = deadlines.reduce((best, item) => (item.days < best.days ? item : best))
      state.competition.daysRemaining = soon.days
      state.competition.date = soon.mark.deadline
      state.competition.target = soon.mark.goal ? `${soon.mark.meters}米 ${soon.mark.goal}` : `${soon.mark.meters}米`
      state.competition.criticality = soon.days <= 28 ? "高" : "普通"
    }
    state.environment.schedule = profile.days ? `每周 ${profile.days} 天，每次约 ${profile.minutes} 分钟` : null
    const filled = [eaten > 0, day.runs.length > 0, day.burn != null, Boolean(latest), Boolean(plan)].filter(Boolean).length
    state.uncertainty.overall = quality(filled)
    state.uncertainty.missingData = missing
    state.generatedAt = new Date().toISOString()
  } catch {
    return state
  }
  return state
}

export function loadAthleteState(): AthleteState {
  const stored = readEnvelope<AthleteState>(STATE_KEY, emptyAthleteState()).data
  return { ...emptyAthleteState(), ...stored, ability: { ...emptyAbility(), ...(stored.ability ?? {}) } }
}

export function refreshAthleteState(): AthleteState {
  const state = deriveAthleteState()
  writeEnvelope(STATE_KEY, state)
  return state
}

let wired = false

export function wireStateEngine() {
  if (wired) return
  wired = true
  onAppEvent(() => {
    try {
      refreshAthleteState()
    } catch {
      /* state refresh must not break the write that just happened */
    }
  })
}
