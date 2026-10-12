import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { interpretTrainingEvidence } from "./evidence-interpretation.ts"
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
  const events = [event(id, "TRAINING_STARTED", "2026-10-07T08:00:00.000Z", { sessionId: "strength-a", decisionId: "d1" }), ...extra]
  writeEnvelope(EVENTS_KEY, events)
  bindTrainingStart({ startEventId: id, startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: session() })
  return box
}

function one(id: string, type: string) {
  const found = interpretTrainingEvidence(id)?.observations.find((item) => item.type === type)
  assert.ok(found)
  return found
}

test("recorded evidence becomes a direct observation and missing training stays null", () => {
  assert.equal(interpretTrainingEvidence("missing"), null)
  seed("rpe-low", [event("rpe", "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 2, trainingOccurrenceId: "rpe-low" })])
  assert.equal(one("rpe-low", "SESSION_RPE_LOW").value, 2)
  seed("rpe-mid", [event("rpe", "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 5, trainingOccurrenceId: "rpe-mid" })])
  assert.equal(one("rpe-mid", "SESSION_RPE_MODERATE").value, 5)
  seed("rpe-high", [event("rpe", "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 8, trainingOccurrenceId: "rpe-high" })])
  assert.equal(one("rpe-high", "SESSION_RPE_HIGH").value, 8)
  seed("rpe-top", [event("rpe", "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 10, trainingOccurrenceId: "rpe-top" })])
  const top = one("rpe-top", "SESSION_RPE_VERY_HIGH")
  assert.equal(top.value, 10)
  assert.equal(top.confidence, "DIRECT")
  assert.deepEqual(top.sourceEvidenceIds, ["rpe"])
  assert.equal(top.timestamp, "2026-10-07T09:00:00.000Z")
  seed("sleep", [event("sleep", "SLEEP_RECORDED", "2026-10-06T23:00:00.000Z", { hours: 5, trainingOccurrenceId: "sleep" })])
  const slept = one("sleep", "SLEEP_SHORT")
  assert.equal(slept.value, 5)
  assert.equal(slept.timestamp, "2026-10-06T23:00:00.000Z")
  seed("recovery", [event("recovery", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:40:00.000Z", { evidenceType: "SUBJECTIVE_RECOVERY", value: 9, trainingOccurrenceId: "recovery" })])
  assert.equal(one("recovery", "RECOVERY_VERY_HIGH").value, 9)
  seed("sore", [event("sore", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:45:00.000Z", { evidenceType: "SORENESS", location: "quad", intensity: 3, trainingOccurrenceId: "sore" })])
  const soreness = one("sore", "SORENESS_LIGHT")
  assert.equal(soreness.value, 3)
  assert.deepEqual(soreness.location, ["quad"])
  seed("pain", [event("pain", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "knee", intensity: 4, trainingOccurrenceId: "pain" })])
  const pain = one("pain", "PAIN_MODERATE")
  assert.equal(pain.value, 4)
  assert.deepEqual(pain.location, ["knee"])
  seed("bare")
  const bare = interpretTrainingEvidence("bare")
  assert.equal(bare?.observations.find((item) => item.type === "NO_SLEEP_EVIDENCE")?.value, null)
  assert.equal(bare?.observations.find((item) => item.type === "NO_PAIN_EVIDENCE")?.value, null)
  assert.equal(bare?.observations.find((item) => item.type === "NO_RECOVERY_EVIDENCE")?.value, null)
  assert.equal(bare?.observations.some((item) => item.type === "NO_PAIN" || item.type === "HEALTHY" || item.type === "NO_INJURY"), false)
  assert.equal(one("bare", "FACT_IN_PROGRESS").value, "IN_PROGRESS")
})

test("multiple and unbound records are not collapsed into a score", () => {
  const box = seed("start-a", [
    event("set-1", "TRAINING_SET_COMPLETED", "2026-10-07T08:10:00.000Z", { trainingOccurrenceId: "start-a", moveId: "squat", setIndex: 1, mode: "reps", actualWeight: 60, actualAmount: 8, completed: true, skipped: false }),
    event("run-1", "RUN_COMPLETED", "2026-10-07T07:00:00.000Z", { km: 6, seconds: 1800, trainingOccurrenceId: "start-a" }),
    event("run-loose", "RUN_COMPLETED", "2026-10-07T08:00:00.000Z", { km: 3, seconds: 900, sessionId: "strength-a" }),
    event("sleep-1", "SLEEP_RECORDED", "2026-10-06T23:00:00.000Z", { hours: 6, trainingOccurrenceId: "start-a" }),
    event("sleep-2", "SLEEP_RECORDED", "2026-10-07T06:30:00.000Z", { hours: 7, trainingOccurrenceId: "start-a" }),
    event("sleep-loose", "SLEEP_RECORDED", "2026-10-07T06:40:00.000Z", { hours: 8 }),
    event("rpe-1", "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value: 10, trainingOccurrenceId: "start-a" }),
    event("rpe-2", "RPE_RECORDED", "2026-10-07T09:05:00.000Z", { evidenceType: "SESSION_RPE", value: 6, trainingOccurrenceId: "start-a" }),
    event("rpe-loose", "RPE_RECORDED", "2026-10-07T09:06:00.000Z", { evidenceType: "SESSION_RPE", value: 5, sessionId: "strength-a" }),
    event("recovery-1", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:40:00.000Z", { evidenceType: "SUBJECTIVE_RECOVERY", value: 4, trainingOccurrenceId: "start-a" }),
    event("recovery-2", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:41:00.000Z", { evidenceType: "SUBJECTIVE_RECOVERY", value: 8, trainingOccurrenceId: "start-a" }),
    event("pain-1", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "knee", intensity: 4, trainingOccurrenceId: "start-a" }),
    event("pain-2", "PAIN_RECORDED", "2026-10-07T08:21:00.000Z", { location: "ankle", intensity: 2, trainingOccurrenceId: "start-a" }),
    event("done", "TRAINING_COMPLETED", "2026-10-07T09:30:00.000Z", { sessionId: "strength-a", decisionId: "d1", setsCompleted: 1, interruptions: false, actual: { sets: 1 } }),
  ])
  closeTrainingOccurrence(event("done", "TRAINING_COMPLETED", "2026-10-07T09:30:00.000Z", { sessionId: "strength-a", decisionId: "d1", setsCompleted: 1, interruptions: false, actual: { sets: 1 } }))
  const beforeFact = readTrainingFact("start-a")
  const beforeSummary = trainingSummary(["start-a"])
  const saved = JSON.stringify([...box.dump.entries()])
  const seen = interpretTrainingEvidence("start-a")
  assert.ok(seen)
  const rpe = seen.observations.find((item) => item.type === "SESSION_RPE_MULTIPLE")
  assert.equal(rpe?.value, null)
  assert.deepEqual(rpe?.sourceEvidenceIds, ["rpe-1", "rpe-2"])
  assert.equal(seen.observations.some((item) => item.value === 8 || item.value === 5), false)
  const sleep = seen.observations.find((item) => item.type === "SLEEP_MULTIPLE")
  assert.equal(sleep?.value, null)
  assert.deepEqual(sleep?.sourceEvidenceIds, ["sleep-1", "sleep-2"])
  assert.equal(seen.observations.find((item) => item.type === "RECOVERY_MULTIPLE")?.value, null)
  assert.equal(seen.observations.find((item) => item.type === "PAIN_MULTIPLE")?.value, null)
  const lift = seen.observations.find((item) => item.type === "STRENGTH_SET_RECORDED")
  assert.equal(lift?.actualWeightKg, 60)
  assert.equal(lift?.actualReps, 8)
  assert.equal(lift?.timestamp, "2026-10-07T08:10:00.000Z")
  const run = seen.observations.find((item) => item.type === "RUN_RECORDED")
  assert.equal(run?.distanceKm, 6)
  assert.equal(run?.durationSec, 1800)
  assert.equal("paceSecPerKm" in run!, false)
  assert.equal(seen.observations.filter((item) => item.type === "RUN_RECORDED").length, 1)
  assert.equal(one("start-a", "FACT_COMPLETED").value, "COMPLETED")
  assert.equal(seen.observations.find((item) => item.type === "FACT_DURATION")?.value, beforeFact?.duration)
  assert.equal(seen.observations.every((item) => item.confidence === "DIRECT"), true)
  assert.deepEqual(readTrainingFact("start-a"), beforeFact)
  assert.deepEqual(trainingSummary(["start-a"]), beforeSummary)
  assert.equal(JSON.stringify([...box.dump.entries()]), saved)
  const source = readFileSync(new URL("./evidence-interpretation.ts", import.meta.url), "utf8")
  assert.equal(source.includes("getTrainingEvidenceProfile"), true)
  assert.equal(source.includes("loadEvents"), false)
  assert.equal(source.includes("writeEnvelope"), false)
  assert.equal(source.includes("training-decision"), false)
  assert.equal(source.includes("fatigue"), false)
  assert.equal(source.includes("paceSecPerKm"), false)
  assert.equal(source.includes("injury"), false)
  assert.equal(source.includes("recommendation"), false)
})
