import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { projectActualSets } from "./canonical.ts"
import { loadEvents, EVENTS_KEY } from "./events.ts"
import { bindTrainingStart, getTrainingPlanSnapshot } from "./occurrence.ts"
import { readTrainingFact } from "./fact-read.ts"
import { getRunningPlanSnapshot, saveRunningPlan, type SessionComponent } from "./running-plan.ts"
import { projectRunningRepetitions, recordRunningRepetitionCompleted, recordRunningRepetitionSkipped } from "./running-execution.ts"
import { setStoreBackend, type MemoryStore, writeEnvelope } from "./storage.ts"
import type { AppEvent } from "./types.ts"

function memory(): MemoryStore {
  const dump = new Map<string, string>()
  return { keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function strength(): Session {
  return { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 3, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }] }
}

function started(id: string, planId: string) {
  writeEnvelope(EVENTS_KEY, [{ event_id: id, athlete_id: "local", timestamp: "2026-10-07T08:00:00.000Z", event_type: "TRAINING_STARTED", source: "MANUAL", payload: { sessionId: "strength-a", decisionId: "d1" }, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 } satisfies AppEvent])
  const occurrence = bindTrainingStart({ startEventId: id, startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: strength(), runningPlanId: planId })
  const snapshot = getRunningPlanSnapshot(id)
  return { occurrence, snapshot }
}

function plan(components: SessionComponent[]) {
  assert.equal(saveRunningPlan({ planId: "run", planSlotId: "strength-a", components }).ok, true)
  return started("occ", "run")
}

function slot(projection: ReturnType<typeof projectRunningRepetitions>, stepId: string, round: number, repeat: number) {
  return projection.slots.find((item) => item.stepId === stepId && item.roundOrdinal === round && item.repeatOrdinal === repeat)
}

function finish() {
  writeEnvelope(EVENTS_KEY, [...loadEvents(), { event_id: "done", athlete_id: "local", timestamp: "2026-10-07T09:00:00.000Z", event_type: "TRAINING_COMPLETED", source: "MANUAL", payload: { sessionId: "strength-a", setsCompleted: 1, interruptions: false, actual: { sets: 1 } }, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 } satisfies AppEvent])
}

