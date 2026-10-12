import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { CoachFirstWeekPanel } from "../../components/coach-first-week-panel.tsx";
import {
  appendIntakeAnswer,
  buildFirstWeek,
  editFirstWeek,
  firstWeekGoalFromText,
  INTAKE_FIELDS,
  loadIntake,
  recordFirstWeekChoice,
  savedFirstWeekDraft,
  validateIntake,
} from "./coach-first-week.ts";
import { setStoreBackend } from "./storage.ts";
import {
  firstWeekInputs,
  firstWeekRecords,
  firstWeekMemory,
  FIRST_WEEK_TEST_DAY as today,
} from "./coach-first-week.fixtures.ts";
const build = (inputs = firstWeekInputs()) => buildFirstWeek(firstWeekRecords(inputs), today);
const reset = () => setStoreBackend(firstWeekMemory());

test("goal-only follows all six dependent questions without manufacturing current ability", () => {
  reset();
  const rs = firstWeekRecords();
  for (let k = 0; k < 6; k++) {
    const r = buildFirstWeek(rs.slice(0, k), today);
    assert.equal(r.nextField, INTAKE_FIELDS[k]);
    assert.equal(r.status, "NEEDS_INFO");
    assert.equal(r.draft, null);
  }
  const r = buildFirstWeek(rs, today);
  assert.equal(r.status, "READY_CANDIDATE");
  assert.equal(r.draft!.currentAbilitySeconds, 57);
  assert.equal(r.draft!.goalSeconds, 55);
});
test("different goals never determine training pace or volume", () => {
  reset();
  const a = firstWeekInputs(),
    b = firstWeekInputs();
  b.goal.targetSeconds = 49;
  assert.deepEqual(
    build(a).draft!.sessions.map((s) => [s.kind, s.mainMinutes, s.targetSeconds, s.repsPerRound]),
    build(b).draft!.sessions.map((s) => [s.kind, s.mainMinutes, s.targetSeconds, s.repsPerRound]),
  );
});
test("novice without a 400m performance receives only conservative foundation candidate", () => {
  reset();
  const i = firstWeekInputs();
  i.ability = {
    ...i.ability,
    experienceMonths: 0,
    current400Seconds: null,
    measuredOn: null,
    timing: "unknown",
    continuousEasyMinutes: 8,
  };
  i.recent = { ...i.recent, sessionsPerWeek: 0, measuredOn: null, rpe: null, recovery48: null };
  i.availability.weekdays = [0, 1, 2, 3, 4, 5, 6];
  const d = build(i).draft!;
  assert.ok(d);
  assert.equal(d.sessions.filter((s) => s.kind === "FOUNDATION").length, 2);
  assert.ok(d.sessions.every((s) => s.targetSeconds === null));
  assert.ok(d.sessions.filter((s) => s.kind === "FOUNDATION").every((s) => s.mainMinutes === 4));
});
test("six available days do not force six sessions and intermediate training stays foundation", () => {
  reset();
  const i = firstWeekInputs();
  i.ability.experienceMonths = 6;
  i.recent.sessionsPerWeek = 2;
  i.availability.weekdays = [1, 2, 3, 4, 5, 6];
  const d = build(i).draft!;
  assert.equal(d.sessions.filter((s) => s.kind !== "REST").length, 2);
  assert.equal(d.sessions.filter((s) => s.kind === "FAMILIAR_REPETITION").length, 0);
});
test("one available day caps sessions even for experienced athlete", () => {
  reset();
  const i = firstWeekInputs();
  i.availability.weekdays = [4];
  assert.equal(build(i).draft!.sessions.filter((s) => s.kind !== "REST").length, 1);
});
test("familiar repeated-running candidate preserves rounds and separate rests", () => {
  reset();
  const s = build().draft!.sessions.find((s) => s.kind === "FAMILIAR_REPETITION")!;
  assert.equal(s.rounds, 2);
  assert.equal(s.repsPerRound, 3);
  assert.equal(s.restSeconds, 120);
  assert.equal(s.roundRestSeconds, 300);
  assert.deepEqual(s.targetSeconds, [30, 31.5]);
  assert.equal(s.estimatedMinutes, 33.15);
});
test("missing round rest cannot be invented or flatten two rounds to one", () => {
  reset();
  const i = firstWeekInputs();
  i.recent.roundRestSeconds = null;
  assert.ok(build(i).draft!.sessions.every((s) => s.kind !== "FAMILIAR_REPETITION"));
});
test("small time budget uses fallback instead of overflowing", () => {
  reset();
  const i = firstWeekInputs();
  i.availability.minutes = 15;
  const d = build(i).draft!;
  assert.ok(d.sessions.every((s) => s.estimatedMinutes <= 15));
  assert.ok(d.sessions.every((s) => s.kind !== "FAMILIAR_REPETITION"));
});
test("planned training cannot count as recent completion", () => {
  reset();
  const i = firstWeekInputs();
  i.recent.actual = false;
  assert.equal(build(i).nextField, "recent");
  assert.equal(build(i).draft, null);
});
for (const field of ["pain", "medicalRestriction", "sleepHours", "recoveryNow"] as const)
  test("missing " + field + " remains unknown, not normal", () => {
    reset();
    const i = firstWeekInputs();
    if (field === "pain" || field === "medicalRestriction") i.limits[field] = "UNKNOWN";
    else i.limits[field] = null;
    assert.equal(build(i).nextField, "limits");
    assert.equal(build(i).draft, null);
  });
