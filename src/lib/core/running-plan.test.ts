import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { EVENTS_KEY } from "./events.ts"
import { bindTrainingStart, getTrainingPlanSnapshot } from "./occurrence.ts"
import { getRunningPlanSnapshot, RUNNING_PLAN_KEY, saveRunningPlan } from "./running-plan.ts"
import { setStoreBackend, type MemoryStore, writeEnvelope } from "./storage.ts"
import { readTrainingFact } from "./fact-read.ts"
import type { AppEvent } from "./types.ts"

function memory(): MemoryStore & { dump: Map<string, string> } {
  const dump = new Map<string, string>()
  return { dump, keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function session(): Session {
  return { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 3, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }] }
}

function event(id: string, type: AppEvent["event_type"], timestamp: string, payload: Record<string, unknown> = {}): AppEvent {
  return { event_id: id, athlete_id: "local", timestamp, event_type: type, source: "MANUAL", payload, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 }
}

function start(id: string, planId?: string) {
  writeEnvelope(EVENTS_KEY, [event(id, "TRAINING_STARTED", "2026-10-07T08:00:00.000Z", { sessionId: "strength-a", decisionId: "d1" })])
  return bindTrainingStart({ startEventId: id, startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: session(), runningPlanId: planId })
}

test("continuous, dose-less warmup, and legacy absence stay distinct", () => {
  setStoreBackend(memory())
  assert.equal(saveRunningPlan({ planId: "easy", planSlotId: "strength-a", components: [{ componentId: "c-easy", modality: "RUNNING", purpose: "EASY_AEROBIC", structure: { kind: "CONTINUOUS", plannedDistanceMeters: 8000, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } }] }).ok, true)
  start("easy-start", "easy")
  const easy = getRunningPlanSnapshot("easy-start")
  assert.equal(easy?.components[0]?.modality, "RUNNING")
  assert.equal(easy?.runningPlanSchemaVersion, 1)
  if (easy?.components[0]?.modality === "RUNNING" && easy.components[0].structure.kind === "CONTINUOUS") assert.equal(easy.components[0].structure.plannedDistanceMeters, 8000)
  setStoreBackend(memory())
  assert.equal(saveRunningPlan({ planId: "warm", planSlotId: "strength-a", components: [{ componentId: "c-warm", modality: "RUNNING", purpose: "WARMUP", structure: { kind: "CONTINUOUS", plannedDistanceMeters: null, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } }] }).ok, true)
  start("warm-start", "warm")
  const warm = getRunningPlanSnapshot("warm-start")
  assert.notEqual(warm, null)
  if (warm?.components[0]?.modality === "RUNNING" && warm.components[0].structure.kind === "CONTINUOUS") {
    assert.equal(warm.components[0].purpose, "WARMUP")
    assert.equal(warm.components[0].structure.plannedDistanceMeters, null)
    assert.equal(warm.components[0].structure.plannedDurationSeconds, null)
  }
  const legacy = memory()
  setStoreBackend(legacy)
  writeEnvelope(EVENTS_KEY, [event("old-run", "RUN_COMPLETED", "2026-10-07T09:00:00.000Z", { km: 8, seconds: 2400, trainingOccurrenceId: "legacy" })])
  start("legacy")
  assert.equal(getRunningPlanSnapshot("legacy"), null)
  assert.equal(legacy.dump.has(RUNNING_PLAN_KEY), false)
})

