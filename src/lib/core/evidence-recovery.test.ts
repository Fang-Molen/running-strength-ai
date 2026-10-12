import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { recoveryEvidence } from "./evidence-recovery.ts"
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

function rpe(id: string, value: number, trainingOccurrenceId: string): AppEvent {
  return event(id, "RPE_RECORDED", "2026-10-07T09:00:00.000Z", { evidenceType: "SESSION_RPE", value, trainingOccurrenceId })
}

function sleep(id: string, hours: number, trainingOccurrenceId: string): AppEvent {
  return event(id, "SLEEP_RECORDED", "2026-10-06T23:00:00.000Z", { hours, trainingOccurrenceId })
}

function recovery(id: string, value: number, trainingOccurrenceId: string): AppEvent {
  return event(id, "SUBJECTIVE_FEEDBACK", "2026-10-07T07:40:00.000Z", { evidenceType: "SUBJECTIVE_RECOVERY", value, trainingOccurrenceId })
}

function types(id: string): string[] {
  return recoveryEvidence(id)?.signals.map((item) => item.type) ?? []
}

test("a missing training has no recovery evidence", () => {
  setStoreBackend(memory())
  assert.equal(recoveryEvidence("missing"), null)
})

test("sleep and subjective recovery are signals, not a recovery diagnosis", () => {
  seed("sleep5", [sleep("sleep", 5, "sleep5")])
  assert.deepEqual(types("sleep5"), ["SHORT_SLEEP_RECORDED"])
  assert.equal(recoveryEvidence("sleep5")?.state, "SIGNAL_PRESENT")
  assert.equal(recoveryEvidence("sleep5")?.recoveryConclusion, "UNKNOWN")
  seed("sleep6", [sleep("sleep", 6, "sleep6")])
  assert.deepEqual(types("sleep6"), [])
  seed("sleep10", [sleep("sleep", 10, "sleep10")])
  assert.deepEqual(types("sleep10"), [])
  assert.equal(recoveryEvidence("sleep10")?.state, "INSUFFICIENT_EVIDENCE")
  seed("recovery1", [recovery("recovery", 1, "recovery1")])
  assert.deepEqual(types("recovery1"), ["LOW_SUBJECTIVE_RECOVERY_RECORDED"])
  seed("recovery3", [recovery("recovery", 3, "recovery3")])
  assert.deepEqual(types("recovery3"), ["LOW_SUBJECTIVE_RECOVERY_RECORDED"])
  seed("recovery4", [recovery("recovery", 4, "recovery4")])
  assert.deepEqual(types("recovery4"), [])
  seed("recovery10", [recovery("recovery", 10, "recovery10")])
  assert.deepEqual(types("recovery10"), [])
  assert.equal(recoveryEvidence("recovery10")?.recoveryConclusion, "UNKNOWN")
  seed("rpe7", [rpe("rpe", 7, "rpe7")])
  assert.deepEqual(types("rpe7"), [])
  assert.deepEqual(recoveryEvidence("rpe7")?.contextSignals.map((item) => item.type), ["HIGH_SUBJECTIVE_INTENSITY"])
  assert.equal(recoveryEvidence("rpe7")?.recoveryConclusion, "UNKNOWN")
  seed("rpe10", [rpe("rpe", 10, "rpe10")])
  assert.deepEqual(recoveryEvidence("rpe10")?.contextSignals.map((item) => item.type), ["HIGH_SUBJECTIVE_INTENSITY"])
  seed("rpe6", [rpe("rpe", 6, "rpe6")])
  assert.deepEqual(recoveryEvidence("rpe6")?.contextSignals ?? [], [])
  assert.equal(recoveryEvidence("rpe6")?.state, "INSUFFICIENT_EVIDENCE")
})

