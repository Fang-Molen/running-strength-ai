import assert from "node:assert/strict"
import test from "node:test"
import { abilityUnchangedBySession } from "./state.ts"
import { confirmDraft, createDraft, executeDecision, recordOverride, requestDecision } from "./control.ts"
import { parseRunUtterance, prefillRun } from "./drafts.ts"
import { dispatchEvent, loadEvents } from "./events.ts"
import { runMigrations } from "./migrate.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"

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

test("run sentence stays a draft until something else confirms it", () => {
  setStoreBackend(memory())
  const parsed = parseRunUtterance("今天跑8公里，45分钟，RPE9")
  assert.equal(parsed.distanceKm, 8)
  assert.equal(parsed.durationSec, 2700)
  assert.equal(parsed.rpe, 9)
  const draft = prefillRun("今天跑8公里，45分钟，RPE9")
  assert.equal(draft.confirmed, false)
  assert.equal(loadEvents().some((event) => event.event_type === "RUN_COMPLETED"), false)
})

test("confirmed run is an event with an id, and a broken store does not throw", () => {
  setStoreBackend(memory())
  const event = dispatchEvent("RUN_COMPLETED", { km: 7.8 })
  assert.ok(event)
  assert.equal(event?.schema_version, 1)
  assert.equal(loadEvents().length, 1)
  setStoreBackend({
    getItem: () => null,
    setItem: () => {
      throw new Error("full")
    },
  })
  assert.equal(dispatchEvent("RUN_COMPLETED", { km: 1 }), null)
})

test("migration does not rewrite the existing plan key", () => {
  const box = memory()
  setStoreBackend(box)
  runMigrations()
  runMigrations()
  assert.equal(box.dump.has("fr255-strength-plan-v3"), false)
  assert.equal(box.dump.has("fr255-food-log-v1"), false)
  setStoreBackend(null)
})

test("a run sentence is not a fact until confirm, then state can rebuild", () => {
  const box = memory()
  setStoreBackend(box)
  const draft = createDraft("今天跑8公里，45分钟，RPE9")
  assert.equal(loadEvents().some((event) => event.event_type === "RUN_COMPLETED"), false)
  const event = confirmDraft(draft, { km: 7.8, seconds: 2700, note: "轻松跑", rpe: 9 })
  assert.equal(event?.event_type, "RUN_COMPLETED")
  assert.equal(box.dump.has("fr255-strength-plan-v3"), false)
  assert.equal(box.dump.has("fr255-food-log-v1"), false)
  assert.equal(box.dump.has("fr255-body-v1"), false)
  setStoreBackend(null)
})

test("one easy run does not lower ability", () => {
  const ability = abilityUnchangedBySession({
    speed: 80,
    aerobic: 82,
    strength: 70,
    power: null,
    endurance: 75,
    runningEconomy: null,
    sportSpecificAbility: null,
    limiter: null,
    confidence: 0.4,
  })
  assert.equal(ability.aerobic, 82)
  assert.equal(ability.speed, 80)
})

test("high fatigue and pain cannot increase load, and profile is not overwritten", () => {
  setStoreBackend(memory())
  const heavy = requestDecision({ decisionType: "LOAD", recommended: { setsDelta: 1 }, fatigue: 80 })
  assert.equal(heavy?.safety_status, "BLOCKED")
  assert.equal(executeDecision(heavy!.decision_id, true).ok, false)
  const pain = requestDecision({ decisionType: "LOAD", recommended: { setsDelta: 1 }, pain: true })
  assert.equal(pain?.risk, "CRITICAL")
  assert.equal(executeDecision(pain!.decision_id, true).ok, false)
  const profile = requestDecision({ decisionType: "PROFILE_UPDATE", recommended: { weightKg: 60 } })
  assert.equal(executeDecision(profile!.decision_id, true).ok, false)
  setStoreBackend(null)
})

test("override keeps the original and the new value", () => {
  setStoreBackend(memory())
  recordOverride({ originalValue: "8公里", newValue: "10公里", reason: "FEELING_GOOD", risk: "MODERATE", decisionId: "dec-1", overridden: true })
  const event = loadEvents().find((item) => item.event_type === "USER_OVERRIDDEN")
  assert.equal((event?.payload as { originalValue: string }).originalValue, "8公里")
  assert.equal((event?.payload as { newValue: string }).newValue, "10公里")
  setStoreBackend(null)
})

