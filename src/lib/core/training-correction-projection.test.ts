import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { bindTrainingStart, closeTrainingOccurrence, listTrainingOccurrences } from "./occurrence.ts"
import { setStoreBackend, readEnvelope, writeEnvelope, type MemoryStore } from "./storage.ts"
import { EVENTS_KEY, loadEvents } from "./events.ts"
import { projectOccurrencePerformance, readPerformanceEvidence } from "./performance-evidence.ts"
import { getTrainingEvidenceProfile } from "./evidence-profile.ts"
import { completeTraining, readTrainingContext, startTraining } from "./training-decision.ts"
import { readTrainingFact } from "./fact-read.ts"
import { trainingSummary } from "./training-summary.ts"
import { appendCorrection, effectiveStrengthFields, listCorrections, occurrenceVoided, TRAINING_CORRECTION_KEY } from "./training-correction.ts"
import { saveSportGoal } from "../ui/sport-goal.ts"
import { executionOf, setLine } from "./execution.ts"
import { latestReviewableCompletion, sessionFromCompleted } from "./coach-view.ts"

function memory(): MemoryStore {
  const dump = new Map<string, string>()
  return { keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => { dump.set(key, value) } }
}

function put(id: string, type: "TRAINING_STARTED" | "TRAINING_SET_COMPLETED" | "RUN_COMPLETED", timestamp: string, payload: Record<string, unknown>) {
  writeEnvelope(EVENTS_KEY, [...loadEvents(), {
    event_id: id,
    athlete_id: "local",
    timestamp,
    event_type: type,
    source: "MANUAL",
    payload,
    confidence: 1,
    data_quality: "HIGH",
    context: {},
    cycle_id: "local-cycle",
    schema_version: 1,
  }])
}

function weightOf(occurrenceId: string): number | null {
  return projectOccurrencePerformance(occurrenceId, loadEvents()).find((item) => item.kind === "STRENGTH_SET")?.actualWeightKg ?? null
}

test("decision formulas do not read the correction projection", () => {
  const source = readFileSync(new URL("./training-decision.ts", import.meta.url), "utf8")
  const ready = source.slice(source.indexOf("export function evaluateTrainingReadiness"), source.indexOf("export function generateTrainingAdjustment"))
  const adjust = source.slice(source.indexOf("export function generateTrainingAdjustment"), source.indexOf("export function applyAdjustment"))
  assert.equal(ready.includes("effectiveStrength"), false)
  assert.equal(adjust.includes("effectiveStrength"), false)
  assert.equal(ready.includes("training-correction"), false)
  assert.equal(adjust.includes("training-correction"), false)
})

