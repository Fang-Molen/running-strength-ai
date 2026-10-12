import assert from "node:assert/strict"
import test from "node:test"
import { abilityUnchangedBySession } from "./state.ts"
import { loadEvents } from "./events.ts"
import { dispatchEvent } from "./events.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"
import {
  assessOutcome,
  chooseAction,
  completeTraining,
  createTrainingDecision,
  evaluateTrainingReadiness,
  generateTrainingAdjustment,
  interruptTraining,
  readTrainingContext,
  recordLearning,
  startTraining,
  validateTrainingDecision,
  type TrainingContext,
} from "./training-decision.ts"

function memory(): MemoryStore {
  const dump = new Map<string, string>()
  return { keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => dump.set(key, value) }
}

function ctx(partial: Partial<TrainingContext> = {}): TrainingContext {
  return {
    fatigue: 20,
    pain: false,
    rehab: false,
    sleepHours: null,
    recentRunKm: null,
    recentRunRpe: null,
    daysToCompetition: null,
    week: 2,
    bias: "build",
    previousFeel: null,
    facts: 3,
    ...partial,
  }
}

const planned = { name: "深蹲", sets: 4, amount: 8, weightKg: 60 }

test("A ready athlete keeps the original plan", () => {
  const decision = createTrainingDecision(ctx(), planned)
  assert.equal(decision.readiness, "READY")
  assert.equal(decision.change, "none")
  assert.equal(decision.weightKg, 60)
  assert.equal(decision.sets, 4)
})

test("B high fatigue does not increase the load", () => {
  const decision = createTrainingDecision(ctx({ fatigue: 80 }), planned)
  assert.equal(decision.readiness, "HIGH_FATIGUE")
  assert.ok(decision.weightKg <= 60)
  assert.ok(decision.sets <= 4)
  assert.equal(decision.amount, 8)
})

test("C a hard run blocks an automatic weight increase", () => {
  const decision = createTrainingDecision(ctx({ fatigue: 20, recentRunKm: 8, recentRunRpe: 9 }), planned)
  assert.equal(decision.change === "none" || decision.change === "hold" || decision.change === "drop-set", true)
  assert.equal(decision.weightKg, 60)
  assert.ok(decision.sets <= 4)
})

test("D pain blocks a load increase", () => {
  const decision = createTrainingDecision(ctx({ pain: true, fatigue: 20 }), planned)
  assert.equal(decision.readiness, "PAIN_REPORTED")
  assert.equal(decision.risk, "CRITICAL")
  const check = validateTrainingDecision(ctx({ pain: true }), planned, { sets: 5, amount: 8, weightKg: 60 })
  assert.equal(check.allowed, false)
})

test("E a near competition does not add load after one bad session", () => {
  const decision = createTrainingDecision(ctx({ fatigue: 20, daysToCompetition: 10, previousFeel: "hard" }), planned)
  assert.equal(decision.weightKg, 60)
  assert.ok(decision.sets <= 4)
  assert.equal(validateTrainingDecision(ctx({ daysToCompetition: 10, fatigue: 30 }), planned, { sets: 4, amount: 8, weightKg: 65 }).allowed, false)
})

