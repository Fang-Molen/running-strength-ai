import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG } from "./strength/catalog.ts";

// 与 exercise-editor.tsx 的 doseOf 同源规则（组件依赖 React/JSON，这里动态导入）
test("动作库每个动作都有剂量类型，计时/距离/每侧/自重判断正确", async () => {
  const { doseOf, LIBRARY } = await import("../components/exercise-editor.tsx");
  assert.ok(LIBRARY.length >= 78 + 10);
  for (const x of LIBRARY) { const d = doseOf(x.name); assert.ok(["reps", "sec", "m"].includes(d.unit), x.name); assert.ok(Number(d.amount) > 0); }
  for (const c of CATALOG.filter((c) => c.timed)) assert.equal(doseOf(c.name).unit, "sec", c.name);
  const expect: [string, string, boolean, boolean][] = [
    ["平板支撑", "sec", false, true], ["侧平板", "sec", true, true], ["侧桥", "sec", true, true], ["跪姿平板", "sec", false, true],
    ["农夫行走", "m", false, false], ["Pallof 抗旋转", "reps", true, true], ["保加利亚分腿蹲", "reps", true, false], ["单腿臀桥", "reps", true, true],
    ["杠铃深蹲", "reps", false, false], ["俯卧撑", "reps", false, true], ["杠铃臀推", "reps", false, false], ["行走弓步", "reps", true, true], ["站姿提踵", "reps", false, false],
  ];
  for (const [n, u, side, bw] of expect) { const d = doseOf(n); assert.equal(d.unit, u, n); assert.equal(d.perSide, side, n + " 每侧"); assert.equal(d.bodyweight, bw, n + " 自重"); }
  assert.equal(doseOf("平板支撑").amount, "30");
});
