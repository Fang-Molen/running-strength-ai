import assert from "node:assert/strict"
import test from "node:test"
import { observeImportedRunning } from "./running-observation.ts"
import type { ImportedRunningSegment } from "./training-import.ts"

const recorded = (value: number) => ({ value, status: "RECORDED" as const, sourceIds: ["text"] })
const absent = { value: null, status: "ABSENT" as const, sourceIds: [] as string[] }

function segment(index: number, input: Partial<ImportedRunningSegment> & { distance?: number | null; seconds?: number | null; completion?: ImportedRunningSegment["completion"] }): ImportedRunningSegment {
  return {
    id: `r${index}`,
    kind: input.kind ?? "REPETITION",
    round: input.round ?? recorded(1),
    repeat: input.repeat ?? recorded(index),
    distanceMeters: input.distance == null ? absent : recorded(input.distance),
    durationSeconds: input.seconds == null ? absent : recorded(input.seconds),
    recoverySeconds: absent,
    completion: input.completion ?? "COMPLETED",
    sourceIds: ["text"],
  }
}

test("recorded parts stay partial, skipped is not missing, and unrecorded is not zero", () => {
  const observation = observeImportedRunning([
    segment(1, { seconds: 36, distance: 200, repeat: recorded(1) }),
    segment(2, { seconds: 40, distance: 200, repeat: recorded(2) }),
    segment(3, { completion: "SKIPPED", seconds: null, distance: 200, repeat: recorded(3) }),
    segment(4, { completion: "NOT_RECORDED", seconds: null, distance: null, repeat: recorded(4) }),
  ])
  assert.equal(observation.planDeviation, "UNAVAILABLE")
  assert.equal(observation.pattern, "UNKNOWN")
  assert.equal(observation.partial, true)
  assert.equal(observation.completed, 2)
  assert.equal(observation.skipped, 1)
  assert.equal(observation.missing, 1)
  assert.equal(observation.rounds[0]?.fastest, 36)
  assert.equal(observation.rounds[0]?.slowest, 40)
  assert.equal(observation.rounds[0]?.mean, 38)
  assert.notEqual(observation.rounds[0]?.mean, 19)
})

test("mixed distances do not compare raw seconds or invent a pace", () => {
  const observation = observeImportedRunning([
    segment(1, { seconds: 50, distance: 300, round: recorded(1), repeat: recorded(1) }),
    segment(2, { seconds: 36, distance: 200, round: recorded(1), repeat: recorded(2) }),
    segment(3, { seconds: 37, distance: 200, round: recorded(2), repeat: recorded(2) }),
  ])
  assert.equal(observation.mixedDistance, true)
  assert.equal(observation.betweenRoundMeanDelta, null)
  assert.equal(observation.lastDelta, null)
  assert.equal(observation.samePositionDeltas.length, 0)
  assert.match(observation.paceNote, /不计算配速/)
})
