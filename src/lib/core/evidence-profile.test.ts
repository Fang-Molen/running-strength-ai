import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { getTrainingEvidenceProfile } from "./evidence-profile.ts"
import { bindTrainingStart } from "./occurrence.ts"
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

test("a known training profile keeps only evidence bound to that start", () => {
  const box = memory()
  setStoreBackend(box)
  const events = [
    event("start-a", "TRAINING_STARTED", "2026-10-07T08:00:00.000Z", { sessionId: "strength-a", decisionId: "d1" }),
    event("set-1", "TRAINING_SET_COMPLETED", "2026-10-07T08:10:00.000Z", { trainingOccurrenceId: "start-a", sessionId: "strength-a", moveId: "squat", setIndex: 1, mode: "reps", actualWeight: 60, actualAmount: 8, completed: true, skipped: false }),
    event("set-loose", "TRAINING_SET_COMPLETED", "2026-10-07T08:11:00.000Z", { sessionId: "strength-a", planSlotId: "strength-a", moveId: "squat", setIndex: 2, mode: "reps", actualWeight: 50, actualAmount: 5, completed: true, skipped: false }),
    event("run-1", "RUN_COMPLETED", "2026-10-07T07:00:00.000Z", { km: 6, seconds: 1800, trainingOccurrenceId: "start-a" }),
    event("run-loose", "RUN_COMPLETED", "2026-10-07T08:00:00.000Z", { km: 3, seconds: 900, sessionId: "strength-a" }),
    event("sleep-1", "SLEEP_RECORDED", "2026-10-06T23:00:00.000Z", { hours: 6, trainingOccurrenceId: "start-a" }),
    event("sleep-2", "SLEEP_RECORDED", "2026-10-07T06:30:00.000Z", { hours: 7, trainingOccurrenceId: "start-a" }),
    event("sleep-loose", "SLEEP_RECORDED", "2026-10-07T06:40:00.000Z", { hours: 8, sessionId: "strength-a" }),
    event("recovery-1", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:40:00.000Z", { evidenceType: "SUBJECTIVE_RECOVERY", value: 4, trainingOccurrenceId: "start-a" }),
    event("recovery-2", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:41:00.000Z", { evidenceType: "SUBJECTIVE_RECOVERY", value: 8, trainingOccurrenceId: "start-a" }),
    event("sore-1", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:45:00.000Z", { evidenceType: "SORENESS", location: "quad", intensity: 3, trainingOccurrenceId: "start-a" }),
    event("pain-1", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "knee", intensity: 4, trainingOccurrenceId: "start-a" }),
    event("pain-2", "PAIN_RECORDED", "2026-10-07T08:21:00.000Z", { location: "ankle", intensity: 2, trainingOccurrenceId: "start-a" }),
    event("pain-loose", "PAIN_RECORDED", "2026-10-07T08:22:00.000Z", { moveIds: ["squat"], sessionId: "strength-a" }),
    event("rpe-10", "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 10, trainingOccurrenceId: "start-a" }),
    event("rpe-6", "RPE_RECORDED", "2026-10-07T09:05:00.000Z", { evidenceType: "SESSION_RPE", value: 6, trainingOccurrenceId: "start-a" }),
    event("rpe-loose", "RPE_RECORDED", "2026-10-07T09:06:00.000Z", { evidenceType: "SESSION_RPE", value: 5, sessionId: "strength-a" }),
    event("rpe-zero", "RPE_RECORDED", "2026-10-07T09:07:00.000Z", { evidenceType: "SESSION_RPE", value: 0, trainingOccurrenceId: "start-a" }),
    event("rpe-high", "RPE_RECORDED", "2026-10-07T09:08:00.000Z", { evidenceType: "SESSION_RPE", value: 11, trainingOccurrenceId: "start-a" }),
    event("run-rpe", "RPE_RECORDED", "2026-10-07T09:09:00.000Z", { rpe: 8, km: 5 }),
  ]
  writeEnvelope(EVENTS_KEY, events)
  bindTrainingStart({ startEventId: "start-a", startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: session() })
  const beforeFact = readTrainingFact("start-a")
  const beforeSummary = trainingSummary(["start-a"])
  const saved = JSON.stringify([...box.dump.entries()])
  const profile = getTrainingEvidenceProfile("start-a")
  assert.ok(profile)
  assert.equal(profile.trainingOccurrenceId, "start-a")
  assert.deepEqual(profile.fact, beforeFact)
  assert.equal(profile.evidence.strength.length, 1)
  assert.equal(profile.evidence.strength[0]?.actualWeightKg, 60)
  assert.equal(profile.evidence.strength[0]?.actualReps, 8)
  assert.equal(profile.evidence.strength[0]?.timestamp, "2026-10-07T08:10:00.000Z")
  assert.equal(profile.evidence.running.length, 1)
  assert.equal(profile.evidence.running[0]?.distanceKm, 6)
  assert.equal(profile.evidence.running[0]?.durationSec, 1800)
  assert.equal("paceSecPerKm" in profile.evidence.running[0]!, false)
  assert.equal(profile.evidence.sleep.status, "MULTIPLE")
  assert.equal(profile.evidence.sleep.value, null)
  assert.deepEqual(profile.evidence.sleep.records.map((item) => item.timestamp), ["2026-10-06T23:00:00.000Z", "2026-10-07T06:30:00.000Z"])
  assert.equal(profile.evidence.subjectiveRecovery.status, "MULTIPLE")
  assert.equal(profile.evidence.subjectiveRecovery.value, null)
  assert.deepEqual(profile.evidence.subjectiveRecovery.records.map((item) => item.value), [4, 8])
  assert.equal(profile.evidence.soreness.status, "RECORDED")
  assert.deepEqual(profile.evidence.soreness.records[0]?.location, ["quad"])
  assert.equal(profile.evidence.pain.status, "MULTIPLE")
  assert.equal(profile.evidence.pain.value, null)
  assert.deepEqual(profile.evidence.pain.records.map((item) => item.value), [4, 2])
  assert.notEqual(profile.evidence.pain.value, 0)
  assert.equal(profile.evidence.sessionRpe.status, "MULTIPLE")
  assert.equal(profile.evidence.sessionRpe.value, null)
  assert.deepEqual(profile.evidence.sessionRpe.records.map((item) => item.value), [10, 6])
  assert.equal(getTrainingEvidenceProfile("missing"), null)
  assert.deepEqual(readTrainingFact("start-a"), beforeFact)
  assert.deepEqual(trainingSummary(["start-a"]), beforeSummary)
  assert.equal(JSON.stringify([...box.dump.entries()]), saved)
})

test("a training with no subjective evidence stays absent rather than zero", () => {
  setStoreBackend(memory())
  writeEnvelope(EVENTS_KEY, [event("start-b", "TRAINING_STARTED", "2026-10-07T08:00:00.000Z", { sessionId: "strength-a", decisionId: "d1" })])
  bindTrainingStart({ startEventId: "start-b", startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: session() })
  const profile = getTrainingEvidenceProfile("start-b")
  assert.ok(profile)
  assert.equal(profile.evidence.sleep.status, "ABSENT")
  assert.equal(profile.evidence.sleep.value, null)
  assert.equal(profile.evidence.pain.status, "ABSENT")
  assert.equal(profile.evidence.pain.value, null)
  assert.equal(profile.evidence.subjectiveRecovery.status, "ABSENT")
  assert.equal(profile.evidence.subjectiveRecovery.value, null)
  assert.equal(profile.evidence.sessionRpe.status, "ABSENT")
  assert.equal(profile.evidence.sessionRpe.value, null)
  assert.equal(profile.evidence.strength.length, 0)
  assert.equal(profile.evidence.running.length, 0)
  const source = readFileSync(new URL("./evidence-profile.ts", import.meta.url), "utf8")
  assert.equal(source.includes("readTrainingFact"), true)
  assert.equal(source.includes("loadTrainingFact"), false)
  assert.equal(source.includes("writeEnvelope"), false)
  assert.equal(source.includes("training-decision"), false)
  assert.equal(source.includes("fatigue"), false)
  assert.equal(source.includes("paceSecPerKm"), false)
})
