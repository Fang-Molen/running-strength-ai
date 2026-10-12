import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_SPORT_GOAL,
  SPORT_GOAL_KEY,
  homeVariant,
  loadSportGoal,
  normalizeSportGoal,
  saveSportGoal,
} from "./sport-goal.ts"

function memory() {
  const data = new Map<string, string>()
  return {
    data,
    keys:()=>[...data.keys()], getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

test("missing or corrupt preference falls back to track without touching other keys", () => {
  const store = memory()
  store.setItem("fr255-events-v1", "keep-events")
  store.setItem("fr255-strength-plan-v3", "keep-plan")
  store.setItem("fr255-body-v1", "keep-body")
  assert.deepEqual(loadSportGoal(store), DEFAULT_SPORT_GOAL)
  assert.equal(homeVariant(loadSportGoal(store)), "track")
  store.setItem(SPORT_GOAL_KEY, "{not-json")
  assert.deepEqual(loadSportGoal(store), DEFAULT_SPORT_GOAL)
  store.setItem(SPORT_GOAL_KEY, JSON.stringify({ version: 1, sport: "other", primaryGoal: "fat-loss" }))
  assert.deepEqual(loadSportGoal(store), DEFAULT_SPORT_GOAL)
  assert.equal(store.getItem("fr255-events-v1"), "keep-events")
  assert.equal(store.getItem("fr255-strength-plan-v3"), "keep-plan")
  assert.equal(store.getItem("fr255-body-v1"), "keep-body")
  assert.equal(store.getItem(SPORT_GOAL_KEY)?.includes("other"), true)
})

test("primary and secondary goals persist and an identical secondary is dropped", () => {
  const store = memory()
  const saved = saveSportGoal({ version: 1, sport: "track", primaryGoal: "fat-loss", secondaryGoal: "fitness" }, store)
  assert.equal(saved, true)
  assert.deepEqual(loadSportGoal(store), { version: 1, sport: "track", primaryGoal: "fat-loss", secondaryGoal: "fitness" })
  assert.equal(homeVariant(loadSportGoal(store)), "fat-loss")
  assert.equal(saveSportGoal({ version: 1, sport: "strength", primaryGoal: "muscle", secondaryGoal: "muscle" }, store), true)
  assert.equal(loadSportGoal(store).secondaryGoal, null)
  assert.equal(homeVariant(loadSportGoal(store)), "muscle")
})

test("switching the preference does not rewrite training, body, or event records", () => {
  const store = memory()
  store.setItem("fr255-events-v1", "events")
  store.setItem("fr255-strength-plan-v3", "plan")
  store.setItem("fr255-body-v1", "body")
  store.setItem("fr255-food-log-v1", "food")
  assert.equal(saveSportGoal({ version: 1, sport: "conditioning", primaryGoal: "performance", secondaryGoal: "strength" }, store), true)
  assert.equal(homeVariant(loadSportGoal(store)), "conditioning")
  assert.equal(saveSportGoal({ version: 1, sport: "track", primaryGoal: "performance", secondaryGoal: null }, store), true)
  assert.equal(homeVariant(loadSportGoal(store)), "track")
  assert.equal(store.getItem("fr255-events-v1"), "events")
  assert.equal(store.getItem("fr255-strength-plan-v3"), "plan")
  assert.equal(store.getItem("fr255-body-v1"), "body")
  assert.equal(store.getItem("fr255-food-log-v1"), "food")
  assert.equal(normalizeSportGoal({ version: 2, sport: "track", primaryGoal: "performance" }), null)
})

test("home follows the primary goal and sport without inventing a fourth prescription", () => {
  assert.equal(homeVariant({ version: 1, sport: "track", primaryGoal: "performance", secondaryGoal: "fat-loss" }), "track")
  assert.equal(homeVariant({ version: 1, sport: "track", primaryGoal: "fitness", secondaryGoal: null }), "track")
  assert.equal(homeVariant({ version: 1, sport: "strength", primaryGoal: "performance", secondaryGoal: null }), "muscle")
  assert.equal(homeVariant({ version: 1, sport: "conditioning", primaryGoal: "strength", secondaryGoal: null }), "muscle")
  assert.equal(homeVariant({ version: 1, sport: "conditioning", primaryGoal: "fitness", secondaryGoal: null }), "conditioning")
})
