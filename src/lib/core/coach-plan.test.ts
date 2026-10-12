import assert from "node:assert/strict"
import test from "node:test"
import { chooseCoachPlanCandidate, coachPlanPreferenceSources, guardCoachPlan, planningQuestions, sanitizePlanningContext, saveCoachPlanCandidate, type PlanningContext } from "./coach-plan.ts"
import { projectPlanningRecovery } from "./coach-plan-recovery.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"

function memory(): MemoryStore {
  const data = new Map<string, string>()
  return { keys:()=>[...data.keys()], getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) }
}

function context(extra: Partial<PlanningContext> = {}): PlanningContext {
  return {
    goal: { distanceMeters: 5000, targetSeconds: 1200, deadline: "2026-12-01", sourceIds: ["goal"] },
    recentPerformance: { distanceMeters: 5000, seconds: 1320, recordedAt: "2026-10-01", sourceIds: ["recent"] },
    weeklyRunKm: 25,
    availableDays: 4,
    minutesPerDay: 60,
    strengthDays: 1,
    experience: "INTERMEDIATE",
    pain: false,
    rehab: false,
    daysToCompetition: 54,
    recoveryStatus: "AVAILABLE",
    sourceIds: ["goal", "recent", "availability", "volume"],
    sources: [
      { id: "goal", detail: "5公里目标 1200秒，2026-12-01" },
      { id: "recent", detail: "最近5公里 1320秒，2026-10-01" },
      { id: "availability", detail: "每周4天，每次60分钟，力量1天" },
      { id: "volume", detail: "近期周跑量25公里" },
    ],
    ...extra,
  }
}

function candidate() {
  const run = (effort: "EASY_TALK" | "CONTROLLED_HARD") => ({ warmupMinutes: 10, main: [{ label: "主训练", repetitions: 1, distanceMeters: null, durationSeconds: 1200, recoverySeconds: null, effort, citations: ["recent", "availability"] }], cooldownMinutes: 10, stopConditions: ["出现疼痛时停止"] })
  const strength = { exercises: [{ name: "分腿蹲", sets: 3, repetitions: 8, durationSeconds: null as number | null, effort: "LEAVE_3_REPS" as const, restSeconds: 75, citations: ["availability"] }], stopConditions: ["出现疼痛时停止"] }
  return {
    horizonWeeks: 4,
    phases: [{ name: "建立", weeks: 3, purpose: "基于最近5公里1320秒建立稳定训练", progression: "HOLD", citations: ["recent"] }, { name: "减量", weeks: 1, purpose: "第4周减量", progression: "DELOAD", citations: ["availability"] }],
    firstWeek: [
      { day: 1, type: "EASY_RUN", title: "轻松跑", durationMinutes: 40, distanceMeters: null, intensity: "EASY", prescription: "40分钟轻松跑", rationale: "在每次60分钟以内", citations: ["availability"], runPrescription: run("EASY_TALK"), strengthPrescription: null },
      { day: 3, type: "QUALITY_RUN", title: "节奏训练", durationMinutes: 50, distanceMeters: null, intensity: "HARD", prescription: "含热身与放松共50分钟", rationale: "参考最近5公里1320秒，但不据此虚构配速", citations: ["recent", "availability"], runPrescription: run("CONTROLLED_HARD"), strengthPrescription: null },
      { day: 5, type: "STRENGTH", title: "跑步力量", durationMinutes: 35, distanceMeters: null, intensity: "MODERATE", prescription: "35分钟基础力量", rationale: "每周可安排1次力量", citations: ["availability"], runPrescription: null, strengthPrescription: strength },
      { day: 7, type: "LONG_RUN", title: "长距离", durationMinutes: 60, distanceMeters: null, intensity: "EASY", prescription: "60分钟轻松长跑", rationale: "不超过单次60分钟", citations: ["availability"], runPrescription: run("EASY_TALK"), strengthPrescription: null },
    ],
    assumptions: ["没有用单次成绩推断长期能力"], evidenceGaps: [], safetyBoundaries: ["疼痛时停止诱发动作"],
    progressionRule: "只有训练完成、RPE和恢复证据足够且无疼痛时，才提出下一周候选调整。",
    deloadRule: "第4周减量，具体变化仍需确认。",
    userControl: "用户可以接受、修改或拒绝候选计划",
  }
}

test("planning asks for goal, recent performance and unresolved recovery instead of inventing them", () => {
  const questions = planningQuestions(context({ goal: { distanceMeters: null, targetSeconds: null, deadline: null, sourceIds: [] }, recentPerformance: null, recoveryStatus: "CONFLICTING" }))
  assert.equal(questions.length, 3)
})