test("strength weight and reps follow one projection through correct, void, restore and correct again", () => {
  const store = memory()
  setStoreBackend(store)
  const plan = { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: null, customName: "深蹲", sets: 1, mode: "reps", amount: 8, restSec: 60, weightKg: 40 }] }
  put("start-a", "TRAINING_STARTED", "2026-10-09T01:00:00.000Z", { sessionId: "strength-a", decisionId: "d1" })
  bindTrainingStart({ startEventId: "start-a", startedAt: "2026-10-09T01:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan })
  put("set-a", "TRAINING_SET_COMPLETED", "2026-10-09T01:10:00.000Z", { sessionId: "strength-a", decisionId: "d1", trainingOccurrenceId: "start-a", moveId: "squat", setIndex: 1, mode: "reps", completed: true, skipped: false, actualWeight: 40, actualAmount: 8 })
  const done = completeTraining({ decisionId: "d1", sessionId: "strength-a", planned: null, actualSets: 1, actualAmount: 8, actualWeightKg: 40, rpe: null, pain: false, modified: false, interrupted: false })
  closeTrainingOccurrence(done!)
  assert.equal(weightOf("start-a"), 40)
  assert.equal(getTrainingEvidenceProfile("start-a")?.evidence.strength[0]?.actualWeightKg, 40)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedWeight, 40)
  assert.equal(readTrainingFact("start-a")?.completedSetCount, 1)

  appendCorrection({ trainingOccurrenceId: "start-a", kind: "FIELD", field: "weight", setKey: null, originalValue: "40", newValue: "99", reason: "没有组标识" })
  assert.equal(weightOf("start-a"), 40)
  appendCorrection({ trainingOccurrenceId: "start-a", kind: "FIELD", field: "weight", setKey: "squat:1", originalValue: "40", newValue: "55", reason: "看错重量" })
  appendCorrection({ trainingOccurrenceId: "start-a", kind: "FIELD", field: "weight", setKey: "squat:1", originalValue: "40", newValue: "57.5", reason: "再核对" })
  const raw = loadEvents().find((event) => event.event_id === "set-a")
  assert.equal(raw?.payload.actualWeight, 40)
  assert.equal(raw?.payload.actualAmount, 8)
  assert.equal(loadEvents().filter((event) => event.event_type === "TRAINING_SET_COMPLETED").length, 1)
  assert.equal(weightOf("start-a"), 57.5)
  assert.equal(readPerformanceEvidence().valid.filter((item) => item.evidenceId === "set-a").length, 1)
  assert.equal(readPerformanceEvidence().valid.find((item) => item.evidenceId === "set-a")?.actualWeightKg, 57.5)
  assert.equal(getTrainingEvidenceProfile("start-a")?.evidence.strength[0]?.actualWeightKg, 57.5)
  assert.equal(getTrainingEvidenceProfile("start-a")?.evidence.strength[0]?.actualReps, 8)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedWeight, 57.5)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedSets, 1)
  assert.equal(trainingSummary(["start-a"]).completedSetCount, 1)
  assert.notEqual((40 + 57.5), weightOf("start-a"))

  appendCorrection({ trainingOccurrenceId: "start-a", kind: "VOID", reason: "整节作废" })
  assert.equal(readTrainingFact("start-a"), null)
  assert.equal(getTrainingEvidenceProfile("start-a"), null)
  assert.equal(readPerformanceEvidence().valid.some((item) => item.evidenceId === "set-a"), false)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedWeight, null)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedSets, null)
  assert.equal(loadEvents().find((event) => event.event_id === "set-a")?.payload.actualWeight, 40)

  appendCorrection({ trainingOccurrenceId: "start-a", kind: "RESTORE", reason: "恢复后用纠正值" })
  assert.equal(weightOf("start-a"), 57.5)
  assert.equal(getTrainingEvidenceProfile("start-a")?.evidence.strength[0]?.actualWeightKg, 57.5)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedWeight, 57.5)
  assert.notEqual(weightOf("start-a"), 40)

  appendCorrection({ trainingOccurrenceId: "start-a", kind: "FIELD", field: "weight", setKey: "squat:1", originalValue: "57.5", newValue: "52.5", reason: "第三次纠正" })
  appendCorrection({ trainingOccurrenceId: "start-a", kind: "FIELD", field: "reps", setKey: "squat:1", originalValue: "8", newValue: "6", reason: "次数记多了" })
  assert.equal(weightOf("start-a"), 52.5)
  assert.equal(projectOccurrencePerformance("start-a", loadEvents())[0]?.actualReps, 6)
  assert.equal(getTrainingEvidenceProfile("start-a")?.evidence.strength[0]?.actualReps, 6)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedReps, 6)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedWeight, 52.5)
  assert.equal(loadEvents().find((event) => event.event_id === "set-a")?.payload.actualWeight, 40)
  assert.equal(loadEvents().find((event) => event.event_id === "set-a")?.payload.actualAmount, 8)
  assert.equal(trainingSummary(["start-a"]).completedSetCount, 1)
  assert.equal(JSON.parse(store.getItem(TRAINING_CORRECTION_KEY) ?? "{}").data.length >= 6, true)
  assert.equal(saveSportGoal({ version: 1, sport: "strength", primaryGoal: "fat-loss", secondaryGoal: null }, store), true)
  assert.equal(weightOf("start-a"), 52.5)
  assert.equal(loadEvents().find((event) => event.event_id === "set-a")?.payload.actualWeight, 40)
  setStoreBackend(null)
})

