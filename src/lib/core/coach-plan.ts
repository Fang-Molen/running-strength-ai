import { projectPlanningRecovery } from "./coach-plan-recovery.ts"

export type PlanGoal = {
  distanceMeters: number | null
  targetSeconds: number | null
  deadline: string | null
  sourceIds: string[]
}

export type PlanningContext = {
  goal: PlanGoal
  recentPerformance: { distanceMeters: number; seconds: number; recordedAt: string; sourceIds: string[] } | null
  weeklyRunKm: number | null
  availableDays: number
  minutesPerDay: number
  strengthDays: number
  experience: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "UNKNOWN"
  pain: boolean
  rehab: boolean
  daysToCompetition: number | null
  recoveryStatus: "AVAILABLE" | "MISSING" | "CONFLICTING"
  planningRecoveryScores?: number[]
  sourceIds: string[]
  sources: { id: string; detail: string }[]
  preferenceNotes?: { text: string; sourceId: string }[]
}

export type PlanPhase = {
  name: string
  weeks: number
  purpose: string
  progression: "BUILD" | "HOLD" | "DELOAD" | "TAPER"
  citations: string[]
}

export type PlanSessionCandidate = {
  day: number
  type: "EASY_RUN" | "QUALITY_RUN" | "LONG_RUN" | "STRENGTH" | "RECOVERY" | "REST"
  title: string
  durationMinutes: number | null
  distanceMeters: number | null
  intensity: "EASY" | "MODERATE" | "HARD" | "NONE"
  prescription: string
  rationale: string
  citations: string[]
  runPrescription: {
    warmupMinutes: number
    main: {
      label: string
      repetitions: number
      distanceMeters: number | null
      durationSeconds: number | null
      recoverySeconds: number | null
      effort: "EASY_TALK" | "STEADY" | "CONTROLLED_HARD" | "FAST_RELAXED"
      citations: string[]
    }[]
    cooldownMinutes: number
    stopConditions: string[]
  } | null
  strengthPrescription: {
    exercises: {
      name: string
      sets: number
      repetitions: number | null
      durationSeconds: number | null
      effort: "TECHNIQUE" | "LEAVE_3_REPS" | "LEAVE_2_REPS" | "BODYWEIGHT_CONTROLLED"
      restSeconds: number
      citations: string[]
    }[]
    stopConditions: string[]
  } | null
}

export type CoachPlanCandidate = {
  status: "DRAFT_PENDING_CONFIRMATION"
  horizonWeeks: number
  phases: PlanPhase[]
  firstWeek: PlanSessionCandidate[]
  assumptions: string[]
  evidenceGaps: string[]
  safetyBoundaries: string[]
  progressionRule: string
  deloadRule: string
  acceptanceRequired: true
}

export type PlanGuardResult =
  | { ok: true; candidate: CoachPlanCandidate }
  | { ok: false; reason: string; questions: string[] }

export type StoredCoachPlanCandidate = {
  candidateId: string
  createdAt: string
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "MODIFIED"
  candidate: CoachPlanCandidate
  modification: string | null
}

export const COACH_PLAN_CANDIDATES_KEY = "fr255-coach-plan-candidates-v1"

export function loadCoachPlanCandidates(): StoredCoachPlanCandidate[] {
  const current = readEnvelope<StoredCoachPlanCandidate[]>(COACH_PLAN_CANDIDATES_KEY, []).data
  return Array.isArray(current) ? current.filter((item) => item?.candidateId && item?.candidate).slice(-20) : []
}

export function coachPlanPreferenceSources(): { text: string; sourceId: string }[] {
  return loadCoachPlanCandidates()
    .filter((item) => item.status === "MODIFIED" && typeof item.modification === "string" && item.modification.trim())
    .slice(-5)
    .map((item) => ({ text: item.modification!.trim().slice(0, 500), sourceId: `plan-preference:${item.candidateId}` }))
}

export function saveCoachPlanCandidate(candidate: CoachPlanCandidate): StoredCoachPlanCandidate {
  const item: StoredCoachPlanCandidate = { candidateId: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), status: "PENDING", candidate, modification: null }
  writeEnvelope(COACH_PLAN_CANDIDATES_KEY, [...loadCoachPlanCandidates(), item].slice(-20))
  return item
}

