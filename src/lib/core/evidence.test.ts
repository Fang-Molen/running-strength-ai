import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { dispatchEvent, loadEvents } from "./events.ts"
import { projectEvidence, projectOccurrenceEvidence, readEvidence, type EvidenceEvent } from "./evidence.ts"
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

function started(): EvidenceEvent {
  return { event_id: "start-a", event_type: "TRAINING_STARTED", timestamp: "2026-10-07T01:00:00.000Z", payload: { sessionId: "strength-a" } }
}

function evidence(partial: EvidenceEvent): EvidenceEvent {
  return partial
}

test("an explicit start id is bound and a missing id stays unbound", () => {
  const events = [
    started(),
    evidence({ event_id: "rpe-1", event_type: "RPE_RECORDED", timestamp: "2026-10-07T02:00:00.000Z", payload: { evidenceType: "SESSION_RPE", value: 7, trainingOccurrenceId: "start-a" } }),
    evidence({ event_id: "rpe-2", event_type: "RPE_RECORDED", timestamp: "2026-10-07T02:00:00.000Z", payload: { evidenceType: "SESSION_RPE", value: 8, sessionId: "strength-a", planSlotId: "strength-a" } }),
    evidence({ event_id: "sleep-1", event_type: "SLEEP_RECORDED", timestamp: "2026-10-07T01:00:00.000Z", payload: { hours: 6 } }),
    evidence({ event_id: "pain-1", event_type: "PAIN_RECORDED", timestamp: "2026-10-07T02:10:00.000Z", payload: { moveIds: ["squat"] } }),
  ]
  const projected = projectEvidence(events)
  const bound = projected.valid.find((item) => item.evidenceId === "rpe-1")
  const loose = projected.valid.find((item) => item.evidenceId === "rpe-2")
  const sleep = projected.valid.find((item) => item.evidenceId === "sleep-1")
  const pain = projected.valid.find((item) => item.evidenceId === "pain-1")
  assert.equal(bound?.binding, "BOUND")
  assert.equal(bound?.trainingOccurrenceId, "start-a")
  assert.equal(loose?.binding, "UNBOUND")
  assert.equal(loose?.trainingOccurrenceId, null)
  assert.equal(sleep?.binding, "UNBOUND")
  assert.equal(pain?.binding, "UNBOUND")
  const view = projectOccurrenceEvidence("start-a", events)
  assert.equal(view.sessionRpe.status, "RECORDED")
  assert.equal(view.sessionRpe.value, 7)
  assert.equal(view.sleep.status, "ABSENT")
  assert.equal(view.sleep.value, null)
  assert.equal(view.pain.status, "ABSENT")
  assert.notEqual(view.pain.value, 0)
  assert.notEqual(view.sessionRpe.value, 0)
})

test("missing pain is not no-pain and repeated values stay separate", () => {
  const events = [
    started(),
    evidence({ event_id: "rpe-a", event_type: "RPE_RECORDED", payload: { evidenceType: "SESSION_RPE", value: 4, trainingOccurrenceId: "start-a" } }),
    evidence({ event_id: "rpe-b", event_type: "RPE_RECORDED", payload: { evidenceType: "SESSION_RPE", value: 8, trainingOccurrenceId: "start-a" } }),
    evidence({ event_id: "bad-rpe", event_type: "RPE_RECORDED", payload: { evidenceType: "SESSION_RPE", value: 0, trainingOccurrenceId: "start-a" } }),
    evidence({ event_id: "bad-pain", event_type: "PAIN_RECORDED", payload: { intensity: 12, trainingOccurrenceId: "start-a" } }),
    evidence({ event_id: "sore", event_type: "SUBJECTIVE_FEEDBACK", payload: { evidenceType: "SORENESS", location: "quad", trainingOccurrenceId: "start-b" } }),
    evidence({ event_id: "recovery", event_type: "SUBJECTIVE_FEEDBACK", payload: { evidenceType: "SUBJECTIVE_RECOVERY", value: 6 } }),
  ]
  const projected = projectEvidence(events)
  assert.deepEqual(projected.rejected.sort(), ["bad-pain", "bad-rpe"])
  const view = projectOccurrenceEvidence("start-a", events)
  assert.equal(view.sessionRpe.status, "MULTIPLE")
  assert.equal(view.sessionRpe.value, null)
  assert.deepEqual(view.sessionRpe.records.map((item) => item.value), [4, 8])
  assert.equal(view.pain.status, "ABSENT")
  assert.equal(view.pain.value, null)
  const bare = projectOccurrenceEvidence("start-a", [started()])
  assert.equal(bare.sessionRpe.status, "ABSENT")
  assert.equal(bare.sessionRpe.value, null)
  const sore = projected.valid.find((item) => item.evidenceId === "sore")
  const recovery = projected.valid.find((item) => item.evidenceId === "recovery")
  assert.equal(sore?.binding, "UNBOUND")
  assert.equal(recovery?.binding, "UNBOUND")
  assert.equal(recovery?.value, 6)
})

test("evidence reading does not write or change the frozen fact", () => {
  const box = memory()
  setStoreBackend(box)
  const event = dispatchEvent("TRAINING_STARTED", { sessionId: "strength-a", decisionId: "d1" })
  assert.ok(event)
  bindTrainingStart({ startEventId: event.event_id, startedAt: event.timestamp, sessionId: "strength-a", planSlotId: "strength-a", plan: session() })
  dispatchEvent("TRAINING_SET_COMPLETED", { sessionId: "strength-a", moveId: "squat", setIndex: 1, completed: true, skipped: false, actualWeight: 60, actualAmount: 8 })
  dispatchEvent("SLEEP_RECORDED", { hours: 6 })
  const beforeFact = readTrainingFact(event.event_id)
  const beforeSummary = trainingSummary([event.event_id])
  const saved = JSON.stringify([...box.dump.entries()])
  const evidenceView = readEvidence()
  assert.equal(evidenceView.valid.some((item) => item.evidenceType === "SLEEP" && item.binding === "UNBOUND"), true)
  assert.equal(projectOccurrenceEvidence(event.event_id, loadEvents()).sleep.status, "ABSENT")
  assert.deepEqual(readTrainingFact(event.event_id), beforeFact)
  assert.deepEqual(trainingSummary([event.event_id]), beforeSummary)
  assert.equal(JSON.stringify([...box.dump.entries()]), saved)
  const source = readFileSync(new URL("./evidence.ts", import.meta.url), "utf8")
  assert.equal(source.includes("writeEnvelope"), false)
  assert.equal(source.includes("loadTrainingFact"), false)
  assert.equal(source.includes("trainingSummary"), false)
  assert.equal(source.includes("mergeSets"), false)
  assert.equal(source.includes("strengthSnapshot"), false)
  assert.equal(source.includes("training-decision"), false)
})
