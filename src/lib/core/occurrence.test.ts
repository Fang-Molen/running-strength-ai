import assert from "node:assert/strict"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { advanceCycle, type Plan } from "@/lib/strength/model"
import { CANONICAL_TRAINING_KEY, captureOriginalPlan, legacyPlannedSetCount, listCanonicalRecords } from "./canonical.ts"
import { mergeSets, type SetRecord } from "./execution.ts"
import { attemptsForOccurrence, bindTrainingStart, closeTrainingOccurrence, getTrainingOccurrence, getTrainingPlanSnapshot, listTrainingOccurrences, markOccurrenceClosed, trainingCompletion, trainingFact, TRAINING_OCCURRENCE_KEY } from "./occurrence.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"
import { completeFromRunner, interruptFromRunner } from "../../components/training-runner.tsx"

const PLAN_KEY = "fr255-strength-plan-v3"
const EVENTS_KEY = "fr255-events-v1"

function memory(): MemoryStore & { dump: Map<string, string> } {
  const dump = new Map<string, string>()
  return {
    dump,
    keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null,
    setItem: (key, value) => {
      dump.set(key, value)
    },
  }
}

function session(patch: Partial<Session> & { moves?: Session["moves"] } = {}): Session {
  return {
    id: "strength-a",
    name: "下肢",
    moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 4, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }],
    ...patch,
  }
}

function start(id: string, plan: unknown, startedAt = "2026-10-07T01:00:00.000Z") {
  const source = plan && typeof plan === "object" && "id" in plan ? (plan as Session) : session()
  return bindTrainingStart({
    startEventId: id,
    startedAt,
    sessionId: typeof source.id === "string" ? source.id : "strength-a",
    planSlotId: typeof source.id === "string" ? source.id : "strength-a",
    plan,
  })
}

test("a direct start snapshots the current four-set plan", () => {
  setStoreBackend(memory())
  const occurrence = start("start-a", session())
  const snapshot = getTrainingPlanSnapshot(occurrence?.trainingPlanSnapshotId ?? "")
  assert.equal(occurrence?.trainingOccurrenceId, "start-a")
  assert.equal(occurrence?.planKnowledge, "KNOWN")
  assert.equal(occurrence?.lifecycle, "IN_PROGRESS")
  assert.equal(occurrence?.startedAt, "2026-10-07T01:00:00.000Z")
  assert.equal(occurrence?.reason, "UNKNOWN")
  assert.equal(snapshot?.sets.length, 4)
  assert.equal(snapshot?.sets[0]?.weightKg, 60)
})

test("edits do not become the training plan", () => {
  setStoreBackend(memory())
  const original = session()
  captureOriginalPlan(original)
  const lighter = session({ moves: [{ ...original.moves[0], weightKg: 70 }] })
  captureOriginalPlan(lighter)
  const fewer = session({ moves: [{ ...original.moves[0], sets: 3, weightKg: 70 }] })
  const occurrence = start("start-b", fewer)
  const snapshot = getTrainingPlanSnapshot(occurrence?.trainingPlanSnapshotId ?? "")
  assert.equal(snapshot?.sets.length, 3)
  assert.equal(snapshot?.sets[0]?.weightKg, 70)
  assert.equal(listCanonicalRecords().length, 2)
  assert.notEqual(snapshot?.snapshotId, listCanonicalRecords()[0]?.originalPlan.snapshotId)
  assert.notEqual(snapshot?.snapshotId, listCanonicalRecords()[1]?.originalPlan.snapshotId)
  const done = [
    { event_id: "start-b", event_type: "TRAINING_STARTED", timestamp: "2026-10-07T01:00:00.000Z", payload: { sessionId: "strength-a" } },
    ...[1, 2, 3].map((index) => ({
      event_id: `set-${index}`,
      event_type: "TRAINING_SET_COMPLETED",
      payload: { sessionId: "strength-a", moveId: "squat", setIndex: index, completed: true, skipped: false, actualWeight: 70, actualAmount: 8 },
    })),
  ]
  const fact = trainingCompletion(occurrence?.trainingOccurrenceId ?? "", done)
  assert.equal(fact?.plannedSetCount, 3)
  assert.equal(fact?.completedSetCount, 3)
  assert.equal(fact?.completionRatio, 1)
})

