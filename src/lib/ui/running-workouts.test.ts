import assert from "node:assert/strict"
import test from "node:test"
import { loadEvents } from "@/lib/core/events"
import { projectRunningExecution } from "@/lib/core/running-execution"
import { getRunningPlan, type RunningPlan } from "@/lib/core/running-plan"
import { setStoreBackend, type MemoryStore } from "@/lib/core/storage"
import { commitTrackRecovery, commitTrackSlot, confirmTrackPlan, customTrackComponents, describeTrackPlan, emptyDraft, listTrackPlans, saveCustomTrackPlan, startTrackSession, trackHomeView } from "./running-workouts.ts"

function memory(): MemoryStore {
  const dump = new Map<string, string>()
  return { keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

test("continuous running summaries show the prescribed dose rather than execution identities", () => {
  const make = (distance: number | null, seconds: number | null, maxDistance: number | null = null): RunningPlan => ({
    runningPlanSchemaVersion: 1, planId: "scheduled:custom:example:run", planSlotId: "scheduled:custom:example:run",
    components: [{ componentId: "run", modality: "RUNNING", purpose: "UNSPECIFIED", structure: {
      kind: "CONTINUOUS", plannedDistanceMeters: distance, plannedDistanceMaxMeters: maxDistance, plannedDurationSeconds: seconds,
    } }],
  })
  const cases: [RunningPlan, string][] = [
    [make(2000, 900), "连续跑 · 2000米 · 目标15分钟"],
    [make(null, 95), "连续跑 · 目标1分35秒"],
    [make(null, 45), "连续跑 · 目标45秒"],
    [make(3000, null, 5000), "连续跑 · 3000—5000米"],
    [make(null, null), "连续跑 · 参数待补充"],
  ]
  for (const [plan, text] of cases) {
    const before = structuredClone(plan)
    assert.equal(describeTrackPlan(plan), text)
    assert.doesNotMatch(describeTrackPlan(plan), /scheduled:|custom:|0秒|0分钟/)
    assert.deepEqual(plan, before)
  }
})

test("200m x 4 x 2 keeps two rounds and does not repeat a write", () => {
  setStoreBackend(memory())
  const draft = emptyDraft("200x4x2")
  draft.targetSeconds = [null]
  draft.repRestSeconds = 60
  draft.roundRestSeconds = 180
  assert.equal(confirmTrackPlan("200x4x2", draft).ok, true)
  const started = startTrackSession("track-200-4-2")
  assert.equal(started.ok, true)
  if (!started.ok) return
  const first = projectRunningExecution(started.trainingOccurrenceId, loadEvents())
  assert.equal(first.repetitions.length, 8)
  assert.deepEqual(first.repetitions.map((item) => [item.roundOrdinal, item.repeatOrdinal]), [[1, 1], [1, 2], [1, 3], [1, 4], [2, 1], [2, 2], [2, 3], [2, 4]])
  assert.equal(first.repetitions[0]?.plannedDurationSeconds, null)
  assert.equal(first.recoveries.filter((item) => item.kind === "AFTER_REPEAT").length, 6)
  assert.equal(first.recoveries.filter((item) => item.kind === "AFTER_ROUND").length, 1)
  const slot = first.repetitions[0]
  assert.ok(slot)
  assert.equal(commitTrackSlot(slot, "complete", "33.5", "").ok, true)
  assert.equal(commitTrackSlot(slot, "complete", "34", "").ok, false)
  assert.equal(loadEvents().filter((event) => event.event_type === "RUNNING_REPETITION_COMPLETED").length, 1)
  const again = startTrackSession("track-200-4-2")
  assert.equal(again.ok && again.trainingOccurrenceId, started.trainingOccurrenceId)
  const reloaded = projectRunningExecution(started.trainingOccurrenceId, loadEvents())
  assert.equal(reloaded.repetitions[0]?.status, "COMPLETED")
  assert.equal(reloaded.repetitions[0]?.actualDurationSeconds, 33.5)
  assert.equal(reloaded.repetitions[0]?.actualDistanceMeters, null)
  assert.equal(reloaded.repetitions[1]?.status, "NOT_YET_RECORDED")
  assert.equal(commitTrackSlot(reloaded.repetitions[1]!, "skip", "", "").ok, true)
  assert.equal(projectRunningExecution(started.trainingOccurrenceId, loadEvents()).repetitions[1]?.status, "SKIPPED")
})

test("400m plus 200m keeps combination order", () => {
  setStoreBackend(memory())
  const draft = emptyDraft("400-200")
  draft.targetSeconds = [null, 28]
  draft.stepRestSeconds = 90
  assert.equal(confirmTrackPlan("400-200", draft).ok, true)
  const started = startTrackSession("track-400-200")
  assert.equal(started.ok, true)
  if (!started.ok) return
  const view = projectRunningExecution(started.trainingOccurrenceId, loadEvents())
  assert.deepEqual(view.repetitions.map((item) => [item.stepId, item.plannedDistanceMeters, item.plannedDurationSeconds]), [["m400", 400, null], ["m200", 200, 28]])
  assert.equal(view.recoveries.length, 1)
  assert.equal(view.recoveries[0]?.kind, "BEFORE_NEXT_STEP")
  assert.equal(view.recoveries[0]?.plannedRecoverySeconds, 90)
})

test("custom 600 400 300 keeps two rounds and an empty target", () => {
  setStoreBackend(memory())
  const built = customTrackComponents(2, 180, [
    { distanceMeters: 600, repeatCount: 1, targetSeconds: null, repRestSeconds: null, stepRestSeconds: 90 },
    { distanceMeters: 400, repeatCount: 1, targetSeconds: null, repRestSeconds: null, stepRestSeconds: 70 },
    { distanceMeters: 300, repeatCount: 1, targetSeconds: null, repRestSeconds: null, stepRestSeconds: null },
  ])
  assert.equal(built.ok, true)
  assert.equal(saveCustomTrackPlan("track-pyramid", 2, 180, [
    { distanceMeters: 600, repeatCount: 1, targetSeconds: null, repRestSeconds: null, stepRestSeconds: 90 },
    { distanceMeters: 400, repeatCount: 1, targetSeconds: null, repRestSeconds: null, stepRestSeconds: 70 },
    { distanceMeters: 300, repeatCount: 1, targetSeconds: null, repRestSeconds: null, stepRestSeconds: null },
  ]).ok, true)
  const plan = listTrackPlans().find((item) => item.planId === "track-pyramid")
  assert.equal(plan && describeTrackPlan(plan), "(600米+400米+300米)×2")
  const started = startTrackSession("track-pyramid")
  assert.equal(started.ok, true)
  if (!started.ok) return
  const view = projectRunningExecution(started.trainingOccurrenceId, loadEvents())
  assert.deepEqual(view.repetitions.map((item) => [item.roundOrdinal, item.plannedDistanceMeters, item.plannedDurationSeconds]), [[1, 600, null], [1, 400, null], [1, 300, null], [2, 600, null], [2, 400, null], [2, 300, null]])
  assert.equal(view.recoveries.filter((item) => item.kind === "BEFORE_NEXT_STEP").length, 4)
  assert.equal(view.recoveries.filter((item) => item.kind === "AFTER_ROUND").length, 1)
  assert.equal(commitTrackSlot(view.repetitions[0]!, "complete", "", "610").ok, true)
  assert.equal(projectRunningExecution(started.trainingOccurrenceId, loadEvents()).repetitions[0]?.actualDistanceMeters, 610)
  assert.equal(projectRunningExecution(started.trainingOccurrenceId, loadEvents()).repetitions[0]?.plannedDistanceMeters, 600)
  assert.equal(projectRunningExecution(started.trainingOccurrenceId, loadEvents()).repetitions[1]?.status, "NOT_YET_RECORDED")
})

test("a started snapshot stays when the plan is edited", () => {
  setStoreBackend(memory())
  const draft = emptyDraft("200x4x2")
  draft.repRestSeconds = 60
  draft.roundRestSeconds = 180
  assert.equal(confirmTrackPlan("200x4x2", draft).ok, true)
  const started = startTrackSession("track-200-4-2")
  assert.equal(started.ok, true)
  if (!started.ok) return
  draft.repRestSeconds = 90
  assert.equal(confirmTrackPlan("200x4x2", draft).ok, true)
  const frozen = projectRunningExecution(started.trainingOccurrenceId, loadEvents()).recoveries.find((item) => item.kind === "AFTER_REPEAT")
  assert.equal(frozen?.plannedRecoverySeconds, 60)
  const current = listTrackPlans().find((item) => item.planId === "track-200-4-2")
  assert.equal(current?.components[0]?.modality === "RUNNING" && current.components[0].structure.kind === "REPEATED" ? current.components[0].structure.blocks[0]?.steps[0]?.recoveryAfterRepeatSeconds : null, 90)
  const rest = frozen
  assert.ok(rest)
  assert.equal(commitTrackRecovery(rest, "").ok, false)
  assert.equal(commitTrackRecovery(rest, "45").ok, true)
  assert.equal(commitTrackRecovery(rest, "50").ok, false)
  const recorded = projectRunningExecution(started.trainingOccurrenceId, loadEvents()).recoveries.find((item) => item.kind === "AFTER_REPEAT" && item.afterRepeatOrdinal === 1 && item.roundOrdinal === 1)
  assert.equal(recorded?.actualRecoverySeconds, 45)
  assert.equal(recorded?.plannedRecoverySeconds, 60)
  assert.equal(loadEvents().filter((event) => event.event_type === "RUNNING_RECOVERY_RECORDED").length, 1)
})

test("one repeat cannot store a between-rep rest", () => {
  setStoreBackend(memory())
  const rejected = saveCustomTrackPlan("track-bad", 1, null, [
    { distanceMeters: 150, repeatCount: 1, targetSeconds: null, repRestSeconds: 30, stepRestSeconds: null },
  ])
  assert.equal(rejected.ok, false)
  assert.equal(getRunningPlan("track-bad"), null)
})

test("today track card reads the saved plan and does not invent readiness", () => {
  setStoreBackend(memory())
  const empty = trackHomeView()
  assert.equal(empty.planId, null)
  assert.match(empty.evidenceNote, /不会把状态写成可以加量/)
  assert.equal(empty.progress, "这次：还没开始。")
  const draft = emptyDraft("200x4x2")
  draft.repRestSeconds = 60
  draft.roundRestSeconds = 180
  assert.equal(confirmTrackPlan("200x4x2", draft).ok, true)
  const saved = trackHomeView()
  assert.equal(saved.planId, "track-200-4-2")
  assert.match(saved.title, /200米/)
  assert.match(saved.rest, /组间 60 秒/)
  assert.match(saved.rest, /轮间 180 秒/)
  assert.equal(saved.openOccurrenceId, null)
  const started = startTrackSession("track-200-4-2")
  assert.equal(started.ok, true)
  if (!started.ok) return
  const slot = projectRunningExecution(started.trainingOccurrenceId, loadEvents()).repetitions[0]
  assert.ok(slot)
  assert.equal(commitTrackSlot(slot, "complete", "31", "200").ok, true)
  const live = trackHomeView()
  assert.equal(live.openOccurrenceId, started.trainingOccurrenceId)
  assert.match(live.progress, /完成 1/)
  assert.equal(loadEvents().filter((event) => event.event_type === "RUNNING_REPETITION_COMPLETED").length, 1)
})



test("explicit running course selection never reads progress from another open course", () => {
  setStoreBackend(memory())
  assert.equal(confirmTrackPlan("200x4x2", emptyDraft("200x4x2")).ok, true)
  assert.equal(confirmTrackPlan("400-200", emptyDraft("400-200")).ok, true)
  assert.equal(startTrackSession("track-200-4-2").ok, true)
  const selected = trackHomeView("track-400-200")
  assert.equal(selected.planId,"track-400-200")
  assert.equal(selected.openOccurrenceId,null)
  assert.match(selected.progress,/还没开始/)
  assert.equal(trackHomeView("missing-plan").planId,null)
  setStoreBackend(null)
})
