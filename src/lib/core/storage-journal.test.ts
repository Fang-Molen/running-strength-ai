import test from "node:test";
import assert from "node:assert/strict";
import { appendJournal, readJournal } from "./storage-journal.ts";
import { setStoreBackend, writeEnvelope } from "./storage.ts";
import {
  dispatchEvent,
  loadEvents,
  EVENTS_KEY,
  EVENT_JOURNAL_PREFIX,
  onAppEvent,
} from "./events.ts";
import {
  appendLearningRecord,
  loadLearning,
  evaluateLearning,
  validateLearningRecord,
  COGNITION_JOURNAL_PREFIX,
  COGNITION_MEMORY_KEY,
  type LearningRecord,
} from "./coach-cognition-learning.ts";
import { collectLocalBackup, inspectLocalBackup, restoreLocalBackup } from "./trial.ts";
import {
  firstWeekMemory,
  firstWeekInputs,
  FIRST_WEEK_TEST_DAY,
} from "./coach-first-week.fixtures.ts";
import {
  appendIntakeAnswer,
  buildFirstWeek,
  INTAKE_FIELDS,
  loadIntake,
  recordFirstWeekChoice,
} from "./coach-first-week.ts";
const prediction = (id = "p", value = 7): LearningRecord => ({
  id,
  kind: "PREDICTION",
  layer: "M7",
  athleteId: "local",
  trainingOccurrenceId: "occ-" + id,
  sourceIds: ["source-" + id],
  createdAt: "2026-10-08T10:00:00Z",
  observedAt: null,
  sessionAt: "2026-10-08T09:00:00Z",
  context: {
    event: "400米",
    distanceMeters: 200,
    reps: 4,
    rounds: 2,
    restSeconds: 120,
    timing: "electronic",
    surface: "track",
    phase: "specific",
  },
  horizonHours: 24,
  value,
  predictionId: null,
  supersedes: null,
  choice: null,
  confirmed: true,
});

