import assert from "node:assert/strict"
import test from "node:test"
import { acceptIssued, buildCandidates, filterTrainingCandidates, issueTrainingDecision, outcomeFeedback, overrideIssued, publishFromContext, rejectIssued } from "./brain-loop.ts"
import { loadDecisions } from "./decisions.ts"
import { dispatchEvent, loadEvents } from "./events.ts"
import { readEnvelope, setStoreBackend, writeEnvelope, type MemoryStore } from "./storage.ts"
import { completeTraining, type TrainingContext } from "./training-decision.ts"
import type { AthleteState } from "./types.ts"

function memory(): MemoryStore {
  const dump = new Map<string, string>()
  return { keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => dump.set(key, value) }
}

function ctx(partial: Partial<TrainingContext> = {}): TrainingContext {
  return {
    fatigue: 20,
    pain: false,
    rehab: false,
    sleepHours: null,
    recentRunKm: null,
    recentRunRpe: null,
    daysToCompetition: null,
    week: 2,
    bias: "build",
    previousFeel: null,
    facts: 3,
    ...partial,
  }
}

const planned = { name: "深蹲", sets: 4, amount: 8, weightKg: 60 }

function gaps(): string[] {
  return ["HRV 未记录，无法使用 HRV 判断恢复状态。", "RPE 未记录。", "当前证据不足以判断耐力变化。"]
}

test("ready state keeps the plan and does not require confirmation", () => {
  setStoreBackend(memory())
  const decision = publishFromContext(ctx(), planned, gaps())
  assert.equal(decision?.decision_type, "KEEP_PLAN")
  assert.equal(decision?.required_confirmation, false)
  assert.equal(decision?.recommended_action.weightKg, 60)
  assert.equal(String(decision?.reasoning).includes("HRV 很低"), false)
  assert.equal(decision?.counter_evidence.includes("HRV 未记录，无法使用 HRV 判断恢复状态。"), true)
  assert.equal(decision?.expected_outcome.includes("不是已经发生"), true)
  setStoreBackend(null)
})

test("high fatigue suggests less volume and does not write the plan", () => {
  const store = memory()
  setStoreBackend(store)
  store.setItem("fr255-strength-plan-v3", "{\"name\":\"keep\"}")
  const decision = publishFromContext(ctx({ fatigue: 80 }), planned, gaps())
  assert.equal(decision?.decision_type, "REDUCE_VOLUME")
  assert.equal(decision?.required_confirmation, true)
  assert.equal(Number(decision?.recommended_action.sets) < 4, true)
  assert.equal(decision?.recommended_action.weightKg, 60)
  const accepted = acceptIssued(decision!.decision_id)
  assert.equal(accepted.ok, true)
  assert.equal(store.getItem("fr255-strength-plan-v3"), "{\"name\":\"keep\"}")
  assert.equal(loadEvents().some((event) => event.event_type === "USER_ACCEPTED"), true)
  assert.equal(loadEvents().some((event) => event.event_type === "TRAINING_MODIFIED"), true)
  assert.equal(loadDecisions().some((item) => item.decision_id === decision?.decision_id), true)
  setStoreBackend(null)
})

test("pain does not increase load and does not invent a diagnosis", () => {
  setStoreBackend(memory())
  const decision = publishFromContext(ctx({ pain: true, fatigue: 20 }), planned, gaps())
  assert.equal(decision?.decision_type, "RECOVERY_SESSION")
  assert.equal(decision?.recommended_action.weightKg, 60)
  assert.equal(Number(decision?.recommended_action.sets) <= 4, true)
  assert.equal(String(decision?.reasoning).includes("不诊断"), true)
  assert.equal(String(decision?.reasoning).includes("肌腱"), false)
  const types = buildCandidates(ctx({ pain: true }), planned, []).map((item) => item.decisionType)
  assert.equal(types.includes("INCREASE_VOLUME"), false)
  setStoreBackend(null)
})