test("a recent result at another distance cannot stand in for the goal distance", () => {
  const questions = planningQuestions(context({ recentPerformance: { distanceMeters: 200, seconds: 34, recordedAt: "2026-10-01", sourceIds: ["recent"] } }))
  assert.equal(questions.length, 1)
  assert.match(questions[0] ?? "", /5000 米/)
  assert.match(questions[0] ?? "", /不能用 200 米/)
})

test("a sourced conservative run and strength plan remains a draft requiring confirmation", () => {
  const result = guardCoachPlan(context(), candidate())
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.candidate.status, "DRAFT_PENDING_CONFIRMATION")
  assert.equal(result.candidate.acceptanceRequired, true)
  assert.equal(result.candidate.firstWeek.length, 4)
})

test("plan guard blocks excess training, back-to-back hard days and race-window build", () => {
  assert.equal(guardCoachPlan(context({ availableDays: 3 }), candidate()).ok, false)
  const adjacent = candidate()
  adjacent.firstWeek[0] = { ...adjacent.firstWeek[0], intensity: "HARD" }
  adjacent.firstWeek[1] = { ...adjacent.firstWeek[1], day: 2 }
  assert.equal(guardCoachPlan(context(), adjacent).ok, false)
  const race = candidate()
  race.phases[0] = { ...race.phases[0], progression: "BUILD" }
  assert.equal(guardCoachPlan(context({ daysToCompetition: 10 }), race).ok, false)
})

test("race-window protection applies to every phase rather than just the first", () => {
  const raw = candidate()
  raw.phases[1] = { ...raw.phases[1], progression: "BUILD" }
  const result = guardCoachPlan(context({ daysToCompetition: 10 }), raw)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, "RACE_WINDOW_BUILD_BLOCKED")
  assert.equal(guardCoachPlan(context({ daysToCompetition: 10 }), candidate()).ok, true)
  assert.equal(guardCoachPlan(context({ daysToCompetition: 29 }), raw).ok, true)
})

test("planning recovery preserves both records and blocks conflict before a candidate can form", () => {
  const projected = projectPlanningRecovery([3, 8])
  assert.equal(projected.status, "CONFLICTING")
  assert.deepEqual(projected.scores, [3, 8])
  assert.equal(projected.sources.length, 2)
  const input = context({ planningRecoveryScores: [3, 8], recoveryStatus: "AVAILABLE" })
  const checked = sanitizePlanningContext(input)
  assert.equal(checked.recoveryStatus, "CONFLICTING")
  assert.deepEqual(checked.planningRecoveryScores, [3, 8])
  assert.equal(checked.sourceIds.includes("planning:recovery:1"), true)
  assert.equal(checked.sources.some((source) => source.detail.includes("8/10") && source.detail.includes("未绑定历史训练")), true)
  assert.match(planningQuestions(input).join("；"), /3\/10、8\/10.*不平均、不代选/)
  assert.equal(guardCoachPlan(input, candidate()).ok, false)
  assert.equal(projectPlanningRecovery([6, 6]).status, "CONFLICTING")
})

test("planning recovery rejects invalid scores, rebuilds source details and does not treat missing as zero", () => {
  assert.equal(projectPlanningRecovery([]).status, "MISSING")
  for (const scores of [[0], [11], [5.5], [NaN], ["6"], [3, 6, 8]]) assert.throws(() => projectPlanningRecovery(scores))
  const checked = sanitizePlanningContext(context({
    planningRecoveryScores: [6], recoveryStatus: "MISSING", sourceIds: [...context().sourceIds, "planning:recovery:1"],
    sources: [...context().sources, { id: "planning:recovery:1", detail: "已恢复且无痛" }],
  }))
  assert.equal(checked.recoveryStatus, "AVAILABLE")
  assert.match(checked.sources.find((source) => source.id === "planning:recovery:1")?.detail ?? "", /6\/10.*未绑定历史训练/)
  assert.equal(planningQuestions(context({ planningRecoveryScores: [3] })).some((question) => question.includes("有记录不等于已经恢复")), true)
})

test("pain blocks hard effort even when the intensity label is moderate, and ability claims stay rejected", () => {
  assert.equal(guardCoachPlan(context({ pain: true }), candidate()).ok, false)
  const disguised = candidate()
  disguised.firstWeek[1] = { ...disguised.firstWeek[1], intensity: "MODERATE" }
  assert.equal(guardCoachPlan(context({ pain: true }), disguised).ok, false)
  const ability = candidate()
  ability.assumptions = ["这次 200 米说明长期能力提高"]
  assert.equal(guardCoachPlan(context(), ability).ok, false)
  assert.equal(guardCoachPlan(context(), candidate()).ok, true)
})

test("missing weekly volume cannot be converted into a fabricated progression percentage", () => {
  const raw = candidate()
  raw.progressionRule = "每周跑量增加10%"
  assert.equal(guardCoachPlan(context({ weeklyRunKm: null }), raw).ok, false)
})

