import test from "node:test"
import assert from "node:assert/strict"
import { setRowsForTest, search, scale, needsCheck, type FoodRow } from "./food-db.ts"
const rows: FoodRow[] = [
  { i: "a", n: "汉堡", a: [], g: 0, b: "g", p: [250, 13, null, null, null], s: { g: 200, u: "200g", v: null }, pt: [], src: "L", st: "AS_STORED_NOT_REVERIFIED" },
  { i: "b", n: "巨无霸 Big Mac", a: [], g: 1, b: "serv", p: null, s: { g: null, u: "1份", v: [580, 25, 45, 34, null] }, pt: [], src: "B", st: "BRAND_REPORTED" },
]
test("food db: search priority, null kept, per-serving not converted", () => {
  setRowsForTest(rows)
  assert.equal(search("汉堡")[0].i, "a")
  const m = scale(rows[0], 200); assert.equal(m.kcal, 500); assert.equal(m.carb, null); assert.equal(m.fiber, null)
  const s = scale(rows[1], 2); assert.equal(s.kcal, 1160); assert.equal(s.fiber, null)
  assert.equal(needsCheck(rows[0]), true); assert.equal(needsCheck(rows[1]), false)
})
