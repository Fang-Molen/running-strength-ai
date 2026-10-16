import test from "node:test";
import assert from "node:assert/strict";
import { fillRestOnce, fmtRest, toSec, splitSec } from "./rest.ts";
test("fmtRest never shows 0 for unset", () => { assert.equal(fmtRest(null), "未设置"); assert.equal(fmtRest(undefined), "未设置"); assert.equal(fmtRest(75), "75秒"); assert.equal(fmtRest(45), "45秒"); assert.equal(fmtRest(120), "2分钟"); });
test("toSec blank is null", () => { assert.equal(toSec("", ""), null); assert.equal(toSec("1", "15"), 75); assert.deepEqual(splitSec(75), ["1", "15"]); });
test("fill only 10/17 下肢, idempotent, keeps user values", () => {
  type E = { date: string; title: string; exercises?: { name: string; restSec?: number | null }[]; restFillSec?: number | null };
  const es: E[] = [
    { date: "2026-10-17", title: "力量 · 下肢", exercises: [{ name: "深蹲" }, { name: "硬拉", restSec: 120 }] },
    { date: "2026-10-17", title: "力量课 · 下肢" },
    { date: "2026-10-18", title: "力量 · 下肢", exercises: [{ name: "深蹲" }] },
    { date: "2026-10-17", title: "力量 · 上肢", exercises: [{ name: "卧推" }] },
  ];
  const a = fillRestOnce(es);
  assert.equal(a.entries[0].exercises![0].restSec, 75); assert.equal(a.entries[0].exercises![1].restSec, 120);
  assert.equal(a.entries[1].restFillSec, 75); assert.equal(a.entries[2].exercises![0].restSec, undefined); assert.equal(a.entries[3].exercises![0].restSec, undefined);
  assert.equal(fillRestOnce(a.entries).changed, 0);
});