test("reps, seconds, rest, mode, order, and movement edits are the saved plan", () => {
  setStoreBackend(memory())
  const reps = start("reps", session({ moves: [{ ...session().moves[0], amount: 5 }] }))
  assert.equal(getTrainingPlanSnapshot(reps?.trainingPlanSnapshotId ?? "")?.exercises[0]?.amount, 5)
  markOccurrenceClosed(reps?.trainingOccurrenceId ?? "", { kind: "COMPLETED", endedAt: null })
  const seconds = start("seconds", session({ moves: [{ ...session().moves[0], mode: "seconds", amount: 30 }] }))
  assert.equal(getTrainingPlanSnapshot(seconds?.trainingPlanSnapshotId ?? "")?.exercises[0]?.mode, "seconds")
  assert.equal(getTrainingPlanSnapshot(seconds?.trainingPlanSnapshotId ?? "")?.exercises[0]?.amount, 30)
  markOccurrenceClosed(seconds?.trainingOccurrenceId ?? "", { kind: "COMPLETED", endedAt: null })
  const rest = start("rest", session({ moves: [{ ...session().moves[0], restSec: 45 }] }))
  assert.equal(getTrainingPlanSnapshot(rest?.trainingPlanSnapshotId ?? "")?.exercises[0]?.restSec, 45)
  markOccurrenceClosed(rest?.trainingOccurrenceId ?? "", { kind: "COMPLETED", endedAt: null })
  const mode = start("mode", session({ moves: [{ ...session().moves[0], mode: "seconds", amount: 20 }] }))
  assert.equal(getTrainingPlanSnapshot(mode?.trainingPlanSnapshotId ?? "")?.exercises[0]?.mode, "seconds")
  markOccurrenceClosed(mode?.trainingOccurrenceId ?? "", { kind: "COMPLETED", endedAt: null })
  markOccurrenceClosed(mode?.trainingOccurrenceId ?? "", { kind: "COMPLETED", endedAt: null })
  const ordered = session({
    moves: [
      { id: "hinge", catalogId: null, customName: "硬拉", sets: 1, mode: "reps", amount: 6, restSec: 60, weightKg: 40 },
      { id: "squat", catalogId: "back-squat", customName: "", sets: 1, mode: "reps", amount: 8, restSec: 90, weightKg: 60 },
    ],
  })
  const order = start("order", ordered)
  assert.deepEqual(getTrainingPlanSnapshot(order?.trainingPlanSnapshotId ?? "")?.exercises.map((item) => item.moveId), ["hinge", "squat"])
  markOccurrenceClosed(order?.trainingOccurrenceId ?? "", { kind: "COMPLETED", endedAt: null })
  const added = start("added", session({ moves: [...session().moves, { id: "hinge", catalogId: null, customName: "硬拉", sets: 2, mode: "reps", amount: 6, restSec: 60, weightKg: 40 }] }))
  assert.equal(getTrainingPlanSnapshot(added?.trainingPlanSnapshotId ?? "")?.exercises.length, 2)
})

test("five edits then a later start use only the final saved plan", () => {
  setStoreBackend(memory())
  for (const sets of [4, 3, 2, 5, 1]) captureOriginalPlan(session({ moves: [{ ...session().moves[0], sets }] }))
  const finalPlan = session({ moves: [{ ...session().moves[0], sets: 2, amount: 10 }] })
  const occurrence = start("final", finalPlan)
  assert.equal(getTrainingPlanSnapshot(occurrence?.trainingPlanSnapshotId ?? "")?.sets.length, 2)
  assert.equal(getTrainingPlanSnapshot(occurrence?.trainingPlanSnapshotId ?? "")?.exercises[0]?.amount, 10)
  assert.equal(listCanonicalRecords().every((item) => item.originalPlan.snapshotId !== occurrence?.trainingPlanSnapshotId), true)
})

