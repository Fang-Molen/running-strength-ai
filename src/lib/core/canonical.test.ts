import assert from "node:assert/strict"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { CANONICAL_TRAINING_KEY, buildOriginalPlanSnapshot, captureOriginalPlan, projectActualSets, projectAlongsideLegacy, projectLegacyTraining, projectTrainingLifecycle, type ActualAttempt } from "./canonical.ts"
import { dispatchEvent, loadEvents } from "./events.ts"
import { emptySets, mergeSets } from "./execution.ts"
import { applyAdjustment, readTrainingContext, type TrainingDecision } from "./training-decision.ts"
import { advanceCycle, type Plan } from "@/lib/strength/model"
import { createCanonicalRecord, getCanonicalRecord, hasCanonicalRecord, listCanonicalRecords, captureOriginalPlan as captureFromIndex, markCanonicalStarted, projectAlongsideLegacy as alongsideFromIndex } from "./index.ts"
import { EVENTS_KEY } from "./events.ts"
import { runMigrations } from "./migrate.ts"
import { setStoreBackend, writeEnvelope, type MemoryStore } from "./storage.ts"

const PLAN_KEY = "fr255-strength-plan-v3"

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

function fourSetSession(): Session {
  return {
    id: "slot-squat",
    name: "下肢",
    moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 4, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }],
  }
}

function session(): Session {
  return {
    id: "slot-squat",
    name: "下肢",
    moves: [
      { id: "squat", catalogId: "back-squat", customName: "", sets: 2, mode: "reps", amount: 8, restSec: 90, weightKg: 60 },
      { id: "hinge", catalogId: null, customName: "罗马尼亚硬拉", sets: 1, mode: "reps", amount: 6, restSec: 75, weightKg: 40 },
    ],
  }
}

test("empty canonical storage is an empty list and does not invent a session", () => {
  setStoreBackend(memory())
  assert.deepEqual(listCanonicalRecords(), [])
  assert.equal(getCanonicalRecord("missing"), null)
  assert.equal(hasCanonicalRecord("missing"), false)
})

test("a canonical record round-trips without changing identity or the original plan", () => {
  setStoreBackend(memory())
  const source = session()
  const snapshot = buildOriginalPlanSnapshot(source, "2026-10-07T00:00:00.000Z")
  const created = createCanonicalRecord({ planSlotId: source.id, originalPlan: snapshot, lifecycle: "IN_PROGRESS", startedAt: null })
  assert.ok(created)
  source.moves[0].sets = 1
  source.id = "changed-slot"
  const again = getCanonicalRecord(created.canonicalTrainingId)
  const listed = listCanonicalRecords()
  assert.equal(listed.length, 1)
  assert.equal(again?.canonicalTrainingId, created.canonicalTrainingId)
  assert.notEqual(again?.canonicalTrainingId, again?.planSlotId)
  assert.equal(again?.planSlotId, "slot-squat")
  assert.equal(again?.lifecycle, "IN_PROGRESS")
  assert.deepEqual(again?.attempts, [])
  assert.equal(again?.startedAt, null)
  assert.equal(again?.endedAt, null)
  assert.equal(again?.links.strengthRpeEventId, null)
  assert.deepEqual(again?.links.painEventIds, [])
  assert.equal(again?.links.injuryEventId, null)
  assert.equal(again?.outcome?.reason, "UNKNOWN")
  assert.deepEqual(again?.originalPlan.exercises.map((item) => item.moveId), ["squat", "hinge"])
  assert.deepEqual(
    again?.originalPlan.sets.map((item) => [item.moveId, item.setIndex, item.weightKg]),
    [
      ["squat", 1, 60],
      ["squat", 2, 60],
      ["hinge", 1, 40],
    ],
  )
  assert.equal(hasCanonicalRecord(created.canonicalTrainingId), true)
})

