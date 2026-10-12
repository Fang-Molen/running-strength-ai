import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { projectHistoricalEvidence } from "./historical-evidence.ts"
import { bindTrainingStart } from "./occurrence.ts"
import { setStoreBackend, type MemoryStore, writeEnvelope } from "./storage.ts"
import { readTrainingFact } from "./fact-read.ts"
import type { AppEvent } from "./types.ts"

function memory(): MemoryStore {
  const dump = new Map<string, string>()
  return { keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function session(id: string): Session {
  return { id, name: id, moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 3, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }] }
}

function event(id: string, type: AppEvent["event_type"], timestamp: string, payload: Record<string, unknown>): AppEvent {
  return { event_id: id, athlete_id: "local", timestamp, event_type: type, source: "MANUAL", payload, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 }
}

test("a history window keeps each training's own fact and evidence", () => {
  setStoreBackend(memory())
  const ids = ["a", "b", "c"]
  writeEnvelope(EVENTS_KEY, [
    ...ids.flatMap((id, index) => [
      event(id, "TRAINING_STARTED", `2026-10-0${index + 2}T08:00:00.000Z`, { sessionId: `strength-${id}`, decisionId: "d1" }),
      event(`sleep-${id}`, "SLEEP_RECORDED", `2026-10-0${index + 1}T23:00:00.000Z`, { hours: 5, trainingOccurrenceId: id }),
    ]),
  ])
  ids.forEach((id, index) => bindTrainingStart({ startEventId: id, startedAt: `2026-10-0${index + 2}T08:00:00.000Z`, sessionId: `strength-${id}`, planSlotId: `strength-${id}`, plan: session(`strength-${id}`) }))
  const seen = projectHistoricalEvidence({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" })
  assert.deepEqual(seen.occurrences.map((item) => item.trainingOccurrenceId), ["a", "b", "c"])
  assert.equal("trend" in seen, false)
  assert.equal("conclusion" in seen, false)
  for (const item of seen.occurrences) {
    assert.equal(item.evidenceBundle?.trainingOccurrenceId, item.trainingOccurrenceId)
    assert.deepEqual(item.fact, readTrainingFact(item.trainingOccurrenceId))
    assert.equal(item.fatigue, "EVIDENCE_PRESENT")
    assert.equal(item.evidenceBundle?.fatigue.fatigueConclusion, "UNKNOWN")
    assert.deepEqual(item.evidenceBundle?.fatigue.signals.map((signal) => signal.evidenceIds), [[`sleep-${item.trainingOccurrenceId}`]])
  }
  const source = readFileSync(new URL("./historical-evidence.ts", import.meta.url), "utf8")
  for (const word of ["连续", "趋势", "ACWR", "training-decision", "recommendation"]) assert.equal(source.includes(word), false)
})
