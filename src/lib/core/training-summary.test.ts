import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { dispatchEvent } from "./events.ts"
import { readTrainingFact } from "./fact-read.ts"
import { bindTrainingStart, closeTrainingOccurrence } from "./occurrence.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"
import { trainingSummary } from "./training-summary.ts"

function memory(): MemoryStore & { dump: Map<string, string> } {
  const dump = new Map<string, string>()
  return { dump, keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function session(sets: number): Session {
  return { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }] }
}

function remember(box: { dump: Map<string, string> }) {
  return JSON.stringify([...box.dump.entries()])
}

function start(sets: number) {
  const event = dispatchEvent("TRAINING_STARTED", { sessionId: "strength-a", decisionId: "d1" })
  assert.ok(event)
  const occurrence = bindTrainingStart({ startEventId: event.event_id, startedAt: event.timestamp, sessionId: "strength-a", planSlotId: "strength-a", plan: session(sets) })
  assert.equal(occurrence?.trainingOccurrenceId, event.event_id)
  return event
}

function finishSet(index: number) {
  assert.ok(dispatchEvent("TRAINING_SET_COMPLETED", { sessionId: "strength-a", moveId: "squat", setIndex: index, completed: true, skipped: false, actualWeight: 60, actualAmount: 8 }))
}

function closeOnce() {
  const event = dispatchEvent("TRAINING_COMPLETED", { sessionId: "strength-a", decisionId: "d1", setsCompleted: 3, interruptions: false, actual: { sets: 3 } })
  assert.ok(event)
  closeTrainingOccurrence(event)
  return event
}

test("one finished training keeps its own ratio", () => {
  setStoreBackend(memory())
  const event = start(3)
  finishSet(1)
  finishSet(2)
  finishSet(3)
  const summary = trainingSummary([event.event_id])
  assert.deepEqual(summary.items[0]?.fact, readTrainingFact(event.event_id))
  assert.equal(summary.items[0]?.fact?.completionRatio, 1)
  assert.equal(summary.completionRatio, 1)
  setStoreBackend(memory())
  const partial = start(3)
  finishSet(1)
  finishSet(2)
  const partialSummary = trainingSummary([partial.event_id])
  assert.equal(partialSummary.items[0]?.fact?.completedSetCount, 2)
  assert.equal(partialSummary.items[0]?.fact?.notRecordedSetCount, 1)
  assert.equal(partialSummary.items[0]?.fact?.skippedSetCount, 0)
  assert.equal(partialSummary.completionRatio, 2 / 3)
})

test("a missing start stays unknown and an empty window stays zero", () => {
  const box = memory()
  setStoreBackend(box)
  bindTrainingStart({ startEventId: "orphan", startedAt: "2026-10-07T01:00:00.000Z", sessionId: "strength-b", planSlotId: "strength-b", plan: session(3) })
  const before = remember(box)
  const missing = trainingSummary(["orphan", "missing-history"])
  assert.equal(missing.items[0]?.fact, null)
  assert.equal(missing.items[1]?.fact, null)
  assert.equal(missing.completedSetCount, null)
  assert.equal(missing.plannedSetCount, null)
  assert.equal(missing.completionRatio, null)
  assert.notEqual(missing.completedSetCount, 0)
  assert.equal(remember(box), before)
  const event = start(3)
  const saved = remember(box)
  const empty = trainingSummary([event.event_id])
  assert.equal(empty.items[0]?.fact?.completedSetCount, 0)
  assert.equal(empty.items[0]?.fact?.completionRatio, 0)
  assert.equal(empty.items[0]?.fact?.lifecycle, "IN_PROGRESS")
  assert.notEqual(empty.items[0]?.fact?.lifecycle, "ABANDONED")
  assert.equal(empty.items[0]?.fact?.duration, null)
  assert.equal(empty.completionRatio, 0)
  assert.equal(remember(box), saved)
})

test("a later plan and a repeated close do not rewrite the summary", () => {
  setStoreBackend(memory())
  const event = start(3)
  assert.equal(session(5).moves[0]?.sets, 5)
  assert.equal(trainingSummary([event.event_id]).items[0]?.fact?.plannedSetCount, 3)
  const first = closeOnce()
  const second = closeOnce()
  assert.notEqual(first.event_id, second.event_id)
  const summary = trainingSummary([event.event_id])
  assert.deepEqual(summary.items[0]?.fact, readTrainingFact(event.event_id))
  assert.equal(summary.items[0]?.fact?.lifecycle, "DUPLICATE_CLOSE")
  assert.equal(summary.items[0]?.fact?.endedAt, null)
  assert.equal(summary.items[0]?.fact?.duration, null)
})

test("duplicate attempts stay unresolved and two trainings stay separate", () => {
  setStoreBackend(memory())
  const first = start(3)
  finishSet(1)
  finishSet(1)
  const duplicated = trainingSummary([first.event_id])
  assert.equal(duplicated.items[0]?.fact?.duplicateSetCount, 1)
  assert.equal(duplicated.items[0]?.fact?.completedSetCount, 0)
  assert.equal(duplicated.items[0]?.fact?.attemptCount, 2)
  closeOnce()
  const second = start(3)
  finishSet(1)
  finishSet(2)
  const separate = trainingSummary([first.event_id, second.event_id])
  assert.equal(separate.items.length, 2)
  assert.notEqual(separate.items[0]?.trainingOccurrenceId, separate.items[1]?.trainingOccurrenceId)
  assert.equal(separate.items[0]?.fact?.plannedSetCount, 3)
  assert.equal(separate.items[0]?.fact?.completedSetCount, 0)
  assert.equal(separate.items[1]?.fact?.completedSetCount, 2)
  assert.equal(separate.items[1]?.fact?.completionRatio, 2 / 3)
  assert.deepEqual(separate.items[0]?.fact, readTrainingFact(first.event_id))
  assert.deepEqual(separate.items[1]?.fact, readTrainingFact(second.event_id))
})

test("an unknown training keeps the combined total unknown", () => {
  setStoreBackend(memory())
  const first = start(3)
  finishSet(1)
  finishSet(2)
  finishSet(3)
  closeOnce()
  const second = start(3)
  finishSet(1)
  finishSet(2)
  const known = trainingSummary([first.event_id, second.event_id])
  assert.equal(known.plannedSetCount, 6)
  assert.equal(known.completedSetCount, 5)
  assert.equal(known.completionRatio, 5 / 6)
  const mixed = trainingSummary([first.event_id, second.event_id, "missing-history"])
  assert.equal(mixed.items[0]?.fact?.completionRatio, 1)
  assert.equal(mixed.items[1]?.fact?.completionRatio, 2 / 3)
  assert.equal(mixed.items[2]?.fact, null)
  assert.equal(mixed.plannedSetCount, null)
  assert.equal(mixed.completedSetCount, null)
  assert.equal(mixed.completionRatio, null)
  assert.notEqual(mixed.completionRatio, 5 / 6)
})

test("the summary only reads facts and does not write", () => {
  const source = readFileSync(new URL("./training-summary.ts", import.meta.url), "utf8")
  assert.equal(source.includes("readTrainingFact"), true)
  assert.equal(source.includes("loadTrainingFact"), false)
  assert.equal(source.includes("projectActualSets"), false)
  assert.equal(source.includes("attemptsForOccurrence"), false)
  assert.equal(source.includes("mergeSets"), false)
  assert.equal(source.includes("strengthSnapshot"), false)
  assert.equal(source.includes("writeEnvelope"), false)
  assert.equal(source.includes("dispatchEvent"), false)
  assert.equal(source.includes("factDuration"), false)
})