test("two occurrences of the same plan slot keep different canonical ids", () => {
  setStoreBackend(memory())
  const source = session()
  const first = createCanonicalRecord({
    planSlotId: source.id,
    originalPlan: buildOriginalPlanSnapshot(source, "2026-10-07T00:00:00.000Z"),
    lifecycle: "IN_PROGRESS",
  })
  const second = createCanonicalRecord({
    planSlotId: source.id,
    originalPlan: buildOriginalPlanSnapshot(source, "2026-10-08T00:00:00.000Z"),
    lifecycle: "SUBJECTIVE_ONLY",
  })
  assert.ok(first && second)
  assert.notEqual(first.canonicalTrainingId, second.canonicalTrainingId)
  assert.equal(getCanonicalRecord(first.canonicalTrainingId)?.lifecycle, "IN_PROGRESS")
  assert.equal(getCanonicalRecord(second.canonicalTrainingId)?.lifecycle, "SUBJECTIVE_ONLY")
  assert.equal(getCanonicalRecord(first.canonicalTrainingId)?.originalPlan.sets.length, 3)
})

test("corrupt canonical storage follows the envelope fallback and keeps valid records", () => {
  const box = memory()
  setStoreBackend(box)
  box.setItem(CANONICAL_TRAINING_KEY, "{")
  assert.deepEqual(listCanonicalRecords(), [])
  box.setItem(CANONICAL_TRAINING_KEY, JSON.stringify({ schemaVersion: 1, revision: 1, updatedAt: "", data: { records: "bad" } }))
  assert.deepEqual(listCanonicalRecords(), [])
  const source = session()
  const good = createCanonicalRecord({
    planSlotId: source.id,
    originalPlan: buildOriginalPlanSnapshot(source, "2026-10-07T00:00:00.000Z"),
    lifecycle: "IN_PROGRESS",
  })
  assert.ok(good)
  const raw = JSON.parse(box.dump.get(CANONICAL_TRAINING_KEY) ?? "{}") as { data: { records: unknown[] } }
  raw.data.records.push({ canonicalTrainingId: 7 })
  box.setItem(CANONICAL_TRAINING_KEY, JSON.stringify(raw))
  assert.equal(listCanonicalRecords().length, 1)
  assert.equal(listCanonicalRecords()[0]?.canonicalTrainingId, good.canonicalTrainingId)
  writeEnvelope(CANONICAL_TRAINING_KEY, { records: [] })
  setStoreBackend({
    getItem: () => null,
    setItem: () => {
      throw new Error("full")
    },
  })
  assert.equal(
    createCanonicalRecord({
      planSlotId: source.id,
      originalPlan: buildOriginalPlanSnapshot(source, "2026-10-07T00:00:00.000Z"),
      lifecycle: "IN_PROGRESS",
    }),
    null,
  )
})

