import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { TrackRunner } from "../../components/track-session.tsx";
import {
  appendIntakeAnswer,
  buildFirstWeek,
  loadIntake,
  recordFirstWeekChoice,
  savedFirstWeekDraft,
  startFirstWeekSession,
} from "./coach-first-week.ts";
import {
  firstWeekInputs,
  firstWeekMemory,
  FIRST_WEEK_TEST_DAY as today,
} from "./coach-first-week.fixtures.ts";
import { setStoreBackend } from "./storage.ts";
import { loadEvents, EVENTS_KEY } from "./events.ts";
import {
  getTrainingOccurrence,
  listTrainingOccurrences,
  TRAINING_OCCURRENCE_KEY,
} from "./occurrence.ts";
import {
  getRunningPlanSnapshot,
  getRunningPlan,
  saveRunningPlan,
  RUNNING_PLAN_KEY,
  listRunningPlans,
} from "./running-plan.ts";
import {
  commitRunningTransaction,
  loadRunningTransactions,
  RUNNING_TRANSACTION_PREFIX,
  runningFeedback,
  explainRunningFeedback,
} from "./running-transaction.ts";
import { projectRunningExecution } from "./running-execution.ts";
import {
  commitTrackContinuous,
  commitTrackSlot,
  finishTrackSession,
  recordTrackRecoveryFeedback,
  startTrackSession,
  startTrackSessionSafely,
  withRunningWriteLock,
} from "../ui/running-workouts.ts";
import { assembleCoachBrief } from "./coach-brief.ts";
import { answerLocally } from "./coach-local-first.ts";
import { collectLocalBackup, restoreLocalBackup } from "./trial.ts";

function intake(novice = false) {
  const m = firstWeekMemory();
  setStoreBackend(m);
  const i = firstWeekInputs();
  i.availability.startDate = today;
  i.availability.weekdays = [0, 2, 4];
  if (novice) {
    i.ability.experienceMonths = 0;
    i.ability.current400Seconds = null;
    i.ability.measuredOn = null;
    i.ability.timing = "unknown";
    i.recent.sessionsPerWeek = 0;
  }
  const id = "isolated-400";
  for (const field of Object.keys(i) as (keyof typeof i)[])
    assert.equal(appendIntakeAnswer(id, field, i[field] as never).ok, true);
  const d = buildFirstWeek(loadIntake(id), today).draft!;
  assert.ok(d);
  const day = d.sessions.find((x) => x.date === today)!;
  return { m, id, d, day };
}
function begin(novice = false) {
  const x = intake(novice);
  assert.equal(recordFirstWeekChoice(x.id, x.d, "ACCEPT"), true);
  const r = startFirstWeekSession(x.id, x.d.id, x.day.id, today);
  assert.ok(r.ok);
  return { ...x, occ: r.trainingOccurrenceId };
}
function complete(occ: string) {
  let v = projectRunningExecution(occ, loadEvents());
  for (const c of v.continuous)
    assert.equal(
      commitTrackContinuous(occ, c.componentId, String(c.plannedDurationSeconds), "").ok,
      true,
    );
  v = projectRunningExecution(occ, loadEvents());
  for (const s of v.repetitions)
    assert.equal(commitTrackSlot(s, "complete", "31", String(s.plannedDistanceMeters)).ok, true);
}
function simplePlan(id: string) {
  return saveRunningPlan({
    planId: id,
    planSlotId: id,
    components: [
      {
        componentId: "main",
        modality: "RUNNING",
        purpose: "EASY_AEROBIC",
        structure: {
          kind: "CONTINUOUS",
          plannedDistanceMeters: null,
          plannedDistanceMaxMeters: null,
          plannedDurationSeconds: 300,
        },
      },
    ],
  });
}