test("a near competition does not become more load", () => {
  setStoreBackend(memory())
  const decision = publishFromContext(ctx({ daysToCompetition: 10, fatigue: 20 }), planned, gaps())
  assert.equal(decision?.decision_type === "KEEP_PLAN" || decision?.decision_type === "REDUCE_VOLUME", true)
  assert.equal(decision?.recommended_action.weightKg, 60)
  assert.equal(Number(decision?.recommended_action.sets) <= 4, true)
  setStoreBackend(null)
})

test("an increase candidate is removed when fatigue or pain is present", () => {
  const increase = buildCandidates(ctx(), planned, [])[0]
  increase.decisionType = "INCREASE_VOLUME"
  assert.equal(filterTrainingCandidates([increase], ctx({ fatigue: 80 }), planned).length, 0)
  assert.equal(filterTrainingCandidates([increase], ctx({ pain: true }), planned).length, 0)
})

test("an expired decision cannot be executed", () => {
  const store = memory()
  setStoreBackend(store)
  store.setItem("fr255-strength-plan-v3", "plan")
  const decision = publishFromContext(ctx({ fatigue: 80 }), planned, gaps())
  const saved = loadDecisions()
  saved[0].expiry = new Date(Date.now() - 1000).toISOString()
  writeEnvelope("fr255-decisions-v1", saved)
  const result = acceptIssued(decision!.decision_id)
  assert.equal(result.ok, false)
  assert.equal(loadEvents().some((event) => event.event_type === "AI_DECISION_EXPIRED"), true)
  assert.equal(store.getItem("fr255-strength-plan-v3"), "plan")
  setStoreBackend(null)
})

test("override keeps the original decision", () => {
  setStoreBackend(memory())
  const decision = publishFromContext(ctx({ fatigue: 80 }), planned, gaps())
  overrideIssued(decision!.decision_id, "今天只做两组")
  const stored = loadDecisions().find((item) => item.decision_id === decision?.decision_id)
  assert.equal(stored?.decision_type, "REDUCE_VOLUME")
  assert.equal(stored?.status, "MODIFIED")
  const event = loadEvents().find((item) => item.event_type === "USER_OVERRIDDEN")
  assert.equal((event?.payload as { originalValue?: string }).originalValue?.includes("建议"), true)
  assert.equal((event?.payload as { newValue?: string }).newValue, "今天只做两组")
  setStoreBackend(null)
})

test("rejecting a suggestion does not remove it", () => {
  setStoreBackend(memory())
  const decision = publishFromContext(ctx({ fatigue: 80 }), planned, gaps())
  rejectIssued(decision!.decision_id)
  assert.equal(loadDecisions().some((item) => item.decision_id === decision?.decision_id && item.status === "REJECTED"), true)
  assert.equal(loadEvents().some((event) => event.event_type === "USER_REJECTED"), true)
  setStoreBackend(null)
})

test("one completed session does not change ability", () => {
  setStoreBackend(memory())
  writeEnvelope("fr255-memory-v1", { notes: [], learning: [], ability: { aerobic: 82 } })
  const decision = publishFromContext(ctx(), planned, gaps())
  completeTraining({
    decisionId: decision!.decision_id,
    sessionId: "s1",
    planned,
    actualSets: 4,
    actualAmount: 6,
    actualWeightKg: 60,
    rpe: null,
    pain: false,
    modified: true,
    interrupted: false,
  })
  const text = outcomeFeedback(decision!.decision_id)
  assert.equal(text?.includes("RPE 未记录"), true)
  assert.equal(text?.includes("一次训练不改变长期能力"), true)
  assert.equal(text?.includes("耐力下降"), false)
  const ability = readEnvelope<{ ability?: { aerobic?: number } }>("fr255-memory-v1", {}).data.ability?.aerobic
  assert.equal(ability, 82)
  setStoreBackend(null)
})