test("duplicate attempts, links and lifecycle survive storage without being rewritten", () => {
  const box = memory()
  setStoreBackend(box)
  box.setItem(PLAN_KEY, "{\"name\":\"keep-plan\"}")
  box.setItem(EVENTS_KEY, "{\"schemaVersion\":1,\"revision\":2,\"updatedAt\":\"\",\"data\":[]}")
  const source = session()
  const snapshot = buildOriginalPlanSnapshot(source, "2026-10-07T00:00:00.000Z")
  const attempts: ActualAttempt[] = [
    {
      actualSetId: "attempt-a",
      eventId: "event-a",
      plannedSetId: snapshot.sets[0]?.plannedSetId ?? null,
      moveId: "squat",
      setIndex: 1,
      completed: true,
      skipped: false,
      actualWeight: 60,
      actualAmount: 8,
      recordedAt: "2026-10-07T00:01:00.000Z",
    },
    {
      actualSetId: "attempt-b",
      eventId: "event-b",
      plannedSetId: snapshot.sets[0]?.plannedSetId ?? null,
      moveId: "squat",
      setIndex: 1,
      completed: true,
      skipped: false,
      actualWeight: 62,
      actualAmount: 7,
      recordedAt: "2026-10-07T00:02:00.000Z",
    },
  ]
  const created = createCanonicalRecord({
    planSlotId: source.id,
    originalPlan: snapshot,
    lifecycle: "COMPLETED",
    startedAt: "2026-10-07T00:00:00.000Z",
    endedAt: "2026-10-07T00:30:00.000Z",
    attempts,
    outcome: { status: "COMPLETED", reason: "UNKNOWN" },
    links: { strengthRpeEventId: null, painEventIds: ["pain-1", "pain-2"], injuryEventId: null },
  })
  assert.ok(created)
  attempts.push({ ...attempts[0], actualSetId: "later" })
  snapshot.sets.pop()
  const stored = getCanonicalRecord(created.canonicalTrainingId)
  assert.equal(stored?.attempts.length, 2)
  assert.deepEqual(
    stored?.attempts.map((item) => item.actualSetId),
    ["attempt-a", "attempt-b"],
  )
  assert.equal(stored?.attempts[0]?.plannedSetId, stored?.attempts[1]?.plannedSetId)
  assert.notEqual(stored?.attempts[0]?.actualSetId, stored?.attempts[1]?.actualSetId)
  assert.equal(stored?.lifecycle, "COMPLETED")
  assert.equal(stored?.outcome?.status, "COMPLETED")
  assert.equal(stored?.outcome?.reason, "UNKNOWN")
  assert.deepEqual(stored?.links.painEventIds, ["pain-1", "pain-2"])
  assert.equal(stored?.links.strengthRpeEventId, null)
  assert.equal(stored?.links.injuryEventId, null)
  assert.equal(stored?.endedAt, "2026-10-07T00:30:00.000Z")
  assert.equal(stored?.originalPlan.sets.length, 3)
  assert.equal(box.dump.get(PLAN_KEY), "{\"name\":\"keep-plan\"}")
  assert.equal(box.dump.get(EVENTS_KEY), "{\"schemaVersion\":1,\"revision\":2,\"updatedAt\":\"\",\"data\":[]}")
  const canonicalKey: string = CANONICAL_TRAINING_KEY
  assert.equal(box.dump.has(canonicalKey), true)
  assert.notEqual(canonicalKey, PLAN_KEY)
  assert.notEqual(canonicalKey, EVENTS_KEY)
})

test("migration does not invent a canonical snapshot or rewrite the plan", () => {
  const box = memory()
  setStoreBackend(box)
  box.setItem(PLAN_KEY, "{\"name\":\"old-plan\"}")
  runMigrations()
  assert.equal(box.dump.has(CANONICAL_TRAINING_KEY), false)
  assert.equal(box.dump.get(PLAN_KEY), "{\"name\":\"old-plan\"}")
  assert.deepEqual(listCanonicalRecords(), [])
})

test("snapshot stays at four sets after the plan is reduced to three", () => {
  setStoreBackend(memory())
  const source = fourSetSession()
  const frozen = captureOriginalPlan(source)
  assert.ok(frozen)
  const adjusted = applyAdjustment(source, { change: "drop-set" } as TrainingDecision)
  assert.equal(getCanonicalRecord(frozen.canonicalTrainingId)?.originalPlan.exercises[0]?.sets, 4)
  assert.equal(getCanonicalRecord(frozen.canonicalTrainingId)?.originalPlan.sets.length, 4)
  assert.equal(adjusted.moves[0]?.sets, 3)
  assert.deepEqual(
    getCanonicalRecord(frozen.canonicalTrainingId)?.originalPlan.sets.map((item) => item.setIndex),
    [1, 2, 3, 4],
  )
})

test("snapshot keeps the old weight after a manual change", () => {
  setStoreBackend(memory())
  const source = fourSetSession()
  const frozen = captureOriginalPlan(source)
  assert.ok(frozen)
  source.moves[0].weightKg = 70
  assert.equal(getCanonicalRecord(frozen.canonicalTrainingId)?.originalPlan.exercises[0]?.weightKg, 60)
  assert.equal(getCanonicalRecord(frozen.canonicalTrainingId)?.originalPlan.sets[0]?.weightKg, 60)
})

test("snapshot keeps the old plan after a chat replacement", () => {
  setStoreBackend(memory())
  const source = fourSetSession()
  const frozen = captureOriginalPlan(source)
  assert.ok(frozen)
  const replacement = { ...source, name: "新课", moves: [{ ...source.moves[0], sets: 1, weightKg: 20, id: "other" }] }
  assert.equal(getCanonicalRecord(frozen.canonicalTrainingId)?.originalPlan.sessionName, "下肢")
  assert.equal(getCanonicalRecord(frozen.canonicalTrainingId)?.originalPlan.sets.length, 4)
  assert.equal(replacement.moves[0]?.sets, 1)
})