test("reopening after an edit uses the saved plan, not yesterday's edit snapshot", () => {
  setStoreBackend(memory())
  captureOriginalPlan(session())
  const saved = session({ moves: [{ ...session().moves[0], sets: 3 }] })
  const occurrence = start("reopen", saved, "2026-10-08T01:00:00.000Z")
  assert.equal(getTrainingPlanSnapshot(occurrence?.trainingPlanSnapshotId ?? "")?.sets.length, 3)
  assert.equal(listCanonicalRecords()[0]?.originalPlan.sets.length, 4)
})

test("advance and template changes snapshot the plan in effect at start", () => {
  setStoreBackend(memory())
  const source = session()
  const plan: Plan = { name: "一周", sessions: [source], cycle: { block: 1, week: 1, logs: [{ sessionId: source.id, feel: "easy", painIds: [], note: "" }], lastChange: "", bias: "build" } }
  captureOriginalPlan(source)
  const next = advanceCycle(plan).plan.sessions[0]
  const first = start("week-1", source)
  markOccurrenceClosed(first?.trainingOccurrenceId ?? "", { kind: "COMPLETED", endedAt: "2026-10-07T02:00:00.000Z" })
  const second = start("week-2", next, "2026-10-14T01:00:00.000Z")
  assert.notEqual(first?.trainingOccurrenceId, second?.trainingOccurrenceId)
  assert.equal(getTrainingPlanSnapshot(first?.trainingPlanSnapshotId ?? "")?.sets[0]?.weightKg, 60)
  assert.equal(getTrainingPlanSnapshot(second?.trainingPlanSnapshotId ?? "")?.sets[0]?.weightKg, 62)
  assert.equal(getTrainingOccurrence(first?.trainingOccurrenceId ?? "")?.trainingPlanSnapshotId, first?.trainingPlanSnapshotId)
  const replaced = session({ name: "新模板", moves: [{ id: "plank", catalogId: "plank", customName: "", sets: 1, mode: "seconds", amount: 20, restSec: 30, weightKg: 0 }] })
  markOccurrenceClosed(second?.trainingOccurrenceId ?? "", { kind: "COMPLETED", endedAt: "2026-10-14T02:00:00.000Z" })
  const third = start("template", replaced, "2026-10-15T01:00:00.000Z")
  assert.equal(getTrainingPlanSnapshot(third?.trainingPlanSnapshotId ?? "")?.exercises[0]?.moveId, "plank")
})

test("an empty plan is known and an unreadable plan stays unknown", () => {
  setStoreBackend(memory())
  const empty = start("empty", session({ moves: [] }))
  assert.equal(empty?.planKnowledge, "KNOWN")
  assert.equal(getTrainingPlanSnapshot(empty?.trainingPlanSnapshotId ?? "")?.sets.length, 0)
  assert.equal(trainingCompletion(empty?.trainingOccurrenceId ?? "", [])?.completionRatio, null)
  markOccurrenceClosed(empty?.trainingOccurrenceId ?? "", { kind: "COMPLETED", endedAt: null })
  const missing = start("missing", null)
  assert.equal(missing?.planKnowledge, "UNKNOWN")
  assert.equal(missing?.trainingPlanSnapshotId, null)
  markOccurrenceClosed(missing?.trainingOccurrenceId ?? "", { kind: "INTERRUPTED", endedAt: null })
  const corrupt = start("corrupt", { id: "strength-a", name: "下肢", moves: "bad" })
  assert.equal(corrupt?.planKnowledge, "UNKNOWN")
  markOccurrenceClosed(corrupt?.trainingOccurrenceId ?? "", { kind: "INTERRUPTED", endedAt: null })
  const unsafe = start("unsafe", { id: "strength-a", name: "下肢", moves: [{ id: 7 }] })
  assert.equal(unsafe?.planKnowledge, "UNKNOWN")
  assert.equal(listTrainingOccurrences().length, 4)
})

test("a second start before close stays on the first occurrence", () => {
  setStoreBackend(memory())
  const first = start("start-a", session())
  const snapshotId = first?.trainingPlanSnapshotId
  const second = start("start-b", session({ moves: [{ ...session().moves[0], sets: 1, weightKg: 100 }] }))
  assert.equal(second?.trainingOccurrenceId, "start-a")
  assert.equal(second?.trainingPlanSnapshotId, snapshotId)
  assert.deepEqual(second?.duplicateStartEventIds, ["start-b"])
  assert.equal(listTrainingOccurrences().length, 1)
  assert.equal(getTrainingPlanSnapshot(snapshotId ?? "")?.sets.length, 4)
})

