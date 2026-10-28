import test from "node:test";
import assert from "node:assert/strict";
import { buildCycleDraft } from "./planner";
import { cycleFixture } from "./fixtures";

const eventCases = [
  [400, /专项速度.*技术/, /末段冲刺/],
  [800, /速度.*专项耐力/, /400米.*长跑/],
  [1500, /专项节奏.*速度.*耐力/, /训练均速/],
  [3000, /比赛准备.*速度.*耐力/, /单次间歇/],
  [5000, /可比耐力.*节奏.*可用时间/, /历史PB/],
  [10000, /专项耐力.*节奏.*补给/, /5公里/],
] as const;
for (const [meters, objective, limitation] of eventCases) test(`${meters}m exposes its own purpose and evidence boundary without inventing race ability`, () => {
  const input = cycleFixture(); input.goal.eventMeters = meters; input.goal.targetSeconds = 100;
  const draft = buildCycleDraft(input) as ReturnType<typeof buildCycleDraft> & { eventFocus?: { objective: string; limitation: string; evidenceNeeds: string[] } };
  assert.ok(draft.eventFocus, "missing event-specific planning evidence");
  assert.match(draft.eventFocus.objective, objective);
  assert.match(draft.eventFocus.limitation, limitation);
  assert.ok(draft.eventFocus.evidenceNeeds.length > 0);
  assert.ok(draft.weeks.every(week => week.purpose.includes(draft.eventFocus!.objective)));
  assert.ok(draft.weeks.every(week => week.purpose.includes(draft.eventFocus!.limitation) && week.purpose.includes(draft.eventFocus!.evidenceNeeds[0])));
  assert.equal(draft.portrait.performances.length, 0);
  assert.equal(draft.portrait.goalIsMeasurement, false);
});

test("other endurance events do not borrow a 10K performance and missing distance stays unknown", () => {
  const input = cycleFixture(); input.goal.eventMeters = 21097;
  const endurance = buildCycleDraft(input) as any;
  assert.match(endurance.eventFocus?.objective, /目标赛事.*近期可比耐力暴露/);
  input.goal.eventMeters = null; input.goal.targetSeconds = null;
  assert.match((buildCycleDraft(input) as any).eventFocus?.limitation, /项目未确认/);
});

for (const weeks of [8, 12, 24, 52]) test(`${weeks}-week stages expose review conditions and future weeks remain unconfirmed`, () => {
  const input = cycleFixture(); input.goal.raceDate = null; input.goal.horizonWeeks = weeks;
  const draft = buildCycleDraft(input);
  assert.equal(draft.weeks.length, weeks);
  for (const week of draft.weeks as Array<typeof draft.weeks[number] & { phaseReview?: { status: string; entryConditions: string[]; exitConditions: string[]; reviewAt: string; selectionReason: string } }>) {
    assert.ok(week.phaseReview, "phase label alone does not explain the entry/exit conditions");
    assert.equal(week.phaseReview.status, "PROVISIONAL_NOT_PHYSIOLOGICAL_CLEARANCE");
    assert.ok(week.phaseReview.entryConditions.length && week.phaseReview.exitConditions.length);
    assert.equal(week.phaseReview.reviewAt, week.end);
    assert.match(week.purpose, /进入条件.*退出条件.*复核/);
    if (week.index > 0) { assert.equal(week.canConfirm, false); assert.equal(week.conditional, true); }
  }
});

test("advanced or expired competition explains phase reassessment without changing completed records", () => {
  const input = cycleFixture(), original = structuredClone(input.entries);
  input.goal.raceDate = "2026-10-20";
  const draft = buildCycleDraft(input) as any;
  assert.equal(draft.weeks[0].phase, "REVIEW");
  assert.match(draft.weeks[0].phaseReview?.selectionReason, /已过期|已在本周/);
  assert.deepEqual(input.entries, original);
});
