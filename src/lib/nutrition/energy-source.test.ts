import assert from "node:assert/strict";
import test from "node:test";
import { energyBasis } from "./energy-source.ts";

test("device total is never augmented by workout expenditure", () => {
  const result = energyBasis(2500, 2600, 2900);
  assert.equal(result.source, "DEVICE_TOTAL");
  assert.equal(result.targetKcal, 2800);
  assert.equal(result.totalDailyKcal, 2900);
  assert.equal(result.trainingKcalIncluded, true);
});

test("missing total preserves estimated target and missing data", () => {
  const result = energyBasis(2500, 2600, null);
  assert.equal(result.source, "PROFILE_ESTIMATE");
  assert.equal(result.targetKcal, 2500);
  assert.equal(result.totalDailyKcal, null);
  assert.equal(result.trainingKcalIncluded, false);
});

test("no profile does not invent a nutritional target", () => {
  assert.equal(energyBasis(null, null, 2300).targetKcal, null);
  assert.equal(energyBasis(null, null, null).targetKcal, null);
});