test("accept, reject and modify stay on the candidate and never apply an existing plan", () => {
  setStoreBackend(memory())
  const guarded = guardCoachPlan(context(), candidate())
  assert.equal(guarded.ok, true)
  if (!guarded.ok) return
  const stored = saveCoachPlanCandidate(guarded.candidate)
  assert.equal(stored.status, "PENDING")
  assert.equal(chooseCoachPlanCandidate(stored.candidateId, "MODIFIED", "周三不能训练")?.status, "MODIFIED")
  assert.deepEqual(coachPlanPreferenceSources().map((item) => item.text), ["周三不能训练"])
  assert.equal(chooseCoachPlanCandidate(stored.candidateId, "REJECTED")?.status, "REJECTED")
  assert.deepEqual(coachPlanPreferenceSources(), [])
})

test("an explicit schedule modification becomes a sourced constraint on the next candidate", () => {
  const raw = candidate()
  const preferenceContext = context({
    preferenceNotes: [{ text: "周三不能训练，力量放周五", sourceId: "preference" }],
    sourceIds: ["goal", "recent", "availability", "volume", "preference"],
    sources: [...context().sources, { id: "preference", detail: "用户明确修改：周三不能训练，力量放周五" }],
  })
  assert.equal(guardCoachPlan(preferenceContext, raw).ok, false)
  raw.firstWeek = raw.firstWeek.map((item) => item.day === 3 ? { ...item, day: 2, citations: [...item.citations, "preference"] } : item.day === 5 ? { ...item, citations: [...item.citations, "preference"] } : item)
  const fixed = guardCoachPlan(preferenceContext, raw)
  assert.equal(fixed.ok, true, fixed.ok ? "" : fixed.reason)
})

test("invalid input numbers and incoherent sources are rejected instead of clamped or defaulted", () => {
  assert.deepEqual(sanitizePlanningContext(context()), { ...context(), preferenceNotes: [] })
  for (const value of [NaN, Infinity, -1, "25"]) assert.throws(() => sanitizePlanningContext({ ...context(), weeklyRunKm: value }))
  assert.throws(() => sanitizePlanningContext(context({ availableDays: 8 })))
  assert.throws(() => sanitizePlanningContext(context({ sources: [...context().sources, context().sources[0]!] })))
  assert.throws(() => sanitizePlanningContext({ ...context(), goal: { ...context().goal, sourceIds: ["fake"] } }))
  assert.equal(planningQuestions(context({ recentPerformance: { ...context().recentPerformance!, recordedAt: "日期未记录" } })).some((question) => question.includes("目标比赛日不能代替")), true)
})

test("a short declared duration cannot conceal a longer running or strength prescription", () => {
  const running = candidate()
  running.firstWeek[0].runPrescription!.main[0].durationSeconds = 3600
  assert.equal(guardCoachPlan(context(), running).ok, false)
  const strength = candidate()
  strength.firstWeek[2].strengthPrescription!.exercises[0].durationSeconds = 600
  strength.firstWeek[2].durationMinutes = 10
  assert.equal(guardCoachPlan(context(), strength).ok, false)
  const invalid = candidate()
  invalid.firstWeek[0].durationMinutes = -1
  assert.equal(guardCoachPlan(context(), invalid).ok, false)
})

test("repeated hard work needs recovery and easy days cannot hide hard effort", () => {
  const repeated = candidate()
  repeated.firstWeek[1].runPrescription!.main[0].repetitions = 2
  assert.equal(guardCoachPlan(context(), repeated).ok, false)
  const disguised = candidate()
  disguised.firstWeek[0].runPrescription!.main[0].effort = "CONTROLLED_HARD"
  assert.equal(guardCoachPlan(context(), disguised).ok, false)
  const missingStop = candidate()
  missingStop.firstWeek[0].runPrescription!.stopConditions = []
  assert.equal(guardCoachPlan(context(), missingStop).ok, false)
})

test("oversized output and partly fabricated citation lists are not silently truncated", () => {
  const oversized = candidate()
  oversized.firstWeek.push(...candidate().firstWeek)
  assert.equal(guardCoachPlan(context(), oversized).ok, false)
  const unknown = candidate()
  unknown.firstWeek[0].citations.push("invented")
  assert.equal(guardCoachPlan(context(), unknown).ok, false)
  const mislabeledHard = candidate()
  mislabeledHard.firstWeek[0] = { ...mislabeledHard.firstWeek[1], day: 2, intensity: "MODERATE" }
  mislabeledHard.firstWeek[1].intensity = "MODERATE"
  assert.equal(guardCoachPlan(context(), mislabeledHard).ok, false)
})
