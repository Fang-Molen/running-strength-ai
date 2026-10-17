import test from "node:test";
import assert from "node:assert/strict";
import { emptyProfile } from "@/lib/strength/profile";
import { parseBodyGoal, persistBodyGoal, readGoalBodyFat, GOAL_BF_KEY } from "./goal-editor";

function storage(failKey?: string) {
  const profile = { ...emptyProfile(), sex: "male", weightKg: "56", bodyFat: "9", heightCm: "174", targetKg: "58", note: "保留个人资料" };
  const values = new Map<string, string>([["fr255-profile-v1", JSON.stringify(profile)], [GOAL_BF_KEY, "12"], ["fr255-body-v1", '[{"weight":56,"fat":9}]'], ["fk-plan400-v4-log", '{"keep":true}']]);
  let failed = false;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (key === failKey && !failed) { failed = true; throw new Error("quota"); } values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  return { values, profile, restore: () => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else delete (globalThis as { localStorage?: Storage }).localStorage; } };
}
test("missing optional body fat remains unknown; invalid or empty targets are rejected", () => {
  assert.deepEqual(parseBodyGoal("60", "", false), { kg: 60, bf: null });
  for (const kg of ["", " ", "0", "NaN", "Infinity", "201"]) assert.equal(typeof parseBodyGoal(kg, "", false), "string");
  assert.equal(typeof parseBodyGoal("60", "", true), "string");
  assert.equal(typeof parseBodyGoal("60", "0", true), "string");
});
test("saving a goal preserves measured values, other profile fields and training records", () => {
  const s = storage(); try {
    const result = persistBodyGoal({ kg: 60, bf: 11 }); assert.equal(result.ok, true);
    const p = JSON.parse(s.values.get("fr255-profile-v1")!);
    assert.deepEqual(p, { ...s.profile, targetKg: "60" });
    assert.equal(s.values.get("fr255-body-v1"), '[{"weight":56,"fat":9}]');
    assert.equal(s.values.get("fk-plan400-v4-log"), '{"keep":true}'); assert.equal(readGoalBodyFat(), 11);
  } finally { s.restore(); }
});
test("existing target body fat can be cleared without modifying measured body fat", () => {
  const s = storage(); try {
    assert.equal(persistBodyGoal({ kg: 58, bf: null }).ok, true);
    assert.equal(readGoalBodyFat(), null); assert.equal(s.values.has(GOAL_BF_KEY), false);
    assert.equal(JSON.parse(s.values.get("fr255-profile-v1")!).bodyFat, "9");
  } finally { s.restore(); }
});
test("partial storage failure rolls back both goal values and reports failure", () => {
  const s = storage("fr255-profile-v1"), before = new Map(s.values); try {
    assert.equal(persistBodyGoal({ kg: 60, bf: 10 }).ok, false);
    assert.deepEqual(JSON.parse(s.values.get("fr255-profile-v1")!), s.profile); assert.equal(readGoalBodyFat(), 12);
    assert.deepEqual(s.values, before);
  } finally { s.restore(); }
});
