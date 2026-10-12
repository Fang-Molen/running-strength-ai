import assert from "node:assert/strict"
import test from "node:test"
import { nextSessionAdviceNeedsSource, projectCoachNextSession } from "./coach-next-session.ts"

const base = {
  occurrenceId: "train-a",
  sessionRpe: 5,
  sleepHours: 7,
  subjectiveRecovery: 6,
  duplicateCount: 0,
  pain: false,
  soreness: false,
  daysToCompetition: null,
  week: 2 as const,
  bias: "build" as const,
  sources: [{ id: "rpe", kind: "FACT" as const, detail: "SESSION_RPE 本次主观强度：5/10" }],
}

test("next-session envelope never manufactures permission to increase", () => {
  const view = projectCoachNextSession(base)
  assert.equal(view.status, "KEEP_ONLY")
  assert.equal(view.increaseSupported, false)
  assert.deepEqual(view.allowed, ["KEEP"])
  assert.deepEqual(view.sourceIds, ["rpe"])
  assert.deepEqual(view.requiredSourceIds, [])
})

test("missing recovery, conflicts, pain and low recovery have distinct envelopes", () => {
  assert.equal(projectCoachNextSession({ ...base, sessionRpe: 8, sleepHours: null, subjectiveRecovery: null }).status, "ASK_FOR_RECOVERY")
  assert.equal(projectCoachNextSession({ ...base, duplicateCount: 1 }).status, "RESOLVE_CONFLICT")
  const pain = projectCoachNextSession({ ...base, pain: true, sources: [...base.sources, { id: "pain", kind: "FACT", detail: "PAIN 疼痛：4/10；部位 左膝" }] })
  assert.equal(pain.status, "RECOVERY_ONLY")
  assert.deepEqual(pain.allowed, ["RECOVERY", "REDUCE"])
  const loosePain = projectCoachNextSession({ ...base, pain: true })
  assert.equal(loosePain.status, "ASK_FOR_RECOVERY")
  assert.equal(loosePain.blockers.includes("BOUND_PAIN_DETAIL_MISSING"), true)
  const low = projectCoachNextSession({ ...base, subjectiveRecovery: 3 })
  assert.equal(low.status, "HOLD_OR_REDUCE")
  assert.equal(low.blockers.includes("LOW_SUBJECTIVE_RECOVERY"), true)
})

test("a next-session recommendation must cite every source that triggered its envelope", () => {
  const view = projectCoachNextSession({
    ...base,
    sessionRpe: 8,
    subjectiveRecovery: 3,
    sources: [
      { id: "rpe", kind: "FACT", detail: "SESSION_RPE 本次主观强度：8/10" },
      { id: "recovery", kind: "FACT", detail: "SUBJECTIVE_RECOVERY 本次主观恢复：3/10" },
    ],
  })
  assert.deepEqual(view.requiredSourceIds, ["rpe", "recovery"])
  assert.equal(nextSessionAdviceNeedsSource(view, "下一课建议减量。", ["rpe"]), true)
  assert.equal(nextSessionAdviceNeedsSource(view, "下一课建议减量。", ["rpe", "recovery"]), false)
  assert.equal(nextSessionAdviceNeedsSource(view, "本次已记录 RPE。", ["rpe"]), false)
})

test("race window, deload, soreness and short sleep do not approve progression", () => {
  for (const input of [
    { ...base, daysToCompetition: 10 },
    { ...base, week: 4 as const },
    { ...base, soreness: true },
    { ...base, sleepHours: 5.5 },
  ]) {
    const view = projectCoachNextSession(input)
    assert.equal(view.status, "HOLD_OR_REDUCE")
    assert.equal(view.increaseSupported, false)
  }
})
