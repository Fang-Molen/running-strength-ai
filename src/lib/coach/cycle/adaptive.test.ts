import test from "node:test";
import assert from "node:assert/strict";
import { cycleFixture } from "./fixtures";
import { buildAthletePortrait } from "./portrait";
import { buildCycleDraft } from "./planner";
import { evaluateRecoveryEvidence } from "../../health/recovery-assessment";
import { metric } from "../../health/analysis-fixtures";
import type { ResponseFact } from "../../health/analysis-contract";

export const response = (
  id: string,
  measure: ResponseFact["measure"],
  value: number,
  at = "2026-10-25T09:00:00Z",
): ResponseFact => ({
  ...metric({ id, sourceRecordId: id, occurredAt: at, knownAt: at, receivedAt: at }),
  kind: "RESPONSE",
  measure,
  value,
  scale: measure === "FUNCTION" ? "FUNCTION_LIMITATION_0_1" : "0-10_HIGH_WORSE",
  region: "quads",
  side: "BILATERAL",
  relatedTrainingRefs: [],
  observationProtocol: "SELF_REPORT_" + measure,
  elapsedHours: null,
  functionTaskId: null,
  notes: null,
});
test("portrait provides two independent recorded seven-day windows, not previous calendar weeks only", () => {
  const x = cycleFixture();
  const p = buildAthletePortrait(x) as any;
  assert.ok(p.adaptive, "missing connected personal response review");
  assert.equal(p.adaptive.windows.length, 2);
  assert.equal(p.adaptive.windows[0].runDistanceM, 9000);
  assert.equal(p.adaptive.windows[1].runDistanceM, 9000);
  assert.equal(p.adaptive.windows[0].coverage, "RECORDED_ONLY");
});
test("recent explicit pain and function feedback can report no observed adverse signal without granting clearance", () => {
  const x = cycleFixture();
  x.snapshot.facts.push(response("p", "PAIN", 0), response("f", "FUNCTION", 0));
  const r = evaluateRecoveryEvidence(x.snapshot);
  assert.equal(r.signalState, "NO_ADVERSE_SIGNAL_OBSERVED");
  assert.equal(r.medicalClearance, false);
  assert.equal(r.automaticPrescription, false);
  x.snapshot.safetyConstraints.push({ id: "hold", version: "1", scope: "PAIN", evidenceRefs: [] });
  assert.equal(evaluateRecoveryEvidence(x.snapshot).safetyState, "HOLD_ACTIVE");
});
test("month request keeps four weeks and recent history window without changing saved goal", () => {
  const x = cycleFixture();
  (x as any).request = { historyDays: 14, horizonWeeks: 4 };
  const before = structuredClone(x.goal),
    d = buildCycleDraft(x);
  assert.equal(d.weeks.length, 4);
  assert.deepEqual(x.goal, before);
  assert.match(d.portrait.history.observations[0].text, /近14天/);
  assert.deepEqual((d as any).request, { historyDays: 14, horizonWeeks: 4 });
});
import { monthFixture, followup } from "../../../../evaluation/adaptive/fixture";
import { buildAdaptiveReview } from "../../health/adaptive-review";
import type { TrainingFact } from "../../health/analysis-contract";
test("four-week balanced plan preserves both running and strength with separate dose budgets", () => {
  const x = monthFixture(),
    d = buildCycleDraft(x);
  for (const w of d.weeks) {
    const courses = w.sessions.flatMap((s) => (s.candidate ? [s.candidate] : []));
    assert.ok(
      courses.some((s) => s.modality === "strength"),
      "strength missing",
    );
    assert.ok(
      courses.some((s) => s.modality === "run"),
      "run missing",
    );
    assert.ok(courses.filter((s) => s.modality === "run").length <= 3);
    assert.ok(courses.filter((s) => s.modality === "strength").length <= 2);
    assert.ok(
      courses
        .filter((s) => s.modality === "strength")
        .flatMap((s) => s.exercises ?? [])
        .reduce((n, e) => n + Number(e.sets), 0) <= 6,
    );
  }
});
test("repeated linked soreness changes strength set proposal and revision withdraws that evidence", () => {
  const x = monthFixture(),
    ts = x.snapshot.facts.filter(
      (f): f is TrainingFact =>
        f.kind === "TRAINING" && ["strength-1", "strength-3"].includes(f.id),
    );
  x.snapshot.facts.push(...ts.map((t) => followup(t, "SORENESS", 4)));
  const d = buildCycleDraft(x);
  assert.ok(d.portrait.adaptive.groups.some((g) => g.state === "REVIEW_DOSE"));
  assert.ok(
    d.weeks[0].sessions.some(
      (s) => s.candidate?.modality === "strength" && s.candidate.exercises?.[0].sets === "2",
    ),
    "feedback does not alter plan",
  );
  x.snapshot.facts = x.snapshot.facts.map((f) =>
    f.id === "strength-3" ? { ...f, revision: f.revision + 1 } : f,
  );
  assert.ok(buildAdaptiveReview(x.snapshot).groups.every((g) => g.state !== "REVIEW_DOSE"));
});
test("mixed actual occurrence retains both modalities and never counts one event as two independent sessions", () => {
  const x = monthFixture(),
    a = x.snapshot.facts.find((f) => f.id === "d") as TrainingFact,
    b = x.snapshot.facts.find((f) => f.id === "strength-0") as TrainingFact;
  b.canonicalActivityId = a.canonicalActivityId;
  b.startedAt = a.startedAt;
  b.occurredAt = a.occurredAt;
  const w = buildAdaptiveReview(x.snapshot).windows[1];
  assert.equal(w.sessionCount, 4);
  assert.equal(w.runSessions, 3);
  assert.equal(w.strengthSessions, 2);
});
test("two-week context yields candidate courses from confirmed actual facts even without calendar links", () => {
  const x = monthFixture();
  x.entries = [];
  const d = buildCycleDraft(x);
  assert.ok(d.weeks[0].sessions.some((s) => s.candidate?.modality === "run"));
  assert.ok(d.weeks[0].sessions.some((s) => s.candidate?.modality === "strength"));
});
test("stale zero check-in and a device readiness number cannot authorize familiar hard training", () => {
  const x = cycleFixture();
  x.snapshot.facts.push(
    response("p", "PAIN", 0, "2026-10-20T09:00:00Z"),
    response("f", "FUNCTION", 0, "2026-10-20T09:00:00Z"),
    metric({ metric: "READINESS", value: 100 }),
  );
  const r = evaluateRecoveryEvidence(x.snapshot);
  assert.notEqual(r.signalState, "NO_ADVERSE_SIGNAL_OBSERVED");
});
import { deriveAthleteState } from "../../core/state";
import { readTrainingContext } from "../../core/training-decision";
import { freshMemory, saveCoach } from "../../strength/coach";
import { setStoreBackend } from "../../core/storage";
test("legacy heuristic score is preserved in storage but cannot become measured readiness", () => {
  const m = new Map<string, string>(),
    box = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
      keys: () => [...m.keys()],
    };
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  setStoreBackend(box);
  Object.defineProperty(globalThis, "localStorage", { value: box, configurable: true });
  try {
    saveCoach({
      ...freshMemory(),
      fatigue: 96,
      band: "cooked",
      notes: [{ text: "旧反馈", band: "cooked", pain: false, heavy: true }],
    });
    assert.equal(deriveAthleteState().recovery.fatigueScore, null);
    assert.equal(readTrainingContext(null).fatigue, null);
    assert.ok([...m.values()].some((v) => v.includes("96")));
  } finally {
    setStoreBackend(null);
    if (old) Object.defineProperty(globalThis, "localStorage", old);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
import { cycleRequestFromText } from "./request";
test("explicit four-week request selects two-week facts without writing goal or accepting a plan", () => {
  assert.deepEqual(
    cycleRequestFromText("根据我这两周的训练出后面四周的训练计划，包括力量周期和跑步安排"),
    { request: { historyDays: 14, horizonWeeks: 4 } },
  );
  assert.equal(cycleRequestFromText("举例给朋友安排一个月训练计划"), null);
  assert.equal(cycleRequestFromText("不要生成一个月训练计划"), null);
});
test("foreign, future and retracted feedback cannot establish a personal response", () => {
  const x = monthFixture(),
    ts = x.snapshot.facts.filter(
      (f): f is TrainingFact =>
        f.kind === "TRAINING" && ["strength-1", "strength-3"].includes(f.id),
    );
  for (const t of ts) {
    x.snapshot.facts.push({ ...followup(t, "SORENESS", 5), athleteId: "OTHER" });
    x.snapshot.facts.push({
      ...followup(t, "SORENESS", 5),
      id: "void:" + t.id,
      sourceRecordId: "void:" + t.id,
      status: "RETRACTED",
    });
  }
  assert.ok(buildAdaptiveReview(x.snapshot).groups.every((g) => g.state !== "REVIEW_DOSE"));
});
test("contradictory same-version feedback is not a reason to increase or reduce a specific dose", () => {
  const x = monthFixture(),
    t = x.snapshot.facts.find((f) => f.id === "strength-1") as TrainingFact,
    f = followup(t, "SORENESS", 5);
  x.snapshot.facts.push(f, { ...f, id: "conflict", value: 0 });
  const r = buildAdaptiveReview(x.snapshot);
  assert.ok(r.groups.every((g) => g.concernCount === 0));
});
test("missing distance and strength weights remain unknown in the portrait", () => {
  const x = monthFixture();
  for (const f of x.snapshot.facts)
    if (f.kind === "TRAINING") {
      f.runSegments.forEach((r) => (r.distanceM = null));
      f.strengthSets.forEach((s) => (s.loadKg = null));
    }
  const r = buildAdaptiveReview(x.snapshot);
  assert.equal(r.windows[0].runDistanceM, null);
  assert.equal(r.windows[0].strengthSets, 6);
  assert.ok(r.groups.every((g) => g.modality !== "STRENGTH"));
});
test("overlapping later exercise is exposed rather than counted as an independent response success", () => {
  const x = monthFixture(),
    t = x.snapshot.facts.find((f) => f.id === "strength-0") as TrainingFact;
  x.snapshot.facts.push(followup(t, "PAIN", 0), followup(t, "FUNCTION", 0));
  const g = buildAdaptiveReview(x.snapshot).groups.find((g) => g.modality === "STRENGTH")!;
  assert.ok(g.confoundedCount > 0);
  assert.equal(g.supportedCount, 0);
});
test("proposed key-course spacing survives every week boundary", () => {
  const x = cycleFixture();
  x.request = { historyDays: 14, horizonWeeks: 4 };
  x.goal.raceDate = null;
  x.training.days!.value = [1, 0];
  x.entries = x.entries.map((e) => ({
    ...e,
    intensity: "HARD",
    actual: { ...e.actual!, intensity: "HARD" },
  }));
  const keys = buildCycleDraft(x)
    .weeks.flatMap((w) =>
      w.sessions.flatMap((s) => (s.candidate?.intensity === "HARD" ? [s.date] : [])),
    )
    .sort();
  assert.ok(keys.length > 1);
  for (let i = 1; i < keys.length; i++)
    assert.ok((Date.parse(keys[i]) - Date.parse(keys[i - 1])) / 864e5 > 1);
});
test("repeated fatigue cannot be labeled observed tolerance when pain and function are normal", () => {
  const x = monthFixture();
  for (const f of x.snapshot.facts.slice())
    if (f.kind === "TRAINING" && ["strength-1", "strength-3"].includes(f.id))
      x.snapshot.facts.push(
        followup(f, "PAIN", 0),
        followup(f, "FUNCTION", 0),
        followup(f, "SUBJECTIVE_FATIGUE", 9),
      );
  const g = buildAdaptiveReview(x.snapshot).groups.find((g) => g.modality === "STRENGTH")!;
  assert.notEqual(g.state, "OBSERVED_TOLERANCE");
  assert.equal(g.supportedCount, 0);
});
test("explicit poor recovery keeps mixed signals despite current pain and function zeros", () => {
  const x = cycleFixture();
  x.snapshot.facts.push(response("p", "PAIN", 0), response("f", "FUNCTION", 0), {
    ...response("r", "RECOVERY_FEELING", 1),
    scale: "1-10_HIGH_BETTER",
  });
  assert.notEqual(evaluateRecoveryEvidence(x.snapshot).signalState, "NO_ADVERSE_SIGNAL_OBSERVED");
});
test("experienced high-volume athlete keeps supported large sessions, not a beginner volume cap", () => {
  const x = monthFixture();
  x.training.minutes!.value = 120;
  x.training.equipment!.value = "GYM";
  for (const e of x.entries) {
    e.minutes = e.modality === "run" ? 80 : 45;
    e.actual!.minutes = e.minutes;
    if (e.modality === "run") {
      e.actual!.km = 20;
      for (const c of e.runComponents ?? [])
        if (c.modality === "RUNNING" && c.structure.kind === "CONTINUOUS") {
          c.structure.plannedDistanceMeters = 20000;
          c.structure.plannedDurationSeconds = 4800;
        }
    } else
      for (const a of e.exercises ?? []) {
        a.sets = "6";
        a.reps = "5";
        a.weight = "60";
      }
  }
  for (const f of x.snapshot.facts)
    if (f.kind === "TRAINING") {
      f.actualDurationSeconds = f.modality === "RUN" ? 4800 : 2700;
      f.endedAt = new Date(Date.parse(f.startedAt) + f.actualDurationSeconds * 1000).toISOString();
      if (f.modality === "RUN") {
        f.runSegments[0].distanceM = 20000;
        f.runSegments[0].durationSeconds = 4800;
      } else
        f.strengthSets = Array.from({ length: 6 }, (_, i) => ({
          ...f.strengthSets[0],
          id: "s" + i,
          reps: 5,
          loadKg: 60,
          loadBasis: "TOTAL_EXTERNAL",
        }));
    }
  const d = buildCycleDraft(x),
    courses = d.weeks[0].sessions.flatMap((s) => (s.candidate ? [s.candidate] : []));
  assert.equal(d.weeks[0].canConfirm, true);
  assert.equal(d.weeks[0].plannedMinutes, 330);
  assert.equal(
    courses
      .filter((e) => e.modality === "run")
      .reduce(
        (n, e) =>
          n +
          (e.runComponents?.[0].modality === "RUNNING" &&
          e.runComponents[0].structure.kind === "CONTINUOUS"
            ? (e.runComponents[0].structure.plannedDistanceMeters ?? 0)
            : 0),
        0,
      ),
    60000,
  );
  assert.equal(
    courses
      .filter((e) => e.modality === "strength")
      .flatMap((e) => e.exercises ?? [])
      .reduce((n, e) => n + Number(e.sets), 0),
    12,
  );
});
test("400 800 and 1500 goals retain familiar nested speed work with exact work/rest, not long-distance substitution", () => {
  for (const meters of [400, 800, 1500]) {
    const x = cycleFixture();
    x.goal.eventMeters = meters;
    x.request = { historyDays: 14, horizonWeeks: 4 };
    x.goal.raceDate = "2026-11-20";
    for (const e of x.entries.filter((e) => e.intensity === "HARD"))
      e.runComponents = [
        {
          componentId: "run",
          modality: "RUNNING",
          purpose: "REPETITION_SPEED",
          structure: {
            kind: "REPEATED",
            blocks: [
              {
                blockId: "speed",
                roundCount: 2,
                recoveryAfterRoundSeconds: 300,
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
    for (const f of x.snapshot.facts)
      if (f.kind === "TRAINING" && ["b", "e"].includes(f.id))
        f.runSegments = Array.from({ length: 8 }, (_, i) => ({
          ...f.runSegments[0],
          id: "rep" + i,
          blockId: "speed",
          roundIndex: Math.floor(i / 4) + 1,
          stepIndex: (i % 4) + 1,
          kind: "REPETITION",
          distanceM: 200,
          durationSeconds: 35,
          restAfterSeconds: i % 4 === 3 ? 300 : 60,
          restScope: i % 4 === 3 ? "AFTER_ROUND" : "AFTER_REPEAT",
        }));
    const d = buildCycleDraft(x),
      key = d.weeks
        .slice(0, 3)
        .flatMap((w) => w.sessions)
        .find((s) => s.candidate?.intensity === "HARD");
    assert.ok(key, `no key course for ${meters}`);
    const c = key.candidate!.runComponents![0];
    assert.equal(c.modality, "RUNNING");
    if (c.modality !== "RUNNING" || c.structure.kind !== "REPEATED") throw Error("structure lost");
    assert.equal(c.structure.blocks[0].roundCount, 2);
    assert.equal(c.structure.blocks[0].steps[0].repeatCount, 4);
    assert.equal(c.structure.blocks[0].steps[0].plannedDurationSeconds, 35);
    assert.equal(c.structure.blocks[0].recoveryAfterRoundSeconds, 300);
  }
});
test("planned interval structure cannot be borrowed from a continuous actual record", () => {
  const x = cycleFixture();
  x.request = { historyDays: 14, horizonWeeks: 4 };
  for (const e of x.entries.filter((e) => e.intensity === "HARD"))
    e.runComponents = [
      {
        componentId: "run",
        modality: "RUNNING",
        purpose: "REPETITION_SPEED",
        structure: {
          kind: "REPEATED",
          blocks: [
            {
              blockId: "speed",
              roundCount: 2,
              recoveryAfterRoundSeconds: 300,
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
  assert.ok(
    buildCycleDraft(x).weeks.every((w) =>
      w.sessions.every((s) => s.candidate?.intensity !== "HARD"),
    ),
  );
});
