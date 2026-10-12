import assert from "node:assert/strict"
import test from "node:test"
import { serviceWorkerNavigationPlan, trainingExecutionOpen } from "./sw-reload.ts"

test("an open training blocks the service worker reload and a finished one does not", () => {
  const events = [
    { event_type: "TRAINING_STARTED", payload: { sessionId: "day-1" } },
    { event_type: "TRAINING_SET_COMPLETED", payload: { sessionId: "day-1" } },
  ]
  assert.equal(trainingExecutionOpen(events), true)
  assert.deepEqual(serviceWorkerNavigationPlan({ hasController: false, alreadyReloaded: false, trainingOpen: true }), { reload: false, prefetch: false })
  assert.deepEqual(serviceWorkerNavigationPlan({ hasController: true, alreadyReloaded: false, trainingOpen: true }), { reload: false, prefetch: true })
  const closed = [...events, { event_type: "TRAINING_COMPLETED", payload: { sessionId: "day-1" } }]
  assert.equal(trainingExecutionOpen(closed), false)
  assert.deepEqual(serviceWorkerNavigationPlan({ hasController: false, alreadyReloaded: false, trainingOpen: false }), { reload: true, prefetch: false })
})

test("a second start reopens training and an interrupted session can reload later", () => {
  const again = [
    { event_type: "TRAINING_STARTED", payload: { sessionId: "day-1" } },
    { event_type: "TRAINING_COMPLETED", payload: { sessionId: "day-1" } },
    { event_type: "TRAINING_STARTED", payload: { sessionId: "day-1" } },
  ]
  assert.equal(trainingExecutionOpen(again), true)
  assert.equal(trainingExecutionOpen([
    { event_type: "TRAINING_STARTED", payload: { sessionId: "day-2" } },
    { event_type: "TRAINING_INTERRUPTED", payload: { sessionId: "day-2" } },
  ]), false)
})

test("an update does not reload, and the one-time first load does not repeat", () => {
  assert.deepEqual(serviceWorkerNavigationPlan({ hasController: true, alreadyReloaded: false, trainingOpen: false }), { reload: false, prefetch: true })
  assert.deepEqual(serviceWorkerNavigationPlan({ hasController: false, alreadyReloaded: true, trainingOpen: false }), { reload: false, prefetch: false })
})
