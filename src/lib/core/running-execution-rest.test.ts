import assert from "node:assert/strict"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { projectActualSets } from "./canonical.ts"
import { loadEvents, EVENTS_KEY } from "./events.ts"
import { bindTrainingStart, getTrainingPlanSnapshot } from "./occurrence.ts"
import { readTrainingFact } from "./fact-read.ts"
import { getRunningPlanSnapshot, saveRunningPlan, type SessionComponent } from "./running-plan.ts"
import { projectRunningExecution, recordRunningContinuousCompleted, recordRunningRecovery } from "./running-execution.ts"
import { setStoreBackend, type MemoryStore, writeEnvelope } from "./storage.ts"
import type { AppEvent } from "./types.ts"

function memory(): MemoryStore {
  const dump = new Map<string, string>()
  return { keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function strength(): Session {
  return { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 3, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }] }
}

function begin(components: SessionComponent[]) {
  assert.equal(saveRunningPlan({ planId: "run", planSlotId: "strength-a", components }).ok, true)
  writeEnvelope(EVENTS_KEY, [{ event_id: "occ", athlete_id: "local", timestamp: "2026-10-07T08:00:00.000Z", event_type: "TRAINING_STARTED", source: "MANUAL", payload: { sessionId: "strength-a", decisionId: "d1" }, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 } satisfies AppEvent])
  const occurrence = bindTrainingStart({ startEventId: "occ", startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: strength(), runningPlanId: "run" })
  return { occurrence, snapshot: getRunningPlanSnapshot("occ") }
}

test("continuous running stays one identity and does not copy the plan", () => {
  setStoreBackend(memory())
  const { snapshot } = begin([{ componentId: "easy", modality: "RUNNING", purpose: "EASY_AEROBIC", structure: { kind: "CONTINUOUS", plannedDistanceMeters: 8000, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } }])
  const id = { trainingOccurrenceId: "occ", runningSnapshotId: snapshot?.runningSnapshotId ?? "", componentId: "easy" }
  const open = projectRunningExecution("occ", loadEvents())
  assert.equal(open.continuous.length, 1)
  assert.equal(open.repetitions.length, 0)
  assert.equal(open.continuous[0]?.status, "NOT_YET_RECORDED")
  assert.equal(open.continuous[0]?.actualDistanceMeters, null)
  const blank = recordRunningContinuousCompleted({ ...id, actualDistanceMeters: null, actualDurationSeconds: null })
  const completed = projectRunningExecution("occ", loadEvents()).continuous[0]
  assert.equal(completed?.status, "COMPLETED")
  assert.equal(completed?.actualDistanceMeters, null)
  assert.equal(completed?.plannedDistanceMeters, 8000)
  assert.equal(completed?.derivedPaceSecPerMeter, null)
  const before = loadEvents().length
  assert.equal(recordRunningContinuousCompleted({ ...id, actualDistanceMeters: -1, actualDurationSeconds: null }), null)
  assert.equal(recordRunningContinuousCompleted({ ...id, actualDistanceMeters: 0, actualDurationSeconds: 10 }), null)
  assert.equal(loadEvents().length, before)
  assert.equal(blank?.event_type, "RUNNING_CONTINUOUS_COMPLETED")
  setStoreBackend(memory())
  const again = begin([{ componentId: "easy", modality: "RUNNING", purpose: "EASY_AEROBIC", structure: { kind: "CONTINUOUS", plannedDistanceMeters: 8000, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } }])
  const againId = { trainingOccurrenceId: "occ", runningSnapshotId: again.snapshot?.runningSnapshotId ?? "", componentId: "easy" }
  const first = recordRunningContinuousCompleted({ ...againId, actualDistanceMeters: 7600, actualDurationSeconds: 2400 })
  const second = recordRunningContinuousCompleted({ ...againId, actualDistanceMeters: 8000, actualDurationSeconds: 2500 })
  const conflict = projectRunningExecution("occ", loadEvents()).continuous[0]
  assert.equal(conflict?.status, "DUPLICATE_UNRESOLVED")
  assert.deepEqual(conflict?.sourceEventIds, [first?.event_id, second?.event_id])
  assert.equal(conflict?.actualDistanceMeters, null)
  assert.equal(conflict?.derivedPaceSecPerMeter, null)
  assert.equal("actualPace" in (first?.payload ?? {}), false)
  setStoreBackend(memory())
  const partial = begin([{ componentId: "easy", modality: "RUNNING", purpose: "EASY_AEROBIC", structure: { kind: "CONTINUOUS", plannedDistanceMeters: 8000, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } }])
  const partialId = { trainingOccurrenceId: "occ", runningSnapshotId: partial.snapshot?.runningSnapshotId ?? "", componentId: "easy" }
  recordRunningContinuousCompleted({ ...partialId, actualDistanceMeters: 7600, actualDurationSeconds: null })
  assert.equal(projectRunningExecution("occ", loadEvents()).continuous[0]?.actualDistanceMeters, 7600)
  assert.equal(projectRunningExecution("occ", loadEvents()).continuous[0]?.actualDurationSeconds, null)
  setStoreBackend(memory())
  const timed = begin([{ componentId: "easy", modality: "RUNNING", purpose: "EASY_AEROBIC", structure: { kind: "CONTINUOUS", plannedDistanceMeters: null, plannedDistanceMaxMeters: null, plannedDurationSeconds: 1800 } }])
  recordRunningContinuousCompleted({ trainingOccurrenceId: "occ", runningSnapshotId: timed.snapshot?.runningSnapshotId ?? "", componentId: "easy", actualDistanceMeters: null, actualDurationSeconds: 1700 })
  assert.equal(projectRunningExecution("occ", loadEvents()).continuous[0]?.actualDurationSeconds, 1700)
  assert.equal(projectRunningExecution("occ", loadEvents()).continuous[0]?.plannedDurationSeconds, 1800)
  assert.equal(projectRunningExecution("occ", loadEvents()).continuous[0]?.actualDistanceMeters, null)
})

