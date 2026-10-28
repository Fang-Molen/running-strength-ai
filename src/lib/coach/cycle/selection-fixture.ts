/** Same synthetic history for paired event-selection tests; no personal data. */
import { cycleFixture } from "./fixtures";
import { training } from "../../health/analysis-fixtures";
import type { RunningComponent, RunningPurpose } from "../../core/running-plan";
import type { ScheduleEntry } from "../../ui/day-schedule-rules";
export function selectionFixture() {
  const input = cycleFixture();
  input.goal.raceDate = "2026-11-12"; input.goal.horizonWeeks = 3;
  const courses: [string, RunningPurpose, "CONTINUOUS" | "REPEATED"][] = [
    ["speed-repeats", "REPETITION_SPEED", "REPEATED"],
    ["interval-repeats", "INTERVAL", "REPEATED"],
    ["rhythm-repeats", "TEMPO_THRESHOLD", "REPEATED"],
    ["continuous-tempo", "TEMPO_THRESHOLD", "CONTINUOUS"],
    ["continuous-long", "LONG", "CONTINUOUS"],
  ];
  const entries: ScheduleEntry[] = courses.map(([id, purpose, kind], index) => {
    const date = "2026-10-" + (12 + index), at = date + "T10:00:00Z";
    const component: RunningComponent = { componentId: "run", modality: "RUNNING", purpose, structure: kind === "CONTINUOUS"
      ? { kind, plannedDistanceMeters: 2000, plannedDistanceMaxMeters: null, plannedDurationSeconds: 1200 }
      : { kind, blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: 0, steps: [{ stepId: "s", plannedDistanceMeters: 500, plannedDurationSeconds: 300, repeatCount: 4, recoveryAfterRepeatSeconds: 60, recoveryBeforeNextStepSeconds: 0 }] }] } };
    return { id, athleteId: input.goal.athleteId, date, kind: "run", modality: "run", title: id, focus: [], minutes: 20,
      intensity: "HARD", lowerHeavy: false, source: "custom", refId: null, status: "done", runComponents: [component],
      actual: { outcome: "as_planned", executionState: "COMPLETED", minutes: 20, km: 2, rpe: 5, intensity: "HARD", reasons: [], note: "synthetic", at, occurrenceIds: [id] } };
  });
  input.entries = entries;
  input.snapshot.facts = entries.map(entry => {
    const repeated = entry.runComponents![0].modality === "RUNNING" && entry.runComponents![0].structure.kind === "REPEATED";
    return training({ id: entry.id, athleteId: input.goal.athleteId, sourceRecordId: entry.id, canonicalActivityId: entry.id, occurrenceId: entry.id, componentId: "run", modality: "RUN", protocolKey: "same-known-protocol", deviceId: "synthetic-watch", accountRef: "synthetic", startedAt: entry.date + "T08:00:00Z", occurredAt: entry.date + "T08:00:00Z", knownAt: entry.actual!.at, receivedAt: entry.actual!.at, actualDurationSeconds: 1200, strengthSets: [],
      runSegments: Array.from({ length: repeated ? 4 : 1 }, (_, index) => ({ id: entry.id + ":" + index, blockId: "b", roundIndex: 1, stepIndex: 1, kind: repeated ? "REPETITION" : "CONTINUOUS", distanceM: repeated ? 500 : 2000, durationSeconds: repeated ? 300 : 1200, restAfterSeconds: repeated ? 60 : 0, restScope: "AFTER_REPEAT", rawResolutionSeconds: 1, gradePercent: 0, surface: "track", completion: "COMPLETED" })),
    });
  });
  return input;
}