test("400m real-use service chain: questions → editable candidate → acceptance → actual → atomic finish → reload → changed next analysis", () => {
  const { m, id, d, day, occ } = begin();
  assert.equal(d.currentAbilitySeconds, 57);
  assert.equal(d.goalSeconds, 55);
  const first = projectRunningExecution(occ, loadEvents());
  assert.equal(first.repetitions.length, 6);
  assert.equal(first.repetitions[0]!.roundOrdinal, 1);
  assert.equal(first.repetitions.at(-1)!.roundOrdinal, 2);
  complete(occ);
  assert.equal(finishTrackSession(occ, "COMPLETED", 9, 0).ok, true);
  const before = loadEvents().map((x) => x.event_id);
  setStoreBackend({ ...m });
  assert.equal(getTrainingOccurrence(occ)?.lifecycle, "COMPLETED");
  assert.equal(projectRunningExecution(occ, loadEvents()).terminal, true);
  assert.deepEqual(
    loadEvents().map((x) => x.event_id),
    before,
  );
  assert.equal(savedFirstWeekDraft(loadIntake(id))?.id, d.id);
  const restored = startFirstWeekSession(id, d.id, day.id, "2026-10-12");
  assert.ok(restored.ok);
  assert.equal(restored.trainingOccurrenceId, occ);
  const next = buildFirstWeek(loadIntake(id), today);
  assert.equal(next.status, "NEEDS_INFO");
  assert.equal(next.nextField, "limits");
  assert.match(next.issues.join(" "), /高RPE/);
  const analysis = answerLocally(assembleCoachBrief(null, "400米下一次怎么练", occ));
  assert.match(analysis.text, /RPE 9/);
  assert.match(analysis.text, /不自动增加/);
});
test("novice candidate is executable as continuous warmup/main/cooldown without invented performance", () => {
  const { d, occ } = begin(true);
  assert.equal(d.currentAbilitySeconds, null);
  assert.equal(projectRunningExecution(occ, loadEvents()).repetitions.length, 0);
  assert.equal(projectRunningExecution(occ, loadEvents()).continuous.length, 3);
  complete(occ);
  assert.equal(finishTrackSession(occ, "COMPLETED", 4, null).ok, true);
});
test("cannot begin unaccepted, rejected, edited, future or rest-day candidate", () => {
  const x = intake();
  assert.equal(startFirstWeekSession(x.id, x.d.id, x.day.id, today).ok, false);
  recordFirstWeekChoice(x.id, x.d, "REJECT");
  assert.equal(startFirstWeekSession(x.id, x.d.id, x.day.id, today).ok, false);
  recordFirstWeekChoice(x.id, x.d, "ACCEPT");
  assert.equal(startFirstWeekSession(x.id, x.d.id, x.day.id, "2026-10-10").ok, false);
  const rest = x.d.sessions.find((s) => s.kind === "REST")!;
  assert.equal(startFirstWeekSession(x.id, x.d.id, rest.id, today).ok, false);
  assert.equal(listTrainingOccurrences().length, 0);
});
test("confirmed candidate with new pain cannot start and does not generate training facts", () => {
  const x = intake();
  recordFirstWeekChoice(x.id, x.d, "ACCEPT");
  const previous = loadIntake(x.id).find((r) => r.field === "limits")!;
  appendIntakeAnswer(x.id, "limits", { ...firstWeekInputs().limits, pain: "PRESENT" }, previous.id);
  assert.equal(startFirstWeekSession(x.id, x.d.id, x.day.id, today).ok, false);
  assert.equal(loadEvents().length, 0);
});
test("one failed start commit leaves no event, occurrence, snapshot or candidate plan; retry succeeds", () => {
  const x = intake();
  recordFirstWeekChoice(x.id, x.d, "ACCEPT");
  const baseline = new Map(x.m.data);
  let writes = 0;
  setStoreBackend({
    ...x.m,
    setItem(k, v) {
      writes++;
      throw Error("QUOTA");
    },
  });
  assert.equal(startFirstWeekSession(x.id, x.d.id, x.day.id, today).ok, false);
  assert.equal(writes, 1);
  assert.deepEqual(x.m.data, baseline);
  assert.equal(loadEvents().length, 0);
  assert.equal(listTrainingOccurrences().length, 0);
  assert.equal(listRunningPlans().length, 0);
  setStoreBackend(x.m);
  assert.equal(startFirstWeekSession(x.id, x.d.id, x.day.id, today).ok, true);
});
test("interrupted serialization/partial physical write is never projected or reported successful", () => {
  const x = intake();
  recordFirstWeekChoice(x.id, x.d, "ACCEPT");
  setStoreBackend({
    ...x.m,
    setItem(k, v) {
      x.m.setItem(k, v.slice(0, 100));
      throw Error("INTERRUPTED");
    },
  });
  assert.equal(startFirstWeekSession(x.id, x.d.id, x.day.id, today).ok, false);
  assert.equal(loadEvents().length, 0);
  assert.equal(listTrainingOccurrences().length, 0);
  assert.equal(loadRunningTransactions().length, 0);
  assert.ok(x.m.keys().some((k) => k.startsWith(RUNNING_TRANSACTION_PREFIX))); // failure artifact retained for diagnosis
});
test("silent no-op write/readback mismatch cannot report successful start", () => {
  const x = intake();
  recordFirstWeekChoice(x.id, x.d, "ACCEPT");
  setStoreBackend({ ...x.m, setItem() {} });
  assert.equal(startFirstWeekSession(x.id, x.d.id, x.day.id, today).ok, false);
  assert.equal(listTrainingOccurrences().length, 0);
});
test("failed end commit preserves prior actual data, stays open and does not partially save RPE", () => {
  const { m, occ } = begin();
  complete(occ);
  const before = loadEvents().map((x) => x.event_id),
    n = runningFeedback().length;
  setStoreBackend({
    ...m,
    setItem() {
      throw Error("QUOTA");
    },
  });
  assert.equal(finishTrackSession(occ, "COMPLETED", 9, 0).ok, false);
  assert.equal(getTrainingOccurrence(occ)?.lifecycle, "IN_PROGRESS");
  assert.deepEqual(
    loadEvents().map((x) => x.event_id),
    before,
  );
  assert.equal(runningFeedback().length, n);
  setStoreBackend(m);
  assert.equal(finishTrackSession(occ, "COMPLETED", 9, 0).ok, true);
});
test("early end preserves unknown remaining segments and rejects post-close writes and duplicate close", () => {
  const { occ } = begin();
  const slot = projectRunningExecution(occ, loadEvents()).repetitions[0]!;
  assert.equal(finishTrackSession(occ, "COMPLETED", 4, 0).ok, false);
  assert.equal(finishTrackSession(occ, "INTERRUPTED", null, null).ok, true);
  assert.equal(getTrainingOccurrence(occ)?.lifecycle, "INTERRUPTED");
  assert.ok(
    projectRunningExecution(occ, loadEvents()).repetitions.every(
      (x) => x.status === "NOT_RECORDED",
    ),
  );
  assert.equal(commitTrackSlot(slot, "complete", "30", "200").ok, false);
  assert.equal(finishTrackSession(occ, "INTERRUPTED", 4, 0).ok, false);
  assert.match(explainRunningFeedback(occ), /RPE 未知/);
});
test("concurrent clients append independent multi-entity starts without loss or overwrite", () => {
  const m = firstWeekMemory();
  setStoreBackend(m);
  simplePlan("A");
  simplePlan("B");
  const b = { ...m };
  let injected = false,
    other: ReturnType<typeof startTrackSession> | null = null;
  const a = {
    ...m,
    setItem(k: string, v: string) {
      if (k.startsWith(RUNNING_TRANSACTION_PREFIX) && !injected) {
        injected = true;
        setStoreBackend(b);
        other = startTrackSession("B");
        setStoreBackend(a);
      }
      m.setItem(k, v);
    },
  };
  setStoreBackend(a);
  const first = startTrackSession("A");
  assert.ok(first.ok);
  assert.ok(other && (other as ReturnType<typeof startTrackSession>).ok);
  setStoreBackend(m);
  assert.equal(listTrainingOccurrences().length, 2);
  assert.equal(loadEvents().filter((e) => e.event_type === "TRAINING_STARTED").length, 2);
  for (const o of listTrainingOccurrences())
    assert.ok(getRunningPlanSnapshot(o.trainingOccurrenceId));
});
test("concurrent conflicting plan edits retain both branches and refuse successful ambiguous plan", () => {
  const m = firstWeekMemory();
  setStoreBackend(m);
  simplePlan("same");
  const prev = JSON.stringify(getRunningPlan("same"));
  const original = getRunningPlan("same")!;
  const a = { ...original, components: [{ ...original.components[0]!, componentId: "a" }] },
    b = { ...original, components: [{ ...original.components[0]!, componentId: "b" }] };
  assert.equal(
    commitRunningTransaction({
      version: 1,
      id: "branchA",
      events: [],
      plans: [{ plan: a, previous: prev }],
    }),
    true,
  );
  assert.equal(
    commitRunningTransaction({
      version: 1,
      id: "branchB",
      events: [],
      plans: [{ plan: b, previous: prev }],
    }),
    true,
  );
  assert.equal(getRunningPlan("same"), null);
  assert.equal(startTrackSession("same").ok, false);
  assert.equal(loadRunningTransactions().flatMap((x) => x.plans ?? []).length, 3);
});
test("browser lock serializes concurrent same-plan start; unsupported lock refuses without write", async () => {
  const m = firstWeekMemory();
  setStoreBackend(m);
  simplePlan("locked");
  const win = Object.getOwnPropertyDescriptor(globalThis, "window"),
    nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let queue = Promise.resolve();
  try {
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        locks: {
          request(_name: string, fn: () => unknown) {
            const job = queue.then(fn);
            queue = job.then(() => undefined);
            return job;
          },
        },
      },
      configurable: true,
    });
    const result = await Promise.all([
      startTrackSessionSafely("locked"),
      startTrackSessionSafely("locked"),
    ]);
    assert.ok(result[0]!.ok && result[1]!.ok);
    if (result[0]!.ok && result[1]!.ok)
      assert.equal(result[0].trainingOccurrenceId, result[1].trainingOccurrenceId);
    assert.equal(listTrainingOccurrences().length, 1);
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    const before = m.data.size;
    const failed = await withRunningWriteLock(() => simplePlan("must-not-save"));
    assert.equal(failed.ok, false);
    assert.equal(m.data.size, before);
  } finally {
    if (win) Object.defineProperty(globalThis, "window", win);
    else Reflect.deleteProperty(globalThis, "window");
    if (nav) Object.defineProperty(globalThis, "navigator", nav);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
test("24/48h observations reject premature input, bind source, survive refresh and affect next explanation", () => {
  const { m, occ } = begin(true);
  complete(occ);
  finishTrackSession(occ, "COMPLETED", 4, 0);
  const started = Date.parse(getTrainingOccurrence(occ)!.startedAt!);
  assert.equal(
    recordTrackRecoveryFeedback(occ, "24H", 2, 0, new Date(started + 3600000)).ok,
    false,
  );
  assert.equal(
    recordTrackRecoveryFeedback(occ, "24H", 2, 0, new Date(started + 24 * 3600000)).ok,
    true,
  );
  assert.equal(
    recordTrackRecoveryFeedback(occ, "24H", 8, 0, new Date(started + 24 * 3600000)).ok,
    false,
  );
  assert.equal(
    recordTrackRecoveryFeedback(occ, "48H", 7, null, new Date(started + 48 * 3600000)).ok,
    true,
  );
  setStoreBackend({ ...m });
  assert.equal(runningFeedback().length, 3);
  assert.match(explainRunningFeedback(occ), /低恢复/);
  assert.match(explainRunningFeedback(occ), /48H/);
});
test("original plan and personal legacy keys are byte-for-byte untouched by candidate chain", () => {
  const x = intake();
  for (const k of [EVENTS_KEY, TRAINING_OCCURRENCE_KEY, RUNNING_PLAN_KEY, "fr255-state-v1"])
    x.m.setItem(k, JSON.stringify({ personal: "sentinel", data: k === EVENTS_KEY ? [] : null }));
  const before = new Map(x.m.data);
  recordFirstWeekChoice(x.id, x.d, "ACCEPT");
  const r = startFirstWeekSession(x.id, x.d.id, x.day.id, today);
  assert.ok(r.ok);
  finishTrackSession(r.trainingOccurrenceId, "INTERRUPTED", 5, 0);
  for (const [k, v] of before) assert.equal(x.m.getItem(k), v);
});
test("transaction backup round trip retains candidate start/close/feedback with no re-inference", () => {
  const { m, occ } = begin(true);
  complete(occ);
  finishTrackSession(occ, "COMPLETED", 5, 0);
  const storage = (data: Map<string, string>) => ({
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  });
  const raw = collectLocalBackup(storage(m.data)),
    restored = new Map<string, string>();
  assert.equal(restoreLocalBackup(raw, storage(restored)).ok, true);
  setStoreBackend({ ...storage(restored), keys: () => [...restored.keys()] });
  assert.equal(getTrainingOccurrence(occ)?.lifecycle, "COMPLETED");
  assert.equal(runningFeedback()[0]?.rpe, 5);
  assert.deepEqual(restored, m.data);
});
test("runner exposes explicit formal finish/interrupt and continuous actual entry (SSR evidence only)", () => {
  const { occ } = begin(true);
  const html = renderToString(
    React.createElement(TrackRunner, { occurrenceId: occ, onClose() {} }),
  );
  assert.match(html, /确认完成并保存/);
  assert.match(html, /确认提前结束并保存/);
  assert.match(html, /连续跑实际秒数/);
});

test("well-formed but incomplete start bundle remains audit-only and exposes no partial entities", () => {
  const m = firstWeekMemory();
  setStoreBackend(m);
  m.setItem(
    RUNNING_TRANSACTION_PREFIX + "broken",
    JSON.stringify({
      schemaVersion: 1,
      id: "broken",
      order: 1,
      data: {
        version: 1,
        id: "broken",
        events: [
          {
            event_id: "incomplete",
            event_type: "TRAINING_STARTED",
            timestamp: "2026-10-11T00:00:00Z",
            payload: {},
          },
        ],
        starts: [{ trainingOccurrenceId: "incomplete", startEventId: "incomplete" }],
        snapshots: { bad: true },
      },
    }),
  );
  assert.equal(loadRunningTransactions().length, 0);
  assert.equal(loadEvents().length, 0);
  assert.equal(listTrainingOccurrences().length, 0);
  assert.equal(m.data.size, 1);
});
test("end and recovery feedback remain independent across interleaved clients", () => {
  const m = firstWeekMemory();
  setStoreBackend(m);
  simplePlan("A");
  simplePlan("B");
  const a = startTrackSession("A"),
    b = startTrackSession("B");
  assert.ok(a.ok && b.ok);
  const clientB = { ...m };
  let injected = false;
  const clientA = {
    ...m,
    setItem(k: string, v: string) {
      if (k.startsWith(RUNNING_TRANSACTION_PREFIX) && !injected) {
        injected = true;
        setStoreBackend(clientB);
        assert.equal(finishTrackSession(b.trainingOccurrenceId, "INTERRUPTED", 6, 0).ok, true);
        setStoreBackend(clientA);
      }
      m.setItem(k, v);
    },
  };
  setStoreBackend(clientA);
  assert.equal(finishTrackSession(a.trainingOccurrenceId, "INTERRUPTED", 8, null).ok, true);
  setStoreBackend(m);
  assert.equal(getTrainingOccurrence(a.trainingOccurrenceId)?.lifecycle, "INTERRUPTED");
  assert.equal(getTrainingOccurrence(b.trainingOccurrenceId)?.lifecycle, "INTERRUPTED");
  assert.equal(runningFeedback().length, 2);
  assert.equal(loadEvents().filter((x) => x.event_type === "TRAINING_INTERRUPTED").length, 2);
});

test("delayed pain feedback binds to the existing safety evidence layer and blocks performance options", () => {
  const { occ } = begin(true);
  complete(occ);
  finishTrackSession(occ, "COMPLETED", 4, 0);
  const started = Date.parse(getTrainingOccurrence(occ)!.startedAt!);
  assert.equal(
    recordTrackRecoveryFeedback(occ, "24H", 6, 3, new Date(started + 24 * 3600000)).ok,
    true,
  );
  const brief = assembleCoachBrief(null, "400米下一次能加量吗", occ);
  assert.equal(brief.pain, true);
  const result = answerLocally(brief);
  assert.equal(result.cognition?.options.length, 0);
  assert.match(result.text, /不建议.*加量|不自动增加/);
});
