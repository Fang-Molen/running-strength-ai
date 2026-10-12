import assert from "node:assert/strict"
import test from "node:test"
import { guardCoachPlan, type CoachPlanCandidate, type PlanningContext } from "./coach-plan.ts"
import { auditCoachPlan } from "./coach-plan-quality.ts"
import { containsPrescribedFailure } from "./coach-strength-boundary.ts"
import { coachPlanOutputContract } from "./coach-plan-output.ts"

function context(extra: Partial<PlanningContext> = {}): PlanningContext {
  return {
    goal: { distanceMeters: 5000, targetSeconds: 1200, deadline: "2026-12-01", sourceIds: ["goal"] },
    recentPerformance: { distanceMeters: 5000, seconds: 1320, recordedAt: "2026-10-01", sourceIds: ["recent"] },
    weeklyRunKm: 25, availableDays: 4, minutesPerDay: 60, strengthDays: 1, experience: "INTERMEDIATE", pain: false, rehab: false, daysToCompetition: 54, recoveryStatus: "AVAILABLE",
    sourceIds: ["goal", "recent", "availability", "volume"], sources: [{ id: "goal", detail: "5公里目标1200秒" }, { id: "recent", detail: "5公里1320秒" }, { id: "availability", detail: "4天、60分钟、力量1天" }, { id: "volume", detail: "25公里" }], ...extra,
  }
}

function plan(): CoachPlanCandidate {
  const run = (effort: "EASY_TALK" | "CONTROLLED_HARD") => ({ warmupMinutes: 10, main: [{ label: "主训练", repetitions: 1, distanceMeters: null, durationSeconds: 1200, recoverySeconds: null, effort, citations: ["recent", "availability"] }], cooldownMinutes: 10, stopConditions: ["出现疼痛时停止"] })
  const strength = { exercises: [{ name: "分腿蹲", sets: 3, repetitions: 8, durationSeconds: null, effort: "LEAVE_3_REPS" as const, restSeconds: 75, citations: ["availability"] }], stopConditions: ["出现疼痛时停止"] }
  return {
    status: "DRAFT_PENDING_CONFIRMATION", horizonWeeks: 4,
    phases: [{ name: "建立", weeks: 3, purpose: "基于近期成绩保持稳定训练", progression: "HOLD", citations: ["recent"] }, { name: "减量", weeks: 1, purpose: "降低总刺激并复盘", progression: "DELOAD", citations: ["availability"] }],
    firstWeek: [
      { day: 1, type: "EASY_RUN", title: "轻松跑", durationMinutes: 40, distanceMeters: null, intensity: "EASY", prescription: "40分钟轻松跑", rationale: "不超过可用时间", citations: ["availability"], runPrescription: run("EASY_TALK"), strengthPrescription: null },
      { day: 3, type: "QUALITY_RUN", title: "质量跑", durationMinutes: 50, distanceMeters: null, intensity: "HARD", prescription: "含热身与放松共50分钟", rationale: "参考近期同类实际，不虚构配速", citations: ["recent", "availability"], runPrescription: run("CONTROLLED_HARD"), strengthPrescription: null },
      { day: 5, type: "STRENGTH", title: "跑步力量", durationMinutes: 35, distanceMeters: null, intensity: "MODERATE", prescription: "35分钟，保留余力", rationale: "每周允许1天力量", citations: ["availability"], runPrescription: null, strengthPrescription: strength },
      { day: 7, type: "LONG_RUN", title: "长距离", durationMinutes: 60, distanceMeters: null, intensity: "EASY", prescription: "60分钟轻松完成", rationale: "不超过可用时间", citations: ["availability"], runPrescription: run("EASY_TALK"), strengthPrescription: null },
    ],
    assumptions: [], evidenceGaps: [], safetyBoundaries: ["疼痛时停止诱发动作"],
    progressionRule: "只有完成情况、RPE、恢复和疼痛证据支持时才提出下一周候选调整。", deloadRule: "第4周减少总刺激并保持恢复。", acceptanceRequired: true,
  }
}

test("a coherent runner plan passes the expert coaching quality gate", () => {
  const result = auditCoachPlan(context(), plan())
  assert.equal(result.pass, true)
  assert.equal(result.score >= 78, true)
})

