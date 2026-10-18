import test from "node:test"; import assert from "node:assert/strict";
import { normalizeDecimal, parseDecimal } from "./decimal.ts";
test("keeps trailing dot while typing", () => { let s = ""; for (const ch of "6.5") { s = normalizeDecimal(s + ch); } assert.equal(s, "6.5"); assert.equal(normalizeDecimal("6."), "6."); });
test("56.4 typed keystroke by keystroke", () => { let s = ""; const seen: string[] = []; for (const ch of "56.4") { s = normalizeDecimal(s + ch); seen.push(s); } assert.deepEqual(seen, ["5", "56", "56.", "56.4"]); assert.equal(parseDecimal(s), 56.4); });
test("comma and Chinese comma accepted", () => { assert.equal(parseDecimal("6,5"), 6.5); assert.equal(parseDecimal("6，5"), 6.5); assert.equal(parseDecimal("５６．４"), 56.4); });
test("single dot, junk stripped, empty is null", () => { assert.equal(normalizeDecimal("1.2.3kg"), "1.23"); assert.equal(parseDecimal(""), null); assert.equal(parseDecimal("."), null); assert.equal(parseDecimal("6."), 6); });
