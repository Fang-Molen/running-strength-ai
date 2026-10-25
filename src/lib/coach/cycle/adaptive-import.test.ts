import test from "node:test";
import assert from "node:assert/strict";
import { createTrainingImportDraft, confirmTrainingImport } from "../../core/training-import";
import { setStoreBackend } from "../../core/storage";
import { setEventContext, currentAthleteId } from "../../core/events";
import { readAnalysis } from "../../health/analysis-host";
import { savePersonalResponse } from "../../health/personal-response-store";
import { followup } from "../../../../evaluation/adaptive/fixture";
const f = <T>(value: T) => ({ value, status: "RECORDED", sourceIds: ["user-edited"] });
test("confirmed import preserves explicit strength protocol and full session timing for real personal feedback", (t) => {
  const data = new Map<string, string>(),
    owner = currentAthleteId();
  setEventContext({ athleteId: "r8-import" });
  setStoreBackend({
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    keys: () => [...data.keys()],
  });
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-25T10:00:00Z") });
  t.after(() => {
    setStoreBackend(null);
    setEventContext({ athleteId: owner });
  });
  for (const day of ["17", "24"]) {
    const d = createTrainingImportDraft(
      {
        sport: "STRENGTH",
        occurredAt: f(`2026-10-${day}T08:00:00Z`),
        durationSeconds: f(1200),
        comparisonContext: { protocolKey: f("bridge-v1") },
        strengthSets: [1, 2, 3].map((i) => ({
          id: "set" + i,
          exerciseName: f("臀桥"),
          setOrdinal: f(i),
          weightKg: f(0),
          repetitions: f(10),
          loadBasis: f("BODYWEIGHT"),
          side: f("BILATERAL"),
          rir: f(3),
          rangeProtocol: f("full"),
          completion: "COMPLETED",
        })),
      },
      "TEXT",
      ["user-edited"],
    );
    assert.equal(confirmTrainingImport(d).ok, true);
  }
  let a = readAnalysis("2026-10-25", "2026-10-25T10:00:00Z");
  const ts = a.snapshot.facts.filter((f) => f.kind === "TRAINING");
  assert.equal(ts.length, 2);
  for (const t of ts) {
    assert.equal(t.actualDurationSeconds, 1200);
    assert.ok(t.endedAt?.endsWith("08:20:00.000Z"));
    assert.equal(t.strengthSets[0].loadBasis, "BODYWEIGHT");
    assert.equal(t.strengthSets[0].rir, 3);
    assert.equal(
      savePersonalResponse({ ...followup(t, "SORENESS", 4), athleteId: "r8-import" }).ok,
      true,
    );
  }
  a = readAnalysis("2026-10-25", "2026-10-25T10:00:00Z");
  assert.ok(a.adaptive.groups.some((g) => g.state === "REVIEW_DOSE"));
});
