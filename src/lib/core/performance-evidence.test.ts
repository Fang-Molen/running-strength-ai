import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { dispatchEvent } from "./events.ts"
import { projectEvidence } from "./evidence.ts"
import { bindTrainingStart } from "./occurrence.ts"
import { projectOccurrencePerformance, projectPerformance, readPerformanceEvidence } from "./performance-evidence.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"
import { readTrainingFact } from "./fact-read.ts"
import { trainingSummary } from "./training-summary.ts"
import type { EvidenceEvent } from "./evidence.ts"

function memory(): MemoryStore & { dump: Map<string, string> } {
  const dump = new Map<string, string>()
  return { dump, keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function session(): Session {
  return { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 3, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }] }
}

function start(): EvidenceEvent {
  return { event_id: "start-a", event_type: "TRAINING_STARTED", timestamp: "2026-10-07T01:00:00.000Z", payload: { sessionId: "strength-a" } }
}

test("strength actuals keep their units and stay unbound without a start id", () => {
  const events: EvidenceEvent[] = [
    start(),
    { event_id: "set-1", event_type: "TRAINING_SET_COMPLETED", timestamp: "2026-10-07T01:10:00.000Z", source: "MANUAL", payload: { trainingOccurrenceId: "start-a", moveId: "squat", setIndex: 1, mode: "reps", actualWeight: 60, actualAmount: 8 } },
    { event_id: "set-2", event_type: "TRAINING_SET_COMPLETED", timestamp: "2026-10-07T01:12:00.000Z", payload: { trainingOccurrenceId: "start-a", moveId: "squat", setIndex: 1, mode: "reps", actualWeight: 80, actualAmount: 6 } },
    { event_id: "set-loose", event_type: "TRAINING_SET_COMPLETED", timestamp: "2026-10-07T01:10:00.000Z", payload: { sessionId: "strength-a", planSlotId: "strength-a", moveId: "squat", setIndex: 2, mode: "reps", actualWeight: 50, actualAmount: 5 } },
    { event_id: "hold", event_type: "TRAINING_SET_COMPLETED", payload: { trainingOccurrenceId: "start-a", moveId: "plank", setIndex: 1, mode: "seconds", actualWeight: 0, actualAmount: 30 } },
    { event_id: "bad-weight", event_type: "TRAINING_SET_COMPLETED", payload: { trainingOccurrenceId: "start-a", moveId: "squat", setIndex: 3, actualWeight: -5, actualAmount: 8 } },
    { event_id: "bad-reps", event_type: "TRAINING_SET_COMPLETED", payload: { trainingOccurrenceId: "start-a", moveId: "squat", setIndex: 4, actualAmount: -1 } },
  ]
  const projected = projectPerformance(events)
  const first = projected.valid.find((item) => item.evidenceId === "set-1")
  const second = projected.valid.find((item) => item.evidenceId === "set-2")
  const loose = projected.valid.find((item) => item.evidenceId === "set-loose")
  const hold = projected.valid.find((item) => item.evidenceId === "hold")
  assert.equal(first?.binding, "BOUND")
  assert.equal(first?.trainingOccurrenceId, "start-a")
  assert.equal(first?.moveId, "squat")
  assert.equal(first?.setIndex, 1)
  assert.equal(first?.actualWeightKg, 60)
  assert.equal(first?.actualReps, 8)
  assert.equal(first?.actualDurationSec, null)
  assert.equal(second?.actualWeightKg, 80)
  assert.equal(second?.actualReps, 6)
  assert.notEqual(((first?.actualWeightKg ?? 0) + (second?.actualWeightKg ?? 0)) / 2, first?.actualWeightKg)
  assert.equal(loose?.binding, "UNBOUND")
  assert.equal(loose?.trainingOccurrenceId, null)
  assert.equal(hold?.actualDurationSec, 30)
  assert.equal(hold?.actualWeightKg, 0)
  assert.equal(hold?.actualReps, null)
  assert.deepEqual(projected.rejected.sort(), ["bad-reps", "bad-weight"])
  const owned = projectOccurrencePerformance("start-a", events)
  assert.equal(owned.some((item) => item.evidenceId === "set-loose"), false)
  assert.equal(owned.filter((item) => item.moveId === "squat" && item.setIndex === 1).length, 2)
})