test("unbound, unmatched and unreadable corrections do not invent a strength value", () => {
  setStoreBackend(memory())
  put("start-b", "TRAINING_STARTED", "2026-10-09T02:00:00.000Z", { sessionId: "strength-b", decisionId: "d2" })
  put("loose", "TRAINING_SET_COMPLETED", "2026-10-09T02:10:00.000Z", { sessionId: "strength-b", moveId: "squat", setIndex: 1, mode: "reps", completed: true, skipped: false, actualWeight: 40, actualAmount: 8 })
  put("timed", "TRAINING_SET_COMPLETED", "2026-10-09T02:12:00.000Z", { sessionId: "strength-b", trainingOccurrenceId: "start-b", moveId: "plank", setIndex: 1, mode: "seconds", completed: true, skipped: false, actualWeight: 0, actualAmount: 30 })
  put("run", "RUN_COMPLETED", "2026-10-09T02:20:00.000Z", { km: 5, seconds: 1500, trainingOccurrenceId: "start-b" })
  appendCorrection({ trainingOccurrenceId: "start-b", kind: "FIELD", field: "weight", setKey: "squat:1", originalValue: "40", newValue: "70", reason: "旧记录没有训练编号" })
  appendCorrection({ trainingOccurrenceId: "start-b", kind: "FIELD", field: "reps", setKey: "plank:1", originalValue: "30", newValue: "12", reason: "秒数不是次数" })
  appendCorrection({ trainingOccurrenceId: "start-b", kind: "FIELD", field: "duration", setKey: "plank:1", originalValue: "30", newValue: "99", reason: "时间尚未接入" })
  appendCorrection({ trainingOccurrenceId: "start-b", kind: "FIELD", field: "distance", setKey: "run:1", originalValue: "5", newValue: "9", reason: "距离尚未接入" })
  appendCorrection({ trainingOccurrenceId: "start-b", kind: "FIELD", field: "feedback", setKey: null, originalValue: "", newValue: "轻松", reason: "反馈尚未接入" })
  const loose = effectiveStrengthFields(loadEvents().find((event) => event.event_id === "loose")?.payload)
  assert.equal(loose.binding, "UNBOUND")
  assert.equal(loose.weight.value, 40)
  assert.equal(loose.weight.status, "ORIGINAL")
  const timed = projectOccurrencePerformance("start-b", loadEvents()).find((item) => item.moveId === "plank")
  assert.equal(timed?.actualDurationSec, 30)
  assert.equal(timed?.actualReps, null)
  assert.equal(timed?.actualWeightKg, 0)
  const run = readPerformanceEvidence().valid.find((item) => item.evidenceId === "run")
  assert.equal(run?.distanceKm, 5)
  assert.equal(run?.durationSec, 1500)
  appendCorrection({ trainingOccurrenceId: "start-b", kind: "FIELD", field: "weight", setKey: "plank:1", originalValue: "0", newValue: "大概两公斤", reason: "不是数字" })
  const unreadable = effectiveStrengthFields(loadEvents().find((event) => event.event_id === "timed")?.payload)
  assert.equal(unreadable.weight.status, "UNKNOWN")
  assert.equal(unreadable.weight.value, null)
  assert.equal(loadEvents().find((event) => event.event_id === "timed")?.payload.actualWeight, 0)
  setStoreBackend(null)
})

