import { saveDeviceRows } from "../../health/device-store";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { setStoreBackend } from "../../core/storage";
import { currentAthleteId, setEventContext } from "../../core/events";
import { loadChecks, upsertCheck } from "../../nutrition/body";
import { readEffectiveProfile } from "../loop/effective-host";
import { loadSchedule, saveSchedule } from "../../ui/day-schedule";
import type { ScheduleEntry } from "../../ui/day-schedule-rules";
import { prepareR5Command, decideR5Command, readR5Commands } from "./host";
import { appendSymptom, readSymptoms, reviseSymptom } from "../../health/symptom-store";
import { reviewSymptoms } from "../../health/symptom-review";
import { readAnalysis } from "../../health/analysis-host";
import { buildWeeklyReview, buildNextWeekDraft } from "./weekly";
import { training, set, metric } from "../../health/analysis-fixtures";
import { selectR4CourseTasks } from "../r4/answer";

const at = "2026-10-25T10:00:00Z";
const entry = (o: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  id: "thursday",
  athleteId: "local",
  date: "2026-10-29",
  kind: "run",
  modality: "run",
  title: "间歇跑",
  focus: ["速度"],
  minutes: 40,
  intensity: "HARD",
  lowerHeavy: false,
  source: "custom",
  refId: null,
  status: "planned",
  runComponents: [
    {
      componentId: "run",
      modality: "RUNNING",
      purpose: "INTERVAL",
      structure: {
        kind: "REPEATED",
        blocks: [
          {
            blockId: "b",
            roundCount: 2,
            recoveryAfterRoundSeconds: 180,
            steps: [
              {
                stepId: "s",
                plannedDistanceMeters: 200,
                plannedDurationSeconds: 34,
                repeatCount: 4,
                recoveryAfterRepeatSeconds: 60,
                recoveryBeforeNextStepSeconds: null,
              },
            ],
          },
        ],
      },
    },
  ],
  ...o,
});
function setup(t: TestContext) {
  const oldPlan = Object.getOwnPropertyDescriptor(globalThis, "__FK_TEST_PLAN_DOC__");
  Reflect.deleteProperty(globalThis, "__FK_TEST_PLAN_DOC__");
  const old = currentAthleteId(),
    desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    values = new Map<string, string>();
  const box = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    keys: () => [...values.keys()],
  };
  setStoreBackend(box);
  setEventContext({ athleteId: "local" });
  Object.defineProperty(globalThis, "localStorage", { value: box, configurable: true });
  t.after(() => {
    if (oldPlan) Object.defineProperty(globalThis, "__FK_TEST_PLAN_DOC__", oldPlan);
    setStoreBackend(null);
    setEventContext({ athleteId: old });
    if (desc) Object.defineProperty(globalThis, "localStorage", desc);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  return { box, values };
}
test("current weight needs confirmation, syncs effective body, rejects duplicate and compensates undo", async (t) => {
  setup(t);
  upsertCheck({ date: "2026-10-24", weight: 68 });
  const p = prepareR5Command("我现在体重66公斤。", at);
  assert.equal(p.kind, "PROPOSAL");
  if (p.kind !== "PROPOSAL") return;
  assert.equal(readEffectiveProfile().weightKg?.value, 68);
  assert.equal((await decideR5Command(p.command.id, "ACCEPT", at)).ok, true);
  assert.equal(readEffectiveProfile().weightKg?.value, 66);
  assert.equal(loadChecks().at(-1)?.weight, 66);
  assert.equal((await decideR5Command(p.command.id, "ACCEPT", at)).ok, false);
  assert.equal((await decideR5Command(p.command.id, "UNDO", at)).ok, true);
  assert.equal(readEffectiveProfile().weightKg?.value, 68);
  assert.equal(readR5Commands()[0].status, "UNDONE");
});
test("target weight and historical correction never become a new current measurement", async (t) => {
  setup(t);
  upsertCheck({ date: "2026-10-24", weight: 68 });
  const target = prepareR5Command("我的目标体重是66公斤", at);
  assert.equal(target.kind, "PROPOSAL");
  if (target.kind !== "PROPOSAL") return;
  assert.equal((await decideR5Command(target.command.id, "ACCEPT", at)).ok, true);
  assert.equal(readEffectiveProfile().weightKg?.value, 68);
  const historical = prepareR5Command("更正2026-10-20的体重为65公斤", at);
  assert.equal(historical.kind, "PROPOSAL");
  if (historical.kind !== "PROPOSAL") return;
  assert.equal((await decideR5Command(historical.command.id, "ACCEPT", at)).ok, true);
  assert.equal(loadChecks().find((x) => x.date === "2026-10-20")?.weight, 65);
  assert.equal(readEffectiveProfile().weightKg?.value, 68);
});
test("Thursday change is previewed, preserves the strength component, and undo restores full intervals", async (t) => {
  setup(t);
  const before = entry({
    trainingType: "mixed",
    exercises: [{ name: "深蹲", sets: "3", reps: "5", weight: "40", rpe: "7" }],
  });
  saveSchedule({ entries: [before], acks: [] });
  const p = prepareR5Command("把下周四的强度课改成轻松跑", at);
  assert.equal(p.kind, "PROPOSAL");
  if (p.kind !== "PROPOSAL") return;
  assert.equal(loadSchedule().entries[0].intensity, "HARD");
  assert.equal((await decideR5Command(p.command.id, "ACCEPT", at)).ok, true);
  const changed = loadSchedule().entries[0];
  assert.equal(changed.intensity, "EASY");
  assert.equal(changed.exercises?.[0].sets, "3");
  assert.equal(changed.runComponents?.[0].modality, "RUNNING");
  assert.equal((changed.runComponents?.[0] as any).structure.kind, "CONTINUOUS");
  assert.equal((await decideR5Command(p.command.id, "UNDO", at)).ok, true);
  assert.deepEqual(loadSchedule().entries[0], before);
});
test("stale confirmation and account switch never write another scope", async (t) => {
  setup(t);
  saveSchedule({ entries: [entry()], acks: [] });
  const p = prepareR5Command("把下周四的强度课改成轻松跑", at);
  if (p.kind !== "PROPOSAL") throw Error("preview missing");
  saveSchedule({ entries: [entry({ minutes: 35 })], acks: [] });
  assert.equal((await decideR5Command(p.command.id, "ACCEPT", at)).ok, false);
  assert.equal(loadSchedule().entries[0].minutes, 35);
  setEventContext({ athleteId: "account:B" });
  assert.equal(readR5Commands().length, 0);
  assert.equal((await decideR5Command(p.command.id, "ACCEPT", at)).ok, false);
  assert.equal(readSymptoms().length, 0);
});
test("reduce one set changes actual executable exercises and does not modify completed rows", async (t) => {
  setup(t);
  saveSchedule({
    entries: [
      entry({
        id: "s",
        date: "2026-10-26",
        modality: "strength",
        kind: "strength",
        runComponents: undefined,
        exercises: [{ name: "深蹲", sets: "3", reps: "5", weight: "40", rpe: "7" }],
      }),
    ],
    acks: [],
  });
  const p = prepareR5Command("下周力量训练减少一组", at);
  assert.equal(p.kind, "PROPOSAL");
  if (p.kind !== "PROPOSAL") return;
  assert.equal((await decideR5Command(p.command.id, "ACCEPT", at)).ok, true);
  assert.equal(loadSchedule().entries[0].exercises?.[0].sets, "2");
  assert.equal(loadSchedule().entries[0].exercises?.[0].weight, "40");
});
test("symptom worsening and limited function remain holds despite normal readiness or a later zero", (t) => {
  setup(t);
  const base = {
    kind: "PAIN" as const,
    region: "膝",
    side: "LEFT" as const,
    severity: 3,
    durationHours: 48,
    trigger: "跑步",
    functionImpact: "NORMAL" as const,
    trend: "STABLE" as const,
    notes: "",
    trainingRefs: [],
    occurredAt: "2026-10-24T08:00:00Z",
  };
  const a = appendSymptom(base, at);
  assert.ok(a.ok);
  assert.ok(
    appendSymptom(
      {
        ...base,
        severity: 6,
        functionImpact: "LIMITED",
        trend: "WORSENING",
        occurredAt: "2026-10-25T08:00:00Z",
      },
      at,
    ).ok,
  );
  assert.deepEqual(
    saveDeviceRows([
      {
        key: "normal-ready",
        source: "合成设备",
        metric: "READINESS",
        day: "2026-10-25",
        value: 100,
        observation: {
          key: "normal-ready",
          sourceId: "synthetic",
          statistic: "PROVIDER_ASSESSMENT",
          syncedAt: at,
          measuredAt: at,
        },
      },
    ]).errors,
    [],
  );
  assert.ok(
    readAnalysis("2026-10-25", at).snapshot.facts.some(
      (f) => f.kind === "METRIC" && f.metric === "READINESS" && f.value === 100,
    ),
  );
  const r = reviewSymptoms(readSymptoms(at), "2026-10-25", 7);
  assert.equal(r.safety, "HOLD_ACTIVE");
  assert.equal(r.groups[0].change, 3);
  assert.equal(readAnalysis("2026-10-25", at).assessment.safetyState, "HOLD_ACTIVE");
  appendSymptom({ ...base, severity: 0, occurredAt: "2026-10-25T09:00:00Z" }, at);
  assert.equal(reviewSymptoms(readSymptoms(at), "2026-10-25", 3).safety, "HOLD_ACTIVE");
  setEventContext({ athleteId: "account:B" });
  assert.equal(readSymptoms(at).length, 0);
});
test("symptom revisions preserve history but retract invalid evidence", (t) => {
  setup(t);
  const a = appendSymptom(
    {
      kind: "SORENESS",
      region: "小腿",
      side: "RIGHT",
      severity: 4,
      durationHours: null,
      trigger: null,
      functionImpact: "UNKNOWN",
      trend: "UNKNOWN",
      notes: "",
      trainingRefs: [],
      occurredAt: "2026-10-22T08:00:00Z",
    },
    at,
  );
  if (!a.ok) throw Error("save");
  assert.equal(reviseSymptom(a.row.id, 0, { severity: 2 }, false, at).ok, true);
  assert.equal(readSymptoms(at)[0].severity, 2);
  assert.equal(reviseSymptom(a.row.id, 0, { severity: 7 }, false, at).ok, false);
  assert.equal(reviseSymptom(a.row.id, 1, {}, true, at).ok, true);
  assert.equal(readSymptoms(at).length, 0);
});
test("weekly totals use actual run and strength components, retain unknowns and split device protocols", () => {
  const run = training({
    id: "run",
    athleteId: "local",
    modality: "RUN",
    componentId: "run",
    strengthSets: [],
    runSegments: [
      {
        id: "seg",
        blockId: "b",
        roundIndex: 1,
        stepIndex: 0,
        distanceM: 1000,
        durationSeconds: 240,
        restAfterSeconds: 60,
        rawResolutionSeconds: 1,
        gradePercent: null,
        surface: "track",
        completion: "COMPLETED",
      },
    ],
  });
  const lift = training({
    id: "lift",
    athleteId: "local",
    componentId: "lift",
    strengthSets: [set(), set({ id: "s2", reps: 4 })],
  });
  const input = {
    athleteId: "local",
    asOf: at,
    weekStart: "2026-10-19",
    entries: [
      entry({
        date: "2026-10-22",
        status: "done",
        actual: {
          outcome: "different",
          minutes: 30,
          intensity: "MODERATE",
          note: "",
          reasons: [],
          at,
        },
      }),
      entry({
        id: "miss",
        date: "2026-10-23",
        actual: { outcome: "missed", minutes: null, intensity: null, note: "", reasons: [], at },
      }),
      entry({ id: "unrecorded", date: "2026-10-24" }),
    ],
    facts: [
      run,
      lift,
      metric({
        id: "h1",
        athleteId: "local",
        metric: "HRV",
        value: 40,
        provider: "GARMIN",
        deviceId: "G",
        protocolKey: "RMSSD",
      }),
      metric({
        id: "h2",
        athleteId: "local",
        metric: "HRV",
        value: 80,
        provider: "COROS",
        deviceId: "C",
        protocolKey: "SDNN",
      }),
    ],
    foods: [
      {
        id: "food",
        athleteId: "local",
        date: "2026-10-22",
        kcal: 400,
        protein: null,
        carb: null,
        fat: null,
      },
    ],
    symptoms: [],
    suggestions: [],
  };
  const r = buildWeeklyReview(input);
  assert.equal(r.running.knownDistanceM, 1000);
  assert.equal(r.strength.completedSets, 2);
  assert.equal(r.strength.knownReps, 9);
  assert.equal(r.completion.completed, 1);
  assert.equal(r.completion.missed, 1);
  assert.equal(r.completion.unrecorded, 1);
  assert.equal(r.nutrition.recordedKcal, 400);
  assert.equal(r.nutrition.dayComplete, false);
  assert.equal(r.nutrition.dailyDeficitKcal, null);
  assert.equal(r.metricGroups.length, 2);
  assert.equal(r.hypotheses.length, 2);
  const revised = buildWeeklyReview({ ...input, facts: input.facts.filter((f) => f.id !== "run") });
  assert.notEqual(revised.basisVersion, r.basisVersion);
  assert.equal(revised.running.knownDistanceM, null);
});
test("next-week draft caps every dose dimension and never creates evidence or unsolicited volume", () => {
  const e = entry({ date: "2026-10-22" });
  const input = {
    athleteId: "local",
    asOf: at,
    weekStart: "2026-10-19",
    entries: [e],
    facts: [],
    foods: [],
    symptoms: [],
    suggestions: [],
  };
  const review = buildWeeklyReview(input),
    draft = buildNextWeekDraft(review, [e], [], {
      safety: "HOLD_ACTIVE",
      events: [],
      days: null,
      minutes: null,
      goal: null,
      phase: null,
    });
  assert.equal(draft.requiresConfirmation, true);
  assert.equal(draft.planWritten, false);
  assert.equal(draft.sessions[0].after.modality, "rest");
  assert.ok(draft.sessions[0].after.minutes <= 40);
  assert.equal(draft.sessions[0].after.actual, undefined);
});
test("R4 mixed queries retain both modalities and single-service queries stay scoped", () => {
  assert.equal(selectR4CourseTasks(["running", "strength"], "run"), true);
  assert.equal(selectR4CourseTasks(["running", "strength"], "strength"), true);
  assert.equal(selectR4CourseTasks(["nutrition"], "run"), false);
  assert.equal(selectR4CourseTasks(["strength"], "run"), false);
});
test("goal edit must not re-date an old profile weight above a newer measurement", async (t) => {
  const { values } = setup(t);
  values.set(
    "fr255-profile-v1",
    JSON.stringify({ weightKg: "70", _savedAt: "2026-10-20T10:00:00Z" }),
  );
  values.set(
    "fr255-body-v1",
    JSON.stringify([
      {
        id: "body",
        date: "2026-10-24",
        weight: 66,
        athleteId: "local",
        recordedAt: "2026-10-24T10:00:00Z",
      },
    ]),
  );
  const p = prepareR5Command("我的目标体重是60公斤", at);
  if (p.kind !== "PROPOSAL") throw Error("preview");
  assert.equal(readEffectiveProfile().weightKg?.value, 66);
  await decideR5Command(p.command.id, "ACCEPT", at);
  assert.equal(readEffectiveProfile().weightKg?.value, 66);
});
test("ambiguous current and target weights cannot be conflated", (t) => {
  setup(t);
  const p = prepareR5Command("我现在体重66公斤，目标是60公斤", at);
  assert.equal(p.kind, "ANSWER");
  assert.equal(loadChecks().length, 0);
});
test("weekly draft is idempotent on open, applies only on confirmation and undo preserves unrelated rows", async (t) => {
  setup(t);
  const { generateWeeklyDraft, decideWeeklyDraft, readWeeklyDocuments } =
    await import("./weekly-host");
  saveSchedule({
    entries: [
      entry({
        id: "past",
        date: "2026-10-22",
        intensity: "EASY",
        status: "done",
        actual: {
          outcome: "different",
          minutes: 20,
          km: 1.6,
          intensity: "EASY",
          note: "",
          reasons: [],
          at,
        },
      }),
    ],
    acks: [],
  });
  const d = await generateWeeklyDraft(at),
    again = await generateWeeklyDraft(at);
  assert.equal(d.id, again.id);
  assert.equal(loadSchedule().entries.length, 1);
  assert.equal(d.draft.sessions.length, 1);
  assert.equal((await decideWeeklyDraft(d.id, "ACCEPT", at)).ok, true);
  assert.equal(loadSchedule().entries.length, 2);
  assert.equal((await decideWeeklyDraft(d.id, "ACCEPT", at)).ok, false);
  assert.equal((await decideWeeklyDraft(d.id, "UNDO", at)).ok, true);
  assert.equal(loadSchedule().entries.length, 1);
  assert.equal(readWeeklyDocuments()[0].status, "UNDONE");
});
test("weekly stale drafts are rejected after a symptom correction or plan edit", async (t) => {
  setup(t);
  const { generateWeeklyDraft, decideWeeklyDraft } = await import("./weekly-host");
  saveSchedule({ entries: [entry({ date: "2026-10-22" })], acks: [] });
  const d = await generateWeeklyDraft(at);
  saveSchedule({ entries: [entry({ date: "2026-10-22", minutes: 20 })], acks: [] });
  assert.equal((await decideWeeklyDraft(d.id, "ACCEPT", at)).ok, false);
});
test("the online safety audit rejects fabricated numbers, unauthorized writes and pain clearance", async (t) => {
  setup(t);
  const { guardR5Reply } = await import("./guard");
  const packet = readAnalysis("2026-10-25", at).packet;
  assert.equal(guardR5Reply("你今天跑了99999米。", packet).ok, false);
  assert.equal(guardR5Reply("我已经替你修改了计划。", packet).ok, false);
  assert.equal(guardR5Reply("可以先说明目前资料，缺少的数据仍保持未知。", packet).ok, true);
  const hold = {
    ...packet,
    assessment: { ...packet.assessment, safetyState: "HOLD_ACTIVE" as const },
  };
  assert.equal(guardR5Reply("设备恢复正常，可以继续跑步。", hold).ok, false);
});
test("mixed run/strength remains executable in both components after the chat edit", async (t) => {
  setup(t);
  const { resolveScheduledCourse } = await import("../../ui/scheduled-execution");
  const { easyRun } = await import("./commands");
  const mixed = entry({
    trainingType: "mixed",
    exercises: [{ name: "深蹲", sets: "3", reps: "5", weight: "40", rpe: "7", restSec: 90 }],
  });
  const r = resolveScheduledCourse(easyRun(mixed), { sessions: [] }, []);
  assert.ok(r.run);
  assert.ok(r.strength);
  assert.equal(r.strength?.moves[0].sets, 3);
});
test("easy-run replacement cannot silently triple the duration of a short interval component", async () => {
  const { easyRun } = await import("./commands");
  const e = entry({
    trainingType: "mixed",
    exercises: [{ name: "深蹲", sets: "3", reps: "5", weight: "40", rpe: "7", restSec: 90 }],
  });
  const after = easyRun(e),
    run = after.runComponents?.find((c) => c.modality === "RUNNING");
  assert.ok(run && run.modality === "RUNNING" && run.structure.kind === "CONTINUOUS");
  if (!run || run.modality !== "RUNNING" || run.structure.kind !== "CONTINUOUS") return;
  assert.ok((run.structure.plannedDurationSeconds ?? 0) <= 272);
});
test("existing functional limitation is a safety hold even when pain was not recorded", async () => {
  const { evaluateRecoveryEvidence } = await import("../../health/recovery-assessment");
  const { projectAnalysisEvidence } = await import("../../health/analysis-evidence");
  const f = {
    ...metric({ id: "fn", athleteId: "local" }),
    kind: "RESPONSE" as const,
    relatedTrainingRefs: [],
    region: null,
    side: "UNSPECIFIED" as const,
    measure: "FUNCTION" as const,
    value: 1,
    scale: "FUNCTION_LIMITATION_0_1",
    observationProtocol: "self",
    elapsedHours: null,
    functionTaskId: null,
    notes: "功能受限",
  };
  const s = projectAnalysisEvidence({
    context: {
      athleteId: "local",
      asOf: at,
      timeZone: "UTC",
      planVersion: null,
      consentVersion: "NONE",
      analysisVersion: "test",
    },
    facts: [f],
  });
  assert.equal(evaluateRecoveryEvidence(s).safetyState, "HOLD_ACTIVE");
});