for (const field of ["pain", "medicalRestriction"] as const)
  test("safety conflict " + field + " blocks even with aggressive target", () => {
    reset();
    const i = firstWeekInputs();
    i.limits[field] = "PRESENT";
    i.goal.targetSeconds = 45;
    assert.equal(build(i).status, "BLOCKED");
    assert.equal(build(i).draft, null);
  });
test("free text warning blocks regardless of healthy checkbox", () => {
  reset();
  const i = firstWeekInputs();
  i.limits.note = "我运动时胸痛，想继续400米冲刺";
  assert.equal(build(i).status, "BLOCKED");
});
for (const state of ["sleep", "rpe", "recovery"] as const)
  test("poor " + state + " blocks new stimulus", () => {
    reset();
    const i = firstWeekInputs();
    if (state === "sleep") i.limits.sleepHours = 4;
    else if (state === "rpe") i.recent.rpe = 9;
    else i.recent.recovery48 = 2;
    assert.equal(build(i).status, "BLOCKED");
  });
test("unknown functional tolerance is queried even when a real 400m time is supplied", () => {
  reset();
  const i = firstWeekInputs();
  i.ability.continuousEasyMinutes = null;
  assert.equal(build(i).nextField, "ability");
});
test("unconfirmed timing, stale dates and near competition do not authorize specialization", () => {
  reset();
  const i = firstWeekInputs();
  i.ability.timing = "unknown";
  assert.equal(build(i).nextField, "ability");
  i.ability.timing = "hand";
  i.ability.measuredOn = "2026-01-01";
  assert.ok(build(i).draft!.sessions.every((s) => s.kind !== "FAMILIAR_REPETITION"));
  i.ability.measuredOn = "2026-10-01";
  i.deadline.targetDate = "2026-10-23";
  assert.ok(build(i).draft!.sessions.every((s) => s.kind !== "FAMILIAR_REPETITION"));
});
test("future actual performance, reversed result range and past deadline prompt correction", () => {
  reset();
  const i = firstWeekInputs();
  i.ability.measuredOn = "2026-11-01";
  assert.equal(build(i).nextField, "ability");
  i.ability.measuredOn = "2026-10-01";
  i.recent.fastestSeconds = 31;
  assert.equal(build(i).nextField, "recent");
  i.recent.fastestSeconds = 28;
  i.deadline.targetDate = "2026-10-10";
  assert.equal(build(i).nextField, "deadline");
});
test("under-18 is outside adult candidate scope", () => {
  reset();
  const i = firstWeekInputs();
  i.ability.age = 16;
  assert.equal(build(i).status, "BLOCKED");
});
test("conflicting actual performance requires explicit correction with original retained", () => {
  reset();
  const id = "correction";
  const i = firstWeekInputs();
  for (const f of INTAKE_FIELDS) assert.equal(appendIntakeAnswer(id, f, i[f]).ok, true);
  const original = loadIntake(id).find((r) => r.field === "ability")!;
  assert.equal(appendIntakeAnswer(id, "ability", { ...i.ability, current400Seconds: 58 }).ok, true);
  const conflicting = loadIntake(id).filter((r) => r.field === "ability");
  assert.equal(buildFirstWeek(loadIntake(id), today).nextField, "ability");
  assert.equal(buildFirstWeek(loadIntake(id), today).draft, null);
  assert.equal(
    appendIntakeAnswer(
      id,
      "ability",
      { ...i.ability, current400Seconds: 56 },
      conflicting.map((r) => r.id),
    ).ok,
    true,
  );
  const rs = loadIntake(id);
  assert.deepEqual(rs.find((r) => r.id === original.id)?.value, original.value);
  assert.equal(rs.filter((r) => r.field === "ability").length, 3);
  assert.equal(buildFirstWeek(rs, today).draft!.currentAbilitySeconds, 56);
});
test("candidate edits recalculate duration, retain original, and prohibit additions", () => {
  reset();
  const d = build().draft!,
    s = d.sessions.find((s) => s.kind === "FAMILIAR_REPETITION")!,
    e = editFirstWeek(d, s.id, { repsPerRound: 2 }),
    edited = e.sessions.find((x) => x.id === s.id)!;
  assert.equal(d.sessions.find((x) => x.id === s.id)!.repsPerRound, 3);
  assert.equal(e.editOf, d.id);
  assert.equal(edited.estimatedMinutes, 28.1);
  assert.equal(edited.mainMinutes, 11.1);
  assert.throws(() => editFirstWeek(d, s.id, { repsPerRound: 5 }));
  assert.throws(() =>
    editFirstWeek(d, d.sessions.find((s) => s.kind === "REST")!.id, { mainMinutes: 2 }),
  );
});
test("saved choice and edit survive reload; changed evidence invalidates stale acceptance", () => {
  const m = firstWeekMemory();
  setStoreBackend(m);
  const id = "persist";
  const i = firstWeekInputs();
  for (const f of INTAKE_FIELDS) appendIntakeAnswer(id, f, i[f]);
  const d = buildFirstWeek(loadIntake(id), today).draft!,
    s = d.sessions.find((s) => s.kind === "FOUNDATION")!,
    e = editFirstWeek(d, s.id, { mainMinutes: 3 });
  assert.equal(recordFirstWeekChoice(id, e, "MODIFY"), true);
  assert.equal(savedFirstWeekDraft(loadIntake(id))!.id, e.id);
  assert.equal(recordFirstWeekChoice(id, e, "ACCEPT"), true);
  assert.equal(
    m.keys().some((k) => k.includes("events") || k.includes("running-plan")),
    false,
  );
  const old = loadIntake(id).find((x) => x.field === "ability")!;
  appendIntakeAnswer(id, "ability", { ...i.ability, current400Seconds: 58 }, old.id);
  assert.equal(recordFirstWeekChoice(id, e, "ACCEPT"), false);
  assert.equal(savedFirstWeekDraft(loadIntake(id)), null);
});
test("quota failure never advances intake or claims candidate saved", () => {
  setStoreBackend({
    keys: () => [],
    getItem: () => null,
    setItem: () => {
      throw Error("quota");
    },
  });
  assert.equal(appendIntakeAnswer("q", "goal", { event: "400米", targetSeconds: 55 }).ok, false);
  assert.equal(loadIntake("q").length, 0);
});
test("zero, NaN, invalid date and duplicated availability fail validation", () => {
  const i = firstWeekInputs();
  assert.ok(validateIntake("ability", { ...i.ability, current400Seconds: 0 }));
  assert.ok(validateIntake("goal", { ...i.goal, targetSeconds: NaN }));
  assert.ok(validateIntake("availability", { ...i.availability, weekdays: [1, 1] }));
  assert.ok(validateIntake("deadline", { targetDate: "2026-02-30", noDeadline: false }));
});
test("goal parser does not convert a standalone reported result into a goal", () => {
  assert.equal(firstWeekGoalFromText("我实际400米57秒"), null);
  assert.deepEqual(firstWeekGoalFromText("我想把400米跑到55秒，帮我安排训练"), {
    event: "400米",
    targetSeconds: 55,
  });
});
test("knowledge and competing explanations expose their limitations", () => {
  reset();
  const d = build().draft!;
  assert.ok(d.knowledge.length >= 2);
  assert.ok(d.knowledge.every((k) => !k.prescriptionApproved));
  assert.equal(d.hypotheses.length, 2);
  assert.ok(d.hypotheses.every((h) => h.counterEvidence && h.check));
  assert.match(d.warnings.join(" "), /产品规则/);
  assert.equal(d.executable, false);
});
test("first-use SSR is safe and displays goal step without reading stored personal values", () => {
  reset();
  const html = renderToString(React.createElement(CoachFirstWeekPanel));
  assert.match(html, /400米目标秒数/);
  assert.doesNotMatch(html, /首周候选计划/);
  assert.match(html, /当前能力/);
  assert.match(html, /未知/);
});