test("squat 40x8 corrects to 55x10 across log, evidence, summary and coach review", () => {
  const store = memory()
  setStoreBackend(store)
  writeEnvelope("fr255-body-v1", { weightKg: 75 })
  writeEnvelope("fr255-food-log-v1", [{ kcal: 400 }])
  writeEnvelope("fr255-strength-plan-v3", { id: "plan" })
  const plan = { id: "strength-a", name: "下肢力量", moves: [{ id: "squat", catalogId: null, customName: "深蹲", sets: 1, mode: "reps", amount: 8, restSec: 60, weightKg: 40 }] }
  put("start-a", "TRAINING_STARTED", "2026-10-09T03:00:00.000Z", { sessionId: "strength-a", decisionId: "d1" })
  bindTrainingStart({ startEventId: "start-a", startedAt: "2026-10-09T03:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan })
  put("set-a", "TRAINING_SET_COMPLETED", "2026-10-09T03:10:00.000Z", { sessionId: "strength-a", decisionId: "d1", trainingOccurrenceId: "start-a", moveId: "squat", setIndex: 1, mode: "reps", name: "深蹲", completed: true, skipped: false, actualWeight: 40, actualAmount: 8, plannedWeight: 40, plannedAmount: 8 })
  const done = completeTraining({ decisionId: "d1", sessionId: "strength-a", planned: { name: "深蹲", sets: 1, amount: 8, weightKg: 40 }, actualSets: 1, actualAmount: 8, actualWeightKg: 40, rpe: null, pain: false, modified: false, interrupted: false })
  closeTrainingOccurrence(done!)
  const again = completeTraining({ decisionId: "d1", sessionId: "strength-a", planned: { name: "深蹲", sets: 1, amount: 8, weightKg: 40 }, actualSets: 1, actualAmount: 8, actualWeightKg: 40, rpe: null, pain: false, modified: false, interrupted: false })
  assert.equal(again?.event_id, done?.event_id)
  assert.equal(loadEvents().filter((event) => event.event_type === "TRAINING_COMPLETED").length, 1)
  const logged = effectiveStrengthFields(loadEvents().find((event) => event.event_id === "set-a")?.payload)
  assert.equal(logged.weight.value, 40)
  assert.equal(logged.reps.value, 8)
  assert.equal(logged.weight.status, "ORIGINAL")
  assert.equal(sessionFromCompleted(done!.payload, null)?.actual, "深蹲 40kg × 1 × 8")

  appendCorrection({ trainingOccurrenceId: "start-a", kind: "FIELD", field: "weight", setKey: "squat:1", originalValue: "40", newValue: "50", reason: "重量看错" })
  appendCorrection({ trainingOccurrenceId: "start-a", kind: "FIELD", field: "reps", setKey: "squat:1", originalValue: "8", newValue: "10", reason: "次数看错" })
  setStoreBackend(store)
  const refreshed = effectiveStrengthFields(loadEvents().find((event) => event.event_id === "set-a")?.payload)
  assert.equal(refreshed.weight.value, 50)
  assert.equal(refreshed.reps.value, 10)
  assert.equal(weightOf("start-a"), 50)
  assert.equal(projectOccurrencePerformance("start-a", loadEvents())[0]?.actualReps, 10)
  assert.equal(getTrainingEvidenceProfile("start-a")?.evidence.strength[0]?.actualWeightKg, 50)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedWeight, 50)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedReps, 10)
  assert.equal(executionOf("strength-a").sets[0]?.actualWeight, 50)
  assert.equal(executionOf("strength-a").sets[0]?.actualAmount, 10)
  assert.equal(sessionFromCompleted(done!.payload, null)?.actual, "深蹲 50kg × 1 × 10")
  assert.equal(loadEvents().filter((event) => event.event_type === "TRAINING_SET_COMPLETED" && event.payload.trainingOccurrenceId === "start-a").length, 1)

  appendCorrection({ trainingOccurrenceId: "start-a", kind: "VOID", reason: "整节作废" })
  appendCorrection({ trainingOccurrenceId: "start-a", kind: "VOID", reason: "重复作废" })
  assert.equal(occurrenceVoided("start-a"), true)
  assert.equal(readTrainingFact("start-a"), null)
  assert.equal(getTrainingEvidenceProfile("start-a"), null)
  assert.equal(readPerformanceEvidence().valid.some((item) => item.evidenceId === "set-a"), false)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedWeight, null)
  assert.notEqual(readTrainingContext(null).snapshot?.strength.completedWeight, 0)
  assert.equal(trainingSummary(["start-a"]).completedSetCount, null)
  assert.equal(sessionFromCompleted(done!.payload, null), null)
  assert.equal(latestReviewableCompletion(loadEvents()), null)
  assert.equal(loadEvents().find((event) => event.event_id === "set-a")?.payload.actualWeight, 40)

  appendCorrection({ trainingOccurrenceId: "start-a", kind: "RESTORE", reason: "恢复" })
  appendCorrection({ trainingOccurrenceId: "start-a", kind: "RESTORE", reason: "重复恢复" })
  assert.equal(occurrenceVoided("start-a"), false)
  assert.equal(weightOf("start-a"), 50)
  assert.equal(projectOccurrencePerformance("start-a", loadEvents())[0]?.actualReps, 10)
  assert.equal(listCorrections("start-a").some((row) => row.kind === "FIELD" && row.newValue === "50"), true)

  appendCorrection({ trainingOccurrenceId: "start-a", kind: "FIELD", field: "weight", setKey: "squat:1", originalValue: "50", newValue: "55", reason: "再次核对重量" })
  setStoreBackend(store)
  const finalLog = effectiveStrengthFields(loadEvents().find((event) => event.event_id === "set-a")?.payload)
  assert.equal(finalLog.weight.value, 55)
  assert.equal(finalLog.reps.value, 10)
  assert.equal(finalLog.weight.status, "CORRECTED")
  assert.equal(weightOf("start-a"), 55)
  assert.equal(readPerformanceEvidence().valid.filter((item) => item.evidenceId === "set-a").length, 1)
  assert.equal(getTrainingEvidenceProfile("start-a")?.evidence.strength[0]?.actualWeightKg, 55)
  assert.equal(getTrainingEvidenceProfile("start-a")?.evidence.strength[0]?.actualReps, 10)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedWeight, 55)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedReps, 10)
  assert.equal(readTrainingContext(null).snapshot?.strength.completedSets, 1)
  assert.equal(trainingSummary(["start-a"]).completedSetCount, 1)
  assert.equal(readTrainingFact("start-a")?.completedSetCount, 1)
  assert.equal(executionOf("strength-a").sets[0]?.actualWeight, 55)
  assert.equal(executionOf("strength-a").sets[0]?.actualAmount, 10)
  assert.equal(setLine(executionOf("strength-a").sets[0]!).actual.includes("55"), true)
  assert.equal(sessionFromCompleted(done!.payload, null)?.actual, "深蹲 55kg × 1 × 10")
  assert.equal(latestReviewableCompletion(loadEvents())?.event_id, done?.event_id)
  const raw = loadEvents().find((event) => event.event_id === "set-a")
  assert.equal(raw?.payload.actualWeight, 40)
  assert.equal(raw?.payload.actualAmount, 8)
  assert.notEqual((40 + 55), weightOf("start-a"))
  assert.equal(loadEvents().filter((event) => event.event_type === "TRAINING_COMPLETED").length, 1)

  appendCorrection({ trainingOccurrenceId: "missing-set", kind: "FIELD", field: "weight", setKey: "squat:1", originalValue: "40", newValue: "99", reason: "没有这次训练" })
  assert.equal(weightOf("start-a"), 55)
  assert.equal(readTrainingFact("missing-set"), null)
  assert.equal(saveSportGoal({ version: 1, sport: "track", primaryGoal: "performance", secondaryGoal: null }, store), true)
  assert.equal(saveSportGoal({ version: 1, sport: "strength", primaryGoal: "fat-loss", secondaryGoal: null }, store), true)
  assert.equal(weightOf("start-a"), 55)
  assert.equal(raw?.payload.actualWeight, 40)
  assert.equal(readEnvelope("fr255-body-v1", null).data && (readEnvelope("fr255-body-v1", { weightKg: 0 }).data as { weightKg: number }).weightKg, 75)
  assert.equal((readEnvelope("fr255-food-log-v1", [] as { kcal: number }[]).data as { kcal: number }[])[0]?.kcal, 400)
  assert.equal((readEnvelope("fr255-strength-plan-v3", { id: "" }).data as { id: string }).id, "plan")
  assert.equal(listCorrections("start-a").length >= 7, true)

  const restarted = startTraining({ decisionId: "d-again", sessionId: "strength-a", action: "ORIGINAL_PLAN" })
  const second = bindTrainingStart({ startEventId: restarted!.event_id, startedAt: restarted!.timestamp, sessionId: "strength-a", planSlotId: "strength-a", plan })
  assert.notEqual(second?.trainingOccurrenceId, "start-a")
  assert.equal(listTrainingOccurrences().length, 2)
  assert.equal(loadEvents().find((event) => event.event_id === "set-a")?.payload.actualWeight, 40)
  assert.equal(loadEvents().filter((event) => event.event_type === "TRAINING_COMPLETED").length, 1)
  assert.equal(readFileSync(new URL("./training-decision.ts", import.meta.url), "utf8").includes("export function evaluateTrainingReadiness"), true)
  setStoreBackend(null)
})