test("issuing twice reuses the open decision", () => {
  const store = memory()
  setStoreBackend(store)
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true })
  const plan = { name: "下肢", sessions: [{ id: "s1", name: "下肢", moves: [{ id: "squat", catalogId: null, customName: "深蹲", sets: 4, mode: "reps" as const, amount: 8, restSec: 90, weightKg: 60 }] }] }
  const first = issueTrainingDecision(plan, null)
  const second = issueTrainingDecision(plan, null)
  assert.equal(first?.decision_id, second?.decision_id)
  setStoreBackend(null)
})

function countEvents(type: string, id: string) {
  return loadEvents().filter((event) => event.event_type === type && ((event.payload as { decisionId?: string }).decisionId === id || (event.payload as { decision_id?: string }).decision_id === id)).length
}

const planShape = { name: "下肢", sessions: [{ id: "s1", name: "下肢", moves: [{ id: "squat", catalogId: null, customName: "深蹲", sets: 4, mode: "reps" as const, amount: 8, restSec: 90, weightKg: 60 }] }] }

test("clicking accept twice records one execution and does not drop another set", () => {
  const store = memory()
  setStoreBackend(store)
  store.setItem("fr255-strength-plan-v3", "schedule")
  const decision = publishFromContext(ctx({ fatigue: 80 }), planned, gaps())
  const sets = decision?.recommended_action.sets
  acceptIssued(decision!.decision_id)
  acceptIssued(decision!.decision_id)
  acceptIssued(decision!.decision_id)
  assert.equal(countEvents("USER_ACCEPTED", decision!.decision_id), 1)
  assert.equal(countEvents("TRAINING_MODIFIED", decision!.decision_id), 1)
  assert.equal(loadDecisions().find((item) => item.decision_id === decision?.decision_id)?.recommended_action.sets, sets)
  assert.equal(store.getItem("fr255-strength-plan-v3"), "schedule")
  setStoreBackend(null)
})

test("an accept that stopped after the event does not run again", () => {
  const store = memory()
  setStoreBackend(store)
  store.setItem("fr255-strength-plan-v3", "schedule")
  const decision = publishFromContext(ctx({ fatigue: 80 }), planned, gaps())
  dispatchEvent("USER_ACCEPTED", { decisionId: decision!.decision_id })
  acceptIssued(decision!.decision_id)
  acceptIssued(decision!.decision_id)
  assert.equal(countEvents("USER_ACCEPTED", decision!.decision_id), 1)
  assert.equal(countEvents("TRAINING_MODIFIED", decision!.decision_id), 1)
  assert.equal(loadDecisions().find((item) => item.decision_id === decision?.decision_id)?.status, "EXECUTED")
  assert.equal(store.getItem("fr255-strength-plan-v3"), "schedule")
  setStoreBackend(null)
})

test("reject stays rejected after another look and does not change the plan", () => {
  const store = memory()
  setStoreBackend(store)
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true })
  store.setItem("fr255-strength-plan-v3", "schedule")
  const decision = publishFromContext(ctx({ fatigue: 80 }), planned, gaps())
  rejectIssued(decision!.decision_id)
  rejectIssued(decision!.decision_id)
  const again = issueTrainingDecision(planShape, null)
  assert.equal(again?.decision_id, decision?.decision_id)
  assert.equal(again?.status, "REJECTED")
  assert.equal(countEvents("USER_REJECTED", decision!.decision_id), 1)
  assert.equal(countEvents("TRAINING_MODIFIED", decision!.decision_id), 0)
  assert.equal(countEvents("USER_ACCEPTED", decision!.decision_id), 0)
  assert.equal(store.getItem("fr255-strength-plan-v3"), "schedule")
  setStoreBackend(null)
})

