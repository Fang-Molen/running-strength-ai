import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { dispatchEvent, loadEvents } from "./events.ts"
import { readTrainingFact } from "./fact-read.ts"
import { bindTrainingStart, closeTrainingOccurrence } from "./occurrence.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"
import { loadTrainingFact } from "./training-fact.ts"

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

test("a full log of three completed sets reads a ratio of 1", () => {
  const box = memory()
  setStoreBackend(box)
  const event = start(3)
  finishSet(1)
  finishSet(2)
  finishSet(3)
  const before = remember(box)
  const fact = readTrainingFact(event.event_id)
  assert.deepEqual(fact, loadTrainingFact(event.event_id, loadEvents()))
  assert.equal(fact?.plannedSetCount, 3)
  assert.equal(fact?.completedSetCount, 3)
  assert.equal(fact?.completionRatio, 1)
  assert.equal(remember(box), before)
})

test("a full log of two completed sets reads a ratio of 2/3", () => {
  setStoreBackend(memory())
  const event = start(3)
  finishSet(1)
  finishSet(2)
  const fact = readTrainingFact(event.event_id)
  assert.equal(fact?.completedSetCount, 2)
  assert.equal(fact?.notRecordedSetCount, 1)
  assert.equal(fact?.skippedSetCount, 0)
  assert.equal(fact?.completionRatio, 2 / 3)
})

test("a missing start does not become a fact or a zero completion", () => {
  const box = memory()
  setStoreBackend(box)
  bindTrainingStart({ startEventId: "orphan", startedAt: "2026-10-07T01:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: session(3) })
  const before = remember(box)
  assert.equal(readTrainingFact("orphan"), null)
  assert.equal(readTrainingFact("missing-history"), null)
  assert.notEqual(readTrainingFact("orphan")?.completionRatio, 0)
  assert.equal(remember(box), before)
})

test("an empty confirmed window reads completion 0 and stays in progress", () => {
  setStoreBackend(memory())
  const event = start(3)
  const fact = readTrainingFact(event.event_id)
  assert.equal(fact?.attemptCount, 0)
  assert.equal(fact?.completedSetCount, 0)
  assert.equal(fact?.notRecordedSetCount, 3)
  assert.equal(fact?.completionRatio, 0)
  assert.equal(fact?.lifecycle, "IN_PROGRESS")
  assert.notEqual(fact?.lifecycle, "ABANDONED")
  assert.equal(fact?.duration, null)
  assert.equal(fact?.endedAt, null)
})

test("the later plan does not change the earlier training", () => {
  setStoreBackend(memory())
  const event = start(3)
  const current = session(5)
  assert.equal(current.moves[0]?.sets, 5)
  assert.equal(readTrainingFact(event.event_id)?.plannedSetCount, 3)
})

test("a repeated close does not create an end time", () => {
  setStoreBackend(memory())
  const event = start(3)
  const first = dispatchEvent("TRAINING_COMPLETED", { sessionId: "strength-a", decisionId: "d1", setsCompleted: 3, interruptions: false, actual: { sets: 3 } })
  const second = dispatchEvent("TRAINING_COMPLETED", { sessionId: "strength-a", decisionId: "d1", setsCompleted: 3, interruptions: false, actual: { sets: 3 } })
  assert.ok(first && second)
  closeTrainingOccurrence(first)
  closeTrainingOccurrence(second)
  const fact = readTrainingFact(event.event_id)
  assert.equal(fact?.lifecycle, "DUPLICATE_CLOSE")
  assert.equal(fact?.endedAt, null)
  assert.equal(fact?.duration, null)
  assert.deepEqual(fact, loadTrainingFact(event.event_id, loadEvents()))
})

test("the adapter only reads through the frozen fact projection", () => {
  const source = readFileSync(new URL("./fact-read.ts", import.meta.url), "utf8")
  assert.equal(source.includes("loadTrainingFact"), true)
  assert.equal(source.includes("projectActualSets"), false)
  assert.equal(source.includes("attemptsForOccurrence"), false)
  assert.equal(source.includes("mergeSets"), false)
  assert.equal(source.includes("strengthSnapshot"), false)
  assert.equal(source.includes("writeEnvelope"), false)
  assert.equal(source.includes("dispatchEvent"), false)
})