test("combined records stay separate and do not impair recovery by formula", () => {
  const box = seed("both", [sleep("sleep", 5, "both"), recovery("recovery", 2, "both")])
  const beforeFact = readTrainingFact("both")
  const beforeSummary = trainingSummary(["both"])
  const saved = JSON.stringify([...box.dump.entries()])
  const both = recoveryEvidence("both")
  assert.deepEqual(both?.signals.map((item) => item.type), ["SHORT_SLEEP_RECORDED", "LOW_SUBJECTIVE_RECOVERY_RECORDED"])
  assert.equal(both?.state, "SIGNAL_PRESENT")
  assert.equal(both?.recoveryConclusion, "UNKNOWN")
  assert.deepEqual(both?.evidenceIds, ["sleep", "recovery"])
  assert.deepEqual(readTrainingFact("both"), beforeFact)
  assert.deepEqual(trainingSummary(["both"]), beforeSummary)
  assert.equal(JSON.stringify([...box.dump.entries()]), saved)
  seed("sleep-versus-recovery", [sleep("sleep", 5, "sleep-versus-recovery"), recovery("recovery", 8, "sleep-versus-recovery")])
  assert.deepEqual(types("sleep-versus-recovery"), ["SHORT_SLEEP_RECORDED"])
  assert.equal(recoveryEvidence("sleep-versus-recovery")?.state, "CONFLICTING_EVIDENCE")
  seed("recovery-versus-sleep", [sleep("sleep", 8, "recovery-versus-sleep"), recovery("recovery", 2, "recovery-versus-sleep")])
  assert.deepEqual(types("recovery-versus-sleep"), ["LOW_SUBJECTIVE_RECOVERY_RECORDED"])
  seed("hard-but-recovered", [rpe("rpe", 9, "hard-but-recovered"), recovery("recovery", 8, "hard-but-recovered")])
  assert.deepEqual(types("hard-but-recovered"), [])
  assert.deepEqual(recoveryEvidence("hard-but-recovered")?.contextSignals.map((item) => item.type), ["HIGH_SUBJECTIVE_INTENSITY"])
  assert.equal(recoveryEvidence("hard-but-recovered")?.recoveryConclusion, "UNKNOWN")
  seed("easy-low", [rpe("rpe", 5, "easy-low"), recovery("recovery", 2, "easy-low")])
  assert.deepEqual(types("easy-low"), ["LOW_SUBJECTIVE_RECOVERY_RECORDED"])
  assert.equal(recoveryEvidence("easy-low")?.recoveryConclusion, "UNKNOWN")
  seed("none")
  assert.equal(recoveryEvidence("none")?.state, "NO_RELEVANT_EVIDENCE")
  assert.equal(recoveryEvidence("none")?.recoveryConclusion, "UNKNOWN")
  seed("many-sleep", [sleep("a", 5, "many-sleep"), sleep("b", 8, "many-sleep")])
  assert.deepEqual(types("many-sleep"), [])
  assert.equal(recoveryEvidence("many-sleep")?.state, "INSUFFICIENT_EVIDENCE")
  seed("many-recovery", [recovery("a", 2, "many-recovery"), recovery("b", 9, "many-recovery")])
  assert.deepEqual(types("many-recovery"), [])
  assert.equal(recoveryEvidence("many-recovery")?.signals.some((item) => item.status === "SUPPORTED"), false)
  seed("many-rpe", [rpe("a", 6, "many-rpe"), rpe("b", 9, "many-rpe")])
  assert.deepEqual(recoveryEvidence("many-rpe")?.contextSignals ?? [], [])
  seed("loose", [sleep("loose", 5, "someone-else")])
  assert.equal(recoveryEvidence("loose")?.state, "NO_RELEVANT_EVIDENCE")
  seed("pain", [event("pain", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "knee", intensity: 7, trainingOccurrenceId: "pain" })])
  assert.equal(recoveryEvidence("pain")?.state, "NO_RELEVANT_EVIDENCE")
  seed("sore", [event("sore", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:45:00.000Z", { evidenceType: "SORENESS", location: "quad", intensity: 7, trainingOccurrenceId: "sore" })])
  assert.equal(recoveryEvidence("sore")?.state, "NO_RELEVANT_EVIDENCE")
  const source = readFileSync(new URL("./evidence-recovery.ts", import.meta.url), "utf8")
  for (const word of ["loadEvents", "writeEnvelope", "training-decision", "fatigueEvidence", "RECOVERY_SCORE", "READINESS", "recommendation"]) {
    assert.equal(source.includes(word), false)
  }
  assert.equal(source.includes("inferTrainingEvidence"), true)
})