export function chooseCoachPlanCandidate(candidateId: string, status: "ACCEPTED" | "REJECTED" | "MODIFIED", modification?: string): StoredCoachPlanCandidate | null {
  const current = loadCoachPlanCandidates()
  let selected: StoredCoachPlanCandidate | null = null
  const next = current.map((item) => {
    if (item.candidateId !== candidateId) return item
    selected = { ...item, status, modification: status === "MODIFIED" ? String(modification ?? "").trim().slice(0, 500) || null : null }
    return selected
  })
  if (!selected || !writeEnvelope(COACH_PLAN_CANDIDATES_KEY, next)) return null
  return selected
}

function ids(value: unknown, allowed: Set<string>): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && allowed.has(item)))].slice(0, 12) : []
}

function text(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null
}

function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null
}

export function sanitizePlanningContext(raw: unknown): PlanningContext {
  if (!raw || typeof raw !== "object") throw new Error("bad planning context")
  const input = raw as PlanningContext
  const number = (value: unknown, min: number, max: number, whole = false): number => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (whole && !Number.isInteger(value))) throw new Error("invalid planning number")
    return value
  }
  const nullable = (value: unknown, min: number, max: number) => value == null ? null : number(value, min, max)
  const checkedIds = (value: unknown): string[] => {
    if (!Array.isArray(value) || value.length > 40 || value.some((id) => typeof id !== "string" || !id.trim() || id.length > 80)) throw new Error("invalid planning source ids")
    return [...new Set(value)]
  }
  const sourceIds = checkedIds(input.sourceIds)
  if (!Array.isArray(input.sources) || input.sources.length > 40 || input.sources.some((source) => !source || typeof source.id !== "string" || !sourceIds.includes(source.id) || typeof source.detail !== "string" || !source.detail.trim() || source.detail.length > 500)) throw new Error("invalid planning sources")
  if (new Set(input.sources.map((source) => source.id)).size !== input.sources.length || sourceIds.some((id) => !input.sources.some((source) => source.id === id))) throw new Error("inconsistent planning sources")
  const subset = (value: unknown) => {
    const ids = checkedIds(value)
    if (ids.some((id) => !sourceIds.includes(id))) throw new Error("unknown planning source")
    return ids
  }
  if (!input.goal || typeof input.goal !== "object") throw new Error("missing goal")
  const deadline = input.goal.deadline
  if (deadline != null && (typeof deadline !== "string" || deadline.length > 30 || !Number.isFinite(Date.parse(deadline)))) throw new Error("invalid goal date")
  const recent = input.recentPerformance
  if (recent && (typeof recent.recordedAt !== "string" || recent.recordedAt.length > 40)) throw new Error("invalid performance date")
  if (typeof input.pain !== "boolean" || typeof input.rehab !== "boolean") throw new Error("unknown body restrictions")
  const preferenceNotes = input.preferenceNotes ?? []
  if (!Array.isArray(preferenceNotes) || preferenceNotes.length > 5 || preferenceNotes.some((note) => !note || typeof note.text !== "string" || !note.text.trim() || note.text.length > 500 || !sourceIds.includes(note.sourceId))) throw new Error("invalid preferences")
  const recovery = input.planningRecoveryScores === undefined ? null : projectPlanningRecovery(input.planningRecoveryScores)
  const existingSources = input.sources.filter((source) => !recovery || !source.id.startsWith("planning:recovery:"))
  const sanitizedSources = [...existingSources.map((source) => ({ id: source.id, detail: source.detail })), ...(recovery?.sources ?? [])]
  if (sanitizedSources.length > 40 || (recovery && [...input.goal.sourceIds, ...(recent?.sourceIds ?? []), ...preferenceNotes.map((note) => note.sourceId)].some((id) => id.startsWith("planning:recovery:")))) throw new Error("misbound planning recovery source")
  return {
    goal: { distanceMeters: nullable(input.goal.distanceMeters, 1, 1_000_000), targetSeconds: nullable(input.goal.targetSeconds, 1, 1_000_000), deadline, sourceIds: subset(input.goal.sourceIds) },
    recentPerformance: recent ? { distanceMeters: number(recent.distanceMeters, 1, 1_000_000), seconds: number(recent.seconds, 1, 1_000_000), recordedAt: recent.recordedAt, sourceIds: subset(recent.sourceIds) } : null,
    weeklyRunKm: nullable(input.weeklyRunKm, 0, 500),
    availableDays: number(input.availableDays, 0, 7, true), minutesPerDay: number(input.minutesPerDay, 0, 300, true), strengthDays: number(input.strengthDays, 0, 4, true),
    experience: ["BEGINNER", "INTERMEDIATE", "ADVANCED", "UNKNOWN"].includes(input.experience) ? input.experience : "UNKNOWN",
    pain: input.pain, rehab: input.rehab,
    daysToCompetition: input.daysToCompetition == null ? null : number(input.daysToCompetition, -36600, 36600, true),
    recoveryStatus: recovery?.status ?? (input.recoveryStatus === "AVAILABLE" || input.recoveryStatus === "CONFLICTING" ? input.recoveryStatus : "MISSING"),
    ...(recovery ? { planningRecoveryScores: recovery.scores } : {}),
    sourceIds: recovery ? sanitizedSources.map((source) => source.id) : sourceIds,
    sources: recovery ? sanitizedSources : input.sources.map((source) => ({ id: source.id, detail: source.detail })),
    preferenceNotes,
  }
}

