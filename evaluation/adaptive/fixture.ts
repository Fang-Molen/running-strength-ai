/** Public synthetic athlete, never a representation of the user's training. */
import { cycleFixture } from "../../src/lib/coach/cycle/fixtures";
import { training, set, metric } from "../../src/lib/health/analysis-fixtures";
import type { ResponseFact, TrainingFact } from "../../src/lib/health/analysis-contract";
import type { ScheduleEntry } from "../../src/lib/ui/day-schedule-rules";
export function monthFixture() {
  const x = cycleFixture();
  x.goal.horizonWeeks = 4;
  x.goal.raceDate = null;
  x.request = { historyDays: 14, horizonWeeks: 4 };
  x.training.days!.value = [1, 2, 3, 5, 6];
  x.training.daysPerWeek!.value = 5;
  for (const f of x.snapshot.facts)
    if (f.kind === "TRAINING") {
      f.endedAt = f.startedAt.replace("08:00", "08:20");
      f.componentId = "run";
      f.observedType = "EASY";
      f.observedTypeBasis = [{ id: f.id, revision: f.revision }];
      f.sessionRpe = 5;
      f.sessionRpeScale = "CR10";
      f.runSegments.forEach((s) => (s.kind = "CONTINUOUS"));
    }
  for (const e of x.entries) {
    e.intensity = "EASY";
    e.title = "轻松跑";
    e.actual!.intensity = "EASY";
    for (const c of e.runComponents ?? []) if (c.modality === "RUNNING") c.purpose = "EASY_AEROBIC";
  }
  const entries: ScheduleEntry[] = ["2026-10-13", "2026-10-17", "2026-10-20", "2026-10-24"].map(
    (date, i) => ({
      id: "strength-" + i,
      athleteId: "SYN-A",
      date,
      kind: "strength",
      modality: "strength",
      title: "熟悉全身力量",
      focus: [],
      minutes: 20,
      intensity: "MODERATE",
      lowerHeavy: false,
      source: "custom",
      refId: null,
      status: "done",
      exercises: [
        {
          catalogId: "glute-bridge",
          name: "臀桥",
          sets: "3",
          reps: "10",
          weight: "0",
          rpe: "",
          unit: "reps",
          restSec: 60,
        },
      ],
      actual: {
        outcome: "as_planned",
        minutes: 20,
        intensity: "MODERATE",
        rpe: 5,
        reasons: [],
        note: "合成实际",
        at: date + "T08:20:00Z",
        occurrenceIds: ["strength-" + i],
      },
    }),
  );
  x.entries = [...x.entries, ...entries];
  for (const e of entries)
    x.snapshot.facts.push(
      training({
        id: e.id,
        sourceRecordId: e.id,
        canonicalActivityId: e.id,
        occurrenceId: e.id,
        componentId: "strength",
        startedAt: e.date + "T08:00:00Z",
        endedAt: e.date + "T08:20:00Z",
        occurredAt: e.date + "T08:00:00Z",
        knownAt: e.date + "T08:20:00Z",
        receivedAt: e.date + "T08:20:00Z",
        protocolKey: "bridge-v1",
        actualDurationSeconds: 1200,
        sessionRpe: 5,
        sessionRpeScale: "CR10",
        strengthSets: [0, 1, 2].map((i) =>
          set({
            id: "s" + i,
            catalogId: "glute-bridge",
            loadKg: 0,
            loadBasis: "BODYWEIGHT",
            reps: 10,
            rir: 3,
            rangeProtocol: "full",
            effortScale: "RIR",
          }),
        ),
      }),
    );
  return x;
}
export function followup(
  t: TrainingFact,
  measure: ResponseFact["measure"],
  value: number,
  hours = 24,
): ResponseFact {
  const at = new Date(Date.parse(t.endedAt!) + hours * 36e5).toISOString(),
    id = t.id + ":" + measure + ":" + hours;
  return {
    ...metric({ id, sourceRecordId: id, occurredAt: at, knownAt: at, receivedAt: at }),
    kind: "RESPONSE",
    measure,
    value,
    scale: measure === "FUNCTION" ? "FUNCTION_LIMITATION_0_1" : "0-10_HIGH_WORSE",
    region: "glutes",
    side: "BILATERAL",
    relatedTrainingRefs: [{ id: t.id, revision: t.revision }],
    observationProtocol:
      measure === "SORENESS" ? "SELF_REPORTED_SORENESS_ZERO_V1" : "SELF_REPORT_" + measure,
    elapsedHours: hours,
    functionTaskId: null,
    notes: null,
  };
}