test("snapshot stays before advanceCycle changes the prescription", () => {
  setStoreBackend(memory())
  const source = fourSetSession()
  const plan: Plan = {
    name: "一周",
    sessions: [source],
    cycle: { block: 1, week: 1, logs: [{ sessionId: source.id, feel: "easy", painIds: [], note: "" }], lastChange: "", bias: "build" },
  }
  const frozen = captureOriginalPlan(plan.sessions[0])
  assert.ok(frozen)
  const next = advanceCycle(plan).plan
  assert.equal(getCanonicalRecord(frozen.canonicalTrainingId)?.originalPlan.exercises[0]?.weightKg, 60)
  assert.equal(getCanonicalRecord(frozen.canonicalTrainingId)?.originalPlan.exercises[0]?.sets, 4)
  assert.equal(next.sessions[0]?.moves[0]?.weightKg, 62)
})

test("legacy events can be classified without inventing an original plan", () => {
  assert.equal(projectLegacyTraining([]), null)
  const prelog = projectLegacyTraining([{ event_type: "TRAINING_COMPLETED", payload: { sessionId: "slot", feel: "ok", note: "" } }])
  assert.equal(prelog?.lifecycle, "SUBJECTIVE_ONLY")
  assert.equal(prelog?.originalPlan, null)
  assert.equal(projectTrainingLifecycle([{ event_type: "TRAINING_INTERRUPTED", payload: { sessionId: "slot", note: "没练" } }]), "SKIPPED_BEFORE_START")
  assert.equal(projectTrainingLifecycle([{ event_type: "TRAINING_STARTED", payload: { sessionId: "slot", decisionId: "d1" } }]), "IN_PROGRESS")
  assert.equal(
    projectTrainingLifecycle([
      { event_type: "TRAINING_STARTED", payload: { sessionId: "slot", decisionId: "d1" } },
      { event_type: "TRAINING_COMPLETED", payload: { sessionId: "slot", decisionId: "d1", setsCompleted: 4, interruptions: false, actual: { sets: 4 } } },
    ]),
    "COMPLETED",
  )
  assert.equal(
    projectTrainingLifecycle([
      { event_type: "TRAINING_STARTED", payload: { sessionId: "slot", decisionId: "d1" } },
      { event_type: "TRAINING_INTERRUPTED", payload: { sessionId: "slot", decisionId: "d1" } },
    ]),
    "INTERRUPTED",
  )
  assert.equal(projectTrainingLifecycle([{ event_type: "TRAINING_COMPLETED", payload: { decisionId: "d1", note: "x", outcome: true } }]), "UNCLASSIFIED_CLOSE")
  assert.equal(
    projectTrainingLifecycle([
      { event_type: "TRAINING_STARTED", payload: { sessionId: "slot" } },
      { event_type: "TRAINING_COMPLETED", payload: { sessionId: "slot", setsCompleted: 4, interruptions: false } },
      { event_type: "TRAINING_COMPLETED", payload: { sessionId: "slot", feel: "ok", note: "" } },
    ]),
    "DUPLICATE_CLOSE",
  )
})

function recordedSet(id: string, moveId: string, setIndex: number, extra: Record<string, unknown> = {}) {
  return {
    event_id: id,
    event_type: "TRAINING_SET_COMPLETED",
    timestamp: "2026-10-07T00:00:00.000Z",
    payload: { moveId, setIndex, completed: true, skipped: false, actualWeight: 60, actualAmount: 8, ...extra },
  }
}