export function planningQuestions(context: PlanningContext): string[] {
  const result: string[] = []
  const recoveryStatus = context.planningRecoveryScores === undefined ? context.recoveryStatus : projectPlanningRecovery(context.planningRecoveryScores).status
  if (context.goal.distanceMeters == null) result.push("你的主要跑步目标距离是多少？")
  if (context.recentPerformance == null) result.push("最近一次同类距离的实际成绩和日期是多少？")
  else if (!Number.isFinite(Date.parse(context.recentPerformance.recordedAt))) result.push("请补充这次近期实际成绩的日期；目标比赛日不能代替成绩日期。")
  if (context.goal.distanceMeters != null && context.goal.sourceIds.length === 0) result.push("请确认目标的来源。")
  if (context.recentPerformance != null && context.recentPerformance.sourceIds.length === 0) result.push("请确认近期实际成绩的来源。")
  if (context.goal.distanceMeters != null && context.recentPerformance != null && context.goal.distanceMeters !== context.recentPerformance.distanceMeters) result.push(`目标是 ${context.goal.distanceMeters} 米，请补充同为 ${context.goal.distanceMeters} 米的近期实际成绩；不能用 ${context.recentPerformance.distanceMeters} 米单次成绩代替。`)
  if (context.availableDays < 1 || context.minutesPerDay < 15) result.push("每周能训练几天、每次大约多少分钟？")
  if (context.pain || context.rehab) result.push("当前疼痛或康复限制是什么，哪些动作会诱发症状？")
  if (recoveryStatus === "CONFLICTING") result.push(`恢复记录有冲突${context.planningRecoveryScores?.length ? `（${context.planningRecoveryScores.map((score) => `${score}/10`).join("、")}）` : ""}，请先人工核对；不平均、不代选。`)
  if (context.planningRecoveryScores?.length === 1 && context.planningRecoveryScores[0]! <= 3) result.push(`本次填写的主观恢复为 ${context.planningRecoveryScores[0]}/10，先核对当前恢复与身体限制，再形成候选；有记录不等于已经恢复。`)
  return result
}

function claimsLongTermAbility(value: string): boolean {
  const patterns = [
    /长期能力(?:已经|已)?(?:提高|下降|提升|变化|变强|变差)/g,
    /(?:提高|提升|下降|变化).{0,8}长期能力/g,
    /(?:单次|这一次|一次成绩).{0,16}(?:说明|证明|代表).{0,10}(?:长期能力|能力变化|水平提高|水平下降)/g,
  ]
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const index = match.index ?? 0
      const before = value.slice(Math.max(0, index - 24), index)
      if (/(?:没有|未|不|不能|不得|不可|禁止|并非|不是|不要)[^。；\n]{0,20}$/.test(before)) continue
      return true
    }
  }
  return false
}

