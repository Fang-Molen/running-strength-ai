import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { queryHistoricalOccurrences } from "./historical-occurrences.ts"
import { bindTrainingStart } from "./occurrence.ts"
import { setStoreBackend, type MemoryStore, writeEnvelope } from "./storage.ts"
import type { AppEvent } from "./types.ts"

function memory(): MemoryStore {
  const dump = new Map<string, string>()
  return { keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function session(id: string): Session {
  return { id, name: id, moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 3, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }] }
}

function event(id: string, type: AppEvent["event_type"], timestamp: string, payload: Record<string, unknown> = {}): AppEvent {
  return { event_id: id, athlete_id: "local", timestamp, event_type: type, source: "MANUAL", payload, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 }
}

test("an empty or invalid window is not treated as a normal history", () => {
  setStoreBackend(memory())
  const empty = queryHistoricalOccurrences({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" })
  assert.equal(empty.occurrencePresence, "NO_TRAINING_OCCURRENCES")
  assert.deepEqual(empty.occurrences, [])
  assert.equal(empty.window.fromInclusive, true)
  assert.equal(empty.window.toExclusive, true)
  assert.equal(queryHistoricalOccurrences({ from: "2026-10-08T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" }).occurrencePresence, "INVALID_WINDOW")
  assert.equal(queryHistoricalOccurrences({ from: "nope", to: "2026-10-08T00:00:00.000Z" }).occurrencePresence, "INVALID_WINDOW")
})

test("only real starts inside the half-open window are returned, in start order", () => {
  setStoreBackend(memory())
  writeEnvelope(EVENTS_KEY, [
    event("late", "TRAINING_STARTED", "2026-10-03T00:00:00.000Z"),
    event("early", "TRAINING_STARTED", "2026-10-01T00:00:00.000Z"),
    event("edge", "TRAINING_STARTED", "2026-10-08T00:00:00.000Z"),
    event("rpe-only", "RPE_RECORDED", "2026-10-02T00:00:00.000Z", { evidenceType: "SESSION_RPE", value: 9 }),
    event("done-only", "TRAINING_COMPLETED", "2026-10-04T00:00:00.000Z", { sessionId: "ghost", setsCompleted: 1 }),
  ])
  bindTrainingStart({ startEventId: "late", startedAt: "2026-10-03T00:00:00.000Z", sessionId: "strength-late", planSlotId: "strength-late", plan: session("strength-late") })
  bindTrainingStart({ startEventId: "early", startedAt: "2026-10-01T00:00:00.000Z", sessionId: "strength-early", planSlotId: "strength-early", plan: session("strength-early") })
  bindTrainingStart({ startEventId: "edge", startedAt: "2026-10-08T00:00:00.000Z", sessionId: "strength-edge", planSlotId: "strength-edge", plan: session("strength-edge") })
  bindTrainingStart({ startEventId: "untimed", startedAt: null, sessionId: "strength-untimed", planSlotId: "strength-untimed", plan: session("strength-untimed") })
  const seen = queryHistoricalOccurrences({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" })
  assert.equal(seen.occurrencePresence, "TRAINING_OCCURRENCES_PRESENT")
  assert.deepEqual(seen.occurrences.map((item) => item.trainingOccurrenceId), ["early", "late"])
  assert.equal(seen.window.order, "STARTED_AT_ASCENDING")
  const source = readFileSync(new URL("./historical-occurrences.ts", import.meta.url), "utf8")
  assert.equal(source.includes("listTrainingOccurrences"), true)
  for (const word of ["RPE_RECORDED", "TRAINING_COMPLETED", "training-decision", "ACWR"]) assert.equal(source.includes(word), false)
})