test("the same slot next week is a new occurrence after the first one closes", () => {
  setStoreBackend(memory())
  const first = start("week-a", session())
  markOccurrenceClosed(first?.trainingOccurrenceId ?? "", { kind: "COMPLETED", endedAt: "2026-10-07T02:00:00.000Z" })
  const second = start("week-b", session({ moves: [{ ...session().moves[0], sets: 3 }] }), "2026-10-14T01:00:00.000Z")
  assert.notEqual(first?.trainingOccurrenceId, second?.trainingOccurrenceId)
  assert.equal(getTrainingPlanSnapshot(first?.trainingPlanSnapshotId ?? "")?.sets.length, 4)
  assert.equal(getTrainingPlanSnapshot(second?.trainingPlanSnapshotId ?? "")?.sets.length, 3)
  assert.equal(first?.planSlotId, second?.planSlotId)
})

test("old starts are not backfilled from edit snapshots", () => {
  const box = memory()
  setStoreBackend(box)
  box.setItem(PLAN_KEY, "{\"name\":\"keep\"}")
  box.setItem(EVENTS_KEY, "{\"schemaVersion\":1,\"revision\":1,\"updatedAt\":\"\",\"data\":[]}")
  captureOriginalPlan(session())
  captureOriginalPlan(session({ moves: [{ ...session().moves[0], sets: 3 }] }))
  assert.equal(listTrainingOccurrences().length, 0)
  const failed = bindTrainingStart({
    startEventId: "historical",
    startedAt: "2026-10-01T01:00:00.000Z",
    sessionId: "strength-a",
    planSlotId: "strength-a",
    plan: session({ moves: [{ ...session().moves[0], sets: 2 }] }),
    persistSnapshot: () => false,
  })
  assert.equal(failed?.planKnowledge, "UNKNOWN")
  assert.equal(failed?.trainingPlanSnapshotId, null)
  assert.equal(getTrainingPlanSnapshot(listCanonicalRecords()[1]?.originalPlan.snapshotId ?? ""), null)
  assert.equal(box.dump.get(PLAN_KEY), "{\"name\":\"keep\"}")
  assert.equal(box.dump.get(EVENTS_KEY), "{\"schemaVersion\":1,\"revision\":1,\"updatedAt\":\"\",\"data\":[]}")
  assert.equal(box.dump.has(CANONICAL_TRAINING_KEY), true)
  assert.equal(box.dump.has(TRAINING_OCCURRENCE_KEY), true)
  assert.equal(listCanonicalRecords().length, 2)
})

function recordedSet(id: string, index: number): { event_id: string; event_type: string; payload: Record<string, unknown> } {
  return { event_id: id, event_type: "TRAINING_SET_COMPLETED", payload: { sessionId: "strength-a", moveId: "squat", setIndex: index, completed: true, skipped: false, actualWeight: 60, actualAmount: 8 } }
}

