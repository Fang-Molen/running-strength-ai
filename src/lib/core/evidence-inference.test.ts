import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { inferTrainingEvidence, type TrainingInference } from "./evidence-inference.ts"
import { bindTrainingStart, closeTrainingOccurrence } from "./occurrence.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"
import { writeEnvelope } from "./storage.ts"
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

function status(id: string, type: string): TrainingInference {
  const found = inferTrainingEvidence(id)?.inferences.find((item) => item.type === type)
  assert.ok(found)
  return found
}

test("a missing training has no inference", () => {
  setStoreBackend(memory())
  assert.equal(inferTrainingEvidence("missing"), null)
})

test("unique records support only the rule they directly meet", () => {
  seed("low", [event("rpe", "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 5, trainingOccurrenceId: "low" })])
  assert.equal(status("low", "HIGH_SUBJECTIVE_INTENSITY").status, "NOT_SUPPORTED")
  seed("high", [event("rpe", "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 7, trainingOccurrenceId: "high" })])
  const high = status("high", "HIGH_SUBJECTIVE_INTENSITY")
  assert.equal(high.status, "SUPPORTED")
  assert.deepEqual(high.evidenceIds, ["rpe"])
  assert.deepEqual(high.observationTypes, ["SESSION_RPE_HIGH"])
  assert.equal(high.confidence, "RULE_BASED")
  seed("top", [event("rpe", "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 10, trainingOccurrenceId: "top" })])
  assert.equal(status("top", "HIGH_SUBJECTIVE_INTENSITY").status, "SUPPORTED")
  seed("short", [event("sleep", "SLEEP_RECORDED", "2026-10-06T23:00:00.000Z", { hours: 5, trainingOccurrenceId: "short" })])
  assert.equal(status("short", "SHORT_SLEEP_RECORDED").status, "SUPPORTED")
  seed("enough", [event("sleep", "SLEEP_RECORDED", "2026-10-06T23:00:00.000Z", { hours: 6, trainingOccurrenceId: "enough" })])
  assert.equal(status("enough", "SHORT_SLEEP_RECORDED").status, "NOT_SUPPORTED")
  seed("tired", [event("recovery", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:40:00.000Z", { evidenceType: "SUBJECTIVE_RECOVERY", value: 3, trainingOccurrenceId: "tired" })])
  assert.equal(status("tired", "LOW_SUBJECTIVE_RECOVERY_RECORDED").status, "SUPPORTED")
  seed("ready", [event("recovery", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:40:00.000Z", { evidenceType: "SUBJECTIVE_RECOVERY", value: 4, trainingOccurrenceId: "ready" })])
  assert.equal(status("ready", "LOW_SUBJECTIVE_RECOVERY_RECORDED").status, "NOT_SUPPORTED")
  seed("pain", [event("pain", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "knee", intensity: 4, trainingOccurrenceId: "pain" })])
  const pain = status("pain", "PAIN_RECORDED")
  assert.equal(pain.status, "SUPPORTED")
  assert.deepEqual(pain.evidenceIds, ["pain"])
  seed("sore", [event("sore", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:45:00.000Z", { evidenceType: "SORENESS", location: "quad", intensity: 3, trainingOccurrenceId: "sore" })])
  assert.equal(status("sore", "SORENESS_RECORDED").status, "SUPPORTED")
  seed("done", [event("close-1", "TRAINING_COMPLETED", "2026-10-07T09:30:00.000Z", { sessionId: "strength-a", decisionId: "d1", setsCompleted: 1, interruptions: false, actual: { sets: 1 } })])
  closeTrainingOccurrence(event("close-1", "TRAINING_COMPLETED", "2026-10-07T09:30:00.000Z", { sessionId: "strength-a", decisionId: "d1", setsCompleted: 1, interruptions: false, actual: { sets: 1 } }))
  const completion = status("done", "TRAINING_COMPLETED")
  assert.equal(completion.status, "SUPPORTED")
  assert.deepEqual(completion.factIds, ["done"])
  seed("open")
  assert.equal(status("open", "TRAINING_COMPLETED").status, "NOT_SUPPORTED")
})

test("missing and repeated evidence stay unknown without a write", () => {
  const box = seed("start-a", [
    event("rpe-1", "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 6, trainingOccurrenceId: "start-a" }),
    event("rpe-2", "RPE_RECORDED", "2026-10-07T09:05:00.000Z", { evidenceType: "SESSION_RPE", value: 9, trainingOccurrenceId: "start-a" }),
    event("rpe-loose", "RPE_RECORDED", "2026-10-07T09:06:00.000Z", { evidenceType: "SESSION_RPE", value: 10, sessionId: "strength-a" }),
    event("sleep-1", "SLEEP_RECORDED", "2026-10-06T23:00:00.000Z", { hours: 5, trainingOccurrenceId: "start-a" }),
    event("sleep-2", "SLEEP_RECORDED", "2026-10-07T06:30:00.000Z", { hours: 8, trainingOccurrenceId: "start-a" }),
    event("recovery-1", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:40:00.000Z", { evidenceType: "SUBJECTIVE_RECOVERY", value: 3, trainingOccurrenceId: "start-a" }),
    event("recovery-2", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:41:00.000Z", { evidenceType: "SUBJECTIVE_RECOVERY", value: 8, trainingOccurrenceId: "start-a" }),
  ])
  const beforeFact = readTrainingFact("start-a")
  const beforeSummary = trainingSummary(["start-a"])
  const saved = JSON.stringify([...box.dump.entries()])
  const seen = inferTrainingEvidence("start-a")
  assert.equal(seen?.inferences.find((item) => item.type === "HIGH_SUBJECTIVE_INTENSITY")?.status, "UNKNOWN")
  assert.deepEqual(seen?.inferences.find((item) => item.type === "HIGH_SUBJECTIVE_INTENSITY")?.evidenceIds, ["rpe-1", "rpe-2"])
  assert.equal(seen?.inferences.find((item) => item.type === "SHORT_SLEEP_RECORDED")?.status, "UNKNOWN")
  assert.equal(seen?.inferences.find((item) => item.type === "LOW_SUBJECTIVE_RECOVERY_RECORDED")?.status, "UNKNOWN")
  assert.equal(seen?.inferences.find((item) => item.type === "PAIN_RECORDED")?.status, "UNKNOWN")
  assert.notEqual(seen?.inferences.find((item) => item.type === "PAIN_RECORDED")?.status, "NOT_SUPPORTED")
  assert.equal(seen?.inferences.find((item) => item.type === "SORENESS_RECORDED")?.status, "UNKNOWN")
  assert.notEqual(seen?.inferences.find((item) => item.type === "SORENESS_RECORDED")?.status, "NOT_SUPPORTED")
  assert.deepEqual(readTrainingFact("start-a"), beforeFact)
  assert.deepEqual(trainingSummary(["start-a"]), beforeSummary)
  assert.equal(JSON.stringify([...box.dump.entries()]), saved)
  seed("empty")
  assert.equal(status("empty", "HIGH_SUBJECTIVE_INTENSITY").status, "UNKNOWN")
  assert.equal(status("empty", "SHORT_SLEEP_RECORDED").status, "UNKNOWN")
  assert.equal(status("empty", "LOW_SUBJECTIVE_RECOVERY_RECORDED").status, "UNKNOWN")
  const source = readFileSync(new URL("./evidence-inference.ts", import.meta.url), "utf8")
  for (const word of ["loadEvents", "writeEnvelope", "training-decision", "FATIGUE", "INJURY", "OVERTRAINING", "READINESS", "paceSecPerKm"]) {
    assert.equal(source.includes(word), false)
  }
})