test("actual attempts stay separate from the original plan", () => {
  const source = fourSetSession()
  const snapshot = buildOriginalPlanSnapshot(source, "2026-10-07T00:00:00.000Z")
  const four = projectActualSets(snapshot, [1, 2, 3, 4].map((index) => recordedSet(`e${index}`, "squat", index)))
  assert.equal(four.plannedSets.length, 4)
  assert.equal(four.attempts.length, 4)
  assert.equal(four.plannedSets.every((item) => item.status === "COMPLETED"), true)
  assert.deepEqual(four.attempts.map((item) => item.actualSetId), ["e1", "e2", "e3", "e4"])

  const three = projectActualSets(snapshot, [1, 2, 3].map((index) => recordedSet(`a${index}`, "squat", index)))
  assert.equal(three.plannedSets.filter((item) => item.status === "COMPLETED").length, 3)
  assert.equal(three.plannedSets[3]?.status, "NOT_RECORDED")
  assert.equal(three.plannedSets.some((item) => item.status === "SKIPPED"), false)
  assert.equal(JSON.stringify(three.plannedSets).includes("FAILED"), false)

  const skipped = projectActualSets(snapshot, [
    recordedSet("s1", "squat", 1),
    recordedSet("s2", "squat", 2),
    recordedSet("s3", "squat", 3),
    recordedSet("s4", "squat", 4, { completed: false, skipped: true, actualWeight: null, actualAmount: null }),
  ])
  assert.equal(skipped.plannedSets[3]?.status, "SKIPPED")

  const duplicate = projectActualSets(snapshot, [recordedSet("d1", "squat", 1), recordedSet("d2", "squat", 1, { actualWeight: 62 })])
  assert.equal(duplicate.attempts.length, 2)
  assert.deepEqual(duplicate.attempts.map((item) => item.actualSetId), ["d1", "d2"])
  assert.equal(duplicate.plannedSets[0]?.status, "DUPLICATE_UNRESOLVED")
  assert.equal(duplicate.plannedSets[0]?.weightDelta, null)

  const both = {
    id: "slot",
    name: "两动作",
    moves: [
      { id: "squat", catalogId: "back-squat", customName: "", sets: 1, mode: "reps" as const, amount: 8, restSec: 90, weightKg: 60 },
      { id: "hinge", catalogId: "rdl", customName: "", sets: 1, mode: "reps" as const, amount: 6, restSec: 75, weightKg: 40 },
    ],
  }
  const split = buildOriginalPlanSnapshot(both, "2026-10-07T00:00:00.000Z")
  const seen = projectActualSets(split, [recordedSet("m1", "squat", 1), recordedSet("m2", "hinge", 1, { actualWeight: 40, actualAmount: 6 })])
  assert.equal(seen.attempts[0]?.plannedSetId === seen.attempts[1]?.plannedSetId, false)
  assert.equal(seen.plannedSets.every((item) => item.status === "COMPLETED"), true)

  const extra = projectActualSets(snapshot, [1, 2, 3, 4, 5].map((index) => recordedSet(`x${index}`, "squat", index)))
  assert.equal(extra.plannedSets.length, 4)
  assert.equal(extra.attempts[4]?.placement, "EXTRA")
  assert.equal(extra.attempts[4]?.plannedSetId, null)

  const changed = projectActualSets(snapshot, [recordedSet("c1", "squat", 1, { actualWeight: 62, actualAmount: 7 })])
  assert.equal(changed.plannedSets[0]?.weightDelta, 2)
  assert.equal(changed.plannedSets[0]?.amountDelta, -1)
  assert.equal(changed.plannedSets[0]?.reason, "UNKNOWN")

  const before = snapshot.exercises[0]?.name
  const replaced = projectActualSets(snapshot, [recordedSet("r1", "new-move", 1, { name: "新动作" })])
  assert.equal(replaced.originalPlan, snapshot)
  assert.equal(snapshot.exercises[0]?.name, before)
  assert.equal(snapshot.sets.length, 4)
  assert.equal(replaced.attempts[0]?.placement, "EXTRA")
  assert.equal(replaced.attempts[0]?.movementChanged, true)
  assert.equal(replaced.plannedSets.every((item) => item.status === "NOT_RECORDED"), true)

  const renamed = projectActualSets(snapshot, [recordedSet("n1", "squat", 1, { name: "换过的动作" })])
  assert.equal(renamed.attempts[0]?.placement, "MATCHED")
  assert.equal(renamed.attempts[0]?.movementChanged, true)
  assert.equal(snapshot.exercises[0]?.name, before)

  const legacy = projectActualSets(null, [recordedSet("old", "squat", 1)])
  assert.equal(legacy.originalPlan, null)
  assert.equal(legacy.plannedSets.length, 0)
  assert.equal(legacy.attempts[0]?.placement, "UNLINKED")
  assert.equal(legacy.attempts[0]?.actualSetId, "old")
  assert.equal(JSON.stringify(legacy).includes("FAILED"), false)
})

