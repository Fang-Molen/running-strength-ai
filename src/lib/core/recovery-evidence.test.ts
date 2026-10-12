import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { dispatchEvent } from "./events.ts"
import { projectEvidence, projectOccurrenceEvidence, type EvidenceEvent } from "./evidence.ts"
import { projectPerformance } from "./performance-evidence.ts"
import { bindTrainingStart } from "./occurrence.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"
import { readTrainingFact } from "./fact-read.ts"
import { trainingSummary } from "./training-summary.ts"

function memory(): MemoryStore & { dump: Map<string, string> } {
  const dump = new Map<string, string>()
  return { dump, keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function session(): Session {
  return { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 3, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }] }
}

function start(): EvidenceEvent {
  return { event_id: "start-a", event_type: "TRAINING_STARTED", timestamp: "2026-10-07T08:00:00.000Z", payload: { sessionId: "strength-a" } }
}

test("subjective evidence binds only to an explicit start and keeps its own time", () => {
  const sleepTime = "2026-10-07T06:30:00.000Z"
  const events: EvidenceEvent[] = [
    start(),
    { event_id: "sleep-bound", event_type: "SLEEP_RECORDED", timestamp: sleepTime, source: "MANUAL", payload: { hours: 6, trainingOccurrenceId: "start-a" } },
    { event_id: "sleep-morning", event_type: "SLEEP_RECORDED", timestamp: sleepTime, payload: { hours: 7, sessionId: "strength-a" } },
    { event_id: "sleep-again", event_type: "SLEEP_RECORDED", timestamp: "2026-10-07T07:00:00.000Z", payload: { hours: 5, trainingOccurrenceId: "start-a" } },
    { event_id: "recovery-bound", event_type: "SUBJECTIVE_FEEDBACK", timestamp: "2026-10-07T07:40:00.000Z", payload: { evidenceType: "SUBJECTIVE_RECOVERY", value: 6, trainingOccurrenceId: "start-a" } },
    { event_id: "recovery-rpe", event_type: "RPE_RECORDED", timestamp: "2026-10-07T07:41:00.000Z", payload: { rpe: 8 } },
    { event_id: "recovery-loose", event_type: "SUBJECTIVE_FEEDBACK", payload: { evidenceType: "SUBJECTIVE_RECOVERY", value: 4 } },
    { event_id: "sore-bound", event_type: "SUBJECTIVE_FEEDBACK", timestamp: "2026-10-07T07:45:00.000Z", payload: { evidenceType: "SORENESS", location: "quad", intensity: 3, trainingOccurrenceId: "start-a" } },
    { event_id: "sore-loose", event_type: "SUBJECTIVE_FEEDBACK", timestamp: "2026-10-07T07:46:00.000Z", payload: { evidenceType: "SORENESS", location: "calf", intensity: 2 } },
    { event_id: "pain-bound", event_type: "PAIN_RECORDED", timestamp: "2026-10-07T08:20:00.000Z", payload: { location: "knee", intensity: 4, trainingOccurrenceId: "start-a" } },
    { event_id: "pain-loose", event_type: "PAIN_RECORDED", timestamp: "2026-10-07T08:21:00.000Z", payload: { moveIds: ["squat"] } },
    { event_id: "rpe-bound", event_type: "RPE_RECORDED", timestamp: "2026-10-07T09:00:00.000Z", payload: { evidenceType: "SESSION_RPE", value: 10, trainingOccurrenceId: "start-a" } },
    { event_id: "rpe-second", event_type: "RPE_RECORDED", timestamp: "2026-10-07T09:05:00.000Z", payload: { evidenceType: "SESSION_RPE", value: 6, trainingOccurrenceId: "start-a" } },
    { event_id: "rpe-loose", event_type: "RPE_RECORDED", payload: { evidenceType: "SESSION_RPE", value: 5, sessionId: "strength-a" } },
    { event_id: "run-rpe", event_type: "RPE_RECORDED", payload: { rpe: 8, km: 5 } },
    { event_id: "bad-sleep", event_type: "SLEEP_RECORDED", payload: { hours: 0, trainingOccurrenceId: "start-a" } },
    { event_id: "bad-rpe", event_type: "RPE_RECORDED", payload: { evidenceType: "SESSION_RPE", value: 0, trainingOccurrenceId: "start-a" } },
    { event_id: "bad-recovery", event_type: "SUBJECTIVE_FEEDBACK", payload: { evidenceType: "SUBJECTIVE_RECOVERY", value: 11, trainingOccurrenceId: "start-a" } },
  ]
  const projected = projectEvidence(events)
  const view = projectOccurrenceEvidence("start-a", events)
  const sleep = projected.valid.find((item) => item.evidenceId === "sleep-bound")
  assert.equal(sleep?.binding, "BOUND")
  assert.equal(sleep?.timestamp, sleepTime)
  assert.notEqual(sleep?.timestamp, start().timestamp)
  assert.equal(projected.valid.find((item) => item.evidenceId === "sleep-morning")?.binding, "UNBOUND")
  assert.equal(view.sleep.status, "MULTIPLE")
  assert.equal(view.sleep.value, null)
  assert.deepEqual(view.sleep.records.map((item) => item.value), [6, 5])
  assert.equal(view.subjectiveRecovery.status, "RECORDED")
  assert.equal(view.subjectiveRecovery.value, 6)
  assert.equal(projected.valid.find((item) => item.evidenceId === "recovery-loose")?.binding, "UNBOUND")
  assert.equal(projected.valid.some((item) => item.evidenceId === "recovery-rpe"), false)
  const sore = projected.valid.find((item) => item.evidenceId === "sore-bound")
  assert.equal(sore?.binding, "BOUND")
  assert.equal(sore?.value, 3)
  assert.deepEqual(sore?.location, ["quad"])
  assert.equal(sore?.timestamp, "2026-10-07T07:45:00.000Z")
  assert.equal(projected.valid.find((item) => item.evidenceId === "sore-loose")?.binding, "UNBOUND")
  const pain = projected.valid.find((item) => item.evidenceId === "pain-bound")
  assert.equal(pain?.binding, "BOUND")
  assert.equal(pain?.value, 4)
  assert.equal(projected.valid.find((item) => item.evidenceId === "pain-loose")?.binding, "UNBOUND")
  assert.equal(projectOccurrenceEvidence("start-b", events).pain.status, "ABSENT")
  assert.equal(projectOccurrenceEvidence("start-b", events).pain.value, null)
  assert.equal(view.sessionRpe.status, "MULTIPLE")
  assert.equal(view.sessionRpe.value, null)
  assert.deepEqual(view.sessionRpe.records.map((item) => item.value), [10, 6])
  assert.equal(projected.valid.find((item) => item.evidenceId === "rpe-loose")?.binding, "UNBOUND")
  assert.equal(projected.valid.some((item) => item.evidenceId === "run-rpe"), false)
  assert.equal(projectPerformance(events).valid.find((item) => item.evidenceId === "run-rpe")?.runningRpe, 8)
  assert.deepEqual(projected.rejected.sort(), ["bad-recovery", "bad-rpe", "bad-sleep"])
})

