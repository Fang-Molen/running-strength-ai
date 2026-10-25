import test from "node:test";
import assert from "node:assert/strict";
import { cycleFixture } from "./fixtures";
import { buildCycleDraft } from "./planner";
import { buildAthletePortrait } from "./portrait";
import { assessCycleFeedback, saveCycleGoal, readCycleGoal, type CycleDocument } from "./host";
import { setStoreBackend } from "../../core/storage";
import { currentAthleteId, setEventContext } from "../../core/events";
import { training, set, metric } from "../../health/analysis-fixtures";
const doc = (draft: ReturnType<typeof buildCycleDraft>): CycleDocument => ({
  id: "review",
  athleteId: draft.athleteId,
  draft,
  status: "ACCEPTED",
  history: [],
});
test("withdrawn linked facts cannot re-enter through saved calendar actuals", () => {
  const x = cycleFixture();
  x.snapshot.facts = x.snapshot.facts.map((f) => ({ ...f, status: "RETRACTED" }));
  const d = buildCycleDraft(x);
  assert.equal(d.weeks[0].canConfirm, false);
  assert.equal(d.portrait.weeks[0].minutes, null);
});
test("one occurrence linked twice is not two progression successes", () => {
  const x = cycleFixture();
  x.goal.raceDate = "2026-11-22";
  x.goal.proposeExtraMinutes = 2;
  x.training.days!.value = [1];
  const e = x.entries.find((e) => e.id === "d")!;
  x.entries = [e, { ...structuredClone(e), id: "duplicate" }];
  x.snapshot.facts = x.snapshot.facts.filter((f) => f.id === "d");
  const d = buildCycleDraft(x);
  assert.ok(d.weeks[0].sessions.every((s) => !s.candidate || s.candidate.minutes <= 20));
  assert.equal(d.portrait.weeks[0].observedSessions, 1);
});
test("pain and function zero do not override an insufficient recovery assessment", () => {
  const x = cycleFixture();
  x.goal.raceDate = "2026-11-22";
  x.goal.proposeExtraMinutes = 2;
  x.recovery.signalState = "INSUFFICIENT";
  const base = metric({
    occurredAt: x.snapshot.context.asOf,
    knownAt: x.snapshot.context.asOf,
    receivedAt: x.snapshot.context.asOf,
  });
  x.snapshot.facts.push(
    {
      ...base,
      kind: "RESPONSE",
      id: "pain0",
      sourceRecordId: "pain0",
      measure: "PAIN",
      value: 0,
      scale: "0-10_HIGH_WORSE",
      region: "quads",
      side: "LEFT",
      observationProtocol: "self",
      relatedTrainingRefs: [],
      elapsedHours: 0,
      functionTaskId: null,
      notes: null,
    },
    {
      ...base,
      kind: "RESPONSE",
      id: "function0",
      sourceRecordId: "function0",
      measure: "FUNCTION",
      value: 0,
      scale: "FUNCTION_LIMITATION_0_1",
      region: "quads",
      side: "LEFT",
      observationProtocol: "self",
      relatedTrainingRefs: [],
      elapsedHours: 0,
      functionTaskId: null,
      notes: null,
    },
  );
  const d = buildCycleDraft(x);
  assert.ok(d.weeks[0].sessions.every((s) => !s.candidate || s.candidate.minutes <= 20));
});
test("existing weekly work consumes budget and protects adjacent key days", () => {
  const x = cycleFixture();
  x.goal.priority = "SPEED";
  x.entries = [
    ...x.entries,
    {
      ...structuredClone(x.entries[0]),
      id: "existing",
      date: "2026-10-27",
      status: "planned",
      actual: undefined,
      minutes: 100,
      intensity: "HARD",
    },
  ];
  const d = buildCycleDraft(x);
  assert.equal(d.weeks[0].canConfirm, false);
  assert.ok(d.weeks[0].sessions.every((s) => !s.candidate));
});
test("one minute of a planned twenty-minute course weakens rather than supports the plan", () => {
  const x = cycleFixture(),
    d = buildCycleDraft(x);
  x.entries = [
    ...x.entries,
    ...d.weeks[0].sessions.flatMap((s) =>
      s.candidate
        ? [
            {
              ...s.candidate,
              status: "done" as const,
              actual: {
                outcome: "different" as const,
                minutes: 1,
                km: 0.1,
                rpe: 3,
                intensity: "EASY" as const,
                reasons: ["short" as const],
                note: "少练",
                at: "2026-10-26T10:00:00Z",
              },
            },
          ]
        : [],
    ),
  ];
  x.snapshot.context.asOf = "2026-11-01T10:00:00Z";
  assert.equal(assessCycleFeedback(doc(d), x).state, "WEAKENED");
});
test("barbell exercises cannot execute with equipment NONE", () => {
  const x = cycleFixture();
  const e = {
    ...structuredClone(x.entries[0]),
    id: "barbell",
    kind: "strength" as const,
    modality: "strength" as const,
    runComponents: undefined,
    exercises: [
      { catalogId: "rdl", name: "杠铃罗马尼亚硬拉", sets: "2", reps: "5", weight: "60", rpe: "7" },
    ],
    actual: { ...x.entries[0].actual!, occurrenceIds: ["barbell"] },
  };
  x.entries = [e];
  x.snapshot.facts = [
    training({
      id: "barbell",
      occurrenceId: "barbell",
      canonicalActivityId: "barbell",
      sourceRecordId: "barbell",
      occurredAt: e.date + "T08:00:00Z",
      startedAt: e.date + "T08:00:00Z",
      knownAt: e.date + "T10:00:00Z",
      receivedAt: e.date + "T10:00:00Z",
      actualDurationSeconds: 1200,
      strengthSets: [set(), set({ id: "s2" })],
    }),
  ];
  x.training.days!.value = [1];
  const d = buildCycleDraft(x);
  assert.equal(d.weeks[0].canConfirm, false);
});
test("future candidates never carry a past actual rest log", () => {
  const x = cycleFixture();
  x.entries = x.entries.map((e) => ({
    ...e,
    restLog: [{ name: "过去实记", planned: 60, actual: 90, at: e.actual!.at }],
  }));
  const d = buildCycleDraft(x);
  assert.ok(d.weeks[0].sessions.every((s) => !s.candidate?.restLog));
});
test("goal revision ten wins across new adapters at the same timestamp", async (t) => {
  const old = currentAthleteId(),
    map = new Map<string, string>();
  setEventContext({ athleteId: "SYN-A" });
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-25T10:00:00Z") });
  t.after(() => {
    setStoreBackend(null);
    setEventContext({ athleteId: old });
  });
  const { schema, athleteId, revision, savedAt, source, ...values } = cycleFixture().goal;
  for (let i = 0; i < 10; i++) {
    setStoreBackend({
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v);
      },
      keys: () => [...map.keys()],
    });
    await saveCycleGoal(values, i, "2026-10-25T10:00:00Z");
  }
  assert.equal(readCycleGoal()?.revision, 10);
});
test("development and specific phases select supported key structures beyond base maintenance", () => {
  const d = buildCycleDraft(cycleFixture());
  const hard = (w: (typeof d.weeks)[number]) =>
    w.sessions.filter((s) => s.candidate?.intensity === "HARD").length;
  assert.equal(hard(d.weeks.find((w) => w.phase === "BASE")!), 0);
  assert.ok(d.weeks.some((w) => w.phase === "BUILD" && hard(w) > 0));
  assert.ok(d.weeks.some((w) => w.phase === "SPECIFIC" && hard(w) > 0));
});
test("informational race markers do not disable a valid taper training week", () => {
  const x = cycleFixture();
  x.goal.raceDate = "2026-10-28";
  const d = buildCycleDraft(x);
  assert.equal(d.weeks[0].canConfirm, true);
});

test("confirmation structure retains nested rounds and unknown rest", async () => {
  const { cycleCourseLines } = await import("./display");
  const e = cycleFixture().entries[0];
  e.runComponents = [
    {
      componentId: "r",
      modality: "RUNNING",
      purpose: "INTERVAL",
      structure: {
        kind: "REPEATED",
        blocks: [
          {
            blockId: "b",
            roundCount: 2,
            recoveryAfterRoundSeconds: null,
            steps: [
              {
                stepId: "s",
                repeatCount: 4,
                plannedDistanceMeters: 200,
                plannedDurationSeconds: 35,
                recoveryAfterRepeatSeconds: 60,
                recoveryBeforeNextStepSeconds: null,
              },
            ],
          },
        ],
      },
    },
  ];
  const text = cycleCourseLines(e).join(";");
  assert.match(text, /2轮/);
  assert.match(text, /4次 × 200米/);
  assert.match(text, /轮间休息未知/);
  assert.doesNotMatch(text, /8次/);
});
