import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { completeTraining, interruptTraining, startTraining } from "./training-decision.ts"
import { emptySets, deviationOf, executionOf, feedbackOf, mainDeviation, mergeSets, outcomeReason, recordSet, restLeft, setLine, stepRest, totalsOf, type SetRecord } from "./execution.ts"
import { dispatchEvent, loadEvents } from "./events.ts"
import { readEnvelope } from "./storage.ts"
import type { Session } from "@/lib/strength/model"

const memory = new Map<string, string>()

beforeEach(() => {
  memory.clear()
  const store = {
    keys:()=>[...memory.keys()], getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size
    },
  }
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true })
  Object.defineProperty(globalThis, "window", { value: { localStorage: store }, configurable: true })
})

function session(): Session {
  return {
    id: "s1",
    name: "下肢",
    moves: [{ id: "squat", catalogId: null, customName: "深蹲", sets: 4, mode: "reps", amount: 8, restSec: 90, weightKg: 80 }],
  }
}

function done(over: Partial<SetRecord> = {}): SetRecord {
  return {
    moveId: "squat",
    name: "深蹲",
    setIndex: 3,
    mode: "reps",
    plannedWeight: 80,
    plannedAmount: 8,
    restSec: 90,
    actualWeight: 80,
    actualAmount: 6,
    completed: true,
    skipped: false,
    modified: true,
    source: "user_entered",
    timestamp: "2026-10-07T00:00:00.000Z",
    ...over,
  }
}

test("a set keeps the plan when the actual reps are lower", () => {
  const plan = session()
  const before = structuredClone(plan)
  const slot = emptySets(plan)[2]
  recordSet(plan.id, "d1", { ...slot, actualWeight: 80, actualAmount: 6, completed: true, modified: true, source: "user_entered", timestamp: "2026-10-07T00:00:00.000Z" })
  assert.deepEqual(plan, before)
  const saved = executionOf(plan.id).sets[0]
  assert.equal(saved.plannedAmount, 8)
  assert.equal(saved.actualAmount, 6)
})

test("eight planned and six actual is minus two reps and 75 percent", () => {
  const gap = deviationOf(done())
  assert.equal(gap.weightKg, 0)
  assert.equal(gap.amount, -2)
  assert.equal(gap.completion, 75)
})

test("a lighter completed set keeps the rep count and lowers the load", () => {
  const gap = deviationOf(done({ setIndex: 1, actualWeight: 75, actualAmount: 8, modified: true }))
  assert.equal(gap.weightKg, -5)
  assert.equal(gap.amount, 0)
  assert.equal(gap.completion, 94)
})

test("a skipped set stays in the session", () => {
  const plan = session()
  const slots = emptySets(plan)
  recordSet(plan.id, "d1", { ...slots[2], skipped: true, completed: false, timestamp: "2026-10-07T00:00:00.000Z" })
  const saved = executionOf(plan.id).sets
  assert.equal(saved.length, 1)
  assert.equal(saved[0].skipped, true)
  assert.equal(mergeSets(slots, saved).length, 4)
})

test("stopping keeps the finished sets and does not complete the session", () => {
  const plan = session()
  startTraining({ decisionId: "d1", sessionId: plan.id, action: "ORIGINAL_PLAN" })
  recordSet(plan.id, "d1", { ...emptySets(plan)[0], completed: true, actualWeight: 80, actualAmount: 8, source: "user_confirmed_plan", timestamp: "2026-10-07T00:00:00.000Z" })
  interruptTraining("d1", plan.id)
  const state = executionOf(plan.id)
  assert.equal(state.open, false)
  assert.equal(state.sets.length, 1)
  assert.equal(state.sets[0].completed, true)
  assert.equal(loadEvents().some((event) => event.event_type === "TRAINING_COMPLETED"), false)
  assert.equal(loadEvents().some((event) => event.event_type === "TRAINING_INTERRUPTED"), true)
})

test("finishing writes TRAINING_COMPLETED and a short set does not change ability", () => {
  const plan = session()
  startTraining({ decisionId: "d1", sessionId: plan.id, action: "ORIGINAL_PLAN" })
  const before = readEnvelope("fr255-memory-v1", { ability: "same" }).data
  recordSet(plan.id, "d1", done())
  completeTraining({ decisionId: "d1", sessionId: plan.id, planned: null, actualSets: 1, actualAmount: 6, actualWeightKg: 80, rpe: null, pain: false, modified: true, interrupted: false })
  assert.equal(loadEvents().some((event) => event.event_type === "TRAINING_COMPLETED"), true)
  assert.deepEqual(readEnvelope("fr255-memory-v1", { ability: "same" }).data, before)
  assert.equal(outcomeReason({ pain: true, stated: null }), "疼痛")
  assert.equal(outcomeReason({ pain: false, stated: null }), "Unknown")
  assert.equal(mainDeviation([done()]).includes("少 2"), true)
})