test("recovery slots stay structural and zero is not the plan", () => {
  setStoreBackend(memory())
  const { snapshot } = begin([{ componentId: "main", modality: "RUNNING", purpose: "REPETITION_SPEED", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 2, recoveryAfterRoundSeconds: 480, steps: [{ stepId: "s200", plannedDistanceMeters: 200, plannedDurationSeconds: 28, repeatCount: 4, recoveryAfterRepeatSeconds: 120, recoveryBeforeNextStepSeconds: null }] }] } }])
  const view = projectRunningExecution("occ", loadEvents())
  assert.equal(view.repetitions.length, 8)
  assert.equal(view.recoveries.filter((item) => item.kind === "AFTER_REPEAT").length, 6)
  assert.equal(view.recoveries.filter((item) => item.kind === "AFTER_ROUND").length, 1)
  assert.equal(view.recoveries.filter((item) => item.kind === "BEFORE_NEXT_STEP").length, 0)
  const base = { trainingOccurrenceId: "occ", runningSnapshotId: snapshot?.runningSnapshotId ?? "", componentId: "main", blockId: "b" }
  assert.equal(recordRunningRecovery({ ...base, kind: "AFTER_REPEAT", stepId: "s200", roundOrdinal: 1, afterRepeatOrdinal: 4, actualRecoverySeconds: 90 }), null)
  assert.equal(recordRunningRecovery({ ...base, kind: "AFTER_ROUND", afterRoundOrdinal: 2, actualRecoverySeconds: 90 }), null)
  assert.equal(recordRunningRecovery({ ...base, kind: "AFTER_REPEAT", stepId: "s200", roundOrdinal: 1, afterRepeatOrdinal: 1, actualRecoverySeconds: null }), null)
  assert.equal(recordRunningRecovery({ ...base, kind: "AFTER_REPEAT", stepId: "s200", roundOrdinal: 1, afterRepeatOrdinal: 1, actualRecoverySeconds: -1 }), null)
  const zero = recordRunningRecovery({ ...base, kind: "AFTER_REPEAT", stepId: "s200", roundOrdinal: 1, afterRepeatOrdinal: 1, actualRecoverySeconds: 0 })
  const recorded = projectRunningExecution("occ", loadEvents()).recoveries.find((item) => item.kind === "AFTER_REPEAT" && item.afterRepeatOrdinal === 1 && item.roundOrdinal === 1)
  assert.equal(recorded?.status, "RECORDED")
  assert.equal(recorded?.actualRecoverySeconds, 0)
  assert.equal(recorded?.plannedRecoverySeconds, 120)
  assert.equal(recorded?.sourceEventIds[0], zero?.event_id)
  const again = recordRunningRecovery({ ...base, kind: "AFTER_REPEAT", stepId: "s200", roundOrdinal: 1, afterRepeatOrdinal: 1, actualRecoverySeconds: 100 })
  const conflict = projectRunningExecution("occ", loadEvents()).recoveries.find((item) => item.kind === "AFTER_REPEAT" && item.afterRepeatOrdinal === 1 && item.roundOrdinal === 1)
  assert.equal(conflict?.status, "DUPLICATE_UNRESOLVED")
  assert.deepEqual(conflict?.sourceEventIds, [zero?.event_id, again?.event_id])
  assert.equal(conflict?.actualRecoverySeconds, null)
  const round = recordRunningRecovery({ ...base, kind: "AFTER_ROUND", afterRoundOrdinal: 1, actualRecoverySeconds: 500 })
  const roundView = projectRunningExecution("occ", loadEvents()).recoveries.find((item) => item.kind === "AFTER_ROUND")
  assert.equal(roundView?.status, "RECORDED")
  assert.equal(roundView?.actualRecoverySeconds, 500)
  assert.equal(roundView?.plannedRecoverySeconds, 480)
  assert.equal(roundView?.sourceEventIds[0], round?.event_id)
  setStoreBackend(memory())
  const combo = begin([{ componentId: "main", modality: "RUNNING", purpose: "UNSPECIFIED", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 3, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s300", plannedDistanceMeters: 300, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: 20 }, { stepId: "s200", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: 15 }, { stepId: "s100", plannedDistanceMeters: 100, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } }])
  const seen = projectRunningExecution("occ", loadEvents())
  assert.equal(seen.repetitions.length, 9)
  assert.equal(seen.recoveries.filter((item) => item.kind === "BEFORE_NEXT_STEP").length, 6)
  assert.equal(seen.recoveries.filter((item) => item.kind === "AFTER_REPEAT").length, 0)
  const comboId = { trainingOccurrenceId: "occ", runningSnapshotId: combo.snapshot?.runningSnapshotId ?? "", componentId: "main", blockId: "b" }
  assert.equal(recordRunningRecovery({ ...comboId, kind: "BEFORE_NEXT_STEP", roundOrdinal: 2, fromStepId: "s100", toStepId: "s200", actualRecoverySeconds: 10 }), null)
  const between = recordRunningRecovery({ ...comboId, kind: "BEFORE_NEXT_STEP", roundOrdinal: 2, fromStepId: "s300", toStepId: "s200", actualRecoverySeconds: 25 })
  const betweenView = projectRunningExecution("occ", loadEvents()).recoveries.find((item) => item.kind === "BEFORE_NEXT_STEP" && item.roundOrdinal === 2 && item.fromStepId === "s300")
  assert.equal(betweenView?.actualRecoverySeconds, 25)
  assert.equal(betweenView?.plannedRecoverySeconds, 20)
  assert.equal(betweenView?.sourceEventIds[0], between?.event_id)
  const untouched = projectRunningExecution("occ", loadEvents()).recoveries.find((item) => item.kind === "BEFORE_NEXT_STEP" && item.roundOrdinal === 1 && item.fromStepId === "s200")
  assert.equal(untouched?.status, "NOT_YET_RECORDED")
  assert.equal(untouched?.actualRecoverySeconds, null)
})

test("mixed session and legacy runs do not leak into strength facts", () => {
  setStoreBackend(memory())
  const mixed = begin([
    { componentId: "warm", modality: "RUNNING", purpose: "WARMUP", structure: { kind: "CONTINUOUS", plannedDistanceMeters: null, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } },
    { componentId: "main", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s600", plannedDistanceMeters: 600, plannedDurationSeconds: 82, repeatCount: 2, recoveryAfterRepeatSeconds: 120, recoveryBeforeNextStepSeconds: null }] }] } },
    { componentId: "lift", modality: "STRENGTH", strengthSessionId: "strength-a" },
    { componentId: "cool", modality: "RUNNING", purpose: "COOLDOWN", structure: { kind: "CONTINUOUS", plannedDistanceMeters: null, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } },
  ])
  recordRunningContinuousCompleted({ trainingOccurrenceId: "occ", runningSnapshotId: mixed.snapshot?.runningSnapshotId ?? "", componentId: "warm", actualDistanceMeters: 1600, actualDurationSeconds: 480 })
  const execution = projectRunningExecution("occ", loadEvents())
  assert.equal(execution.continuous.map((item) => item.componentId).join(","), "warm,cool")
  assert.equal(execution.repetitions.length, 2)
  assert.equal(execution.recoveries.filter((item) => item.kind === "AFTER_REPEAT").length, 1)
  assert.equal(execution.continuous[0]?.derivedPaceSecPerMeter, 480 / 1600)
  assert.equal(execution.continuous[0]?.paceDistanceSourceEventId, execution.continuous[0]?.sourceEventIds[0])
  assert.equal(projectActualSets(getTrainingPlanSnapshot(mixed.occurrence?.trainingPlanSnapshotId ?? ""), loadEvents()).plannedSets.length, 3)
  assert.equal(readTrainingFact("occ")?.plannedSetCount, 3)
  writeEnvelope(EVENTS_KEY, [...loadEvents(), { event_id: "done", athlete_id: "local", timestamp: "2026-10-07T09:00:00.000Z", event_type: "TRAINING_COMPLETED", source: "MANUAL", payload: { sessionId: "strength-a", setsCompleted: 1, interruptions: false, actual: { sets: 1 } }, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 } satisfies AppEvent])
  assert.equal(projectRunningExecution("occ", loadEvents()).continuous[1]?.status, "NOT_RECORDED")
  setStoreBackend(memory())
  writeEnvelope(EVENTS_KEY, [{ event_id: "legacy", athlete_id: "local", timestamp: "2026-10-07T08:00:00.000Z", event_type: "TRAINING_STARTED", source: "MANUAL", payload: { sessionId: "strength-a", decisionId: "d1" }, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 } satisfies AppEvent, { event_id: "whole", athlete_id: "local", timestamp: "2026-10-07T09:00:00.000Z", event_type: "RUN_COMPLETED", source: "MANUAL", payload: { km: 8, seconds: 2400 }, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 } satisfies AppEvent])
  bindTrainingStart({ startEventId: "legacy", startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: strength() })
  const legacy = projectRunningExecution("legacy", loadEvents())
  assert.equal(legacy.availability, "UNAVAILABLE")
  assert.equal(legacy.continuous.length, 0)
  assert.equal(legacy.recoveries.length, 0)
})