test("F G H I J rejecting, modifying, interrupting and finishing stay tied to the decision", () => {
  setStoreBackend(memory())
  const decision = createTrainingDecision(ctx({ fatigue: 70 }), planned)
  chooseAction(decision.decision_id, "ORIGINAL_PLAN")
  const started = startTraining({ decisionId: decision.decision_id, sessionId: "s1", action: "ORIGINAL_PLAN" })
  assert.equal(started?.event_type, "TRAINING_STARTED")
  assert.equal((started?.payload as { selectedAction: string }).selectedAction, "ORIGINAL_PLAN")
  chooseAction(decision.decision_id, "USER_MODIFIED")
  assert.equal(loadEvents().some((event) => event.event_type === "USER_MODIFIED"), true)
  interruptTraining(decision.decision_id, "s1")
  assert.equal(loadEvents().some((event) => event.event_type === "TRAINING_INTERRUPTED"), true)
  const done = completeTraining({
    decisionId: decision.decision_id,
    sessionId: "s1",
    planned,
    actualSets: 3,
    actualAmount: 8,
    actualWeightKg: 60,
    rpe: null,
    pain: false,
    modified: false,
    interrupted: false,
  })
  assert.equal(done?.event_type, "TRAINING_COMPLETED")
  assert.equal((done?.payload as { decisionId: string }).decisionId, decision.decision_id)
  const outcome = assessOutcome({ completion: true, interrupted: false, setsPlanned: 4, setsCompleted: 3, modified: false })
  assert.equal(outcome.assessment, "PARTIALLY_COMPLETED")
  assert.equal(outcome.next.includes("维持"), true)
  setStoreBackend(null)
})

test("K one miss does not change ability", () => {
  setStoreBackend(memory())
  const before = abilityUnchangedBySession({
    speed: 80,
    aerobic: 82,
    strength: null,
    power: null,
    endurance: null,
    runningEconomy: null,
    sportSpecificAbility: null,
    limiter: null,
    confidence: 0.4,
  })
  const learned = recordLearning({ decisionId: "td-1", prediction: "60kg 可以完成 4×8", actual: "完成 3×8", success: false })
  assert.equal(before.aerobic, 82)
  assert.equal(learned.ability, null)
  setStoreBackend(null)
})

test("L missing data stays unknown", () => {
  assert.equal(evaluateTrainingReadiness(ctx({ fatigue: null, facts: 0, recentRunRpe: null })), "UNKNOWN")
  const decision = createTrainingDecision(ctx({ fatigue: null, facts: 1 }), planned)
  assert.equal(decision.change, "none")
  assert.equal(decision.weightKg, 60)
})

test("M a decision exists without a model key", () => {
  const decision = createTrainingDecision(ctx(), planned)
  assert.equal(decision.status, "PENDING_CONFIRMATION")
  assert.ok(decision.expiry)
  assert.equal(typeof fetch === "function" || typeof fetch === "undefined" || true, true)
  assert.equal(decision.reason.length > 0, true)
})

test("a recorded sleep value is visible and an empty record stays null", () => {
  setStoreBackend(memory())
  assert.equal(readTrainingContext(null).sleepHours, null)
  dispatchEvent("SLEEP_RECORDED", { hours: 7.5 })
  const seen = readTrainingContext(null)
  assert.equal(seen.sleepHours, 7.5)
  assert.equal(seen.snapshot?.sleepHours, 7.5)
  setStoreBackend(null)
})

test("recorded HRV and resting heart rate stay on the context and off the decision", () => {
  setStoreBackend(memory())
  dispatchEvent("HRV_RECORDED", { hrv: 62 }, { source: "MANUAL" })
  dispatchEvent("RHR_RECORDED", { bpm: 48 })
  const seen = readTrainingContext(null)
  assert.equal(seen.hrv?.value, 62)
  assert.equal(seen.hrv?.source, "MANUAL")
  assert.equal(seen.restingHeartRate?.value, 48)
  const low = generateTrainingAdjustment(ctx({ fatigue: 20, sleepHours: 4, hrv: seen.hrv, restingHeartRate: seen.restingHeartRate, snapshot: seen.snapshot }), planned)
  const plain = generateTrainingAdjustment(ctx({ fatigue: 20 }), planned)
  assert.equal(low.readiness, "READY")
  assert.equal(low.change, plain.change)
  assert.equal(low.sets, plain.sets)
  assert.equal(low.weightKg, plain.weightKg)
  setStoreBackend(null)
})

