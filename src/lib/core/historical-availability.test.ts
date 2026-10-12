import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { projectHistoricalAvailability } from "./historical-availability.ts"
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

function event(id: string, type: AppEvent["event_type"], timestamp: string, payload: Record<string, unknown>): AppEvent {
  return { event_id: id, athlete_id: "local", timestamp, event_type: type, source: "MANUAL", payload, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 }
}

test("domain availability stays separate for each training and does not become good or bad", () => {
  setStoreBackend(memory())
  assert.equal(projectHistoricalAvailability({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" }).occurrencePresence, "NO_TRAINING_OCCURRENCES")
  writeEnvelope(EVENTS_KEY, [
    event("bare", "TRAINING_STARTED", "2026-10-02T08:00:00.000Z", { sessionId: "strength-bare", decisionId: "d1" }),
    event("tired", "TRAINING_STARTED", "2026-10-03T08:00:00.000Z", { sessionId: "strength-tired", decisionId: "d1" }),
    event("sleep", "SLEEP_RECORDED", "2026-10-02T23:00:00.000Z", { hours: 5, trainingOccurrenceId: "tired" }),
    event("easy", "TRAINING_STARTED", "2026-10-04T08:00:00.000Z", { sessionId: "strength-easy", decisionId: "d1" }),
    event("rpe", "RPE_RECORDED", "2026-10-04T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 6, trainingOccurrenceId: "easy" }),
    event("sore-day", "TRAINING_STARTED", "2026-10-05T08:00:00.000Z", { sessionId: "strength-sore", decisionId: "d1" }),
    event("knee", "PAIN_RECORDED", "2026-10-05T08:20:00.000Z", { location: "left-knee", intensity: 4, trainingOccurrenceId: "sore-day" }),
    event("loose", "SLEEP_RECORDED", "2026-10-05T23:00:00.000Z", { hours: 5, sessionId: "strength-sore" }),
  ])
  for (const [id, at] of [["bare", "2026-10-02T08:00:00.000Z"], ["tired", "2026-10-03T08:00:00.000Z"], ["easy", "2026-10-04T08:00:00.000Z"], ["sore-day", "2026-10-05T08:00:00.000Z"]] as const) {
    bindTrainingStart({ startEventId: id, startedAt: at, sessionId: `strength-${id}`, planSlotId: `strength-${id}`, plan: session(`strength-${id}`) })
  }
  const seen = projectHistoricalAvailability({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" })
  const bare = seen.occurrences.find((item) => item.trainingOccurrenceId === "bare")
  const tired = seen.occurrences.find((item) => item.trainingOccurrenceId === "tired")
  const easy = seen.occurrences.find((item) => item.trainingOccurrenceId === "easy")
  const sore = seen.occurrences.find((item) => item.trainingOccurrenceId === "sore-day")
  assert.equal(bare?.fatigue, "NO_CITED_EVIDENCE")
  assert.equal(bare?.availability?.fatigue.conclusion, "UNKNOWN")
  assert.equal(tired?.fatigue, "EVIDENCE_PRESENT")
  assert.equal(tired?.recovery, "EVIDENCE_PRESENT")
  assert.equal(tired?.musculoskeletal, "NO_CITED_EVIDENCE")
  assert.equal(easy?.fatigue, "EVIDENCE_UNRESOLVED")
  assert.equal(easy?.availability?.fatigue.citedEvidence, "CITED_EVIDENCE_PRESENT")
  assert.equal(easy?.recovery, "EVIDENCE_UNRESOLVED")
  assert.equal(easy?.availability?.recovery.citedEvidence, "NO_CITED_EVIDENCE")
  assert.notEqual(easy?.recovery, "NO_CITED_EVIDENCE")
  assert.equal(sore?.musculoskeletal, "EVIDENCE_PRESENT")
  assert.equal(sore?.recovery, "NO_CITED_EVIDENCE")
  assert.equal(sore?.availability?.musculoskeletal.conclusion, "UNKNOWN")
  const source = readFileSync(new URL("./historical-availability.ts", import.meta.url), "utf8")
  for (const word of ["NORMAL", "GOOD", "BAD", "training-decision", "ACWR", "平均"]) assert.equal(source.includes(word), false)
})