test("the runner close separates the next real start", () => {
  setStoreBackend(memory())
  const firstPlan = session({ moves: [{ ...session().moves[0], sets: 3 }] })
  const first = start("start-a", firstPlan)
  const completed = completeFromRunner({ decisionId: "d1", sessionId: "strength-a", planned: null, actualSets: 2, actualAmount: 8, actualWeightKg: 60, rpe: null, pain: false, modified: false, interrupted: false })
  const closed = getTrainingOccurrence(first?.trainingOccurrenceId ?? "")
  assert.equal(closed?.lifecycle, "COMPLETED")
  assert.equal(closed?.outcome, "COMPLETED")
  assert.equal(closed?.endedAt, completed?.timestamp)
  assert.equal(closed?.closeEventId, completed?.event_id)
  assert.equal(getTrainingPlanSnapshot(closed?.trainingPlanSnapshotId ?? "")?.sets.length, 3)
  const second = start("start-b", session({ moves: [{ ...session().moves[0], sets: 5 }] }), "2026-10-14T01:00:00.000Z")
  assert.notEqual(first?.trainingOccurrenceId, second?.trainingOccurrenceId)
  assert.equal(getTrainingPlanSnapshot(first?.trainingPlanSnapshotId ?? "")?.sets.length, 3)
  assert.equal(getTrainingPlanSnapshot(second?.trainingPlanSnapshotId ?? "")?.sets.length, 5)
  const events = [
    { event_id: "start-a", event_type: "TRAINING_STARTED", payload: { sessionId: "strength-a" } },
    recordedSet("a-1", 1),
    recordedSet("a-2", 2),
    { event_id: completed?.event_id, event_type: "TRAINING_COMPLETED", payload: { sessionId: "strength-a" } },
    { event_id: "start-b", event_type: "TRAINING_STARTED", payload: { sessionId: "strength-a" } },
    recordedSet("b-1", 1),
  ]
  const factA = trainingFact(first?.trainingOccurrenceId ?? "", events)
  const factB = trainingFact(second?.trainingOccurrenceId ?? "", events)
  assert.equal(factA?.plannedSetCount, 3)
  assert.equal(factA?.completedSetCount, 2)
  assert.equal(factA?.notRecordedSetCount, 1)
  assert.equal(factA?.skippedSetCount, 0)
  assert.equal(factA?.completionRatio, 2 / 3)
  assert.deepEqual(attemptsForOccurrence(first?.trainingOccurrenceId ?? "", events).map((item) => item.event_id), ["a-1", "a-2"])
  assert.deepEqual(attemptsForOccurrence(second?.trainingOccurrenceId ?? "", events).map((item) => item.event_id), ["b-1"])
  assert.notDeepEqual(factA?.attemptCount, factB?.plannedSetCount)
})

test("the runner interrupt also frees the next start", () => {
  setStoreBackend(memory())
  const first = start("start-a", session())
  const interrupted = interruptFromRunner("d1", "strength-a")
  const closed = getTrainingOccurrence(first?.trainingOccurrenceId ?? "")
  assert.equal(closed?.lifecycle, "INTERRUPTED")
  assert.equal(closed?.endedAt, interrupted?.timestamp)
  const second = start("start-b", session({ moves: [{ ...session().moves[0], sets: 2 }] }))
  assert.notEqual(first?.trainingOccurrenceId, second?.trainingOccurrenceId)
  assert.equal(getTrainingOccurrence(first?.trainingOccurrenceId ?? "")?.trainingPlanSnapshotId, first?.trainingPlanSnapshotId)
})

test("a duplicate start stays on the first occurrence until the runner completes it", () => {
  setStoreBackend(memory())
  const first = start("start-a", session({ moves: [{ ...session().moves[0], sets: 3 }] }))
  const again = start("start-b", session({ moves: [{ ...session().moves[0], sets: 9 }] }))
  assert.equal(again?.trainingOccurrenceId, first?.trainingOccurrenceId)
  completeFromRunner({ decisionId: "d1", sessionId: "strength-a", planned: null, actualSets: 3, actualAmount: 8, actualWeightKg: 60, rpe: null, pain: false, modified: false, interrupted: false })
  const next = start("start-c", session({ moves: [{ ...session().moves[0], sets: 5 }] }))
  assert.equal(listTrainingOccurrences().length, 2)
  assert.notEqual(next?.trainingOccurrenceId, first?.trainingOccurrenceId)
  assert.equal(getTrainingPlanSnapshot(first?.trainingPlanSnapshotId ?? "")?.sets.length, 3)
  assert.equal(getTrainingPlanSnapshot(next?.trainingPlanSnapshotId ?? "")?.sets.length, 5)
})