test("rest reaches zero only after the full time", () => {
  assert.equal(restLeft(90, 0), 90)
  assert.equal(restLeft(90, 18_000), 72)
  assert.equal(restLeft(90, 90_000), 0)
})

test("an open session can be rebuilt after the sets were stored", () => {
  const plan = session()
  startTraining({ decisionId: "d1", sessionId: plan.id, action: "ORIGINAL_PLAN" })
  recordSet(plan.id, "d1", { ...emptySets(plan)[0], completed: true, actualWeight: 80, actualAmount: 8, source: "user_confirmed_plan", timestamp: "2026-10-07T00:00:00.000Z" })
  recordSet(plan.id, "d1", { ...emptySets(plan)[1], completed: true, actualWeight: 80, actualAmount: 7, source: "user_entered", modified: true, timestamp: "2026-10-07T00:01:00.000Z" })
  const state = executionOf(plan.id)
  assert.equal(state.open, true)
  assert.equal(mergeSets(emptySets(plan), state.sets).filter((set) => !set.completed && !set.skipped)[0].setIndex, 3)
})

test("missing actual numbers stay unknown and a current-set edit is not the plan", () => {
  const gap = deviationOf(done({ actualWeight: null, actualAmount: null, completed: false, modified: false, source: null }))
  assert.equal(gap.weightKg, null)
  assert.equal(gap.completion, null)
  const plan = session()
  const logged = mergeSets(emptySets(plan), [done({ setIndex: 1, actualWeight: 75 })])
  assert.equal(plan.moves[0].weightKg, 80)
  assert.equal(logged[0].actualWeight, 75)
  assert.equal(totalsOf([done({ actualAmount: null, actualWeight: null, completed: true, source: null })]).actual, null)
})

test("pausing rest keeps the same second and continuing moves it down by one", () => {
  assert.deepEqual(stepRest(75, false), { seconds: 75, running: false })
  assert.deepEqual(stepRest(75, true), { seconds: 74, running: true })
  assert.deepEqual(stepRest(1, true), { seconds: 0, running: false })
})

test("each set line labels weight and reps as actual minus plan", () => {
  const sameReps = setLine(done({ plannedWeight: 80, plannedAmount: 8, actualWeight: 75, actualAmount: 8 }))
  assert.equal(sameReps.gap, "重量 -5 kg · 次数 0 次")
  const heavier = setLine(done({ plannedWeight: 8, plannedAmount: 8, actualWeight: 75, actualAmount: 8 }))
  assert.equal(heavier.gap, "重量 +67 kg · 次数 0 次")
  assert.equal(heavier.gap.includes("/"), false)
  const fewer = setLine(done({ plannedWeight: 8, plannedAmount: 8, actualWeight: 8, actualAmount: 6 }))
  assert.equal(fewer.gap, "重量 0 kg · 次数 -2 次")
  assert.equal(fewer.state, "已修改")
  const confirmed = setLine(done({ actualWeight: 80, actualAmount: 8, modified: false, source: "user_confirmed_plan" }))
  assert.equal(confirmed.gap, "重量 0 kg · 次数 0 次")
  assert.equal(confirmed.state, "按计划确认")
  const skipped = setLine(done({ completed: false, skipped: true, actualWeight: null, actualAmount: null, modified: false, source: null }))
  assert.equal(skipped.state, "跳过")
  assert.equal(skipped.actual, "跳过")
  assert.equal(skipped.gap, "")
  assert.equal(`${skipped.actual} ${skipped.gap}`.includes("0 × 0"), false)
  assert.equal(`${skipped.actual} ${skipped.gap}`.includes("0 kg"), false)
})

test("feedback is stored without replacing the completed set", () => {
  const plan = session()
  recordSet(plan.id, "d1", done())
  dispatchEvent("SUBJECTIVE_FEEDBACK", { sessionId: plan.id, text: "刚好" })
  assert.equal(feedbackOf(plan.id), "刚好")
  assert.equal(executionOf(plan.id).sets[0]?.actualAmount, 6)
  assert.equal(plan.moves[0]?.weightKg, 80)
})