test("a run without a start id stays unbound and its rpe is not a session rpe", () => {
  const events: EvidenceEvent[] = [
    start(),
    { event_id: "run-1", event_type: "RUN_COMPLETED", timestamp: "2026-10-07T01:00:00.000Z", payload: { km: 6, seconds: 1800, sessionId: "strength-a" } },
    { event_id: "run-bad", event_type: "RUN_COMPLETED", payload: { km: -1, seconds: -5 } },
    { event_id: "run-rpe", event_type: "RPE_RECORDED", payload: { rpe: 8, km: 5 } },
    { event_id: "session-rpe", event_type: "RPE_RECORDED", payload: { evidenceType: "SESSION_RPE", value: 7, trainingOccurrenceId: "start-a" } },
  ]
  const projected = projectPerformance(events)
  const run = projected.valid.find((item) => item.evidenceId === "run-1")
  const effort = projected.valid.find((item) => item.evidenceId === "run-rpe")
  assert.equal(run?.binding, "UNBOUND")
  assert.equal(run?.distanceKm, 6)
  assert.equal(run?.durationSec, 1800)
  assert.equal(run?.runningRpe, null)
  assert.equal(effort?.kind, "RUN")
  assert.equal(effort?.binding, "UNBOUND")
  assert.equal(effort?.runningRpe, 8)
  assert.equal(effort?.distanceKm, 5)
  assert.equal(projected.valid.some((item) => item.evidenceId === "session-rpe"), false)
  assert.deepEqual(projected.rejected, ["run-bad"])
  assert.equal(projectOccurrencePerformance("start-a", events).some((item) => item.kind === "RUN"), false)
  const contract = projectEvidence(events)
  assert.equal(contract.valid.find((item) => item.evidenceId === "session-rpe")?.evidenceType, "SESSION_RPE")
  assert.equal(contract.valid.some((item) => item.evidenceId === "run-rpe"), false)
})

test("performance reading does not write or change the frozen fact", () => {
  const box = memory()
  setStoreBackend(box)
  const event = dispatchEvent("TRAINING_STARTED", { sessionId: "strength-a", decisionId: "d1" })
  assert.ok(event)
  bindTrainingStart({ startEventId: event.event_id, startedAt: event.timestamp, sessionId: "strength-a", planSlotId: "strength-a", plan: session() })
  dispatchEvent("TRAINING_SET_COMPLETED", { sessionId: "strength-a", moveId: "squat", setIndex: 1, mode: "reps", plannedWeight: 60, plannedAmount: 8, restSec: 90, actualWeight: 60, actualAmount: 8, completed: true, skipped: false })
  dispatchEvent("RUN_COMPLETED", { km: 3, seconds: 900 })
  const beforeFact = readTrainingFact(event.event_id)
  const beforeSummary = trainingSummary([event.event_id])
  const saved = JSON.stringify([...box.dump.entries()])
  const performance = readPerformanceEvidence()
  assert.equal(performance.valid.some((item) => item.kind === "STRENGTH_SET" && item.binding === "UNBOUND" && item.actualWeightKg === 60), true)
  assert.equal(performance.valid.some((item) => item.kind === "RUN" && item.binding === "UNBOUND" && item.distanceKm === 3), true)
  assert.deepEqual(readTrainingFact(event.event_id), beforeFact)
  assert.deepEqual(trainingSummary([event.event_id]), beforeSummary)
  assert.equal(JSON.stringify([...box.dump.entries()]), saved)
  const source = readFileSync(new URL("./performance-evidence.ts", import.meta.url), "utf8")
  assert.equal(source.includes("writeEnvelope"), false)
  assert.equal(source.includes("loadTrainingFact"), false)
  assert.equal(source.includes("trainingSummary"), false)
  assert.equal(source.includes("training-decision"), false)
  assert.equal(source.includes("TRIMP"), false)
  assert.equal(source.includes("fatigue"), false)
})
