import assert from "node:assert/strict"
import test from "node:test"
import { bindTrainingStart, closeTrainingOccurrence } from "./occurrence.ts"
import { setStoreBackend, writeEnvelope, type MemoryStore } from "./storage.ts"
import { fatigueEvidence } from "./evidence-fatigue.ts"
import { queryHistoricalOccurrences } from "./historical-occurrences.ts"
import { readTrainingFact } from "./fact-read.ts"
import { listBoundTrainings } from "./coach-compare.ts"
import { readTrainingContext, completeTraining } from "./training-decision.ts"
import { appendCorrection, compensationDraft, effectiveField, excludeVoidedTrainingEvents, listCorrections, occurrenceVoided, TRAINING_CORRECTION_KEY } from "./training-correction.ts"
import { dispatchEvent, EVENTS_KEY, loadEvents } from "./events.ts"

function memory(): MemoryStore {
  const dump = new Map<string, string>()
  return { keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => { dump.set(key, value) } }
}

function seedStart(id: string, sessionId: string, timestamp: string) {
  writeEnvelope(EVENTS_KEY, [...loadEvents(), {
    event_id: id,
    athlete_id: "local",
    timestamp,
    event_type: "TRAINING_STARTED",
    source: "MANUAL",
    payload: { sessionId, decisionId: id, planVersion: "fr255-strength-plan-v3", selectedAction: "ORIGINAL_PLAN" },
    confidence: 1,
    data_quality: "HIGH",
    context: {},
    cycle_id: "local-cycle",
    schema_version: 1,
  }])
}

test("void and restore stay append-only and resolve to one effective state", () => {
  setStoreBackend(memory())
  assert.equal(appendCorrection({ trainingOccurrenceId: "occ-1", kind: "VOID", reason: "记错了" }) != null, true)
  assert.equal(appendCorrection({ trainingOccurrenceId: "occ-1", kind: "VOID", reason: "再点一次" }) != null, true)
  assert.equal(occurrenceVoided("occ-1"), true)
  assert.equal(appendCorrection({ trainingOccurrenceId: "occ-1", kind: "RESTORE", reason: "误作废" }) != null, true)
  assert.equal(occurrenceVoided("occ-1"), false)
  assert.equal(appendCorrection({ trainingOccurrenceId: "occ-1", kind: "VOID", reason: "确认作废" }) != null, true)
  assert.equal(occurrenceVoided("occ-1"), true)
  assert.equal(listCorrections("occ-1").length, 4)
  assert.equal(appendCorrection({ trainingOccurrenceId: "", kind: "VOID", reason: "无编号" }), null)
  assert.equal(appendCorrection({ trainingOccurrenceId: "occ-1", kind: "FIELD", reason: "没字段" }), null)
  setStoreBackend(null)
})

test("a field correction keeps the original text and the latest value wins", () => {
  setStoreBackend(memory())
  appendCorrection({ trainingOccurrenceId: "occ-2", kind: "FIELD", field: "weight", setKey: "squat:1", originalValue: "60", newValue: "55", reason: "看错重量" })
  appendCorrection({ trainingOccurrenceId: "occ-2", kind: "FIELD", field: "weight", setKey: "squat:1", originalValue: "60", newValue: "57.5", reason: "再核对" })
  assert.deepEqual(effectiveField("occ-2", "weight", "squat:1", "60"), { value: "57.5", corrected: true })
  assert.deepEqual(effectiveField("occ-2", "reps", "squat:1", null), { value: null, corrected: false })
  const raw = listCorrections("occ-2")[0]
  assert.equal(raw?.originalValue, "60")
  assert.equal(JSON.parse(JSON.stringify(listCorrections("occ-2"))).length > 0, true)
  setStoreBackend(null)
})

test("a voided occurrence is hidden from later reads without deleting its events", () => {
  setStoreBackend(memory())
  const plan = { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: null, customName: "深蹲", sets: 1, mode: "reps", amount: 5, restSec: 60, weightKg: 40 }] }
  seedStart("start-1", "strength-a", "2026-10-09T01:00:00.000Z")
  bindTrainingStart({ startEventId: "start-1", startedAt: "2026-10-09T01:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan })
  dispatchEvent("TRAINING_SET_COMPLETED", { sessionId: "strength-a", decisionId: "d1", moveId: "squat", setIndex: 1, completed: true, skipped: false, actualAmount: 5, actualWeight: 40 })
  const done = completeTraining({ decisionId: "d1", sessionId: "strength-a", planned: null, actualSets: 1, actualAmount: 5, actualWeightKg: 40, rpe: null, pain: false, modified: false, interrupted: false })
  assert.equal(done != null, true)
  closeTrainingOccurrence(done!)
  const again = completeTraining({ decisionId: "d1", sessionId: "strength-a", planned: null, actualSets: 1, actualAmount: 5, actualWeightKg: 40, rpe: null, pain: false, modified: false, interrupted: false })
  closeTrainingOccurrence(again!)
  assert.equal(again?.event_id, done?.event_id)
  assert.equal(loadEvents().filter((event) => event.event_type === "TRAINING_COMPLETED").length, 1)
  const before = loadEvents().length
  appendCorrection({ trainingOccurrenceId: "start-1", kind: "VOID", reason: "这节记错" })
  const visible = excludeVoidedTrainingEvents(loadEvents())
  assert.equal(visible.some((event) => event.event_id === "start-1"), false)
  assert.equal(visible.some((event) => event.event_type === "TRAINING_SET_COMPLETED"), false)
  assert.equal(loadEvents().length, before)
  assert.notEqual(loadEvents().find((event) => event.event_id === "start-1"), undefined)
  appendCorrection({ trainingOccurrenceId: "start-1", kind: "RESTORE", reason: "恢复" })
  assert.equal(excludeVoidedTrainingEvents(loadEvents()).some((event) => event.event_id === "start-1"), true)
  setStoreBackend(null)
})

