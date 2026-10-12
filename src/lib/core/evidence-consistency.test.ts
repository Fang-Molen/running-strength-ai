import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { readEvidenceBundle } from "./evidence-bundle.ts"
import { checkEvidenceConsistency, inspectEvidenceBundle } from "./evidence-consistency.ts"
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

test("a real bundle is structurally consistent and a changed conclusion is not", () => {
  setStoreBackend(memory())
  assert.equal(checkEvidenceConsistency("missing"), null)
  const box = seed("empty")
  const beforeFact = readTrainingFact("empty")
  const beforeSummary = trainingSummary(["empty"])
  const saved = JSON.stringify([...box.dump.entries()])
  assert.equal(checkEvidenceConsistency("empty")?.status, "CONSISTENT")
  assert.deepEqual(checkEvidenceConsistency("empty")?.issues, [])
  assert.deepEqual(readTrainingFact("empty"), beforeFact)
  assert.deepEqual(trainingSummary(["empty"]), beforeSummary)
  assert.equal(JSON.stringify([...box.dump.entries()]), saved)
  const bundle = readEvidenceBundle("empty")
  assert.ok(bundle)
  seed("clash", [
    event("same", "PAIN_RECORDED", "2026-10-07T08:20:00.000Z", { location: "left-knee", intensity: 2, trainingOccurrenceId: "clash" }),
    event("same", "PAIN_RECORDED", "2026-10-07T08:25:00.000Z", { location: "left-knee", intensity: 5, trainingOccurrenceId: "clash" }),
  ])
  assert.equal(checkEvidenceConsistency("clash")?.status, "CONSISTENT")
  const broken = { ...bundle, fatigue: { ...bundle.fatigue, fatigueConclusion: "FATIGUED" as "UNKNOWN" } }
  const inspected = inspectEvidenceBundle(broken)
  assert.equal(inspected.status, "INCONSISTENT")
  assert.equal(inspected.issues.some((item) => item.code === "CONCLUSION_NOT_UNKNOWN" && item.domain === "FATIGUE"), true)
  const source = readFileSync(new URL("./evidence-consistency.ts", import.meta.url), "utf8")
  for (const word of ["loadEvents", "training-decision", "recommendation", "score"]) assert.equal(source.includes(word), false)
})
