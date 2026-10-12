import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { legacyPlannedSetCount } from "./canonical.ts"
import { mergeSets, type SetRecord } from "./execution.ts"
import { bindTrainingStart, closeTrainingOccurrence, getTrainingOccurrence } from "./occurrence.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"
import { loadTrainingFact } from "./training-fact.ts"
import { completeFromRunner } from "../../components/training-runner.tsx"

function memory(): MemoryStore {
  const dump = new Map<string, string>()
  return { keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function session(sets = 3): Session {
  return { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }] }
}

function begin(id: string, sets = 3, startedAt: string | null = "2026-10-07T01:00:00.000Z") {
  return bindTrainingStart({ startEventId: id, startedAt, sessionId: "strength-a", planSlotId: "strength-a", plan: session(sets) })
}

function log(startId: string, indexes: number[], extra = false) {
  return [
    { event_id: startId, event_type: "TRAINING_STARTED", timestamp: "2026-10-07T01:00:00.000Z", payload: { sessionId: "strength-a" } },
    ...indexes.map((index) => ({ event_id: `${startId}-set-${index}`, event_type: "TRAINING_SET_COMPLETED", timestamp: "2026-10-07T01:05:00.000Z", payload: { sessionId: "strength-a", moveId: "squat", setIndex: extra ? 9 : index, completed: true, skipped: false, actualWeight: 60, actualAmount: 8 } })),
  ]
}

test("two trainings on the same slot stay different facts", () => {
  setStoreBackend(memory())
  const first = begin("start-a", 3)
  completeFromRunner({ decisionId: "d1", sessionId: "strength-a", planned: null, actualSets: 3, actualAmount: 8, actualWeightKg: 60, rpe: null, pain: false, modified: false, interrupted: false })
  const second = begin("start-b", 5, "2026-10-14T01:00:00.000Z")
  const events = [
    ...log("start-a", [1, 2, 3]),
    { event_id: getTrainingOccurrence("start-a")?.closeEventId ?? "", event_type: "TRAINING_COMPLETED", payload: { sessionId: "strength-a" } },
    { event_id: "start-b", event_type: "TRAINING_STARTED", timestamp: "2026-10-14T01:00:00.000Z", payload: { sessionId: "strength-a" } },
    { event_id: "start-b-set-1", event_type: "TRAINING_SET_COMPLETED", payload: { sessionId: "strength-a", moveId: "squat", setIndex: 1, completed: true, skipped: false, actualWeight: 60, actualAmount: 8 } },
  ]
  const factA = loadTrainingFact(first?.trainingOccurrenceId ?? "", events)
  const factB = loadTrainingFact(second?.trainingOccurrenceId ?? "", events)
  assert.notEqual(factA?.trainingOccurrenceId, factB?.trainingOccurrenceId)
  assert.equal(factA?.sessionId, factB?.sessionId)
  assert.equal(factA?.planSlotId, factB?.planSlotId)
  assert.equal(factA?.plannedSetCount, 3)
  assert.equal(factA?.completedSetCount, 3)
  assert.equal(factA?.completionRatio, 1)
  assert.equal(factB?.plannedSetCount, 5)
  assert.equal(factB?.completedSetCount, 1)
  assert.deepEqual(factA?.trainingOccurrenceId, "start-a")
  assert.equal(factB?.lifecycle, "IN_PROGRESS")
  assert.notEqual(factB?.lifecycle, "ABANDONED")
})

test("completion counts stay with the snapshot and do not treat gaps as skips", () => {
  setStoreBackend(memory())
  const occurrence = begin("start-a", 3)
  const partial = loadTrainingFact(occurrence?.trainingOccurrenceId ?? "", log("start-a", [1, 2]))
  assert.equal(partial?.plannedSetCount, 3)
  assert.equal(partial?.completedSetCount, 2)
  assert.equal(partial?.notRecordedSetCount, 1)
  assert.equal(partial?.skippedSetCount, 0)
  assert.equal(partial?.completionRatio, 2 / 3)
  const none = loadTrainingFact(occurrence?.trainingOccurrenceId ?? "", log("start-a", []))
  assert.equal(none?.attemptCount, 0)
  assert.equal(none?.completedSetCount, 0)
  assert.equal(none?.notRecordedSetCount, 3)
  assert.equal(none?.completionRatio, 0)
  const duplicated = loadTrainingFact(occurrence?.trainingOccurrenceId ?? "", [
    ...log("start-a", [1]),
    { event_id: "again", event_type: "TRAINING_SET_COMPLETED", payload: { sessionId: "strength-a", moveId: "squat", setIndex: 1, completed: true, skipped: false, actualWeight: 60, actualAmount: 8 } },
  ])
  assert.equal(duplicated?.duplicateSetCount, 1)
  assert.equal(duplicated?.completedSetCount, 0)
  assert.equal(duplicated?.attemptCount, 2)
  const extra = loadTrainingFact(occurrence?.trainingOccurrenceId ?? "", [...log("start-a", [1, 2, 3]), { event_id: "extra", event_type: "TRAINING_SET_COMPLETED", payload: { sessionId: "strength-a", moveId: "squat", setIndex: 9, completed: true, skipped: false, actualWeight: 60, actualAmount: 8 } }])
  assert.equal(extra?.plannedSetCount, 3)
  assert.equal(extra?.completedSetCount, 3)
  assert.equal(extra?.extraSetCount, 1)
  assert.equal(extra?.completionRatio, 1)
})

