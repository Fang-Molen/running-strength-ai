import test from "node:test";
import assert from "node:assert/strict";
import { setStoreBackend } from "../../core/storage";
import { currentAthleteId, setEventContext } from "../../core/events";
import { loadSchedule, saveSchedule } from "../../ui/day-schedule";
import { saveProfile, emptyProfile } from "../../strength/profile";
import { appendSymptom } from "../../health/symptom-store";
import {
  readCycleGoal,
  saveCycleGoal,
  prepareCycle,
  readCycleDocuments,
  decideCycle,
  refreshCycleFeedback,
  cycleRevisionState,
  readCycleContext,
  cycleCoachSummary,
} from "./host";
import { cycleFixture } from "./fixtures";
const now = "2026-10-25T10:00:00Z";
function setup(t: test.TestContext) {
  const owner = currentAthleteId(),
    prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    plan = Object.getOwnPropertyDescriptor(globalThis, "__FK_TEST_PLAN_DOC__"),
    map = new Map<string, string>();
  let fail = (key: string) => false;
  const box = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (fail(k)) throw Error("DISK_FULL");
      map.set(k, v);
    },
    keys: () => [...map.keys()],
  };
  Reflect.deleteProperty(globalThis, "__FK_TEST_PLAN_DOC__");
  setStoreBackend(box);
  setEventContext({ athleteId: "local" });
  Object.defineProperty(globalThis, "localStorage", { value: box, configurable: true });
  saveProfile({
    ...emptyProfile(),
    age: "30",
    sex: "male",
    heightCm: "178",
    weightKg: "66",
    aim: "keep",
    minutes: 60,
    days: 3,
    trainingDays: [1, 3, 5],
    equipment: "NONE",
  });
  appendSymptom(
    {
      kind: "PAIN",
      region: "膝",
      side: "LEFT",
      severity: 0,
      durationHours: 0,
      trigger: null,
      functionImpact: "NORMAL",
      trend: "STABLE",
      notes: "合成当前晨检，仅记录无痛，不解除任何原限制",
      trainingRefs: [],
      occurredAt: now,
    },
    now,
  );
  saveSchedule({
    entries: cycleFixture().entries.map((e) => ({
      ...e,
      athleteId: "local",
      intensity: "EASY",
      // These are independent manual calendar actuals, not imported canonical occurrences.
      actual: { ...e.actual!, intensity: "EASY", occurrenceIds: undefined },
    })),
    acks: [],
  });
  t.after(() => {
    setStoreBackend(null);
    setEventContext({ athleteId: owner });
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
const values = () => {
  const { schema, athleteId, revision, savedAt, source, ...v } = cycleFixture().goal;
  return v;
};
const goal = () => saveCycleGoal(values(), 0, now);
test("goal save is explicit, versioned, separate from measured ability and calendar", async (t) => {
  setup(t);
  const before = loadSchedule();
  assert.equal(readCycleGoal(), null);
  const g = await goal();
  assert.equal(g.revision, 1);
  assert.deepEqual(loadSchedule(), before);
  await assert.rejects(saveCycleGoal(values(), 0, now), /已变化/);
});
test("cycle preview does not write, confirmation only adds first week and undo restores exact originals", async (t) => {
  setup(t);
  await goal();
  const before = loadSchedule(),
    d = await prepareCycle(now);
  assert.deepEqual(loadSchedule(), before);
  assert.equal(d.draft.weeks.length, 8);

  {
    const result = await decideCycle(d.id, "ACCEPT", now);
    assert.equal(result.ok, true, result.message);
  }
  assert.equal(loadSchedule().entries.length, before.entries.length + 3);
  assert.ok(
    loadSchedule()
      .entries.filter((e) => e.id.startsWith("cycle:"))
      .every((e) => e.date <= "2026-11-01"),
  );
  assert.equal((await decideCycle(d.id, "ACCEPT", now)).ok, false);
  assert.equal((await decideCycle(d.id, "UNDO", now)).ok, true);
  assert.deepEqual(loadSchedule(), before);
});
test("unknown goal remains useful as a conditional rolling draft but cannot confirm", async (t) => {
  setup(t);
  const d = await prepareCycle(now);
  assert.ok(d.draft.weeks.length);
  assert.equal((await decideCycle(d.id, "ACCEPT", now)).ok, false);
});
test("same basis is idempotent; a goal date change invalidates pending confirmation", async (t) => {
  setup(t);
  await goal();
  const d = await prepareCycle(now);
  assert.equal((await prepareCycle(now)).id, d.id);
  await saveCycleGoal({ ...values(), raceDate: "2026-11-01" }, 1, now);
  assert.equal((await decideCycle(d.id, "ACCEPT", now)).ok, false);
  const revised = await prepareCycle(now);
  assert.notEqual(revised.id, d.id);
  assert.equal(revised.draft.weeks[0].phase, "TAPER");
  assert.equal(readCycleDocuments().find((x) => x.id === d.id)?.status, "STALE");
});
test("account switch cannot read or confirm another account cycle", async (t) => {
  setup(t);
  await goal();
  const d = await prepareCycle(now);
  setEventContext({ athleteId: "OTHER" });
  assert.equal(readCycleGoal(), null);
  assert.equal(readCycleDocuments().length, 0);
  assert.equal((await decideCycle(d.id, "ACCEPT", now)).ok, false);
});
test("new pain invalidates and blocks a pending cycle regardless of prior normal status", async (t) => {
  setup(t);
  await goal();
  const d = await prepareCycle(now);
  appendSymptom(
    {
      kind: "PAIN",
      region: "膝",
      side: "LEFT",
      severity: 6,
      durationHours: 24,
      trigger: "跑步",
      functionImpact: "LIMITED",
      trend: "WORSENING",
      notes: "合成",
      trainingRefs: [],
      occurredAt: now,
    },
    now,
  );
  assert.equal((await decideCycle(d.id, "ACCEPT", now)).ok, false);
  const revised = await prepareCycle(now);
  assert.equal(revised.draft.hold, true);
});
test("reject never modifies formal calendar and cannot later accept the same token", async (t) => {
  setup(t);
  await goal();
  const d = await prepareCycle(now),
    before = loadSchedule();
  assert.equal((await decideCycle(d.id, "REJECT", now)).ok, true);
  assert.deepEqual(loadSchedule(), before);
  assert.equal((await decideCycle(d.id, "ACCEPT", now)).ok, false);
});
test("later course edits and actual execution block destructive undo", async (t) => {
  setup(t);
  await goal();
  const d = await prepareCycle(now);
  {
    const result = await decideCycle(d.id, "ACCEPT", now);
    assert.equal(result.ok, true, result.message);
  }
  const s = loadSchedule(),
    id = d.draft.weeks[0].sessions.find((s) => s.candidate)!.candidate!.id;
  saveSchedule({
    ...s,
    entries: s.entries.map((e) => (e.id === id ? { ...e, title: "用户后来修改" } : e)),
  });
  assert.equal((await decideCycle(d.id, "UNDO", now)).ok, false);
  assert.equal(loadSchedule().entries.find((e) => e.id === id)?.title, "用户后来修改");
});
test("atomic calendar receipt remains authoritative when the card journal fails after acceptance", async (t) => {
  const f = setup(t);
  await goal();
  const d = await prepareCycle(now);
  f.failWrite((k) => k.startsWith("fk-cycle:draft:"));
  {
    const result = await decideCycle(d.id, "ACCEPT", now);
    assert.equal(result.ok, true, result.message);
  }
  assert.equal(readCycleDocuments()[0].status, "ACCEPTED");
  assert.equal((await decideCycle(d.id, "ACCEPT", now)).ok, false);
  f.failWrite(() => false);
  assert.equal((await decideCycle(d.id, "UNDO", now)).ok, true);
});
test("historical corrections withdraw dependent conclusions without rewriting old drafts", async (t) => {
  setup(t);
  await goal();
  const d = await prepareCycle(now);
  {
    const result = await decideCycle(d.id, "ACCEPT", now);
    assert.equal(result.ok, true, result.message);
  }
  const s = loadSchedule(),
    old = s.entries.find((e) => !e.id.startsWith("cycle:"))!;
  saveSchedule({
    ...s,
    entries: s.entries.map((e) =>
      e.id === old.id ? { ...e, actual: { ...e.actual!, minutes: 10 } } : e,
    ),
  });
  assert.equal(cycleRevisionState(readCycleDocuments()[0], now), "NEEDS_REVIEW");
  const after = refreshCycleFeedback(now)[0];
  assert.equal(after.feedback?.state, "WITHDRAWN");
  assert.ok(after.history.some((h) => h.action === "FEEDBACK_WITHDRAWN"));
  assert.equal(d.draft.weeks[0].sessions[0].candidate?.actual, undefined);
});

test("unchanged evidence remains confirmable as the clock advances within the same day", async (t) => {
  setup(t);
  await goal();
  const d = await prepareCycle(now);
  assert.equal(cycleRevisionState(d, "2026-10-25T10:00:01Z"), "CURRENT");
  assert.equal((await decideCycle(d.id, "ACCEPT", "2026-10-25T10:00:01Z")).ok, true);
});
test("current cycle facts stay local until server authorization; stale candidate structure is withheld", async (t) => {
  setup(t);
  t.mock.timers.enable({ apis: ["Date"], now: new Date(now) });
  await goal();
  await prepareCycle(now);
  const { askOnlineCoach, setOnline } = await import("../online-coach");
  const old = globalThis.fetch;
  let sent = "";
  globalThis.fetch = (async (_url, init) => {
    sent = String(init?.body);
    return new Response(JSON.stringify({ text: "合成回复，仅核对传输。" }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  setOnline(true);
  await askOnlineCoach({
    question: "解释周期计划",
    facts: "已核对实际训练",
    local: "",
    history: [],
  });
  assert.equal(sent, "");
  const summary = cycleCoachSummary(now);
  assert.match(summary, /FK_CYCLE_PROMPT_1/);
  assert.match(summary, /最近一周候选/);
  assert.match(summary, /连续跑/);
  await saveCycleGoal({ ...values(), eventMeters: 1500 }, 1, now);
  assert.doesNotMatch(cycleCoachSummary(now), /FK_CYCLE_PROMPT_1/);
});
test("older accepted draft can be undone after a newer draft exists", async (t) => {
  setup(t);
  await goal();
  const d = await prepareCycle(now);
  assert.equal((await decideCycle(d.id, "ACCEPT", now)).ok, true);
  await saveCycleGoal({ ...values(), eventMeters: 1500 }, 1, now);
  const newer = await prepareCycle(now);
  assert.notEqual(newer.id, d.id);
  assert.equal(readCycleDocuments()[0].id, newer.id);
  assert.equal((await decideCycle(d.id, "UNDO", now)).ok, true);
  assert.equal(loadSchedule().entries.length, 6);
});
test('explicit four-week window survives version check, confirmation and undo without changing goal',async(t)=>{
 setup(t);
 const g=cycleFixture().goal;await saveCycleGoal({...g,horizonWeeks:8},0,now);
 const before=loadSchedule().entries.length;
 const d=await prepareCycle(now,{historyDays:14,horizonWeeks:4});
 assert.equal(d.draft.weeks.length,4);assert.equal(readCycleGoal()!.horizonWeeks,8);assert.equal(cycleRevisionState(d,now),'CURRENT');assert.equal(loadSchedule().entries.length,before);
 assert.equal(d.draft.weeks[0].canConfirm,true,'manual actual course should remain usable');
 assert.equal((await decideCycle(d.id,'ACCEPT',now)).ok,true);
 assert.equal((await decideCycle(d.id,'UNDO',now)).ok,true);assert.equal(loadSchedule().entries.length,before);
});
