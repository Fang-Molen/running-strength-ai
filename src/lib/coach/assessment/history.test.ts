import test from "node:test";
import assert from "node:assert/strict";
import { assessAthleteHistory, historySummary } from "./history";
import { context, training, set } from "../../health/analysis-fixtures";
import { projectAnalysisEvidence } from "../../health/analysis-evidence";
import type { TrainingFact } from "../../health/analysis-contract";
import { buildCycleDraft } from "../cycle/planner";
import { cycleFixture } from "../cycle/fixtures";
const run = (day: string, seconds = 300, extra: Partial<TrainingFact> = {}): TrainingFact =>
  training({
    id: day,
    sourceRecordId: day,
    canonicalActivityId: day,
    occurrenceId: day,
    modality: "RUN",
    componentId: "running",
    provider: "MANUAL",
    accountRef: "self",
    deviceId: "strap-A",
    protocolKey: "track-1km",
    occurredAt: `2026-10-${day}T08:00:00Z`,
    knownAt: `2026-10-${day}T08:00:00Z`,
    receivedAt: `2026-10-${day}T08:00:00Z`,
    startedAt: `2026-10-${day}T08:00:00Z`,
    sessionRpe: 5,
    sessionRpeScale: "0-10_SESSION_RPE",
    strengthSets: [],
    runSegments: [
      {
        id: "s",
        blockId: "work",
        roundIndex: 1,
        stepIndex: 1,
        kind: "CONTINUOUS",
        distanceM: 1000,
        durationSeconds: seconds,
        restAfterSeconds: 0,
        rawResolutionSeconds: null,
        gradePercent: 0,
        surface: "track",
        averageHeartRateBpm: 150,
        heartRateMethod: "CHEST_STRAP",
        completion: "COMPLETED",
      },
    ],
    ...extra,
  });
const assess = (facts: TrainingFact[]) =>
  assessAthleteHistory(projectAnalysisEvidence({ context, facts }));
test("same-protocol prior dates give hand-calculated pace/HR/RPE changes without claiming capacity", () => {
  const latest = run("22", 330, { sessionRpe: 7 });
  latest.runSegments[0].averageHeartRateBpm = 156;
  const h = assess([run("15"), run("18"), latest]),
    c = h.comparisons[0];
  assert.equal(c.status, "DIRECT");
  assert.equal(c.priorDays, 2);
  assert.equal(c.paceDeltaSecondsPerKm, 30);
  assert.equal(c.heartRateDeltaBpm, 6);
  assert.equal(c.rpeDelta, 2);
  assert.equal(c.explanations.length, 2);
  assert.equal(h.universalScore, null);
  assert.equal(h.planning.allowAutomaticIncrease, false);
});
for (const [name, change] of [
  [
    "shorter recovery",
    (r: TrainingFact) => {
      r.runSegments[0].restAfterSeconds = 45;
    },
  ],
  [
    "new device",
    (r: TrainingFact) => {
      r.deviceId = "strap-B";
    },
  ],
  [
    "different account",
    (r: TrainingFact) => {
      r.accountRef = "other-account";
    },
  ],
  [
    "different course distance",
    (r: TrainingFact) => {
      r.runSegments[0].distanceM = 800;
    },
  ],
] as const)
  test(name + " prevents pooled heart-rate and pace claims", () => {
    const latest = run("22", 330);
    change(latest);
    const c = assess([run("15"), latest]).comparisons[0];
    assert.equal(c.status, "NOT_COMPARABLE");
    assert.equal(c.heartRateDeltaBpm, null);
    assert.equal(c.paceDeltaSecondsPerKm, null);
  });