test("a modification keeps the original advice and does not execute it twice", () => {
  const store = memory()
  setStoreBackend(store)
  store.setItem("fr255-strength-plan-v3", "schedule")
  const decision = publishFromContext(ctx({ fatigue: 80 }), planned, gaps())
  const reasoning = decision?.reasoning
  const sets = decision?.recommended_action.sets
  overrideIssued(decision!.decision_id, "今天只做两组")
  overrideIssued(decision!.decision_id, "再改一次")
  const stored = loadDecisions().find((item) => item.decision_id === decision?.decision_id)
  assert.equal(stored?.reasoning, reasoning)
  assert.equal(stored?.recommended_action.sets, sets)
  assert.equal(stored?.status, "MODIFIED")
  assert.equal(countEvents("USER_OVERRIDDEN", decision!.decision_id), 1)
  acceptIssued(decision!.decision_id)
  assert.equal(countEvents("USER_ACCEPTED", decision!.decision_id), 0)
  assert.equal(countEvents("TRAINING_MODIFIED", decision!.decision_id), 0)
  assert.equal(store.getItem("fr255-strength-plan-v3"), "schedule")
  setStoreBackend(null)
})

test("an expired decision stays expired when opened again", () => {
  const store = memory()
  setStoreBackend(store)
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true })
  store.setItem("fr255-strength-plan-v3", "schedule")
  const decision = publishFromContext(ctx({ fatigue: 80 }), planned, gaps())
  const saved = loadDecisions()
  saved[0].expiry = new Date(Date.now() - 1000).toISOString()
  writeEnvelope("fr255-decisions-v1", saved)
  acceptIssued(decision!.decision_id)
  acceptIssued(decision!.decision_id)
  const again = issueTrainingDecision(planShape, null)
  assert.equal(again?.decision_id, decision?.decision_id)
  assert.equal(again?.status, "EXPIRED")
  assert.equal(countEvents("USER_ACCEPTED", decision!.decision_id), 0)
  assert.equal(countEvents("AI_DECISION_EXPIRED", decision!.decision_id), 1)
  assert.equal(store.getItem("fr255-strength-plan-v3"), "schedule")
  setStoreBackend(null)
})

test("an older suggestion cannot run after a newer one exists", () => {
  const store = memory()
  setStoreBackend(store)
  store.setItem("fr255-strength-plan-v3", "schedule")
  const older = publishFromContext(ctx({ fatigue: 80 }), planned, gaps())
  const newer = publishFromContext(ctx({ fatigue: 20 }), planned, gaps())
  assert.equal(acceptIssued(older!.decision_id).ok, false)
  assert.equal(countEvents("USER_ACCEPTED", older!.decision_id), 0)
  assert.equal(acceptIssued(newer!.decision_id).ok, true)
  assert.equal(acceptIssued(newer!.decision_id).ok, true)
  assert.equal(countEvents("USER_ACCEPTED", newer!.decision_id), 1)
  assert.equal(store.getItem("fr255-strength-plan-v3"), "schedule")
  setStoreBackend(null)
})

test("accept then reopen does not ask again or change ability", () => {
  const store = memory()
  setStoreBackend(store)
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true })
  store.setItem("fr255-strength-plan-v3", "schedule")
  writeEnvelope("fr255-memory-v1", { notes: [], learning: [], ability: { aerobic: 82 } })
  const decision = publishFromContext(ctx({ fatigue: 80 }), planned, gaps())
  acceptIssued(decision!.decision_id)
  const again = issueTrainingDecision(planShape, null)
  assert.equal(again?.decision_id, decision?.decision_id)
  assert.equal(again?.status, "EXECUTED")
  acceptIssued(decision!.decision_id)
  assert.equal(countEvents("USER_ACCEPTED", decision!.decision_id), 1)
  assert.equal(readEnvelope<{ ability?: { aerobic?: number } }>("fr255-memory-v1", {}).data.ability?.aerobic, 82)
  assert.equal(store.getItem("fr255-strength-plan-v3"), "schedule")
  setStoreBackend(null)
})