test("a missing start is an unknown window, not zero completed sets", () => {
  setStoreBackend(memory())
  const occurrence = begin("start-a", 3)
  const missing = loadTrainingFact(occurrence?.trainingOccurrenceId ?? "", log("other-start", [1]))
  assert.equal(missing?.plannedSetCount, 3)
  assert.equal(missing?.attemptCount, null)
  assert.equal(missing?.completedSetCount, null)
  assert.equal(missing?.notRecordedSetCount, null)
  assert.equal(missing?.completionRatio, null)
  const unknownPlan = bindTrainingStart({ startEventId: "bare", startedAt: "2026-10-08T01:00:00.000Z", sessionId: "strength-b", planSlotId: "strength-b", plan: null })
  const bare = loadTrainingFact(unknownPlan?.trainingOccurrenceId ?? "", [{ event_id: "bare", event_type: "TRAINING_STARTED", payload: { sessionId: "strength-b" } }])
  assert.equal(bare?.plannedSetCount, null)
  assert.equal(bare?.completedSetCount, null)
  assert.equal(bare?.attemptCount, 0)
  assert.equal(bare?.completionRatio, null)
  assert.equal(loadTrainingFact("missing-history", []), null)
})

test("duration uses only reliable start and end times", () => {
  setStoreBackend(memory())
  const open = begin("start-open", 3, "2026-10-07T01:00:00.000Z")
  const openFact = loadTrainingFact(open?.trainingOccurrenceId ?? "", log("start-open", []))
  assert.equal(openFact?.lifecycle, "IN_PROGRESS")
  assert.equal(openFact?.endedAt, null)
  assert.equal(openFact?.duration, null)
  setStoreBackend(memory())
  const started = begin("start-done", 3, "2026-10-07T02:00:00.000Z")
  const early = closeTrainingOccurrence({ event_id: "early", event_type: "TRAINING_INTERRUPTED", timestamp: "2026-10-07T01:00:00.000Z", payload: { sessionId: "strength-a", decisionId: "d1" } })
  assert.equal(early?.lifecycle, "INTERRUPTED")
  assert.equal(loadTrainingFact(started?.trainingOccurrenceId ?? "", [...log("start-done", []), { event_id: "early", event_type: "TRAINING_INTERRUPTED", payload: { sessionId: "strength-a" } }])?.duration, null)
  setStoreBackend(memory())
  const finished = begin("start-c", 3, "2026-10-07T03:00:00.000Z")
  closeTrainingOccurrence({ event_id: "done", event_type: "TRAINING_COMPLETED", timestamp: "2026-10-07T03:10:00.000Z", payload: { sessionId: "strength-a", setsCompleted: 3, interruptions: false, actual: { sets: 3 } } })
  const fact = loadTrainingFact(finished?.trainingOccurrenceId ?? "", [...log("start-c", [1, 2, 3]), { event_id: "done", event_type: "TRAINING_COMPLETED", payload: { sessionId: "strength-a" } }])
  assert.equal(fact?.lifecycle, "COMPLETED")
  assert.equal(fact?.outcome, "COMPLETED")
  assert.equal(fact?.reason, "UNKNOWN")
  assert.equal(fact?.duration, 10 * 60 * 1000)
  closeTrainingOccurrence({ event_id: "done-2", event_type: "TRAINING_COMPLETED", timestamp: "2026-10-07T03:20:00.000Z", payload: { sessionId: "strength-a", setsCompleted: 3, interruptions: false, actual: { sets: 3 } } })
  const duplicate = loadTrainingFact(finished?.trainingOccurrenceId ?? "", [...log("start-c", [1, 2, 3]), { event_id: "done", event_type: "TRAINING_COMPLETED", payload: { sessionId: "strength-a" } }, { event_id: "done-2", event_type: "TRAINING_COMPLETED", payload: { sessionId: "strength-a" } }])
  assert.equal(duplicate?.lifecycle, "DUPLICATE_CLOSE")
  assert.equal(duplicate?.endedAt, null)
  assert.equal(duplicate?.duration, null)
  setStoreBackend(memory())
  const blankStart = begin("start-blank", 3, null)
  assert.equal(loadTrainingFact(blankStart?.trainingOccurrenceId ?? "", [{ event_id: "start-blank", event_type: "TRAINING_STARTED", payload: { sessionId: "strength-a" } }])?.duration, null)
})

test("the fact projection does not read legacy plan counting", () => {
  const source = readFileSync(new URL("./training-fact.ts", import.meta.url), "utf8")
  assert.equal(source.includes("mergeSets"), false)
  assert.equal(source.includes("legacyPlannedSetCount"), false)
  assert.equal(source.includes("strengthSnapshot"), false)
  assert.equal(source.includes("writeEnvelope"), false)
  assert.equal(source.includes("execution.ts"), false)
  const planned: SetRecord[] = [{ moveId: "squat", name: "深蹲", setIndex: 1, mode: "reps", plannedWeight: 60, plannedAmount: 8, restSec: 90, actualWeight: null, actualAmount: null, completed: false, skipped: false, modified: false, source: null, timestamp: null }]
  const logged: SetRecord[] = [{ ...planned[0], actualWeight: 55, actualAmount: 7, completed: true, source: "user_entered", timestamp: "2026-10-07T01:00:00.000Z" }, { ...planned[0], actualWeight: 50, actualAmount: 6, completed: true, source: "user_entered", timestamp: "2026-10-07T01:01:00.000Z" }]
  assert.equal(mergeSets(planned, logged)[0]?.actualWeight, 50)
  assert.equal(legacyPlannedSetCount([{ event_type: "TRAINING_SET_COMPLETED", payload: { sessionId: "strength-a" } }, { event_type: "TRAINING_SET_COMPLETED", payload: { sessionId: "strength-a" } }]), 2)
})