test("completed and skipped repetitions keep actuals separate from the plan", () => {
  setStoreBackend(memory())
  const { snapshot } = plan([{ componentId: "c", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: 600, plannedDurationSeconds: 82, repeatCount: 2, recoveryAfterRepeatSeconds: 120, recoveryBeforeNextStepSeconds: null }] }] } }])
  const identity = { trainingOccurrenceId: "occ", runningSnapshotId: snapshot?.runningSnapshotId ?? "", componentId: "c", blockId: "b", stepId: "s" }
  assert.notEqual(recordRunningRepetitionCompleted({ ...identity, roundOrdinal: 1, repeatOrdinal: 1, actualDistanceMeters: 600, actualDurationSeconds: null }), null)
  assert.notEqual(recordRunningRepetitionCompleted({ ...identity, roundOrdinal: 1, repeatOrdinal: 2, actualDistanceMeters: null, actualDurationSeconds: 83 }), null)
  const open = projectRunningRepetitions("occ", loadEvents())
  assert.equal(open.slots.length, 2)
  assert.equal(slot(open, "s", 1, 1)?.status, "COMPLETED")
  assert.equal(slot(open, "s", 1, 1)?.actualDistanceMeters, 600)
  assert.equal(slot(open, "s", 1, 1)?.actualDurationSeconds, null)
  assert.equal(slot(open, "s", 1, 2)?.actualDistanceMeters, null)
  assert.equal(slot(open, "s", 1, 2)?.actualDurationSeconds, 83)
  assert.equal(slot(open, "s", 1, 1)?.plannedDistanceMeters, 600)
  assert.notEqual(slot(open, "s", 1, 2)?.actualDistanceMeters, 600)
  setStoreBackend(memory())
  const both = plan([{ componentId: "c", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: 400, plannedDurationSeconds: 70, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } }])
  const bothId = { trainingOccurrenceId: "occ", runningSnapshotId: both.snapshot?.runningSnapshotId ?? "", componentId: "c", blockId: "b", stepId: "s", roundOrdinal: 1, repeatOrdinal: 1 }
  recordRunningRepetitionCompleted({ ...bothId, actualDistanceMeters: 405, actualDurationSeconds: 71 })
  assert.equal(slot(projectRunningRepetitions("occ", loadEvents()), "s", 1, 1)?.actualDistanceMeters, 405)
  assert.equal(slot(projectRunningRepetitions("occ", loadEvents()), "s", 1, 1)?.actualDurationSeconds, 71)
  setStoreBackend(memory())
  const blank = plan([{ componentId: "c", modality: "RUNNING", purpose: "HILL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "hill", plannedDistanceMeters: null, plannedDurationSeconds: 30, repeatCount: 6, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } }])
  const hill = { trainingOccurrenceId: "occ", runningSnapshotId: blank.snapshot?.runningSnapshotId ?? "", componentId: "c", blockId: "b", stepId: "hill" }
  recordRunningRepetitionCompleted({ ...hill, roundOrdinal: 1, repeatOrdinal: 1, actualDistanceMeters: null, actualDurationSeconds: null })
  const hillView = projectRunningRepetitions("occ", loadEvents())
  assert.equal(hillView.slots.length, 6)
  assert.equal(slot(hillView, "hill", 1, 1)?.status, "COMPLETED")
  assert.equal(slot(hillView, "hill", 1, 1)?.actualDurationSeconds, null)
  assert.equal(slot(hillView, "hill", 1, 1)?.plannedDurationSeconds, 30)
  assert.equal(slot(hillView, "hill", 1, 2)?.status, "NOT_YET_RECORDED")
  const before = loadEvents().length
  assert.equal(recordRunningRepetitionCompleted({ ...hill, roundOrdinal: 1, repeatOrdinal: 2, actualDistanceMeters: -1, actualDurationSeconds: null }), null)
  assert.equal(recordRunningRepetitionCompleted({ ...hill, roundOrdinal: 1, repeatOrdinal: 2, actualDistanceMeters: 0, actualDurationSeconds: null }), null)
  assert.equal(recordRunningRepetitionCompleted({ ...hill, roundOrdinal: 1, repeatOrdinal: 2, actualDistanceMeters: null, actualDurationSeconds: -5 }), null)
  assert.equal(loadEvents().length, before)
  assert.notEqual(recordRunningRepetitionSkipped({ ...hill, roundOrdinal: 1, repeatOrdinal: 2 }), null)
  const skipped = slot(projectRunningRepetitions("occ", loadEvents()), "hill", 1, 2)
  assert.equal(skipped?.status, "SKIPPED")
  assert.equal(skipped?.actualDistanceMeters, null)
  assert.equal(skipped?.actualDurationSeconds, null)
  assert.equal(recordRunningRepetitionSkipped({ ...hill, roundOrdinal: 1, repeatOrdinal: 3, actualDistanceMeters: 30, actualDurationSeconds: null }), null)
})

test("invalid identities are rejected and conflicts stay unresolved", () => {
  setStoreBackend(memory())
  const { snapshot } = plan([
    { componentId: "easy", modality: "RUNNING", purpose: "EASY_AEROBIC", structure: { kind: "CONTINUOUS", plannedDistanceMeters: 8000, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } },
    { componentId: "main", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } },
  ])
  const base = { trainingOccurrenceId: "occ", runningSnapshotId: snapshot?.runningSnapshotId ?? "", componentId: "main", blockId: "b", stepId: "s", roundOrdinal: 1, repeatOrdinal: 1, actualDistanceMeters: 200, actualDurationSeconds: null }
  assert.equal(recordRunningRepetitionCompleted({ ...base, runningSnapshotId: "other-snap" }), null)
  assert.equal(recordRunningRepetitionCompleted({ ...base, trainingOccurrenceId: "other-occ" }), null)
  assert.equal(recordRunningRepetitionCompleted({ ...base, componentId: "missing" }), null)
  assert.equal(recordRunningRepetitionCompleted({ ...base, componentId: "easy" }), null)
  assert.equal(recordRunningRepetitionCompleted({ ...base, blockId: "missing" }), null)
  assert.equal(recordRunningRepetitionCompleted({ ...base, stepId: "missing" }), null)
  assert.equal(recordRunningRepetitionCompleted({ ...base, roundOrdinal: 0 }), null)
  assert.equal(recordRunningRepetitionCompleted({ ...base, repeatOrdinal: 0 }), null)
  assert.equal(recordRunningRepetitionCompleted({ ...base, roundOrdinal: 2 }), null)
  assert.equal(recordRunningRepetitionCompleted({ ...base, repeatOrdinal: 2 }), null)
  assert.equal(projectRunningRepetitions("occ", loadEvents()).slots.some((item) => item.componentId === "easy"), false)
  const first = recordRunningRepetitionCompleted(base)
  const second = recordRunningRepetitionCompleted(base)
  const duplicated = slot(projectRunningRepetitions("occ", loadEvents()), "s", 1, 1)
  assert.equal(duplicated?.status, "DUPLICATE_UNRESOLVED")
  assert.deepEqual(duplicated?.sourceEventIds, [first?.event_id, second?.event_id])
  assert.equal(duplicated?.actualDistanceMeters, null)
  setStoreBackend(memory())
  const skipPlan = plan([{ componentId: "main", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } }])
  const skipId = { trainingOccurrenceId: "occ", runningSnapshotId: skipPlan.snapshot?.runningSnapshotId ?? "", componentId: "main", blockId: "b", stepId: "s", roundOrdinal: 1, repeatOrdinal: 1 }
  const skipA = recordRunningRepetitionSkipped(skipId)
  const skipB = recordRunningRepetitionSkipped(skipId)
  assert.equal(slot(projectRunningRepetitions("occ", loadEvents()), "s", 1, 1)?.status, "DUPLICATE_UNRESOLVED")
  assert.deepEqual(slot(projectRunningRepetitions("occ", loadEvents()), "s", 1, 1)?.sourceEventIds, [skipA?.event_id, skipB?.event_id])
  setStoreBackend(memory())
  const mixed = plan([{ componentId: "main", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } }])
  const mixedId = { trainingOccurrenceId: "occ", runningSnapshotId: mixed.snapshot?.runningSnapshotId ?? "", componentId: "main", blockId: "b", stepId: "s", roundOrdinal: 1, repeatOrdinal: 1 }
  const done = recordRunningRepetitionCompleted({ ...mixedId, actualDistanceMeters: null, actualDurationSeconds: null })
  const skip = recordRunningRepetitionSkipped(mixedId)
  const conflict = slot(projectRunningRepetitions("occ", loadEvents()), "s", 1, 1)
  assert.equal(conflict?.status, "DUPLICATE_UNRESOLVED")
  assert.deepEqual(conflict?.sourceEventIds, [done?.event_id, skip?.event_id])
  assert.equal(conflict?.actualDistanceMeters, null)
})