function quantitativeClaimNeedsSource(value: string, citations: string[]): boolean {
  return /\d/.test(value) && citations.length === 0
}

export function guardCoachPlan(context: PlanningContext, raw: unknown): PlanGuardResult {
  const questions = planningQuestions(context)
  if (questions.length) return { ok: false, reason: "MISSING_CRITICAL_INPUT", questions }
  if (!raw || typeof raw !== "object") return { ok: false, reason: "INVALID_OUTPUT", questions: [] }
  const input = raw as Record<string, unknown>
  const allowed = new Set(context.sourceIds)
  const validCitations = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return true
    if (Array.isArray(value)) return value.every(validCitations)
    const object = value as Record<string, unknown>
    if ("citations" in object && (!Array.isArray(object.citations) || object.citations.length > 12 || object.citations.some((id) => typeof id !== "string" || !allowed.has(id)))) return false
    return Object.values(object).every(validCitations)
  }
  if (!validCitations(input)) return { ok: false, reason: "UNKNOWN_PLAN_SOURCE", questions: [] }
  const horizonWeeks = integer(input.horizonWeeks, 1, 52)
  if (!horizonWeeks || !Array.isArray(input.phases) || !Array.isArray(input.firstWeek)) return { ok: false, reason: "INVALID_OUTPUT", questions: [] }
  if (input.phases.length > 8 || input.firstWeek.length > 7) return { ok: false, reason: "PLAN_SIZE_LIMIT", questions: [] }

  const phases: PlanPhase[] = []
  for (const value of input.phases.slice(0, 8)) {
    if (!value || typeof value !== "object") return { ok: false, reason: "INVALID_PHASE", questions: [] }
    const phase = value as Record<string, unknown>
    const name = text(phase.name, 80)
    const weeks = integer(phase.weeks, 1, 24)
    const purpose = text(phase.purpose)
    const progression = phase.progression
    const citations = ids(phase.citations, allowed)
    if (!name || !weeks || !purpose || !["BUILD", "HOLD", "DELOAD", "TAPER"].includes(String(progression))) return { ok: false, reason: "INVALID_PHASE", questions: [] }
    if (quantitativeClaimNeedsSource(`${purpose} ${weeks}`, citations)) return { ok: false, reason: "PHASE_SOURCE_MISSING", questions: [] }
    phases.push({ name, weeks, purpose, progression: progression as PlanPhase["progression"], citations })
  }
  if (!phases.length || phases.reduce((sum, item) => sum + item.weeks, 0) !== horizonWeeks) return { ok: false, reason: "PHASE_HORIZON_MISMATCH", questions: [] }

  const firstWeek: PlanSessionCandidate[] = []
  for (const value of input.firstWeek.slice(0, 7)) {
    if (!value || typeof value !== "object") return { ok: false, reason: "INVALID_SESSION", questions: [] }
    const session = value as Record<string, unknown>
    const day = integer(session.day, 1, 7)
    const type = String(session.type)
    const title = text(session.title, 80)
    const durationMinutes = session.durationMinutes == null ? null : integer(session.durationMinutes, 1, 300)
    const distanceMeters = session.distanceMeters == null ? null : integer(session.distanceMeters, 1, 100_000)
    if ((session.durationMinutes != null && durationMinutes == null) || (session.distanceMeters != null && distanceMeters == null)) return { ok: false, reason: "INVALID_SESSION_NUMBER", questions: [] }
    const intensity = String(session.intensity)
    const prescription = text(session.prescription)
    const rationale = text(session.rationale)
    const citations = ids(session.citations, allowed)
    let runPrescription: PlanSessionCandidate["runPrescription"] = null
    if (session.runPrescription != null) {
      if (!session.runPrescription || typeof session.runPrescription !== "object") return { ok: false, reason: "INVALID_RUN_PRESCRIPTION", questions: [] }
      const run = session.runPrescription as Record<string, unknown>
      const warmupMinutes = integer(run.warmupMinutes, 0, 60)
      const cooldownMinutes = integer(run.cooldownMinutes, 0, 60)
      if (warmupMinutes == null || cooldownMinutes == null || !Array.isArray(run.main) || run.main.length === 0 || run.main.length > 12) return { ok: false, reason: "INVALID_RUN_PRESCRIPTION", questions: [] }
      const main: NonNullable<PlanSessionCandidate["runPrescription"]>["main"] = []
      for (const rawBlock of run.main) {
        if (!rawBlock || typeof rawBlock !== "object") return { ok: false, reason: "INVALID_RUN_PRESCRIPTION", questions: [] }
        const block = rawBlock as Record<string, unknown>
        const label = text(block.label, 100)
        const repetitions = integer(block.repetitions, 1, 48)
        const distance = block.distanceMeters == null ? null : integer(block.distanceMeters, 1, 100_000)
        const duration = block.durationSeconds == null ? null : integer(block.durationSeconds, 1, 20_000)
        const recovery = block.recoverySeconds == null ? null : integer(block.recoverySeconds, 0, 3_600)
        const effort = String(block.effort)
        const blockCitations = ids(block.citations, allowed)
        if (!label || !repetitions || (distance == null && duration == null) || !["EASY_TALK", "STEADY", "CONTROLLED_HARD", "FAST_RELAXED"].includes(effort) || blockCitations.length === 0) return { ok: false, reason: "INVALID_RUN_PRESCRIPTION", questions: [] }
        if ((block.distanceMeters != null && distance == null) || (block.durationSeconds != null && duration == null) || (block.recoverySeconds != null && recovery == null)) return { ok: false, reason: "INVALID_RUN_PRESCRIPTION", questions: [] }
        if (repetitions > 1 && ["CONTROLLED_HARD", "FAST_RELAXED"].includes(effort) && (recovery == null || recovery === 0)) return { ok: false, reason: "RUN_RECOVERY_MISSING", questions: [] }
        main.push({ label, repetitions, distanceMeters: distance, durationSeconds: duration, recoverySeconds: recovery, effort: effort as typeof main[number]["effort"], citations: blockCitations })
      }
      runPrescription = { warmupMinutes, main, cooldownMinutes, stopConditions: Array.isArray(run.stopConditions) ? run.stopConditions.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 160)).slice(0, 8) : [] }
      if (!runPrescription.stopConditions.some((item) => item.trim())) return { ok: false, reason: "STOP_CONDITIONS_MISSING", questions: [] }
      const minimumSeconds = (warmupMinutes + cooldownMinutes) * 60 + main.reduce((total, block) => total + (block.durationSeconds ?? 0) * block.repetitions + (block.recoverySeconds ?? 0) * Math.max(0, block.repetitions - 1), 0)
      if (durationMinutes == null || minimumSeconds > durationMinutes * 60 || minimumSeconds > context.minutesPerDay * 60) return { ok: false, reason: "RUN_TIME_BUDGET_EXCEEDED", questions: [] }
    }
    let strengthPrescription: PlanSessionCandidate["strengthPrescription"] = null
    if (session.strengthPrescription != null) {
      if (!session.strengthPrescription || typeof session.strengthPrescription !== "object") return { ok: false, reason: "INVALID_STRENGTH_PRESCRIPTION", questions: [] }
      const strength = session.strengthPrescription as Record<string, unknown>
      if (!Array.isArray(strength.exercises) || strength.exercises.length === 0 || strength.exercises.length > 8) return { ok: false, reason: "INVALID_STRENGTH_PRESCRIPTION", questions: [] }
      const exercises: NonNullable<PlanSessionCandidate["strengthPrescription"]>["exercises"] = []
      for (const rawExercise of strength.exercises) {
        if (!rawExercise || typeof rawExercise !== "object") return { ok: false, reason: "INVALID_STRENGTH_PRESCRIPTION", questions: [] }
        const exercise = rawExercise as Record<string, unknown>
        const name = text(exercise.name, 100)
        const sets = integer(exercise.sets, 1, 6)
        const repetitions = exercise.repetitions == null ? null : integer(exercise.repetitions, 1, 30)
        const exerciseDuration = exercise.durationSeconds == null ? null : integer(exercise.durationSeconds, 1, 600)
        const effort = String(exercise.effort)
        const restSeconds = integer(exercise.restSeconds, 0, 600)
        const exerciseCitations = ids(exercise.citations, allowed)
        if (!name || !sets || (repetitions == null && exerciseDuration == null) || !["TECHNIQUE", "LEAVE_3_REPS", "LEAVE_2_REPS", "BODYWEIGHT_CONTROLLED"].includes(effort) || restSeconds == null || exerciseCitations.length === 0) return { ok: false, reason: "INVALID_STRENGTH_PRESCRIPTION", questions: [] }
        if ((exercise.repetitions != null && repetitions == null) || (exercise.durationSeconds != null && exerciseDuration == null)) return { ok: false, reason: "INVALID_STRENGTH_PRESCRIPTION", questions: [] }
        exercises.push({ name, sets, repetitions, durationSeconds: exerciseDuration, effort: effort as typeof exercises[number]["effort"], restSeconds, citations: exerciseCitations })
      }
      strengthPrescription = { exercises, stopConditions: Array.isArray(strength.stopConditions) ? strength.stopConditions.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 160)).slice(0, 8) : [] }
      if (!strengthPrescription.stopConditions.some((item) => item.trim())) return { ok: false, reason: "STOP_CONDITIONS_MISSING", questions: [] }
      const minimumSeconds = exercises.reduce((total, exercise) => total + (exercise.durationSeconds ?? 0) * exercise.sets + exercise.restSeconds * Math.max(0, exercise.sets - 1), 0)
      if (durationMinutes == null || minimumSeconds > durationMinutes * 60) return { ok: false, reason: "STRENGTH_TIME_BUDGET_EXCEEDED", questions: [] }
    }
    if (!day || !title || !prescription || !rationale || !["EASY_RUN", "QUALITY_RUN", "LONG_RUN", "STRENGTH", "RECOVERY", "REST"].includes(type) || !["EASY", "MODERATE", "HARD", "NONE"].includes(intensity)) return { ok: false, reason: "INVALID_SESSION", questions: [] }
    if ((durationMinutes != null || distanceMeters != null || /\d/.test(`${prescription} ${rationale}`)) && citations.length === 0) return { ok: false, reason: "SESSION_SOURCE_MISSING", questions: [] }
    if (durationMinutes != null && durationMinutes > context.minutesPerDay) return { ok: false, reason: "SESSION_EXCEEDS_AVAILABILITY", questions: [] }
    if (["EASY_RUN", "QUALITY_RUN", "LONG_RUN"].includes(type) && !runPrescription) return { ok: false, reason: "RUN_DETAILS_MISSING", questions: [] }
    if (type === "STRENGTH" && !strengthPrescription) return { ok: false, reason: "STRENGTH_DETAILS_MISSING", questions: [] }
    if (type !== "STRENGTH" && strengthPrescription) return { ok: false, reason: "STRENGTH_DETAILS_MISBOUND", questions: [] }
    if (["REST", "STRENGTH"].includes(type) && runPrescription) return { ok: false, reason: "RUN_DETAILS_MISBOUND", questions: [] }
    if (["EASY_RUN", "LONG_RUN"].includes(type) && (intensity !== "EASY" || runPrescription?.main.some((block) => block.effort !== "EASY_TALK"))) return { ok: false, reason: "EASY_DAY_INTENSITY_CONFLICT", questions: [] }
    firstWeek.push({ day, type: type as PlanSessionCandidate["type"], title, durationMinutes, distanceMeters, intensity: intensity as PlanSessionCandidate["intensity"], prescription, rationale, citations, runPrescription, strengthPrescription })
  }
  if (!firstWeek.length || new Set(firstWeek.map((item) => item.day)).size !== firstWeek.length) return { ok: false, reason: "INVALID_WEEK", questions: [] }
  const dayNumber = (value: string): number | null => ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 } as Record<string, number>)[value] ?? null
  for (const preference of context.preferenceNotes ?? []) {
    if (!firstWeek.some((item) => item.citations.includes(preference.sourceId))) return { ok: false, reason: "PREFERENCE_SOURCE_MISSING", questions: [] }
    const unavailable = preference.text.match(/周([一二三四五六日天]).{0,5}(?:不能|没法|无法|不要).{0,4}(?:训练|跑|练)/)
    const unavailableDay = unavailable?.[1] ? dayNumber(unavailable[1]) : null
    if (unavailableDay && firstWeek.some((item) => item.day === unavailableDay && item.type !== "REST")) return { ok: false, reason: "PREFERENCE_CONFLICT", questions: [] }
    const strength = preference.text.match(/力量.{0,4}(?:放|安排|改到|挪到).{0,3}周([一二三四五六日天])|周([一二三四五六日天]).{0,4}(?:做力量|安排力量|练力量|力量训练)/)
    const strengthDay = dayNumber(strength?.[1] ?? strength?.[2] ?? "")
    if (strengthDay && !firstWeek.some((item) => item.day === strengthDay && item.type === "STRENGTH")) return { ok: false, reason: "PREFERENCE_CONFLICT", questions: [] }
  }
  const trainingDays = firstWeek.filter((item) => item.type !== "REST").length
  const isHard = (item: PlanSessionCandidate) => item.intensity === "HARD" || item.runPrescription?.main.some((block) => ["CONTROLLED_HARD", "FAST_RELAXED"].includes(block.effort)) === true
  if (trainingDays > context.availableDays) return { ok: false, reason: "TOO_MANY_TRAINING_DAYS", questions: [] }
  if (firstWeek.filter(isHard).length > 2) return { ok: false, reason: "TOO_MANY_HARD_DAYS", questions: [] }
  if (firstWeek.filter((item) => item.type === "STRENGTH").length > context.strengthDays) return { ok: false, reason: "TOO_MANY_STRENGTH_DAYS", questions: [] }
  for (let day = 1; day < 7; day += 1) {
    if (firstWeek.some((item) => item.day === day && isHard(item)) && firstWeek.some((item) => item.day === day + 1 && isHard(item))) return { ok: false, reason: "BACK_TO_BACK_HARD_DAYS", questions: [] }
  }
  if (firstWeek.some((item) => item.day === 7 && isHard(item)) && firstWeek.some((item) => item.day === 1 && isHard(item))) return { ok: false, reason: "BACK_TO_BACK_HARD_DAYS", questions: [] }
  if ((context.pain || context.rehab) && (phases.some((item) => item.progression === "BUILD") || firstWeek.some(isHard))) return { ok: false, reason: "PAIN_BUILD_BLOCKED", questions: [] }
  if (context.daysToCompetition != null && context.daysToCompetition >= 0 && context.daysToCompetition <= 28 && phases.some((phase) => phase.progression === "BUILD")) return { ok: false, reason: "RACE_WINDOW_BUILD_BLOCKED", questions: [] }
  if (claimsLongTermAbility(JSON.stringify(input))) return { ok: false, reason: "LONG_TERM_ABILITY_INFERRED", questions: [] }
  if (context.weeklyRunKm == null && /(?:增加|提高|上调).{0,8}(?:周量|跑量|里程)|\d+%/.test(JSON.stringify(input))) return { ok: false, reason: "VOLUME_BASELINE_MISSING", questions: [] }

  const assumptions = Array.isArray(input.assumptions) ? input.assumptions.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 240)).slice(0, 12) : []
  const evidenceGaps = Array.isArray(input.evidenceGaps) ? input.evidenceGaps.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 240)).slice(0, 12) : []
  const safetyBoundaries = Array.isArray(input.safetyBoundaries) ? input.safetyBoundaries.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 240)).slice(0, 12) : []
  const progressionRule = text(input.progressionRule)
  const deloadRule = text(input.deloadRule)
  if (!progressionRule || !deloadRule) return { ok: false, reason: "PLAN_RULES_MISSING", questions: [] }
  if (!/(?:确认|接受|修改|拒绝)/.test(String(input.userControl ?? ""))) return { ok: false, reason: "USER_CONTROL_MISSING", questions: [] }
  return { ok: true, candidate: { status: "DRAFT_PENDING_CONFIRMATION", horizonWeeks, phases, firstWeek: firstWeek.sort((a, b) => a.day - b.day), assumptions, evidenceGaps, safetyBoundaries, progressionRule, deloadRule, acceptanceRequired: true } }
}
import { readEnvelope, writeEnvelope } from "./storage.ts"