test("repeated structures keep rounds and ordered steps", () => {
  setStoreBackend(memory())
  const saved = saveRunningPlan({
    planId: "reps",
    planSlotId: "strength-a",
    components: [
      { componentId: "c-600", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b600", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s600", plannedDistanceMeters: 600, plannedDurationSeconds: 82, repeatCount: 2, recoveryAfterRepeatSeconds: 120, recoveryBeforeNextStepSeconds: null }] }] } },
      { componentId: "c-200", modality: "RUNNING", purpose: "REPETITION_SPEED", structure: { kind: "REPEATED", blocks: [{ blockId: "b200", roundCount: 2, recoveryAfterRoundSeconds: 480, steps: [{ stepId: "s200", plannedDistanceMeters: 200, plannedDurationSeconds: 28, repeatCount: 4, recoveryAfterRepeatSeconds: 120, recoveryBeforeNextStepSeconds: null }] }] } },
      { componentId: "c-combo", modality: "RUNNING", purpose: "UNSPECIFIED", structure: { kind: "REPEATED", blocks: [{ blockId: "bcombo", roundCount: 3, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s300", plannedDistanceMeters: 300, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }, { stepId: "s200b", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }, { stepId: "s100", plannedDistanceMeters: 100, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } },
      { componentId: "c-hill", modality: "RUNNING", purpose: "HILL", structure: { kind: "REPEATED", blocks: [{ blockId: "bhill", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "shill", plannedDistanceMeters: null, plannedDurationSeconds: 30, repeatCount: 6, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } },
      { componentId: "c-lift", modality: "STRENGTH", strengthSessionId: "strength-a" },
    ],
  })
  assert.equal(saved.ok, true)
  const occurrence = start("rep-start", "reps")
  const snapshot = getRunningPlanSnapshot("rep-start")
  const speed = snapshot?.components.find((item) => item.componentId === "c-200")
  assert.equal(speed?.modality, "RUNNING")
  if (speed?.modality === "RUNNING" && speed.structure.kind === "REPEATED") {
    assert.equal(speed.structure.blocks[0]?.roundCount, 2)
    assert.equal(speed.structure.blocks[0]?.steps[0]?.repeatCount, 4)
    assert.notEqual(speed.structure.blocks[0]?.steps.length, 8)
  }
  const combo = snapshot?.components.find((item) => item.componentId === "c-combo")
  if (combo?.modality === "RUNNING" && combo.structure.kind === "REPEATED") assert.deepEqual(combo.structure.blocks[0]?.steps.map((item) => item.plannedDistanceMeters), [300, 200, 100])
  const hill = snapshot?.components.find((item) => item.componentId === "c-hill")
  if (hill?.modality === "RUNNING" && hill.structure.kind === "REPEATED") {
    assert.equal(hill.structure.blocks[0]?.steps[0]?.plannedDistanceMeters, null)
    assert.equal(hill.structure.blocks[0]?.steps[0]?.plannedDurationSeconds, 30)
  }
  const lift = snapshot?.components.find((item) => item.componentId === "c-lift")
  assert.equal(lift?.modality, "STRENGTH")
  if (lift?.modality === "STRENGTH") assert.equal("steps" in lift, false)
  assert.equal(getTrainingPlanSnapshot(occurrence?.trainingPlanSnapshotId ?? "")?.sets.length, 3)
  assert.equal(readTrainingFact("rep-start")?.plannedSetCount, 3)
  const zero = saveRunningPlan({ planId: "zero", planSlotId: "strength-a", components: [{ componentId: "c-zero", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "bzero", roundCount: 2, recoveryAfterRoundSeconds: 0, steps: [{ stepId: "szero", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 2, recoveryAfterRepeatSeconds: 0, recoveryBeforeNextStepSeconds: null }] }] } }] })
  assert.equal(zero.ok, true)
  if (zero.ok && zero.plan.components[0]?.modality === "RUNNING" && zero.plan.components[0].structure.kind === "REPEATED") {
    assert.equal(zero.plan.components[0].structure.blocks[0]?.recoveryAfterRoundSeconds, 0)
    assert.equal(zero.plan.components[0].structure.blocks[0]?.steps[0]?.recoveryAfterRepeatSeconds, 0)
  }
  const omitted = saveRunningPlan({ planId: "omitted", planSlotId: "other", components: [{ componentId: "c-omit", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "bomit", roundCount: 2, recoveryAfterRoundSeconds: null, steps: [{ stepId: "somit", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 2, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } }] })
  assert.equal(omitted.ok, true)
  if (omitted.ok && omitted.plan.components[0]?.modality === "RUNNING" && omitted.plan.components[0].structure.kind === "REPEATED") assert.equal(omitted.plan.components[0].structure.blocks[0]?.steps[0]?.recoveryAfterRepeatSeconds, null)
})

