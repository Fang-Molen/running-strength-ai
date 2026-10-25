import { answerLocally } from "../../core/coach-local-first";
import { assembleCoachBrief } from "../../core/coach-brief";
import { buildFacts } from "../online-coach";
import { guardR5Reply } from "../r5/guard";
import test from "node:test";
import assert from "node:assert/strict";
import { setStoreBackend } from "../../core/storage";
import { currentAthleteId, setEventContext } from "../../core/events";
import { createTrainingImportDraft, confirmTrainingImport } from "../../core/training-import";
import { readAnalysis } from "../../health/analysis-host";
import { appendCorrection } from "../../core/training-correction";
const recorded = <T>(value: T) => ({ value, status: "RECORDED", sourceIds: ["text"] });
test("confirmed actual segment heart rate reaches the shared analysis and disappears after void without rewriting originals", (t) => {
  const old = currentAthleteId(),
    data = new Map<string, string>();
  setStoreBackend({
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    keys: () => [...data.keys()],
  });
  setEventContext({ athleteId: "r7-fixture" });
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-25T10:00:00Z") });
  t.after(() => {
    setStoreBackend(null);
    setEventContext({ athleteId: old });
  });
  const draft = createTrainingImportDraft(
    {
      sport: "RUNNING",
      occurredAt: recorded("2026-10-23T10:00:00Z"),
      title: recorded("实际跑步"),
      runningStructure: "CONTINUOUS",
      runningSegments: [
        {
          id: "lap1",
          kind: "CONTINUOUS",
          round: recorded(1),
          repeat: recorded(1),
          distanceMeters: recorded(1000),
          durationSeconds: recorded(300),
          averageHeartRateBpm: recorded(150),
          heartRateMethod: recorded("CHEST_STRAP"),
          completion: "COMPLETED",
          sourceIds: ["text"],
        },
      ],
      sessionRpe: recorded(5),
    },
    "TEXT",
    ["text"],
  );
  const confirmed = confirmTrainingImport(draft);
  assert.ok(confirmed.ok);
  const a = readAnalysis("2026-10-25", "2026-10-25T10:00:00Z");
  const fact = a.snapshot.facts.find((f) => f.kind === "TRAINING" && f.modality === "RUN");
  assert.ok(fact?.kind === "TRAINING");
  assert.equal((fact.runSegments[0] as { averageHeartRateBpm?: number }).averageHeartRateBpm, 150);
  assert.equal(a.history.sessions[0].heartRateBpm, 150);
  assert.equal(a.history.sessions[0].paceSecondsPerKm, 300);
  const before = JSON.stringify([...data]);
  const reply = answerLocally(assembleCoachBrief(null, "根据历史训练形成能力画像", null));
  assert.equal(reply.localOnly, "HISTORY_ASSESSMENT");
  assert.match(reply.text, /5分00秒/);
  assert.ok(reply.text.length <= 1000);
  const scopedReply = answerLocally({...assembleCoachBrief(null, '根据历史训练形成能力画像', null), occurrenceId: confirmed.record.confirmedImportId});
  assert.equal(scopedReply.localOnly, 'HISTORY_ASSESSMENT');
  const onlineFacts = buildFacts("2026-10-25", null, null, {
    question: "分析历史训练配速与心率",
    asOf: "2026-10-25T10:00:00Z",
  });
  assert.match(onlineFacts, /150次/);
  assert.ok(onlineFacts.length <= 8000);
  const verified = a.history.observations.map((o) => o.text).join("\n");
  assert.equal(guardR5Reply(verified, a.packet).ok, true);
  assert.equal(guardR5Reply(verified.replace("150次", "190次"), a.packet).ok, false);
  assert.equal(guardR5Reply("已替你修改课表", a.packet).ok, false);
  assert.equal(JSON.stringify([...data]), before);
  setEventContext({ athleteId: "foreign" });
  assert.equal(readAnalysis("2026-10-25", "2026-10-25T10:00:00Z").history.sessions.length, 0);
  setEventContext({ athleteId: "r7-fixture" });
  // This is the real confirmation/storage/projection path, not an injected analysis fixture.
  const comparisonContext = {
    deviceId: recorded("strap-A"),
    protocolKey: recorded("track-continuous"),
    surface: recorded("track"),
    gradePercent: recorded(0),
  };
  for (const day of ["20", "21", "24"]) {
    const contextual = createTrainingImportDraft(
      {
        ...draft,
        occurredAt: recorded(`2026-10-${day}T10:00:00Z`),
        comparisonContext,
        runningSegments: draft.runningSegments.map((x) => ({ ...x, recoverySeconds: recorded(0) })),
      },
      "TEXT",
      ["text"],
    );
    assert.ok(confirmTrainingImport(contextual).ok);
  }
  const comparable = readAnalysis("2026-10-25", "2026-10-25T10:00:00Z").history;
  assert.equal(comparable.comparisons[0].status, "DIRECT");
  assert.equal(comparable.comparisons[0].priorDays, 2);
  assert.equal(comparable.comparisons[0].heartRateDeltaBpm, 0);
  assert.ok(
    appendCorrection({
      trainingOccurrenceId: confirmed.record.confirmedImportId,
      kind: "VOID",
      reason: "合成记录作废",
    }),
  );
  const after = readAnalysis("2026-10-25", "2026-10-25T10:00:00Z");
  assert.equal(after.history.sessions.length, 3);
  assert.ok(
    !after.history.sessions.some((s) => s.occurrenceId === confirmed.record.confirmedImportId),
  );
  assert.notEqual(after.history.version, a.history.version);
});