test("unknown terrain retains descriptive pace but withholds heart-rate comparison and progression", () => {
  const latest = run("22", 330);
  latest.runSegments[0].surface = null;
  const h = assess([run("15"), latest]);
  assert.equal(h.comparisons[0].status, "LIMITED");
  assert.equal(h.comparisons[0].paceDeltaSecondsPerKm, 30);
  assert.equal(h.comparisons[0].heartRateDeltaBpm, null);
  assert.equal(h.planning.reviewExecution, false);
});
test("missing one HR or one work duration does not silently average the remaining segments", () => {
  const r = run("22");
  r.runSegments.push({ ...r.runSegments[0], id: "s2", stepIndex: 2, averageHeartRateBpm: null });
  let s = assess([r]).sessions[0];
  assert.equal(s.heartRateBpm, null);
  assert.equal(s.paceSecondsPerKm, 300);
  r.runSegments[1].durationSeconds = null;
  s = assess([r]).sessions[0];
  assert.equal(s.workSeconds, null);
  assert.equal(s.paceSecondsPerKm, null);
});
test("heart-rate summaries weight actual duration, not lap count or planned distance", () => {
  const r = run("22");
  r.runSegments.push({
    ...r.runSegments[0],
    id: "s2",
    stepIndex: 2,
    durationSeconds: 600,
    averageHeartRateBpm: 180,
  });
  assert.equal(assess([r]).sessions[0].heartRateBpm, 170);
});
test("same-day runs are not independent baseline days", () => {
  const same = run("15");
  same.id = "same";
  same.sourceRecordId = "same";
  same.canonicalActivityId = "same";
  same.occurrenceId = "same";
  same.runSegments[0].durationSeconds = 300;
  const c = assess([run("15"), same, run("22", 330)]).comparisons[0];
  assert.equal(c.priorDays, 1);
});
test("foreign, planned, future-known and retracted records cannot enter the portrait", () => {
  const h = assess([
    run("12", 300, { athleteId: "foreign" }),
    run("13", 300, { status: "PLANNED" }),
    run("14", 300, { knownAt: "2026-11-01T00:00:00Z" }),
    run("15", 300, { status: "RETRACTED" }),
    run("22"),
  ]);
  assert.equal(h.sessions.length, 1);
  assert.equal(h.comparisons.length, 0);
});
test("same occurrence running and strength stay separate while days are counted once", () => {
  const r = run("22"),
    s = training({
      id: "strength",
      sourceRecordId: "strength",
      canonicalActivityId: "22",
      occurrenceId: "22",
      componentId: "strength",
      strengthSets: [set(), set({ id: "set2", loadKg: null })],
    });
  const h = assess([r, s]);
  assert.equal(h.sessions.length, 1);
  assert.equal(h.actualStrengthSets, 2);
  assert.match(h.observations[0].text, /1个实际训练日/);
  assert.equal(h.strength[0].sets[1].loadKg, null);
});
test("revision changes withdraw old comparison and do not retain its reference", () => {
  const old = run("22", 330),
    before = assess([run("15"), old]),
    next = assess([run("15"), old, { ...old, revision: 2, status: "RETRACTED" }]);
  assert.notEqual(before.version, next.version);
  assert.equal(next.comparisons.length, 0);
  assert.ok(!JSON.stringify(next.observations).includes("330"));
});
test("normal execution cannot release an explicit pain restriction", () => {
  const s = projectAnalysisEvidence({
    context,
    facts: [run("15"), run("22")],
    safetyConstraints: [{ id: "pain", version: "1", scope: "PAIN_REVIEW", evidenceRefs: [] }],
  });
  const h = assessAthleteHistory(s);
  assert.equal(h.planning.hold, true);
  assert.match(historySummary(h), /不能由心率或设备分数解除/);
});
test("repeated matching deterioration blocks proposed progression even with optimistic device recovery", () => {
  const input = cycleFixture();
  input.goal.raceDate = "2026-11-22";
  input.goal.proposeExtraMinutes = 2;
  const rows = [
    run("12"),
    run("15"),
    run("18"),
    run("24", 330, { sessionRpe: 7 }),
    run("25", 350, { sessionRpe: 8 }),
  ];
  input.snapshot.facts.push(...rows);
  const d = buildCycleDraft(input);
  assert.equal(d.portrait.history.planning.reviewExecution, true);
  assert.ok(d.weeks[0].sessions.every((s) => !s.candidate || s.candidate.minutes <= 20));
  assert.ok(d.warnings.some((s) => s.includes("先复核")));
});
test("empty history remains partial and asks at most two questions within the answer limit", () => {
  const h = assess([]),
    text = historySummary(h);
  assert.equal(h.dimensions.recordedRunning, "UNKNOWN");
  assert.equal(h.dimensions.maximumCapacity, "REQUIRES_VERIFIED_PERFORMANCE");
  assert.ok(h.questions.length <= 2);
  assert.ok(text.length <= 950);
});

test("unknown current device never bridges incompatible historical device baselines", () => {
  const a = run("15", 240, { deviceId: "A" }),
    b = run("18", 360, { deviceId: "B" }),
    c = run("22", 330, { deviceId: null });
  const h = assess([a, b, c]);
  assert.equal(h.comparisons[0].priorDays, 1);
  assert.equal(h.comparisons[0].paceDeltaSecondsPerKm, -30);
});
test("missing outcome data does not invent support or counterevidence for physiological explanations", () => {
  const a = run("15"),
    b = run("22");
  for (const t of [a, b]) {
    t.sessionRpe = null;
    t.runSegments[0].durationSeconds = null;
    t.runSegments[0].averageHeartRateBpm = null;
  }
  const h = assess([a, b]);
  assert.equal(h.comparisons[0].explanations.length, 0);
  assert.doesNotMatch(historySummary(h), /支持2条|反证2条/);
});
test("rest after round cannot be pooled with rest after repetition", () => {
  const a = run("15"),
    b = run("22");
  for (const t of [a, b]) t.runSegments[0].kind = "REPETITION";
  a.runSegments[0].restScope = "AFTER_ROUND";
  b.runSegments[0].restScope = "AFTER_REPEAT";
  assert.equal(assess([a, b]).comparisons[0].status, "NOT_COMPARABLE");
});
