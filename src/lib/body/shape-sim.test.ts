import test from "node:test"; import assert from "node:assert/strict";
import { splitOf, girthFor, DEFAULT_SIM } from "./shape-sim.ts";
test("default split is not all muscle", () => { assert.ok(DEFAULT_SIM.leanShare < 0.5); const s = splitOf({ kg: 60, bf: 15 }, { kg: 64, bf: null }, DEFAULT_SIM); assert.ok(s.dFat > s.dLean); });
test("bf mode derives fat/lean from both targets", () => { const s = splitOf({ kg: 60, bf: 15 }, { kg: 62, bf: 12 }, { ...DEFAULT_SIM, mode: "bf" }); assert.ok(Math.abs(s.dFat - (7.44 - 9)) < 1e-9); assert.ok(Math.abs(s.dLean - (2 + 1.56)) < 1e-9); });
test("no change → zero girth; fat loss shrinks waist most", () => { assert.deepEqual(Object.values(girthFor(0, 0)).every(v => v === 0), true); const g = girthFor(-3, 0); assert.ok(g.waist < g.chest && g.waist < 0); });
test("girth clamped", () => { assert.ok(girthFor(100, 0).waist <= 0.03); });
