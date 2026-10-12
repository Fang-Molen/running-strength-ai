import assert from "node:assert/strict"
import test from "node:test"
import { readCoachOpenView } from "./coach-open.ts"
import { issueTrainingDecision, rejectIssued } from "./brain-loop.ts"
import { loadDecisions } from "./decisions.ts"
import { dispatchEvent, loadEvents } from "./events.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"

function memory(): MemoryStore & { dump: Map<string, string> } {
  const dump = new Map<string, string>()
  return { dump, keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

const plan = { name: "下肢", sessions: [{ id: "s1", name: "下肢", moves: [{ id: "squat", catalogId: null, customName: "深蹲", sets: 4, mode: "reps" as const, amount: 8, restSec: 90, weightKg: 60 }] }] }

test("opening coach view reads existing state without creating decisions or refreshing storage", () => {
  const store = memory()
  setStoreBackend(store)
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true })
  const before = [...store.dump]
  const view = readCoachOpenView()
  assert.equal(view.inbox, null)
  assert.equal(view.pending, null)
  assert.equal(view.completedDecisionId, null)
  assert.equal(view.athlete.recovery.fatigueScore, null)
  assert.equal(view.athlete.recovery.recoveryStatus, "未知")
  assert.equal(view.athlete.uncertainty.missingData.some((item) => item.includes("疼痛未记录")), true)
  assert.equal(view.athlete.uncertainty.missingData.some((item) => item.includes("默认值不是恢复证据")), true)
  assert.deepEqual([...store.dump], before)
  assert.equal(loadEvents().length, 0)
  assert.equal(loadDecisions().length, 0)

  const issued = issueTrainingDecision(plan, view.athlete)
  assert.ok(issued)
  assert.equal(loadEvents().filter((event) => event.event_type === "AI_DECISION_CREATED").length, 1)
  const afterIssue = [...store.dump]
  assert.equal(readCoachOpenView().inbox?.decision_id, issued.decision_id)
  assert.deepEqual([...store.dump], afterIssue)
  assert.equal(issueTrainingDecision(plan, view.athlete)?.decision_id, issued.decision_id)
  assert.equal(loadEvents().filter((event) => event.event_type === "AI_DECISION_CREATED").length, 1)
  rejectIssued(issued.decision_id)
  const settled = [...store.dump]
  assert.equal(readCoachOpenView().inbox?.status, "REJECTED")
  assert.deepEqual([...store.dump], settled)
  setStoreBackend(null)
})

test("opening a completed training does not silently record outcome learning", () => {
  const store = memory()
  setStoreBackend(store)
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true })
  dispatchEvent("TRAINING_COMPLETED", { decisionId: "d1", setsPlanned: 4, setsCompleted: 3 })
  const before = [...store.dump]
  const view = readCoachOpenView()
  assert.equal(view.completedDecisionId, "d1")
  assert.deepEqual([...store.dump], before)
  assert.equal(store.getItem("fr255-memory-v1"), null)
  setStoreBackend(null)
})