test("invalid plans are rejected and a started snapshot ignores later edits", () => {
  setStoreBackend(memory())
  assert.equal(saveRunningPlan({ planId: "bad-dose", planSlotId: "strength-a", components: [{ componentId: "c", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: null, plannedDurationSeconds: null, repeatCount: 2, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } }] }).ok, false)
  assert.equal(saveRunningPlan({ planId: "bad-distance", planSlotId: "strength-a", components: [{ componentId: "c", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: -5, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } }] }).ok, false)
  assert.equal(saveRunningPlan({ planId: "bad-duration", planSlotId: "strength-a", components: [{ componentId: "c", modality: "RUNNING", purpose: "HILL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: null, plannedDurationSeconds: -1, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } }] }).ok, false)
  assert.equal(saveRunningPlan({ planId: "bad-repeat", planSlotId: "strength-a", components: [{ componentId: "c", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 0, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } }] }).ok, false)
  assert.equal(saveRunningPlan({ planId: "bad-round", planSlotId: "strength-a", components: [{ componentId: "c", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 0, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: null }] }] } }] }).ok, false)
  assert.equal(saveRunningPlan({ planId: "bad-recovery", planSlotId: "strength-a", components: [{ componentId: "c", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: -1, steps: [{ stepId: "s", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 2, recoveryAfterRepeatSeconds: 30, recoveryBeforeNextStepSeconds: null }] }] } }] }).ok, false)
  assert.equal(saveRunningPlan({ planId: "bad-last", planSlotId: "strength-a", components: [{ componentId: "c", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: null, recoveryBeforeNextStepSeconds: 10 }] }] } }] }).ok, false)
  assert.equal(saveRunningPlan({ planId: "bad-single-round", planSlotId: "strength-a", components: [{ componentId: "c", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: 30, steps: [{ stepId: "s", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 2, recoveryAfterRepeatSeconds: 10, recoveryBeforeNextStepSeconds: null }] }] } }] }).ok, false)
  assert.equal(saveRunningPlan({ planId: "bad-single-rep", planSlotId: "strength-a", components: [{ componentId: "c", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 2, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 1, recoveryAfterRepeatSeconds: 10, recoveryBeforeNextStepSeconds: null }] }] } }] }).ok, false)
  assert.equal(saveRunningPlan({ planId: "dup", planSlotId: "strength-a", components: [{ componentId: "same", modality: "RUNNING", purpose: "OTHER", structure: { kind: "CONTINUOUS", plannedDistanceMeters: 1000, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } }, { componentId: "same", modality: "RUNNING", purpose: "OTHER", structure: { kind: "CONTINUOUS", plannedDistanceMeters: 2000, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } }] }).ok, false)
  assert.equal(saveRunningPlan({ planId: "keep", planSlotId: "strength-a", components: [{ componentId: "c-keep", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b-keep", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s-keep", plannedDistanceMeters: 600, plannedDurationSeconds: 82, repeatCount: 2, recoveryAfterRepeatSeconds: 120, recoveryBeforeNextStepSeconds: null }] }] } }] }).ok, true)
  start("kept", "keep")
  const before = getRunningPlanSnapshot("kept")
  saveRunningPlan({ planId: "keep", planSlotId: "strength-a", components: [{ componentId: "c-other", modality: "RUNNING", purpose: "EASY_AEROBIC", structure: { kind: "CONTINUOUS", plannedDistanceMeters: 1000, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } }] })
  assert.equal(getRunningPlanSnapshot("kept")?.components[0]?.componentId, "c-keep")
  assert.equal(before?.runningSnapshotId, getRunningPlanSnapshot("kept")?.runningSnapshotId)
  const source = readFileSync(new URL("./running-plan.ts", import.meta.url), "utf8")
  for (const word of ["RunGoal", "RUN_COMPLETED", "targetDurationSeconds", "targetPace", "loadEvents", "training-decision"]) assert.equal(source.includes(word), false)
})
