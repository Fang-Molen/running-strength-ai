import test from "node:test";
import assert from "node:assert/strict";
import { buildCycleDraft } from "./planner";
import { cycleFixture, cycleCases } from "./fixtures";
import { buildAthletePortrait } from "./portrait";
import { cyclePrompt } from "./prompt";
for (const c of cycleCases)
  test(c.name, () => {
    const x = cycleFixture(),
      a = buildCycleDraft(x),
      changed = c.change(structuredClone(x)),
      b = buildCycleDraft(changed);
    c.verify(a, b, changed);
  });
test("targets remain goals, future/retracted/foreign evidence cannot become ability", () => {
  const x = cycleFixture();
  x.goal.targetSeconds = 90;
  const a = buildAthletePortrait(x);
  assert.equal(a.goalIsMeasurement, false);
  assert.equal(a.performances.length, 0);
  assert.equal(a.universalLevel, null);
});
test("prompt is bounded, versioned, evidence-only and grants no writing authority", () => {
  const d = buildCycleDraft(cycleFixture()),
    p = cyclePrompt(d);
  assert.ok(p.length <= 1800);
  assert.match(p, /用户确认|确认/);
  assert.match(p, /未知/);
  assert.match(p, /两种|竞争/);
});
test("progression is a single proposed duration change with repeated same-protocol actual evidence", () => {
  const x = cycleFixture();
  x.goal.raceDate = "2026-11-22";
  x.goal.proposeExtraMinutes = 2;
  const d = buildCycleDraft(x),
    sessions = d.weeks[0].sessions.filter((s) => s.candidate);
  assert.equal(d.weeks[0].phase, "BUILD");
  assert.equal(d.weeks[0].canConfirm, true);
  assert.equal(sessions.filter((s) => s.candidate!.minutes > 20).length, 1);
  assert.equal(d.weeks[0].plannedMinutes, 62);
});
test("changing device protocol prevents pooled progression evidence", () => {
  const x = cycleFixture();
  x.goal.raceDate = "2026-11-22";
  x.goal.proposeExtraMinutes = 2;
  x.snapshot.facts = x.snapshot.facts.map((f, i) => ({ ...f, protocolKey: "protocol-" + i }));
  const d = buildCycleDraft(x);
  assert.ok(d.weeks[0].sessions.every((s) => !s.candidate || s.candidate.minutes <= 20));
});
test("an event focus cannot increase the weekly count of key sessions", () => {
  const x = cycleFixture();
  x.goal.priority = "SPEED";
  const d = buildCycleDraft(x);
  assert.ok(
    d.weeks.every((w) => w.sessions.filter((s) => s.candidate?.intensity === "HARD").length <= 1),
  );
});
test("future-dated calendar actuals cannot establish familiarity", () => {
  const x = cycleFixture();
  x.snapshot.facts = [];
  x.entries = x.entries.map((e) => ({ ...e, date: "2026-10-30" }));
  const d = buildCycleDraft(x);
  assert.ok(d.weeks[0].sessions.every((s) => !s.candidate));
});