test("eight and nine slots keep their rounds until a real ending", () => {
  setStoreBackend(memory())
  const speed = plan([{ componentId: "c", modality: "RUNNING", purpose: "REPETITION_SPEED", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 2, recoveryAfterRoundSeconds: 480, steps: [{ stepId: "s200", plannedDistanceMeters: 200, plannedDurationSeconds: 28, repeatCount: 4, recoveryAfterRepeatSeconds: 120, recoveryBeforeNextStepSeconds: null }] }] } }])
  const id = { trainingOccurrenceId: "occ", runningSnapshotId: speed.snapshot?.runningSnapshotId ?? "", componentId: "c", blockId: "b", stepId: "s200" }
  recordRunningRepetitionCompleted({ ...id, roundOrdinal: 1, repeatOrdinal: 1, actualDistanceMeters: 200, actualDurationSeconds: 29 })
  recordRunningRepetitionCompleted({ ...id, roundOrdinal: 1, repeatOrdinal: 2, actualDistanceMeters: null, actualDurationSeconds: null })
  recordRunningRepetitionSkipped({ ...id, roundOrdinal: 1, repeatOrdinal: 3 })
  const open = projectRunningRepetitions("occ", loadEvents())
  assert.equal(open.terminal, false)
  assert.equal(open.slots.length, 8)
  assert.deepEqual(open.slots.map((item) => [item.roundOrdinal, item.repeatOrdinal]), [[1, 1], [1, 2], [1, 3], [1, 4], [2, 1], [2, 2], [2, 3], [2, 4]])
  assert.equal(slot(open, "s200", 1, 4)?.status, "NOT_YET_RECORDED")
  assert.equal(slot(open, "s200", 2, 1)?.status, "NOT_YET_RECORDED")
  writeEnvelope(EVENTS_KEY, [...loadEvents(), { event_id: "pause-is-not-an-event", athlete_id: "local", timestamp: "2026-10-07T08:30:00.000Z", event_type: "SUBJECTIVE_FEEDBACK", source: "MANUAL", payload: { text: "paused" }, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 } satisfies AppEvent])
  assert.equal(slot(projectRunningRepetitions("occ", loadEvents()), "s200", 2, 4)?.status, "NOT_YET_RECORDED")
  finish()
  const closed = projectRunningRepetitions("occ", loadEvents())
  assert.equal(closed.terminal, true)
  assert.equal(slot(closed, "s200", 1, 1)?.status, "COMPLETED")
  assert.equal(slot(closed, "s200", 1, 3)?.status, "SKIPPED")
  assert.equal(slot(closed, "s200", 1, 4)?.status, "NOT_RECORDED")
  assert.equal(slot(closed, "s200", 2, 4)?.status, "NOT_RECORDED")
  assert.equal(closed.slots.length, 8)
  setStoreBackend(memory())
  const combo = plan([{ componentId: "c", modality: "RUNNING", purpose: "UNSPECIFIED", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 3, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s300", plannedDistanceMeters: 300, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }, { stepId: "s200", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }, { stepId: "s100", plannedDistanceMeters: 100, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } }])
  const seen = projectRunningRepetitions("occ", loadEvents())
  assert.equal(seen.slots.length, 9)
  assert.equal(slot(seen, "s300", 2, 1)?.stepId, "s300")
  assert.equal(slot(seen, "s200", 2, 1)?.stepId, "s200")
  assert.notEqual(slot(seen, "s300", 2, 1)?.stepId, slot(seen, "s200", 2, 1)?.stepId)
  assert.equal(combo.snapshot?.components.length, 1)
})

test("legacy runs and strength facts stay outside repetition projection", () => {
  setStoreBackend(memory())
  writeEnvelope(EVENTS_KEY, [{ event_id: "legacy", athlete_id: "local", timestamp: "2026-10-07T08:00:00.000Z", event_type: "TRAINING_STARTED", source: "MANUAL", payload: { sessionId: "strength-a", decisionId: "d1" }, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 } satisfies AppEvent, { event_id: "whole", athlete_id: "local", timestamp: "2026-10-07T09:00:00.000Z", event_type: "RUN_COMPLETED", source: "MANUAL", payload: { km: 8, seconds: 2400, trainingOccurrenceId: "legacy" }, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 } satisfies AppEvent])
  bindTrainingStart({ startEventId: "legacy", startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: strength() })
  const missing = projectRunningRepetitions("legacy", loadEvents())
  assert.equal(missing.availability, "UNAVAILABLE")
  assert.equal(missing.slots.length, 0)
  setStoreBackend(memory())
  const mixed = plan([
    { componentId: "run", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: 600, plannedDurationSeconds: 82, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } },
    { componentId: "lift", modality: "STRENGTH", strengthSessionId: "strength-a" },
  ])
  recordRunningRepetitionCompleted({ trainingOccurrenceId: "occ", runningSnapshotId: mixed.snapshot?.runningSnapshotId ?? "", componentId: "run", blockId: "b", stepId: "s", roundOrdinal: 1, repeatOrdinal: 1, actualDistanceMeters: 610, actualDurationSeconds: 84 })
  const sets = projectActualSets(getTrainingPlanSnapshot(mixed.occurrence?.trainingPlanSnapshotId ?? ""), loadEvents())
  assert.equal(sets.plannedSets.length, 3)
  assert.equal(sets.attempts.length, 0)
  assert.equal(readTrainingFact("occ")?.plannedSetCount, 3)
  const source = readFileSync(new URL("./running-execution.ts", import.meta.url), "utf8")
  for (const word of ["actualPace", "paceScore", "RUNNING_CONTINUOUS_SKIPPED", "training-decision", "qualityScore"]) assert.equal(source.includes(word), false)
})