test("recovery evidence does not rewrite the frozen fact or the store", () => {
  const box = memory()
  setStoreBackend(box)
  const event = dispatchEvent("TRAINING_STARTED", { sessionId: "strength-a", decisionId: "d1" })
  assert.ok(event)
  bindTrainingStart({ startEventId: event.event_id, startedAt: event.timestamp, sessionId: "strength-a", planSlotId: "strength-a", plan: session() })
  dispatchEvent("SLEEP_RECORDED", { hours: 6 })
  dispatchEvent("PAIN_RECORDED", { sessionId: "strength-a", moveIds: ["squat"] })
  const beforeFact = readTrainingFact(event.event_id)
  const beforeSummary = trainingSummary([event.event_id])
  const saved = JSON.stringify([...box.dump.entries()])
  const logged = [
    { event_id: event.event_id, event_type: "TRAINING_STARTED", timestamp: event.timestamp, payload: { sessionId: "strength-a" } },
    { event_id: "old-sleep", event_type: "SLEEP_RECORDED", timestamp: "2026-10-06T23:00:00.000Z", payload: { hours: 6 } },
    { event_id: "old-pain", event_type: "PAIN_RECORDED", timestamp: "2026-10-06T23:10:00.000Z", payload: { sessionId: "strength-a", moveIds: ["squat"] } },
  ]
  assert.equal(projectOccurrenceEvidence(event.event_id, logged).sleep.status, "ABSENT")
  assert.equal(projectOccurrenceEvidence(event.event_id, logged).pain.status, "ABSENT")
  assert.equal(projectEvidence(logged).valid.every((item) => item.binding === "UNBOUND"), true)
  assert.deepEqual(readTrainingFact(event.event_id), beforeFact)
  assert.deepEqual(trainingSummary([event.event_id]), beforeSummary)
  assert.equal(JSON.stringify([...box.dump.entries()]), saved)
  const source = readFileSync(new URL("./evidence.ts", import.meta.url), "utf8")
  assert.equal(source.includes("writeEnvelope"), false)
  assert.equal(source.includes("loadTrainingFact"), false)
  assert.equal(source.includes("training-decision"), false)
  assert.equal(source.includes("fatigue"), false)
})
