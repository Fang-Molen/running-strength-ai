import assert from "node:assert/strict"
import test from "node:test"
import { analyzeRunningRounds } from "./running-round-analysis.ts"
import type { RunningRepetitionProjection, RunningRepetitionSlot } from "./running-execution.ts"
import type { RunningPlanSnapshot, SessionComponent } from "./running-plan.ts"

function fixture(distances = [200], strength = false): { snapshot: RunningPlanSnapshot; projection: RunningRepetitionProjection } {
  const steps = distances.map((distance, i) => ({ stepId: `s${i}`, plannedDistanceMeters: distance, plannedDurationSeconds: distance === 200 ? 28 : 48, repeatCount: 4, recoveryAfterRepeatSeconds: 120, recoveryBeforeNextStepSeconds: null }))
  const components: SessionComponent[] = [
    { componentId: "run", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "block", roundCount: 2, recoveryAfterRoundSeconds: 480, steps }] } },
    ...(strength ? [{ componentId: "lift", modality: "STRENGTH" as const, strengthSessionId: "squat" }] : []),
  ]
  const snapshot: RunningPlanSnapshot = { runningPlanSchemaVersion: 1, runningSnapshotId: "snap", capturedAt: "2026-10-08T00:00:00Z", trainingOccurrenceId: "occ", sourcePlanId: "plan", components }
  const slots: RunningRepetitionSlot[] = steps.flatMap((step) => [1, 2].flatMap((roundOrdinal) => [1, 2, 3, 4].map((repeatOrdinal) => ({
    trainingOccurrenceId: "occ", runningSnapshotId: "snap", componentId: "run", blockId: "block", stepId: step.stepId,
    roundOrdinal, repeatOrdinal, status: "NOT_RECORDED" as const, plannedDistanceMeters: step.plannedDistanceMeters,
    plannedDurationSeconds: step.plannedDurationSeconds, actualDistanceMeters: null, actualDurationSeconds: null,
    sourceEventIds: [], derivedPaceSecPerMeter: null, paceDistanceSourceEventId: null, paceDurationSourceEventId: null,
  }))))
  return { snapshot, projection: { availability: "AVAILABLE", terminal: true, slots } }
}

function setTime(projection: RunningRepetitionProjection, round: number, repeat: number, seconds: number, stepId = "s0", distance = 200) {
  const slot = projection.slots.find((item) => item.roundOrdinal === round && item.repeatOrdinal === repeat && item.stepId === stepId)!
  slot.status = "COMPLETED"
  slot.actualDistanceMeters = distance
  slot.actualDurationSeconds = seconds
  slot.sourceEventIds = [`event-${stepId}-${round}-${repeat}`]
}

test("200m × 4 × 2 preserves both rounds, slot targets and sources without inferring ability", () => {
  const { snapshot, projection } = fixture()
  ;[30, 29, 28, 27].forEach((seconds, index) => setTime(projection, 1, index + 1, seconds))
  ;[31, 30, 29, 28].forEach((seconds, index) => setTime(projection, 2, index + 1, seconds))
  const analysis = analyzeRunningRounds(projection, snapshot)
  const result = analysis.observations[0]!
  assert.equal(result.purpose, "INTERVAL")
  assert.deepEqual(result.rounds.map((round) => round.timingGroups[0]?.meanSeconds), [28.5, 29.5])
  assert.deepEqual(result.rounds.map((round) => round.timingGroups[0]?.medianSeconds), [28.5, 29.5])
  assert.deepEqual(result.rounds[0]?.timings.map((timing) => timing.deviationFromPlanSeconds), [2, 1, 0, -1])
  assert.deepEqual(result.roundComparisons[0]?.positionDifferencesSeconds.map((pair) => pair.differenceSeconds), [1, 1, 1, 1])
  assert.equal(result.roundComparisons[0]?.meanDifferenceSeconds, 1)
  assert.equal(result.roundComparisons[0]?.sourceEventIds.length, 8)
  assert.equal("ability" in result, false)
})