test("a prohibition against failure is not treated as prescribing failure", () => {
  const raw = plan()
  raw.firstWeek[2] = { ...raw.firstWeek[2], prescription: "保留余力，不要力竭，禁止做到失败，避免极限" }
  const allowed = auditCoachPlan(context(), raw)
  assert.equal(allowed.criticalIssues.includes("STRENGTH_TO_FAILURE"), false)
  assert.equal(allowed.pass, true)
  for (const prescription of ["力竭前停止", "未到力竭", "不到极限"]) {
    raw.firstWeek[2] = { ...raw.firstWeek[2], prescription }
    assert.equal(auditCoachPlan(context(), raw).criticalIssues.includes("STRENGTH_TO_FAILURE"), false, prescription)
  }
  raw.firstWeek[2] = { ...raw.firstWeek[2], prescription: "不要力竭，但直到力竭" }
  assert.equal(auditCoachPlan(context(), raw).criticalIssues.includes("STRENGTH_TO_FAILURE"), true)
  raw.firstWeek[2] = { ...raw.firstWeek[2], prescription: "不要加重，但做到力竭" }
  assert.equal(auditCoachPlan(context(), raw).criticalIssues.includes("STRENGTH_TO_FAILURE"), true)
  raw.firstWeek[2] = { ...raw.firstWeek[2], prescription: "每组做到极限" }
  assert.equal(auditCoachPlan(context(), raw).criticalIssues.includes("STRENGTH_TO_FAILURE"), true)
  raw.firstWeek[2] = { ...raw.firstWeek[2], prescription: "做到失败" }
  assert.equal(auditCoachPlan(context(), raw).criticalIssues.includes("STRENGTH_TO_FAILURE"), true)
})

test("hard-day stacking, strength to failure and missing deload lower coaching quality", () => {
  const raw = plan()
  raw.firstWeek[0] = { ...raw.firstWeek[0], day: 2, intensity: "HARD" }
  raw.firstWeek[2] = { ...raw.firstWeek[2], prescription: "每组做到力竭" }
  raw.phases = [{ name: "冲量", weeks: 4, purpose: "一直增加", progression: "BUILD", citations: ["recent"] }]
  const result = auditCoachPlan(context(), raw)
  assert.equal(result.pass, false)
  assert.equal(result.criticalIssues.includes("BACK_TO_BACK_HARD"), true)
  assert.equal(result.criticalIssues.includes("STRENGTH_TO_FAILURE"), true)
})

test("missing recovery cannot be ignored by a promised progression", () => {
  const raw = plan()
  raw.progressionRule = "下一周必须直接增加训练量"
  const result = auditCoachPlan(context({ recoveryStatus: "MISSING" }), raw)
  assert.equal(result.pass, false)
  assert.equal(result.criticalIssues.includes("RECOVERY_IGNORED"), true)
})

test("the existing structural guard and coaching audit agree on unsafe availability", () => {
  const raw = plan()
  raw.firstWeek[0] = { ...raw.firstWeek[0], durationMinutes: 90 }
  const untrusted = { ...raw, userControl: "用户可接受、修改或拒绝" }
  assert.equal(guardCoachPlan(context(), untrusted).ok, false)
  assert.equal(auditCoachPlan(context(), raw).pass, false)
})

test("negated failure boundaries pass while later affirmative prescriptions still fail", () => {
  for (const text of ["不要力竭", "力竭前停止", "未到力竭", "不要做到失败"]) assert.equal(containsPrescribedFailure(text), false, text)
  for (const text of ["直到力竭", "做到失败", "做到极限", "不要加重，但做到力竭", "力竭前停止；下一组做到力竭"]) assert.equal(containsPrescribedFailure(text), true, text)
})

test("race output and quality contracts reject a build hidden in a later phase", () => {
  const raw = plan()
  raw.phases[1]!.progression = "BUILD"
  const nearRace = context({ daysToCompetition: 10 })
  assert.equal(auditCoachPlan(nearRace, raw).criticalIssues.includes("RACE_WINDOW_BUILD_BLOCKED"), true)
  assert.match(coachPlanOutputContract(nearRace), /不得把BUILD藏到第二阶段/)
})
