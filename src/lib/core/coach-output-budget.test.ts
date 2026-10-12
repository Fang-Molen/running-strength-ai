import assert from "node:assert/strict"
import test from "node:test"
import { coachMaxTokens } from "./coach-output-budget.ts"

test("return answers use a shorter output budget than a three-point series", () => {
  assert.equal(coachMaxTokens("candidate-route", "RETURN"), 220)
  assert.equal(coachMaxTokens("formal-series", "SERIES"), 320)
  assert.ok(coachMaxTokens("formal-series", "RETURN") >= 320)
  assert.equal(coachMaxTokens("formal-compare", "COMPARE"), 300)
  assert.equal(coachMaxTokens("candidate-route", "NEXT_SESSION"), 240)
  assert.equal(coachMaxTokens("candidate-route", "FUEL"), 220)
  assert.equal(coachMaxTokens("candidate-route", "GENERAL"), 260)
})