test("legacy event counts and canonical snapshots stay separate", () => {
  const box = memory()
  setStoreBackend(box)
  const source = fourSetSession()
  const snapshot = buildOriginalPlanSnapshot(source, "2026-10-07T00:00:00.000Z")
  for (const index of [1, 2, 3, 4]) {
    dispatchEvent("TRAINING_SET_COMPLETED", { sessionId: source.id, moveId: "squat", setIndex: index, mode: "reps", completed: true, skipped: false, actualWeight: 60, actualAmount: 8 })
  }
  const stored = loadEvents()
  const both = projectAlongsideLegacy(snapshot, stored)
  assert.equal(both.legacyPlannedSets, 4)
  assert.equal(readTrainingContext(null).snapshot?.strength.plannedSets, 4)
  assert.equal(both.canonical.plannedSets.length, 4)
  assert.equal(both.canonical.attempts.length, 4)
  assert.equal(loadEvents().length, stored.length)

  setStoreBackend(memory())
  for (const index of [1, 2, 3]) {
    dispatchEvent("TRAINING_SET_COMPLETED", { sessionId: source.id, moveId: "squat", setIndex: index, mode: "reps", completed: true, skipped: false, actualWeight: 60, actualAmount: 8 })
  }
  const partial = loadEvents()
  const three = projectAlongsideLegacy(snapshot, partial)
  assert.equal(three.legacyPlannedSets, 3)
  assert.equal(readTrainingContext(null).snapshot?.strength.plannedSets, 3)
  assert.equal(three.canonical.plannedSets.length, 4)
  assert.equal(three.canonical.attempts.length, 3)
  assert.equal(three.canonical.plannedSets[3]?.status, "NOT_RECORDED")

  setStoreBackend(memory())
  dispatchEvent("TRAINING_SET_COMPLETED", { sessionId: source.id, moveId: "squat", setIndex: 1, mode: "reps", completed: true, skipped: false, actualWeight: 60, actualAmount: 8 })
  dispatchEvent("TRAINING_SET_COMPLETED", { sessionId: source.id, moveId: "squat", setIndex: 1, mode: "reps", completed: true, skipped: false, actualWeight: 62, actualAmount: 7 })
  const duplicated = loadEvents()
  const folded = mergeSets(emptySets(source), [
    { ...emptySets(source)[0], completed: true, actualWeight: 60, actualAmount: 8, source: "user_entered", timestamp: "2026-10-07T00:00:00.000Z" },
    { ...emptySets(source)[0], completed: true, actualWeight: 62, actualAmount: 7, source: "user_entered", timestamp: "2026-10-07T00:01:00.000Z" },
  ])
  const kept = projectAlongsideLegacy(snapshot, duplicated)
  assert.equal(folded.filter((item) => item.moveId === "squat" && item.setIndex === 1).length, 1)
  assert.equal(folded.find((item) => item.moveId === "squat" && item.setIndex === 1)?.actualWeight, 62)
  assert.equal(kept.legacyPlannedSets, 2)
  assert.equal(readTrainingContext(null).snapshot?.strength.plannedSets, 2)
  assert.equal(kept.canonical.attempts.length, 2)
  assert.equal(kept.canonical.plannedSets[0]?.status, "DUPLICATE_UNRESOLVED")

  const untouched = loadEvents()
  const old = projectAlongsideLegacy(null, untouched)
  assert.equal(old.canonical.originalPlan, null)
  assert.equal(old.legacyPlannedSets, 2)
  assert.equal(listCanonicalRecords().length, 0)
  assert.equal(loadEvents().length, untouched.length)
  assert.equal(readTrainingContext(null).snapshot?.strength.plannedSets, 2)
})

