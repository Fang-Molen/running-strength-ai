import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { evidenceProvenance } from "./evidence-provenance.ts"
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

test("provenance is empty rather than null when a training has no cited evidence", () => {
  setStoreBackend(memory())
  assert.equal(evidenceProvenance("missing"), null)
  seed("empty")
  const empty = evidenceProvenance("empty")
  assert.deepEqual(empty?.records, [])
})

test("the same evidence stays attached to each domain that cites it", () => {
  seed("start-a", [
    event("sleep", "SLEEP_RECORDED", "2026-10-06T23:00:00.000Z", { hours: 5, trainingOccurrenceId: "start-a" }),
    event("rpe", "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 9, trainingOccurrenceId: "start-a" }),
    event("knee", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "left-knee", intensity: 4, trainingOccurrenceId: "start-a" }),
  ])
  const records = evidenceProvenance("start-a")?.records ?? []
  const sleepRows = records.filter((item) => item.evidenceId === "sleep")
  assert.deepEqual(sleepRows.map((item) => item.domain).sort(), ["FATIGUE", "RECOVERY"])
  assert.equal(sleepRows.every((item) => item.role === "SIGNAL"), true)
  const pain = records.find((item) => item.evidenceId === "knee")
  assert.equal(pain?.domain, "MUSCULOSKELETAL")
  assert.equal(pain?.role, "PAIN")
  assert.deepEqual(pain?.location, ["left-knee"])
  assert.equal(pain?.severity, 4)
  assert.equal(pain?.timestamp, "2026-10-07T08:20:00.000Z")
  const rpeRows = records.filter((item) => item.evidenceId === "rpe")
  assert.deepEqual(rpeRows.map((item) => item.domain).sort(), ["FATIGUE", "RECOVERY"])
  assert.equal(rpeRows.find((item) => item.domain === "RECOVERY")?.role, "CONTEXT")
  const source = readFileSync(new URL("./evidence-provenance.ts", import.meta.url), "utf8")
  assert.equal(source.includes("readEvidenceBundle"), true)
  assert.equal(source.includes("loadEvents"), false)
  assert.equal(source.includes("training-decision"), false)
})
