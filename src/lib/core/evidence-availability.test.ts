import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { evidenceAvailability } from "./evidence-availability.ts"
import { bindTrainingStart } from "./occurrence.ts"
import { setStoreBackend, type MemoryStore, writeEnvelope } from "./storage.ts"
import type { AppEvent } from "./types.ts"

function memory(): MemoryStore {
  const dump = new Map<string, string>()
  return { keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function session(): Session {
  return { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 3, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }] }
}

function event(id: string, type: AppEvent["event_type"], timestamp: string, payload: Record<string, unknown>): AppEvent {
  return { event_id: id, athlete_id: "local", timestamp, event_type: type, source: "MANUAL", payload, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 }
}

function seed(id: string, extra: AppEvent[] = []) {
  setStoreBackend(memory())
  writeEnvelope(EVENTS_KEY, [event(id, "TRAINING_STARTED", "2026-10-07T08:00:00.000Z", { sessionId: "strength-a", decisionId: "d1" }), ...extra])
  bindTrainingStart({ startEventId: id, startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: session() })
}

test("missing training availability is null, not an empty normal state", () => {
  setStoreBackend(memory())
  assert.equal(evidenceAvailability("missing"), null)
})

test("no cited evidence stays distinct from a normal state", () => {
  seed("empty")
  const empty = evidenceAvailability("empty")
  assert.equal(empty?.fatigue.state, "NO_RELEVANT_EVIDENCE")
  assert.equal(empty?.fatigue.citedEvidence, "NO_CITED_EVIDENCE")
  assert.equal(empty?.fatigue.conclusion, "UNKNOWN")
  assert.equal(empty?.recovery.citedEvidence, "NO_CITED_EVIDENCE")
  assert.equal(empty?.musculoskeletal.citedEvidence, "NO_CITED_EVIDENCE")
  assert.equal(empty?.fatigue.evaluated, true)
  assert.equal("normal" in (empty?.fatigue ?? {}), false)
  seed("rpe6", [event("rpe", "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 6, trainingOccurrenceId: "rpe6" })])
  const low = evidenceAvailability("rpe6")
  assert.equal(low?.recovery.state, "INSUFFICIENT_EVIDENCE")
  assert.equal(low?.recovery.citedEvidence, "NO_CITED_EVIDENCE")
  assert.notEqual(low?.recovery.state, "NO_RELEVANT_EVIDENCE")
  seed("pain", [event("knee", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "left-knee", intensity: 4, trainingOccurrenceId: "pain" })])
  const pain = evidenceAvailability("pain")
  assert.equal(pain?.musculoskeletal.state, "SIGNAL_PRESENT")
  assert.equal(pain?.musculoskeletal.citedEvidence, "CITED_EVIDENCE_PRESENT")
  assert.equal(pain?.musculoskeletal.conclusion, "UNKNOWN")
  assert.equal(pain?.fatigue.state, "NO_RELEVANT_EVIDENCE")
  assert.equal("overallState" in (pain ?? {}), false)
  const source = readFileSync(new URL("./evidence-availability.ts", import.meta.url), "utf8")
  for (const word of ["NORMAL", "score", "recommendation", "training-decision", "loadEvents"]) assert.equal(source.includes(word), false)
})
