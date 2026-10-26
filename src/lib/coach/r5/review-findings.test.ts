import test from "node:test";
import assert from "node:assert/strict";
import { setStoreBackend } from "../../core/storage";
import { setEventContext, currentAthleteId } from "../../core/events";
import { prepareR5Command, decideR5Command, readR5Commands } from "./host";
import { loadChecks } from "../../nutrition/body";
import { readEffectiveProfile } from "../loop/effective-host";
import { readEffectiveTrainingProfile } from "../loop/effective-training";
import { saveSchedule, loadSchedule } from "../../ui/day-schedule";
import type { ScheduleEntry } from "../../ui/day-schedule-rules";
import { readSymptoms, reviseSymptom } from "../../health/symptom-store";
import { buildWeeklyReview, buildNextWeekDraft } from "./weekly";
import { generateWeeklyDraft, decideWeeklyDraft, readWeeklyDocuments } from "./weekly-host";
import { loadProfile } from "../../strength/profile";
const at = "2026-10-25T10:00:00Z";
function fixture(t: test.TestContext) {
  const old = currentAthleteId(),
    prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    plan = Object.getOwnPropertyDescriptor(globalThis, "__FK_TEST_PLAN_DOC__"),
    map = new Map<string, string>();
  let fail: (k: string, v: string) => boolean = () => false;
  const box = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (fail(k, v)) throw Error("DISK_FULL");
      map.set(k, v);
    },
    keys: () => [...map.keys()],
  };
  Object.defineProperty(globalThis, "localStorage", { value: box, configurable: true });
  Reflect.deleteProperty(globalThis, "__FK_TEST_PLAN_DOC__");
  setStoreBackend(box);
  setEventContext({ athleteId: "local" });
  t.after(() => {
    setStoreBackend(null);
    setEventContext({ athleteId: old });
    if (prior) Object.defineProperty(globalThis, "localStorage", prior);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (plan) Object.defineProperty(globalThis, "__FK_TEST_PLAN_DOC__", plan);
  });
  return {
    map,
    failWrite: (fn: typeof fail) => {
      fail = fn;
    },
  };
}
const course = (id: string, date: string, patch: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  id,
  date,
  athleteId: "local",
  kind: "run",
  modality: "run",
  title: "轻松跑",
  focus: ["轻松"],
  minutes: 60,
  intensity: "EASY",
  lowerHeavy: false,
  source: "custom",
  refId: null,
  status: "planned",
  runComponents: [
    {
      componentId: "run",
      modality: "RUNNING",
      purpose: "EASY_AEROBIC",
      structure: {
        kind: "CONTINUOUS",
        plannedDistanceMeters: 10000,
        plannedDistanceMaxMeters: null,
        plannedDurationSeconds: 3600,
      },
    },
  ],
  ...patch,
});
const proposal = (q: string) => {
  const r = prepareR5Command(q, at);
  assert.equal(r.kind, "PROPOSAL", r.kind === "ANSWER" ? r.text : "");
  if (r.kind !== "PROPOSAL") throw Error("no proposal");
  return r.command;
};
test("current-message pain and dangerous symptoms gate every command before interception", async (t) => {
  fixture(t);
  saveSchedule({ entries: [course("thu", "2026-10-29")], acks: [] });
  for (const q of [
    "周四改成轻松跑，左膝疼痛5分，走路受限",
    "我体重66公斤，现在胸痛喘不过气",
    "下周计划，我膝盖痛并且走路受限",
  ]) {
    const r = prepareR5Command(q, at);
    assert.equal(r.kind, "ANSWER");
    if (r.kind === "ANSWER") assert.match(r.text, /暂停|停止|医疗|急救/);
  }
  assert.equal(readR5Commands().length, 0);
  assert.equal(loadSchedule().entries[0].minutes, 60);
});
test("historical measurement correction cannot outrank a newer current profile measurement", async (t) => {
  const { map } = fixture(t);
  map.set("fr255-profile-v1", JSON.stringify({ weightKg: "66", _savedAt: at }));
  const c = proposal("更正2026-10-10体重70公斤");
  assert.ok((await decideR5Command(c.id, "ACCEPT", at)).ok);
  assert.equal(readEffectiveProfile().weightKg?.value, 66);
});
test("undo of a symptom refuses subsequent health revisions", async (t) => {
  fixture(t);
  const c = proposal("我左膝疼痛3分，持续2天");
  await decideR5Command(c.id, "ACCEPT", at);
  const row = readSymptoms(at)[0];
  assert.ok(
    reviseSymptom(row.id, row.revision, { severity: 8, functionImpact: "UNABLE" }, false, at).ok,
  );
  assert.equal((await decideR5Command(c.id, "UNDO", at)).ok, false);
  assert.equal(readSymptoms(at)[0].severity, 8);
});
test("array profile patches and newly introduced optional fields restore absence on undo", async (t) => {
  const { map } = fixture(t);
  const c = proposal("训练日是周一、周三、周五");
  await decideR5Command(c.id, "ACCEPT", at);
  assert.deepEqual(loadProfile().trainingDays, [1, 3, 5]);
  assert.ok((await decideR5Command(c.id, "UNDO", at)).ok);
  assert.equal(loadProfile().trainingDays, undefined);
  const gear = proposal("器材是哑铃");
  await decideR5Command(gear.id, "ACCEPT", at);
  await decideR5Command(gear.id, "UNDO", at);
  assert.equal(loadProfile().equipment, undefined);
  assert.equal(Object.hasOwn(JSON.parse(map.get("fr255-profile-v1")!), "equipment"), false);
});
test("legacy unowned body measurement is restored by a valid compensating projection", async (t) => {
  const { map } = fixture(t);
  map.set("fr255-body-v1", JSON.stringify([{ id: "old", date: "2026-10-25", weight: 68 }]));
  const c = proposal("我现在体重66公斤");
  await decideR5Command(c.id, "ACCEPT", at);
  assert.equal(loadChecks()[0].weight, 66);
  assert.ok((await decideR5Command(c.id, "UNDO", at)).ok);
  assert.equal(loadChecks()[0].weight, 68);
});
test("a note-only save never confirms UI defaults as minutes or weekly frequency", async (t) => {
  fixture(t);
  const c = proposal("备注：周末有空");
  await decideR5Command(c.id, "ACCEPT", at);
  const p = readEffectiveTrainingProfile();
  assert.equal(p.minutes, null);
  assert.equal(p.daysPerWeek, null);
  assert.equal(p.notes?.value, "周末有空");
});
test("local clause binding preserves current weight and exact requested weekday", (t) => {
  fixture(t);
  assert.equal(proposal("我现在体重66公斤，目标是减脂").kind, "MEASUREMENT");
  saveSchedule({
    entries: [
      course("mon", "2026-10-26", {
        modality: "strength",
        kind: "strength",
        runComponents: undefined,
        exercises: [{ name: "深蹲", sets: "3", reps: "5", weight: "40", rpe: "7", restSec: 90 }],
      }),
      course("thu", "2026-10-29", {
        modality: "strength",
        kind: "strength",
        runComponents: undefined,
        exercises: [{ name: "深蹲", sets: "3", reps: "5", weight: "40", rpe: "7", restSec: 90 }],
      }),
    ],
    acks: [],
  });
  const c = proposal("下周四力量减少一组");
  assert.deepEqual(
    c.pairs?.map((p) => p.after.id),
    ["thu"],
  );
});
test("multiple supported profile fields are retained in one explicit diff", async (t) => {
  fixture(t);
  const c = proposal("我今年40岁，身高180厘米");
  assert.equal(c.profile?.patch.age, "40");
  assert.equal(c.profile?.patch.heightCm, "180");
  await decideR5Command(c.id, "ACCEPT", at);
  assert.equal(loadProfile().heightCm, "180");
});
test("week draft uses actual ceilings and becomes non-executable when the ceiling is unknown", () => {
  const prior = course("past", "2026-10-22", {
    status: "done",
    actual: {
      outcome: "different",
      minutes: 20,
      km: 3,
      intensity: "EASY",
      note: "",
      reasons: [],
      at,
    },
  });
  const input = {
    athleteId: "local",
    asOf: at,
    weekStart: "2026-10-19",
    entries: [prior],
    facts: [],
    foods: [],
    symptoms: [],
    suggestions: [],
  };
  const r = buildWeeklyReview(input),
    c = { safety: "NO_KNOWN_HOLD", events: [], days: null, minutes: null, goal: null, phase: null };
  const d = buildNextWeekDraft(r, [prior], [], c);
  assert.equal(d.executable, true);
  assert.ok(d.sessions.reduce((n, p) => n + p.after.minutes, 0) <= 20);
  const run = d.sessions[0].after.runComponents?.[0];
  if (run?.modality === "RUNNING" && run.structure.kind === "CONTINUOUS")
    assert.ok((run.structure.plannedDistanceMeters ?? 0) <= 3000);
  const unknown = buildNextWeekDraft(
    buildWeeklyReview({ ...input, entries: [{ ...prior, actual: undefined }] }),
    [{ ...prior, actual: undefined }],
    [],
    c,
  );
  assert.equal(unknown.executable, false);
});
test("calendar receipts recover weekly accept and undo after journal failures", async (t) => {
  const { failWrite } = fixture(t);
  saveSchedule({
    entries: [
      course("past", "2026-10-22", {
        status: "done",
        actual: {
          outcome: "different",
          minutes: 20,
          km: 3,
          intensity: "EASY",
          note: "",
          reasons: [],
          at,
        },
      }),
    ],
    acks: [],
  });
  const d = await generateWeeklyDraft(at);
  failWrite(
    (k, v) =>
      k.startsWith("fk-r5-week:") &&
      (v.includes('"status":"ACCEPTED"') || v.includes('"status":"UNDONE"')),
  );
  await decideWeeklyDraft(d.id, "ACCEPT", at);
  assert.equal(loadSchedule().entries.length, 2);
  assert.equal(readWeeklyDocuments()[0].status, "ACCEPTED");
  await decideWeeklyDraft(d.id, "UNDO", at);
  assert.equal(loadSchedule().entries.length, 1);
  assert.equal(readWeeklyDocuments()[0].status, "UNDONE");
});
test("ordinary undo receipts remain authoritative when the card journal cannot save", async (t) => {
  const { failWrite } = fixture(t);
  const c = proposal("我现在体重66公斤");
  await decideR5Command(c.id, "ACCEPT", at);
  failWrite((k, v) => k.startsWith("fk-r5-command:") && v.includes('"status":"UNDONE"'));
  await decideR5Command(c.id, "UNDO", at);
  assert.equal(readR5Commands()[0].status, "UNDONE");
  assert.equal((await decideR5Command(c.id, "UNDO", at)).ok, false);
});
test("an in-flight online answer is rejected after a new profile restriction is confirmed", async (t) => {
  fixture(t);
  const { askOnlineCoach, setOnline } = await import("../online-coach");
  setOnline(true);
  const previous = globalThis.fetch;
  let release: (r: Response) => void = () => {};
  globalThis.fetch = (() =>
    new Promise<Response>((r) => {
      release = r;
    })) as typeof fetch;
  t.after(() => {
    globalThis.fetch = previous;
  });
  const pending = askOnlineCoach({
    question: "只解释已有事实",
    snapshotRef: { snapshotId: "synthetic-r5", consentId: "synthetic-r5", asOf: new Date().toISOString() },
    facts: "当前资料未完整确认",
    local: "",
    history: [],
  });
  const c = proposal("身体限制：医生要求暂停跑步");
  await decideR5Command(c.id, "ACCEPT", at);
  release(
    new Response(JSON.stringify({ text: "这段说明依据此前的记录。", ok: true, planChanged: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const result = await pending;
  assert.ok("error" in result);
  if ("error" in result) assert.match(result.error, /变化|核验/);
});
test("online numbers matching another known metric do not establish factual source binding", async () => {
  const { guardR5Reply } = await import("./guard");
  const { metric } = await import("../../health/analysis-fixtures");
  const { projectAnalysisEvidence } = await import("../../health/analysis-evidence");
  const { buildMuscleExposure } = await import("../../health/muscle-exposure");
  const { evaluateRecoveryEvidence } = await import("../../health/recovery-assessment");
  const { buildCoachAnalysisPacket } = await import("../../health/analysis-packet");
  const s = projectAnalysisEvidence({
      context: {
        athleteId: "local",
        asOf: at,
        timeZone: "UTC",
        planVersion: null,
        consentVersion: "NONE",
        analysisVersion: "test",
      },
      facts: [
        metric({ id: "sleep", athleteId: "local", metric: "SLEEP", value: 6, unit: "h" }),
        metric({ id: "hrv", athleteId: "local", metric: "HRV", value: 40, unit: "ms" }),
      ],
    }),
    exposure = buildMuscleExposure(s),
    packet = buildCoachAnalysisPacket(s, evaluateRecoveryEvidence(s, exposure), exposure);
  assert.equal(guardR5Reply("你的HRV是6 ms。", packet).ok, false);
});

test("same-timestamp weekly regeneration surfaces the newest revised document", async (t) => {
  fixture(t);
  const first = await generateWeeklyDraft(at);
  saveSchedule({
    entries: [
      course("past", "2026-10-22", {
        status: "done",
        actual: {
          outcome: "different",
          minutes: 20,
          km: 3,
          intensity: "EASY",
          note: "",
          reasons: [],
          at,
        },
      }),
    ],
    acks: [],
  });
  const revised = await generateWeeklyDraft(at, true);
  assert.notEqual(first.id, revised.id);
  assert.equal(readWeeklyDocuments()[0].id, revised.id);
  assert.equal(readWeeklyDocuments()[0].review.completion.completed, 1);
});