test("voiding one occurrence does not hide the next independent session or turn it into zero load", () => {
  setStoreBackend(memory())
  const plan = { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: null, customName: "深蹲", sets: 1, mode: "reps", amount: 5, restSec: 60, weightKg: 40 }] }
  seedStart("start-a", "strength-a", "2026-10-08T01:00:00.000Z")
  bindTrainingStart({ startEventId: "start-a", startedAt: "2026-10-08T01:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan })
  dispatchEvent("TRAINING_SET_COMPLETED", { sessionId: "strength-a", decisionId: "d1", moveId: "squat", setIndex: 1, completed: true, skipped: false, actualAmount: 5, actualWeight: 40 })
  const first = completeTraining({ decisionId: "d1", sessionId: "strength-a", planned: null, actualSets: 1, actualAmount: 5, actualWeightKg: 40, rpe: 9, pain: false, modified: false, interrupted: false })
  closeTrainingOccurrence(first!)
  dispatchEvent("RPE_RECORDED", { rpe: 9, sessionId: "strength-a", trainingOccurrenceId: "start-a" })
  seedStart("start-b", "strength-a", "2026-10-09T01:00:00.000Z")
  bindTrainingStart({ startEventId: "start-b", startedAt: "2026-10-09T01:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan })
  dispatchEvent("TRAINING_SET_COMPLETED", { sessionId: "strength-a", decisionId: "d2", moveId: "squat", setIndex: 1, completed: true, skipped: false, actualAmount: 5, actualWeight: 50 })
  const second = completeTraining({ decisionId: "d2", sessionId: "strength-a", planned: null, actualSets: 1, actualAmount: 5, actualWeightKg: 50, rpe: null, pain: false, modified: false, interrupted: false })
  closeTrainingOccurrence(second!)
  appendCorrection({ trainingOccurrenceId: "start-a", kind: "VOID", reason: "第一节记错" })
  const visible = excludeVoidedTrainingEvents(loadEvents())
  assert.equal(visible.some((event) => event.event_id === "start-a"), false)
  assert.equal(visible.some((event) => event.event_id === "start-b"), true)
  assert.equal(loadEvents().some((event) => event.event_id === "start-a"), true)
  assert.equal(readTrainingFact("start-a"), null)
  assert.equal(readTrainingFact("start-b")?.startEventId, "start-b")
  assert.equal(fatigueEvidence("start-a"), null)
  assert.notEqual(fatigueEvidence("start-b"), null)
  const history = queryHistoricalOccurrences({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T00:00:00.000Z" })
  assert.deepEqual(history.occurrences.map((item) => item.trainingOccurrenceId), ["start-b"])
  assert.equal(listBoundTrainings().some((item) => item.trainingOccurrenceId === "start-a"), false)
  assert.equal(listBoundTrainings().some((item) => item.trainingOccurrenceId === "start-b"), true)
  const context = readTrainingContext(null)
  const snapshot = context.snapshot
  assert.ok(snapshot)
  assert.equal(snapshot.strength.completedSets, 1)
  assert.equal(snapshot.strength.completedWeight, 50)
  assert.equal(snapshot.rpe, null)
  appendCorrection({ trainingOccurrenceId: "start-a", kind: "RESTORE", reason: "恢复第一节" })
  assert.equal(readTrainingFact("start-a")?.startEventId, "start-a")
  assert.equal(queryHistoricalOccurrences({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T00:00:00.000Z" }).occurrences.length, 2)
  const draft = compensationDraft("start-a")
  assert.equal(draft?.kind, "VOID")
  setStoreBackend(null)
})

test("correction storage does not reuse the event or occurrence keys", () => {
  assert.equal(TRAINING_CORRECTION_KEY, "fr255-training-correction-v1")
  assert.equal(TRAINING_CORRECTION_KEY.includes("events"), false)
})
