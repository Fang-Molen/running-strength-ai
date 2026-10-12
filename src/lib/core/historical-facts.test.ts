import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { projectHistoricalFacts } from "./historical-facts.ts"
import { bindTrainingStart } from "./occurrence.ts"
import { setStoreBackend, type MemoryStore, writeEnvelope } from "./storage.ts"
import { readTrainingFact } from "./fact-read.ts"
import type { AppEvent } from "./types.ts"

function memory(): MemoryStore {
  const dump = new Map<string, string>()
  return { keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function session(): Session {
  return { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 3, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }] }
}

function event(id: string, type: AppEvent["event_type"], timestamp: string): AppEvent {
  return { event_id: id, athlete_id: "local", timestamp, event_type: type, source: "MANUAL", payload: { sessionId: "strength-a", decisionId: "d1" }, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 }
}

test("historical facts are the existing single-training facts, not guessed zeros", () => {
  setStoreBackend(memory())
  writeEnvelope(EVENTS_KEY, [event("start-a", "TRAINING_STARTED", "2026-10-02T08:00:00.000Z")])
  bindTrainingStart({ startEventId: "start-a", startedAt: "2026-10-02T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: session() })
  const projected = projectHistoricalFacts({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" })
  const fact = readTrainingFact("start-a")
  assert.equal(projected.occurrencePresence, "TRAINING_OCCURRENCES_PRESENT")
  assert.deepEqual(projected.occurrences[0]?.fact, fact)
  assert.equal(projected.occurrences[0]?.fact?.duration, null)
  assert.notEqual(projected.occurrences[0]?.fact?.duration, 0)
  assert.equal(projected.occurrences[0]?.fact?.completionRatio == null || typeof projected.occurrences[0]?.fact?.completionRatio === "number", true)
  const outside = projectHistoricalFacts({ from: "2026-11-01T00:00:00.000Z", to: "2026-11-08T00:00:00.000Z" })
  assert.equal(outside.occurrencePresence, "NO_TRAINING_OCCURRENCES")
  assert.deepEqual(outside.occurrences, [])
  const source = readFileSync(new URL("./historical-facts.ts", import.meta.url), "utf8")
  assert.equal(source.includes("readTrainingFact"), true)
  for (const word of ["?? 0", "training-decision", "ACWR"]) assert.equal(source.includes(word), false)
})