test("two separate clients interleave durable event commits without lost writes", () => {
  const shared = firstWeekMemory();
  let injected = false;
  let b: string | null = null;
  const clientB = { ...shared };
  const clientA = {
    ...shared,
    setItem: (k: string, v: string) => {
      if (k.startsWith(EVENT_JOURNAL_PREFIX) && !injected) {
        injected = true;
        setStoreBackend(clientB);
        b = dispatchEvent("TRAINING_STARTED", { writer: "B" })?.event_id ?? null;
        setStoreBackend(clientA);
      }
      shared.setItem(k, v);
    },
  };
  setStoreBackend(clientA);
  const a = dispatchEvent("TRAINING_STARTED", { writer: "A" });
  assert.ok(a && b);
  setStoreBackend(clientB);
  assert.deepEqual(new Set(loadEvents().map((e) => e.event_id)), new Set([a.event_id, b]));
  assert.equal(shared.keys().filter((k) => k.startsWith(EVENT_JOURNAL_PREFIX)).length, 2);
});
test("legacy conflicting and duplicate events remain byte-for-byte untouched on new append", () => {
  const m = firstWeekMemory();
  setStoreBackend(m);
  const e = dispatchEvent("TRAINING_STARTED", { old: true })!;
  m.data.clear();
  writeEnvelope(EVENTS_KEY, [e, e, { ...e, payload: { different: true } }]);
  const old = m.getItem(EVENTS_KEY);
  dispatchEvent("TRAINING_STARTED", { new: true });
  assert.equal(m.getItem(EVENTS_KEY), old);
  assert.equal(loadEvents().length, 4);
});
test("two writers save feedback without stale-array overwrite", () => {
  const m = firstWeekMemory();
  let inject = false;
  let b = false;
  const box = {
    ...m,
    setItem: (k: string, v: string) => {
      if (k.startsWith(COGNITION_JOURNAL_PREFIX) && !inject) {
        inject = true;
        b = appendLearningRecord(prediction("b"), 0).ok;
      }
      m.setItem(k, v);
    },
  };
  setStoreBackend(box);
  assert.equal(appendLearningRecord(prediction("a"), 0).ok, true);
  assert.equal(b, true);
  assert.equal(loadLearning().records.length, 2);
  assert.equal(loadLearning().revision, 2);
  assert.equal(appendLearningRecord(prediction("c"), 0).error, "REVISION_CONFLICT");
});
test("overlapping same-id differing feedback remains auditable and is excluded from inference", () => {
  const m = firstWeekMemory();
  let inject = false;
  const box = {
    ...m,
    setItem: (k: string, v: string) => {
      if (k.startsWith(COGNITION_JOURNAL_PREFIX) && !inject) {
        inject = true;
        assert.equal(appendLearningRecord(prediction("same", 3), 0).ok, true);
      }
      m.setItem(k, v);
    },
  };
  setStoreBackend(box);
  assert.equal(appendLearningRecord(prediction("same", 8), 0).ok, true);
  assert.equal(loadLearning().records.length, 2);
  const e = evaluateLearning(loadLearning(), "400米");
  assert.deepEqual(e.excluded, ["same"]);
  assert.equal(e.outcomes.length, 0);
});
test("journal+legacy+intake choices round trip actual backup and reload", () => {
  const m = firstWeekMemory();
  setStoreBackend(m);
  dispatchEvent("TRAINING_STARTED", { synthetic: true });
  writeEnvelope(COGNITION_MEMORY_KEY, [prediction("legacy")]);
  appendLearningRecord(prediction("journal"), 1);
  const i = firstWeekInputs();
  for (const f of INTAKE_FIELDS) assert.equal(appendIntakeAnswer("backup", f, i[f]).ok, true);
  const d = buildFirstWeek(loadIntake("backup"), FIRST_WEEK_TEST_DAY).draft!;
  assert.equal(recordFirstWeekChoice("backup", d, "ACCEPT"), true);
  const backup = collectLocalBackup(m);
  const target = firstWeekMemory();
  assert.equal(inspectLocalBackup(backup, target).ok, true);
  const restored = restoreLocalBackup(backup, target);
  assert.equal(restored.ok, true);
  assert.deepEqual([...target.data], [...m.data]);
  setStoreBackend(target);
  assert.equal(loadEvents().length, 1);
  assert.equal(loadLearning().records.length, 2);
  assert.equal(loadIntake("backup").length, 7);
});
test("unknown oversized backup key remains rejected", () => {
  const m = firstWeekMemory();
  m.setItem("fr255-" + "x".repeat(90), "bad");
  assert.equal(inspectLocalBackup(collectLocalBackup(m), firstWeekMemory()).ok, false);
});
test("quota and adapters without durable enumeration fail visibly", () => {
  setStoreBackend({
    getItem: () => null,
    setItem: () => {
      throw Error("quota");
    },
    keys: () => [],
  });
  assert.equal(dispatchEvent("TRAINING_STARTED", {}), null);
  assert.equal(appendJournal("fr255-probe:", "x", {}), false);
  setStoreBackend({
    getItem: () => null,
    setItem: () => {
      throw Error("must not call");
    },
  });
  assert.equal(appendJournal("fr255-probe:", "x", {}), false);
});
test("malformed physical records are retained and never silently deleted", () => {
  const m = firstWeekMemory();
  setStoreBackend(m);
  m.setItem("fr255-probe:broken", "{broken");
  assert.equal(appendJournal("fr255-probe:", "good", { value: 1 }), true);
  assert.equal(readJournal("fr255-probe:").length, 1);
  assert.equal(m.getItem("fr255-probe:broken"), "{broken");
});
test("listener failure cannot cause successful durable event to be reported as failed", () => {
  setStoreBackend(firstWeekMemory());
  const stop = onAppEvent(() => {
    throw Error("listener");
  });
  assert.ok(dispatchEvent("TRAINING_STARTED", {}));
  assert.equal(loadEvents().length, 1);
  stop();
});
test("feedback observations are connected to first-week explanation without dose authorization", () => {
  setStoreBackend(firstWeekMemory());
  for (const id of ["a", "b", "c"]) {
    const p = prediction(id);
    const revision = loadLearning().revision;
    assert.equal(appendLearningRecord(p, revision).ok, true);
    assert.equal(
      appendLearningRecord(
        {
          ...p,
          id: "o-" + id,
          kind: "OBSERVATION",
          layer: "M3",
          value: 3,
          predictionId: p.id,
          observedAt: "2026-10-09T09:00:00Z",
          createdAt: "2026-10-09T10:00:00Z",
        },
        revision + 1,
      ).ok,
      true,
    );
  }
  const i = firstWeekInputs();
  for (const f of INTAKE_FIELDS) appendIntakeAnswer("feedback", f, i[f]);
  const d = buildFirstWeek(loadIntake("feedback"), FIRST_WEEK_TEST_DAY).draft!;
  assert.match(d.warnings.join(" "), /3条配对/);
  assert.match(d.warnings.join(" "), /不迁移剂量或授权增加负荷/);
  const prior = loadIntake("feedback").find((r) => r.field === "recent")!;
  appendIntakeAnswer("feedback", "recent", { ...i.recent, recovery48: 2 }, prior.id);
  assert.equal(buildFirstWeek(loadIntake("feedback"), FIRST_WEEK_TEST_DAY).status, "BLOCKED");
});
test("prediction written after an early valid-window observation cannot count as prior evidence", () => {
  const p = { ...prediction("late"), createdAt: "2026-10-09T08:00:00Z" };
  const observed: LearningRecord = {
    ...p,
    id: "o-late",
    kind: "OBSERVATION",
    layer: "M3",
    predictionId: p.id,
    observedAt: "2026-10-09T07:00:00Z",
    createdAt: "2026-10-09T10:00:00Z",
  };
  assert.equal(validateLearningRecord(observed, [p]), "POST_HOC_PREDICTION");
  assert.equal(
    evaluateLearning({ revision: 2, records: [p, observed] }, "400米").outcomes.length,
    0,
  );
});