test("a second close removes the unique end time and a pre-session note does not close", () => {
  setStoreBackend(memory())
  const first = start("start-a", session())
  assert.equal(getTrainingOccurrence(first?.trainingOccurrenceId ?? "")?.lifecycle, "IN_PROGRESS")
  closeTrainingOccurrence({ event_id: "pre-log", event_type: "TRAINING_COMPLETED", timestamp: "2026-10-07T01:10:00.000Z", payload: { sessionId: "strength-a", feel: "ok", note: "" } })
  closeTrainingOccurrence({ event_id: "pre-skip", event_type: "TRAINING_INTERRUPTED", timestamp: "2026-10-07T01:11:00.000Z", payload: { sessionId: "strength-a", note: "没练" } })
  assert.equal(getTrainingOccurrence(first?.trainingOccurrenceId ?? "")?.lifecycle, "IN_PROGRESS")
  assert.equal(getTrainingOccurrence(first?.trainingOccurrenceId ?? "")?.endedAt, null)
  const firstClose = completeFromRunner({ decisionId: "d1", sessionId: "strength-a", planned: null, actualSets: 4, actualAmount: 8, actualWeightKg: 60, rpe: null, pain: false, modified: false, interrupted: false })
  closeTrainingOccurrence({ event_id: "close-2", event_type: "TRAINING_COMPLETED", timestamp: "2026-10-07T03:00:00.000Z", payload: { sessionId: "strength-a", decisionId: "d1", setsCompleted: 4, interruptions: false, actual: { sets: 4 } } })
  const closed = getTrainingOccurrence(first?.trainingOccurrenceId ?? "")
  assert.equal(closed?.lifecycle, "DUPLICATE_CLOSE")
  assert.equal(closed?.outcome, "UNKNOWN")
  assert.equal(closed?.endedAt, null)
  assert.equal(closed?.closeEventId, firstClose?.event_id)
  assert.deepEqual(closed?.duplicateCloseEventIds, ["close-2"])
  const failed = bindTrainingStart({ startEventId: "broken", startedAt: "2026-10-07T04:00:00.000Z", sessionId: "strength-b", planSlotId: "strength-b", plan: session({ id: "strength-b" }), persistSnapshot: () => false })
  const brokenClose = completeFromRunner({ decisionId: "d2", sessionId: "strength-b", planned: null, actualSets: 0, actualAmount: null, actualWeightKg: null, rpe: null, pain: false, modified: false, interrupted: false })
  const unknown = getTrainingOccurrence(failed?.trainingOccurrenceId ?? "")
  assert.equal(unknown?.planKnowledge, "UNKNOWN")
  assert.equal(unknown?.trainingPlanSnapshotId, null)
  assert.equal(unknown?.lifecycle, "COMPLETED")
  assert.equal(unknown?.endedAt, brokenClose?.timestamp)
  const unclassified = start("start-u", session())
  closeTrainingOccurrence({ event_id: "odd", event_type: "TRAINING_COMPLETED", timestamp: "2026-10-07T05:00:00.000Z", payload: { sessionId: "strength-a", decisionId: "d1", note: "x", outcome: true } })
  assert.equal(getTrainingOccurrence(unclassified?.trainingOccurrenceId ?? "")?.lifecycle, "UNCLASSIFIED_CLOSE")
  assert.equal(getTrainingOccurrence(unclassified?.trainingOccurrenceId ?? "")?.endedAt, null)
})

test("legacy set counting stays on event count and does not use the training snapshot", () => {
  const planned: SetRecord[] = [{ moveId: "squat", name: "深蹲", setIndex: 1, mode: "reps", plannedWeight: 60, plannedAmount: 8, restSec: 90, actualWeight: null, actualAmount: null, completed: false, skipped: false, modified: false, source: null, timestamp: null }]
  const logged: SetRecord[] = [
    { ...planned[0], actualWeight: 60, actualAmount: 8, completed: true, source: "user_entered", timestamp: "2026-10-07T01:00:00.000Z" },
    { ...planned[0], actualWeight: 50, actualAmount: 7, completed: true, source: "user_entered", timestamp: "2026-10-07T01:01:00.000Z" },
  ]
  assert.equal(mergeSets(planned, logged)[0]?.actualWeight, 50)
  assert.equal(legacyPlannedSetCount([
    { event_type: "TRAINING_SET_COMPLETED", payload: { sessionId: "strength-a" } },
    { event_type: "TRAINING_SET_COMPLETED", payload: { sessionId: "strength-a" } },
  ]), 2)
})

