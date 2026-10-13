import test from "node:test"
import assert from "node:assert/strict"
import { initChecklist, toggleSet, toggleMove, progress, reconcile, saveChecklist, loadChecklist, editSet } from "./today-checklist.ts"
const moves = [{ id: "a", sets: 3, amount: 10, weightKg: 40 }, { id: "b", sets: 2, amount: 8, weightKg: 0 }]
test("prefilled, tick set starts rest timer, progress counts", () => {
  let s = initChecklist("2026-10-13", "s1", moves, true)
  assert.deepEqual(s.moves.a[0], { done: false, reps: 10, kg: 40 })
  s = toggleSet(s, "a", 0, 1000, 90)
  assert.equal(s.restEndsAt, 91000); assert.equal(s.startedAt, 1000)
  s = toggleMove(s, "b", 2000)
  assert.deepEqual(progress(s), { done: 3, total: 6 })
  s = editSet(s, "a", 1, { reps: 12 }, 3000); assert.equal(s.moves.a[1].reps, 12)
})
test("reconcile keeps logged sets when plan changes; storage round-trip", () => {
  const old = toggleSet(initChecklist("d", "s1", moves, false), "a", 0, 1, 0)
  const fresh = initChecklist("d", "s1", [{ id: "a", sets: 4, amount: 10, weightKg: 40 }], false)
  const r = reconcile(old, fresh)
  assert.equal(r.moves.a.length, 4); assert.equal(r.moves.a[0].done, true); assert.equal(r.moves.b, undefined)
  const mem = new Map<string, string>(); const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
  assert.ok(saveChecklist(st, r)); assert.equal(loadChecklist(st, "d")?.moves.a[0].done, true)
})