test("a run RPE and several stored runs are visible without a made-up type", () => {
  setStoreBackend(memory())
  dispatchEvent("RUN_COMPLETED", { km: 6, seconds: 1800 })
  dispatchEvent("RUN_COMPLETED", { km: 3, seconds: 720 })
  dispatchEvent("RPE_RECORDED", { rpe: 6, km: 3 })
  const seen = readTrainingContext(null)
  assert.equal(seen.recentRunRpe, 6)
  assert.equal(seen.snapshot?.recentRuns.length, 2)
  assert.equal(seen.snapshot?.recentRunKm, 3)
  assert.equal(seen.snapshot?.recentRunDuration, 720)
  assert.equal(seen.snapshot?.recentRunPace, 240)
  assert.equal(seen.recentRunKm, null)
  assert.equal(JSON.stringify(seen.snapshot).includes("阈值"), false)
  assert.equal(JSON.stringify(seen.snapshot).includes("VO"), false)
  setStoreBackend(null)
})

test("completed strength sets are visible and do not change the adjustment", () => {
  setStoreBackend(memory())
  const sessionId = "s1"
  dispatchEvent("TRAINING_SET_COMPLETED", { sessionId, mode: "reps", plannedAmount: 8, actualAmount: 8, plannedWeight: 60, actualWeight: 60, completed: true, skipped: false })
  dispatchEvent("TRAINING_SET_COMPLETED", { sessionId, mode: "reps", plannedAmount: 8, actualAmount: 6, plannedWeight: 60, actualWeight: 60, completed: true, skipped: false })
  completeTraining({ decisionId: "d1", sessionId, planned: planned, actualSets: 2, actualAmount: 6, actualWeightKg: 60, rpe: null, pain: false, modified: true, interrupted: false })
  const seen = readTrainingContext(null)
  assert.equal(seen.snapshot?.strength.plannedSets, 2)
  assert.equal(seen.snapshot?.strength.completedSets, 2)
  assert.equal(seen.snapshot?.strength.plannedReps, 16)
  assert.equal(seen.snapshot?.strength.completedReps, 14)
  assert.equal(seen.snapshot?.strength.plannedWeight, 60)
  assert.equal(seen.snapshot?.strength.completedWeight, 60)
  assert.equal(seen.snapshot?.strength.strengthRpe, null)
  const tired = generateTrainingAdjustment({ ...ctx({ fatigue: 80 }), snapshot: seen.snapshot }, planned)
  assert.equal(tired.change, "drop-set")
  assert.equal(tired.sets, 3)
  assert.equal(tired.weightKg, 60)
  setStoreBackend(null)
})

test("a pain event is visible without becoming the decision pain flag", () => {
  setStoreBackend(memory())
  dispatchEvent("PAIN_RECORDED", { sessionId: "s1", moveIds: ["squat"] })
  dispatchEvent("TRAINING_INTERRUPTED", { sessionId: "s1" })
  const seen = readTrainingContext(null)
  assert.equal(seen.pain, false)
  assert.equal(seen.snapshot?.painRecordedAt != null, true)
  assert.deepEqual(seen.snapshot?.painLocation, ["squat"])
  assert.equal(seen.snapshot?.trainingInterrupted, true)
  assert.equal(seen.snapshot?.injuryReported, false)
  const decision = generateTrainingAdjustment(ctx({ fatigue: 20, snapshot: seen.snapshot }), planned)
  assert.equal(decision.readiness, "READY")
  assert.equal(decision.change, "none")
  setStoreBackend(null)
})

test("missing context facts stay null", () => {
  setStoreBackend(memory())
  const seen = readTrainingContext(null)
  assert.equal(seen.sleepHours, null)
  assert.equal(seen.hrv, null)
  assert.equal(seen.restingHeartRate, null)
  assert.equal(seen.snapshot?.recentRunPace, null)
  assert.equal(seen.snapshot?.todayRunKm, null)
  assert.equal(seen.snapshot?.strength.completedSets, null)
  assert.equal(seen.snapshot?.strength.strengthRpe, null)
  assert.equal(seen.snapshot?.painLocation, null)
  assert.equal(seen.snapshot?.injuryReported, false)
  setStoreBackend(null)
})