test("a seconds change is only a difference and later plan edits do not rewrite the snapshot", () => {
  setStoreBackend(memory())
  const source: Session = {
    id: "slot-hold",
    name: "支撑",
    moves: [
      { id: "plank", catalogId: "plank", customName: "", sets: 2, mode: "seconds", amount: 30, restSec: 45, weightKg: 0 },
      { id: "squat", catalogId: "back-squat", customName: "", sets: 1, mode: "reps", amount: 8, restSec: 90, weightKg: 60 },
    ],
  }
  const frozen = captureFromIndex(source)
  assert.ok(frozen)
  const snapshot = buildOriginalPlanSnapshot(source, "2026-10-07T00:01:00.000Z")
  const seen = projectActualSets(snapshot, [
    { event_id: "sec-1", event_type: "TRAINING_SET_COMPLETED", payload: { moveId: "plank", setIndex: 1, completed: true, skipped: false, actualAmount: 25, actualWeight: 0 } },
  ])
  assert.equal(seen.plannedSets[0]?.amountDelta, -5)
  assert.equal(seen.plannedSets[0]?.reason, "UNKNOWN")
  source.moves[0].amount = 20
  source.moves[0].restSec = 15
  source.moves[0].mode = "reps"
  source.moves.reverse()
  source.moves.pop()
  source.moves.push({ id: "added", catalogId: null, customName: "新增", sets: 3, mode: "reps", amount: 10, restSec: 60, weightKg: 20 })
  const stored = getCanonicalRecord(frozen.canonicalTrainingId)
  assert.equal(stored?.originalPlan.exercises[0]?.moveId, "plank")
  assert.equal(stored?.originalPlan.exercises[0]?.amount, 30)
  assert.equal(stored?.originalPlan.exercises[0]?.restSec, 45)
  assert.equal(stored?.originalPlan.exercises[0]?.mode, "seconds")
  assert.equal(stored?.originalPlan.exercises.length, 2)
  assert.deepEqual(stored?.originalPlan.exercises.map((item) => item.moveId), ["plank", "squat"])
  const replacement = alongsideFromIndex(stored?.originalPlan ?? null, [])
  assert.equal(replacement.canonical.originalPlan?.exercises.length, 2)
  assert.equal(typeof captureFromIndex, "function")
  assert.equal(typeof alongsideFromIndex, "function")
})

test("editing the plan does not start a training", () => {
  setStoreBackend(memory())
  const source = fourSetSession()
  const frozen = captureOriginalPlan(source)
  assert.ok(frozen)
  assert.equal(frozen.lifecycle, null)
  assert.equal(frozen.outcome, null)
  assert.equal(frozen.startedAt, null)
  const reduced = applyAdjustment(source, { change: "drop-set" } as TrainingDecision)
  source.moves[0].weightKg = 70
  const advanced = advanceCycle({
    name: "一周",
    sessions: [source],
    cycle: { block: 1, week: 1, logs: [{ sessionId: source.id, feel: "easy", painIds: [], note: "" }], lastChange: "", bias: "build" },
  }).plan
  const stored = getCanonicalRecord(frozen.canonicalTrainingId)
  assert.equal(stored?.lifecycle, null)
  assert.equal(stored?.originalPlan.exercises[0]?.sets, 4)
  assert.equal(stored?.originalPlan.exercises[0]?.weightKg, 60)
  assert.equal(reduced.moves[0]?.sets, 3)
  assert.notEqual(advanced.sessions[0]?.moves[0]?.weightKg, stored?.originalPlan.exercises[0]?.weightKg)
  assert.equal(projectTrainingLifecycle([{ event_type: "TRAINING_COMPLETED", payload: { sessionId: source.id, feel: "ok", note: "" } }]), "SUBJECTIVE_ONLY")
  const started = markCanonicalStarted(source.id, "2026-10-07T01:00:00.000Z")
  assert.equal(started?.lifecycle, "IN_PROGRESS")
  assert.equal(started?.startedAt, "2026-10-07T01:00:00.000Z")
  assert.equal(getCanonicalRecord(frozen.canonicalTrainingId)?.originalPlan.sets.length, 4)
  assert.equal(getCanonicalRecord(frozen.canonicalTrainingId)?.originalPlan.exercises[0]?.weightKg, 60)
})





