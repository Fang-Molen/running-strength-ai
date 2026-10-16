import test from "node:test"
import assert from "node:assert/strict"
import { aggregate, nutrientOf, type FoodEntry } from "./log.ts"
const base = { date: "2026-10-16", meal: "午餐" as const, grams: 0 }
test("aggregate: null is pending, never 0; per-nutrient counts", () => {
  const es: FoodEntry[] = [
    { ...base, id: "1", name: "华莱士鸡腿堡", kcal: 0, label: "营养待补充" },
    { ...base, id: "2", name: "米饭", kcal: 232, protein: 5.2, foodId: "x", carb: null },
    { ...base, id: "3", name: "补录", kcal: 300, protein: 10, carb: 40, fat: 8, label: "手填" },
  ]
  const a = aggregate(es)
  assert.deepEqual(a.kcal, { sum: 532, known: 2, pending: 1 })
  assert.deepEqual(a.protein, { sum: 15.2, known: 2, pending: 1 })
  assert.deepEqual(a.carb, { sum: 40, known: 1, pending: 2 })
  assert.equal(a.fiber.pending, 3)
  assert.equal(nutrientOf(es[0], "kcal"), null)
  assert.equal(nutrientOf({ ...base, id: "w", name: "水", kcal: 0, foodId: "water" }, "kcal"), 0)
})
