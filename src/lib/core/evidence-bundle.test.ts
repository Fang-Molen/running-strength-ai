import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { readEvidenceBundle } from "./evidence-bundle.ts"
import { bindTrainingStart } from "./occurrence.ts"
import { setStoreBackend, type MemoryStore, writeEnvelope } from "./storage.ts"
import { readTrainingFact } from "./fact-read.ts"
import { trainingSummary } from "./training-summary.ts"
import type { AppEvent } from "./types.ts"

function memory(): MemoryStore & { dump: Map<string, string> } {
  const dump = new Map<string, string>()
  return { dump, keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function session(): Session {
  return { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 3, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }] }
}

function event(id: string, type: AppEvent["event_type"], timestamp: string, payload: Record<string, unknown>): AppEvent {
  return { event_id: id, athlete_id: "local", timestamp, event_type: type, source: "MANUAL", payload, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 }
}

function seed(id: string, extra: AppEvent[] = []) {
  const box = memory()
  setStoreBackend(box)
  writeEnvelope(EVENTS_KEY, [event(id, "TRAINING_STARTED", "2026-10-07T08:00:00.000Z", { sessionId: "strength-a", decisionId: "d1" }), ...extra])
  bindTrainingStart({ startEventId: id, startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: session() })
  return box
}

test("a missing training has no evidence bundle", () => {
  setStoreBackend(memory())
  assert.equal(readEvidenceBundle("missing"), null)
})

test("a bundle keeps the three domain results unchanged", () => {
  const box = seed("start-a", [
    event("rpe", "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 9, trainingOccurrenceId: "start-a" }),
    event("sleep", "SLEEP_RECORDED", "2026-10-06T23:00:00.000Z", { hours: 5, trainingOccurrenceId: "start-a" }),
    event("knee", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "left-knee", intensity: 4, trainingOccurrenceId: "start-a" }),
  ])
  const beforeFact = readTrainingFact("start-a")
  const beforeSummary = trainingSummary(["start-a"])
  const saved = JSON.stringify([...box.dump.entries()])
  const bundle = readEvidenceBundle("start-a")
  assert.ok(bundle)
  assert.deepEqual(Object.keys(bundle).sort(), ["fatigue", "musculoskeletal", "recovery", "trainingOccurrenceId"])
  assert.equal(bundle.fatigue.state, "SIGNAL_PRESENT")
  assert.equal(bundle.fatigue.fatigueConclusion, "UNKNOWN")
  assert.equal(bundle.recovery.state, "SIGNAL_PRESENT")
  assert.equal(bundle.recovery.recoveryConclusion, "UNKNOWN")
  assert.equal(bundle.musculoskeletal.state, "SIGNAL_PRESENT")
  assert.equal(bundle.musculoskeletal.musculoskeletalConclusion, "UNKNOWN")
  assert.equal(bundle.musculoskeletal.pain[0]?.severity, 4)
  assert.equal("overallState" in bundle, false)
  assert.equal("signalCount" in bundle, false)
  assert.deepEqual(readTrainingFact("start-a"), beforeFact)
  assert.deepEqual(trainingSummary(["start-a"]), beforeSummary)
  assert.equal(JSON.stringify([...box.dump.entries()]), saved)
  seed("empty")
  const empty = readEvidenceBundle("empty")
  assert.equal(empty?.fatigue.state, "NO_RELEVANT_EVIDENCE")
  assert.equal(empty?.recovery.state, "NO_RELEVANT_EVIDENCE")
  assert.equal(empty?.musculoskeletal.state, "NO_RELEVANT_EVIDENCE")
  assert.equal(empty?.fatigue.fatigueConclusion, "UNKNOWN")
  const source = readFileSync(new URL("./evidence-bundle.ts", import.meta.url), "utf8")
  for (const word of ["loadEvents", "readTrainingFact", "trainingSummary", "training-decision", "overallState", "overallConclusion", "signalCount", "worstState", "combinedEvidenceIds"]) {
    assert.equal(source.includes(word), false)
  }
})
