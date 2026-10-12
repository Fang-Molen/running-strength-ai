import assert from "node:assert/strict"
import test from "node:test"
import { projectCoachReturn } from "./coach-return.ts"

const base = {
  occurrenceId: "train-a",
  sessionRpe: 5,
  sleepHours: 7,
  subjectiveRecovery: 6,
  recoveryState: "SIGNAL_PRESENT",
  duplicateCount: 0,
  pain: false,
  soreness: false,
  musculoskeletalState: "NO_RELEVANT_EVIDENCE",
  sources: [{ id: "start", kind: "FACT" as const, detail: "训练开始" }],
}

test("return projection never turns missing evidence into medical clearance", () => {
  const view = projectCoachReturn(base)
  assert.equal(view.state, "CHECK_CURRENT_STATUS")
  assert.equal(view.clearance, "UNKNOWN")
  assert.equal(view.normalTrainingCleared, false)
  assert.equal(view.allowedSteps.includes("CONFIRM_CURRENT_SYMPTOMS"), true)
})

test("bound pain, soreness and context-only pain stay separate", () => {
  const pain = projectCoachReturn({ ...base, pain: true, sources: [...base.sources, { id: "pain", kind: "FACT", detail: "PAIN 疼痛：4/10；部位 左膝" }] })
  assert.equal(pain.state, "PAIN_RECORDED")
  assert.deepEqual(pain.sourceIds, ["pain"])
  assert.equal(pain.allowedSteps.includes("STOP_PROVOKING_MOVEMENT"), true)
  assert.equal(pain.allowedSteps.includes("CONSIDER_PROFESSIONAL_EVALUATION"), true)

  const sore = projectCoachReturn({ ...base, soreness: true, sources: [...base.sources, { id: "sore", kind: "FACT", detail: "SORENESS 酸痛：5/10；部位 大腿" }] })
  assert.equal(sore.state, "SORENESS_RECORDED")
  assert.equal(sore.allowedSteps.includes("CONSIDER_PROFESSIONAL_EVALUATION"), false)

  const loose = projectCoachReturn({ ...base, pain: true })
  assert.equal(loose.state, "RECOVERY_EVIDENCE_GAP")
  assert.equal(loose.missing.includes("BOUND_PAIN_DETAIL"), true)
})

test("conflict and high RPE recovery gap block staged conclusions", () => {
  assert.equal(projectCoachReturn({ ...base, duplicateCount: 1 }).state, "RESOLVE_CONFLICT")
  const gap = projectCoachReturn({ ...base, sessionRpe: 8, sleepHours: null, subjectiveRecovery: null })
  assert.equal(gap.state, "RECOVERY_EVIDENCE_GAP")
  assert.equal(gap.missing.includes("RECOVERY_OR_SLEEP"), true)
})