test("different corrected sets are listed once and are not added together", () => {
  const store = memory()
  setStoreBackend(store)
  const plan = { id: "strength-c", name: "下肢", moves: [{ id: "squat", catalogId: null, customName: "深蹲", sets: 2, mode: "reps", amount: 8, restSec: 60, weightKg: 40 }] }
  put("start-c", "TRAINING_STARTED", "2026-10-09T04:00:00.000Z", { sessionId: "strength-c", decisionId: "d3" })
  bindTrainingStart({ startEventId: "start-c", startedAt: "2026-10-09T04:00:00.000Z", sessionId: "strength-c", planSlotId: "strength-c", plan })
  put("set-c1", "TRAINING_SET_COMPLETED", "2026-10-09T04:10:00.000Z", { sessionId: "strength-c", trainingOccurrenceId: "start-c", moveId: "squat", setIndex: 1, mode: "reps", name: "深蹲", completed: true, skipped: false, actualWeight: 40, actualAmount: 8 })
  put("set-c2", "TRAINING_SET_COMPLETED", "2026-10-09T04:12:00.000Z", { sessionId: "strength-c", trainingOccurrenceId: "start-c", moveId: "squat", setIndex: 2, mode: "reps", name: "深蹲", completed: true, skipped: false, actualWeight: 40, actualAmount: 8 })
  const done = completeTraining({ decisionId: "d3", sessionId: "strength-c", planned: null, actualSets: 2, actualAmount: 8, actualWeightKg: 40, rpe: null, pain: false, modified: false, interrupted: false })
  closeTrainingOccurrence(done!)
  appendCorrection({ trainingOccurrenceId: "start-c", kind: "FIELD", field: "weight", setKey: "squat:1", originalValue: "40", newValue: "50", reason: "第一组" })
  appendCorrection({ trainingOccurrenceId: "start-c", kind: "FIELD", field: "weight", setKey: "squat:2", originalValue: "40", newValue: "55", reason: "第二组" })
  const review = sessionFromCompleted(done!.payload, null)
  assert.equal(review?.actual, "深蹲 第1组 50kg × 8次；深蹲 第2组 55kg × 8次")
  assert.equal(review?.reason, "各组纠正值不同，不合并成一个重量")
  assert.equal(review?.deviation.loadKg, null)
  const weights = projectOccurrencePerformance("start-c", loadEvents()).map((item) => item.actualWeightKg)
  assert.deepEqual(weights, [50, 55])
  assert.equal(weights.reduce((sum, value) => sum + (value ?? 0), 0), 105)
  assert.notEqual(weights.reduce((sum, value) => sum + (value ?? 0), 0), 40 + 50 + 55)
  assert.equal(loadEvents().filter((event) => event.event_id === "set-c1" || event.event_id === "set-c2").length, 2)
  setStoreBackend(null)
})
