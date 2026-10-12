import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { fatigueEvidence } from "./evidence-fatigue.ts"
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

function seed(id: string, extra: AppEvent[] = []) {
  const box = memory()
  setStoreBackend(box)
  writeEnvelope(EVENTS_KEY, [event(id, "TRAINING_STARTED", "2026-10-07T08:00:00.000Z", { sessionId: "strength-a", decisionId: "d1" }), ...extra])
  bindTrainingStart({ startEventId: id, startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: session() })
  return box
}

function rpe(id: string, value: number, trainingOccurrenceId = id): AppEvent {
  return event(id, "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value, trainingOccurrenceId })
}

function sleep(id: string, hours: number, trainingOccurrenceId: string): AppEvent {
  return event(id, "SLEEP_RECORDED", "2026-10-06T23:00:00.000Z", { hours, trainingOccurrenceId })
}

function recovery(id: string, value: number, trainingOccurrenceId: string): AppEvent {
  return event(id, "SUBJECTIVE_FEEDBACK", "2026-10-07T07:40:00.000Z", { evidenceType: "SUBJECTIVE_RECOVERY", value, trainingOccurrenceId })
}

function types(id: string): string[] {
  return fatigueEvidence(id)?.signals.map((item) => item.type) ?? []
}

test("a missing training has no fatigue evidence", () => {
  setStoreBackend(memory())
  assert.equal(fatigueEvidence("missing"), null)
})

test("one clear signal is present and is not a fatigue diagnosis", () => {
  seed("rpe7", [rpe("rpe7", 7)])
  assert.deepEqual(types("rpe7"), ["HIGH_SUBJECTIVE_INTENSITY"])
  assert.equal(fatigueEvidence("rpe7")?.state, "SIGNAL_PRESENT")
  assert.equal(fatigueEvidence("rpe7")?.fatigueConclusion, "UNKNOWN")
  seed("rpe10", [rpe("rpe10", 10)])
  assert.equal(fatigueEvidence("rpe10")?.state, "SIGNAL_PRESENT")
  assert.equal(fatigueEvidence("rpe10")?.signals[0]?.evidenceIds[0], "rpe10")
  seed("rpe6", [rpe("rpe6", 6)])
  assert.deepEqual(types("rpe6"), [])
  assert.equal(fatigueEvidence("rpe6")?.state, "INSUFFICIENT_EVIDENCE")
  seed("sleep5", [sleep("sleep5", 5, "sleep5")])
  assert.deepEqual(types("sleep5"), ["SHORT_SLEEP_RECORDED"])
  seed("sleep6", [sleep("sleep6", 6, "sleep6")])
  assert.deepEqual(types("sleep6"), [])
  seed("recovery2", [recovery("recovery2", 2, "recovery2")])
  assert.deepEqual(types("recovery2"), ["LOW_SUBJECTIVE_RECOVERY_RECORDED"])
  seed("recovery4", [recovery("recovery4", 4, "recovery4")])
  assert.deepEqual(types("recovery4"), [])
  assert.equal(fatigueEvidence("recovery4")?.fatigueConclusion, "UNKNOWN")
})

test("mixed records stay separate and do not confirm fatigue", () => {
  const box = seed("both", [rpe("rpe", 9, "both"), sleep("sleep", 5, "both")])
  const beforeFact = readTrainingFact("both")
  const beforeSummary = trainingSummary(["both"])
  const saved = JSON.stringify([...box.dump.entries()])
  const both = fatigueEvidence("both")
  assert.deepEqual(both?.signals.map((item) => item.type), ["HIGH_SUBJECTIVE_INTENSITY", "SHORT_SLEEP_RECORDED"])
  assert.equal(both?.state, "SIGNAL_PRESENT")
  assert.equal(both?.fatigueConclusion, "UNKNOWN")
  assert.deepEqual(both?.evidenceIds, ["rpe", "sleep"])
  assert.deepEqual(readTrainingFact("both"), beforeFact)
  assert.deepEqual(trainingSummary(["both"]), beforeSummary)
  assert.equal(JSON.stringify([...box.dump.entries()]), saved)
  seed("sleep-only", [rpe("rpe", 5, "sleep-only"), sleep("sleep", 5, "sleep-only")])
  assert.deepEqual(types("sleep-only"), ["SHORT_SLEEP_RECORDED"])
  assert.equal(fatigueEvidence("sleep-only")?.state, "CONFLICTING_EVIDENCE")
  seed("recovery-only", [rpe("rpe", 5, "recovery-only"), recovery("recovery", 2, "recovery-only")])
  assert.deepEqual(types("recovery-only"), ["LOW_SUBJECTIVE_RECOVERY_RECORDED"])
  seed("sleep-versus-recovery", [sleep("sleep", 5, "sleep-versus-recovery"), recovery("recovery", 8, "sleep-versus-recovery")])
  assert.deepEqual(types("sleep-versus-recovery"), ["SHORT_SLEEP_RECORDED"])
  assert.equal(fatigueEvidence("sleep-versus-recovery")?.fatigueConclusion, "UNKNOWN")
  seed("none")
  assert.equal(fatigueEvidence("none")?.state, "NO_RELEVANT_EVIDENCE")
  assert.equal(fatigueEvidence("none")?.fatigueConclusion, "UNKNOWN")
  seed("many-rpe", [rpe("a", 6, "many-rpe"), rpe("b", 9, "many-rpe")])
  assert.deepEqual(types("many-rpe"), [])
  assert.equal(fatigueEvidence("many-rpe")?.state, "INSUFFICIENT_EVIDENCE")
  assert.deepEqual(fatigueEvidence("many-rpe")?.unresolvedSignals[0]?.evidenceIds, ["a", "b"])
  seed("many-sleep", [sleep("a", 5, "many-sleep"), sleep("b", 8, "many-sleep")])
  assert.deepEqual(types("many-sleep"), [])
  seed("many-recovery", [recovery("a", 3, "many-recovery"), recovery("b", 8, "many-recovery")])
  assert.deepEqual(types("many-recovery"), [])
  assert.equal(fatigueEvidence("many-recovery")?.state, "INSUFFICIENT_EVIDENCE")
  seed("loose", [rpe("loose", 10, "someone-else")])
  assert.equal(fatigueEvidence("loose")?.state, "NO_RELEVANT_EVIDENCE")
  seed("pain", [event("pain", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "knee", intensity: 7, trainingOccurrenceId: "pain" })])
  assert.equal(fatigueEvidence("pain")?.state, "NO_RELEVANT_EVIDENCE")
  seed("sore", [event("sore", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:45:00.000Z", { evidenceType: "SORENESS", location: "quad", intensity: 7, trainingOccurrenceId: "sore" })])
  assert.equal(fatigueEvidence("sore")?.state, "NO_RELEVANT_EVIDENCE")
  const source = readFileSync(new URL("./evidence-fatigue.ts", import.meta.url), "utf8")
  for (const word of ["loadEvents", "writeEnvelope", "training-decision", "FATIGUE_SCORE", "recommendation", "ACWR"]) {
    assert.equal(source.includes(word), false)
  }
  assert.equal(source.includes("inferTrainingEvidence"), true)
})
