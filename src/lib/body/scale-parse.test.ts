import test from "node:test"; import assert from "node:assert/strict";
import { parseScaleText, fromJson } from "./scale-parse.ts";
test("app screenshot text", () => { const r = parseScaleText("2026-10-16 07:32\n体重 56.4kg\n体脂率 18.8%\n肌肉量 43.3kg\n双臂肌肉 4.9kg\n躯干肌肉 21.2kg\n双腿肌肉 15.1kg\n内脏脂肪等级 6\n水分 56.2%\n骨量 2.6kg\n基础代谢 1494kcal");
  assert.deepEqual(r.values, { weight: 56.4, fat: 18.8, muscle: 43.3, armMuscle: 4.9, trunkMuscle: 21.2, legMuscle: 15.1, visceral: 6, waterRate: 56.2, boneMass: 2.6, bmr: 1494 }); assert.equal(r.date, "2026-10-16"); assert.deepEqual(r.suspicious, []); });
test("missing stay absent, 斤 converted, suspicious flagged", () => { const r = parseScaleText("体重\n112.8斤\n体脂率 85%"); assert.equal(r.values.weight, 56.4); assert.equal(r.values.muscle, undefined); assert.deepEqual(r.suspicious, ["fat"]); });
test("muscle rate is not muscle mass", () => { assert.equal(parseScaleText("肌肉率 76.8%").values.muscle, undefined); });
test("json normalise", () => { const r = fromJson({ weight: "56.4", fat: null, bmr: 1494, foo: 1, date: "2026-10-16" }); assert.deepEqual(r.values, { weight: 56.4, bmr: 1494 }); assert.equal(r.date, "2026-10-16"); });
