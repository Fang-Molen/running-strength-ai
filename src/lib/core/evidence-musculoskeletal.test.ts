import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { fatigueEvidence } from "./evidence-fatigue.ts"
import { musculoskeletalEvidence } from "./evidence-musculoskeletal.ts"
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

test("a missing training has no musculoskeletal evidence", () => {
  setStoreBackend(memory())
  assert.equal(musculoskeletalEvidence("missing"), null)
})

test("bound pain and soreness stay separate records", () => {
  seed("bare")
  const bare = musculoskeletalEvidence("bare")
  assert.equal(bare?.state, "NO_RELEVANT_EVIDENCE")
  assert.equal(bare?.musculoskeletalConclusion, "UNKNOWN")
  assert.deepEqual(bare?.pain, [])
  assert.deepEqual(bare?.soreness, [])
  seed("pain", [event("knee", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "left-knee", intensity: 2, trainingOccurrenceId: "pain" })])
  const pain = musculoskeletalEvidence("pain")
  assert.equal(pain?.state, "SIGNAL_PRESENT")
  assert.equal(pain?.musculoskeletalConclusion, "UNKNOWN")
  assert.equal(pain?.pain.length, 1)
  assert.equal(pain?.pain[0]?.evidenceId, "knee")
  assert.equal(pain?.pain[0]?.observationType, "PAIN")
  assert.equal(pain?.pain[0]?.reasonCode, "BOUND_RECORD_PRESENT")
  assert.deepEqual(pain?.pain[0]?.location, ["left-knee"])
  assert.equal(pain?.pain[0]?.severity, 2)
  assert.equal(pain?.pain[0]?.timestamp, "2026-10-07T08:20:00.000Z")
  assert.equal(pain?.soreness.length, 0)
  assert.equal(fatigueEvidence("pain")?.state, "NO_RELEVANT_EVIDENCE")
  assert.equal(recoveryEvidence("pain")?.state, "NO_RELEVANT_EVIDENCE")
  seed("sore", [event("quad", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:45:00.000Z", { evidenceType: "SORENESS", location: "quad", intensity: 3, trainingOccurrenceId: "sore" })])
  const soreness = musculoskeletalEvidence("sore")
  assert.equal(soreness?.state, "SIGNAL_PRESENT")
  assert.equal(soreness?.soreness[0]?.observationType, "SORENESS")
  assert.deepEqual(soreness?.soreness[0]?.location, ["quad"])
  assert.equal(soreness?.soreness[0]?.severity, 3)
  assert.equal(soreness?.pain.length, 0)
  seed("both", [
    event("knee", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "left-knee", intensity: 2, trainingOccurrenceId: "both" }),
    event("quad", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:45:00.000Z", { evidenceType: "SORENESS", location: "quad", intensity: 3, trainingOccurrenceId: "both" }),
  ])
  const both = musculoskeletalEvidence("both")
  assert.deepEqual(both?.pain.map((item) => item.evidenceId), ["knee"])
  assert.deepEqual(both?.soreness.map((item) => item.evidenceId), ["quad"])
  assert.equal(both?.musculoskeletalConclusion, "UNKNOWN")
})

test("multiple sites stay listed and unbound records stay out", () => {
  const box = seed("sites", [
    event("knee", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "left-knee", intensity: 2, trainingOccurrenceId: "sites" }),
    event("tendon", "PAIN_RECORDED", "2026-10-07T08:25:00.000Z", { location: "right-achilles", intensity: 5, trainingOccurrenceId: "sites" }),
    event("loose-pain", "PAIN_RECORDED", "2026-10-07T08:30:00.000Z", { location: "back", intensity: 9, sessionId: "strength-a" }),
    event("loose-sore", "SUBJECTIVE_FEEDBACK", "2026-10-07T07:50:00.000Z", { evidenceType: "SORENESS", location: "calf", intensity: 8 }),
  ])
  const beforeFact = readTrainingFact("sites")
  const beforeSummary = trainingSummary(["sites"])
  const saved = JSON.stringify([...box.dump.entries()])
  const seen = musculoskeletalEvidence("sites")
  assert.equal(seen?.state, "SIGNAL_PRESENT")
  assert.equal(seen?.musculoskeletalConclusion, "UNKNOWN")
  assert.deepEqual(seen?.pain.map((item) => item.severity), [2, 5])
  assert.deepEqual(seen?.pain.map((item) => item.location), [["left-knee"], ["right-achilles"]])
  assert.equal(seen?.pain.some((item) => item.evidenceId === "loose-pain"), false)
  assert.equal(seen?.soreness.some((item) => item.evidenceId === "loose-sore"), false)
  assert.equal("severity" in (seen ?? {}), false)
  assert.deepEqual(readTrainingFact("sites"), beforeFact)
  assert.deepEqual(trainingSummary(["sites"]), beforeSummary)
  assert.equal(JSON.stringify([...box.dump.entries()]), saved)
  seed("clash", [
    event("same", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "left-knee", intensity: 2, trainingOccurrenceId: "clash" }),
    event("same", "PAIN_RECORDED", "2026-10-07T08:25:00.000Z", { location: "left-knee", intensity: 5, trainingOccurrenceId: "clash" }),
  ])
  const clash = musculoskeletalEvidence("clash")
  assert.equal(clash?.state, "CONFLICTING_EVIDENCE")
  assert.deepEqual(clash?.pain.map((item) => item.severity), [2, 5])
  assert.equal(clash?.musculoskeletalConclusion, "UNKNOWN")
  const source = readFileSync(new URL("./evidence-musculoskeletal.ts", import.meta.url), "utf8")
  for (const word of ["loadEvents", "writeEnvelope", "fatigueEvidence", "recoveryEvidence", "training-decision", "INJURED", "READINESS", "recommendation"]) {
    assert.equal(source.includes(word), false)
  }
  assert.equal(source.includes("inferTrainingEvidence"), true)
  assert.equal(source.includes("getTrainingEvidenceProfile"), true)
})