test("skipped, unrecorded and conflict remain separate; partial times cannot compare whole rounds", () => {
  const { snapshot, projection } = fixture()
  setTime(projection, 1, 1, 34)
  projection.slots.find((slot) => slot.roundOrdinal === 1 && slot.repeatOrdinal === 2)!.status = "SKIPPED"
  const conflict = projection.slots.find((slot) => slot.roundOrdinal === 1 && slot.repeatOrdinal === 3)!
  conflict.status = "DUPLICATE_UNRESOLVED"
  conflict.actualDurationSeconds = null
  conflict.sourceEventIds = ["a", "b"]
  const result = analyzeRunningRounds(projection, snapshot).observations[0]!
  assert.deepEqual([result.rounds[0]?.completedCount, result.rounds[0]?.skippedCount, result.rounds[0]?.notRecordedCount, result.rounds[0]?.unresolvedCount], [1, 1, 1, 1])
  assert.equal(result.rounds[0]?.timingGroups[0]?.count, 1)
  assert.deepEqual(result.rounds[0]?.timingGroups[0]?.sourceEventIds, ["event-s0-1-1"])
  assert.deepEqual(result.roundComparisons, [])
})

test("different actual distances and missing actual distance never borrow the planned distance", () => {
  const { snapshot, projection } = fixture()
  ;[34, 35, 36, 37].forEach((seconds, index) => setTime(projection, 1, index + 1, seconds))
  ;[36, 37, 38, 39].forEach((seconds, index) => setTime(projection, 2, index + 1, seconds))
  setTime(projection, 2, 2, 35, "s0", 190)
  const result = analyzeRunningRounds(projection, snapshot).observations[0]!
  assert.deepEqual(result.rounds[1]?.timingGroups.map((group) => [group.distanceMeters, group.count]), [[190, 1], [200, 3]])
  assert.equal(result.rounds[1]?.timings[1]?.deviationFromPlanSeconds, null)
  assert.deepEqual(result.roundComparisons, [])
  projection.slots.find((slot) => slot.roundOrdinal === 2 && slot.repeatOrdinal === 2)!.actualDistanceMeters = null
  assert.equal(analyzeRunningRounds(projection, snapshot).observations[0]?.rounds[1]?.timings.length, 3)
})

test("mixed strength stays outside observations and separate running steps never merge", () => {
  const { snapshot, projection } = fixture([200, 300], true)
  setTime(projection, 1, 1, 34)
  setTime(projection, 1, 1, 48, "s1", 300)
  const observations = analyzeRunningRounds(projection, snapshot).observations
  assert.deepEqual(observations.map((observation) => observation.stepId), ["s0", "s1"])
  assert.deepEqual(observations.map((observation) => observation.rounds[0]?.timingGroups[0]?.distanceMeters), [200, 300])
})

test("legacy unavailable and stale snapshot or partial projection cannot become an observation", () => {
  const { snapshot, projection } = fixture()
  assert.deepEqual(analyzeRunningRounds({ availability: "UNAVAILABLE", terminal: false, slots: [] }, null), { availability: "UNAVAILABLE", observations: [] })
  projection.slots.pop()
  assert.deepEqual(analyzeRunningRounds(projection, snapshot), { availability: "AVAILABLE", observations: [] })
  projection.slots[0]!.runningSnapshotId = "stale"
  assert.deepEqual(analyzeRunningRounds(projection, snapshot), { availability: "AVAILABLE", observations: [] })
})

test("within-round direction and a sudden last repeat stay arithmetic, without a pace-drop label", () => {
  const { snapshot, projection } = fixture()
  ;[36, 34, 32, 30].forEach((seconds, index) => setTime(projection, 1, index + 1, seconds))
  ;[30, 32, 34, 36].forEach((seconds, index) => setTime(projection, 2, index + 1, seconds))
  const slowing = analyzeRunningRounds(projection, snapshot).observations[0]!
  assert.deepEqual(slowing.rounds[0]?.timings.map((timing) => timing.durationSeconds), [36, 34, 32, 30])
  assert.deepEqual(slowing.rounds[1]?.timings.map((timing) => timing.durationSeconds), [30, 32, 34, 36])
  assert.equal("paceDrop" in slowing, false)
  ;[34, 34, 34, 28].forEach((seconds, index) => setTime(projection, 1, index + 1, seconds))
  const surge = analyzeRunningRounds(projection, snapshot).observations[0]!
  assert.deepEqual(surge.rounds[0]?.timings.map((timing) => timing.deviationFromPlanSeconds), [6, 6, 6, 0])
  assert.equal("paceDrop" in surge, false)
})

test("a continuous component is not split into invented rounds", () => {
  const { snapshot, projection } = fixture()
  snapshot.components = [{ componentId: "easy", modality: "RUNNING", purpose: "EASY_AEROBIC", structure: { kind: "CONTINUOUS", plannedDistanceMeters: 5000, plannedDistanceMaxMeters: null, plannedDurationSeconds: 1800 } }]
  projection.slots = []
  assert.deepEqual(analyzeRunningRounds(projection, snapshot), { availability: "AVAILABLE", observations: [] })
})
