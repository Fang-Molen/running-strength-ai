import type { TrainingFact } from "../../health/analysis-contract";
import type { RunningComponent } from "../../core/running-plan";
/** Exact execution support for copying a familiar interval course, never inferred from total km. */
export function supportsRepeatedCourse(
  component: RunningComponent,
  facts: TrainingFact[],
): boolean {
  if (component.structure.kind !== "REPEATED") return true;
  if (facts.length !== 1) return false;
  const rows = facts[0].runSegments;
  const expected = component.structure.blocks.flatMap((b, block) =>
    Array.from({ length: b.roundCount }, (_, round) =>
      b.steps.flatMap((step, si) =>
        Array.from({ length: step.repeatCount }, (_, repeat) => ({
          block,
          round: round + 1,
          distance: step.plannedDistanceMeters,
          duration: step.plannedDurationSeconds,
          rest:
            repeat < step.repeatCount - 1
              ? step.recoveryAfterRepeatSeconds
              : si < b.steps.length - 1
                ? step.recoveryBeforeNextStepSeconds
                : b.recoveryAfterRoundSeconds,
          scope:
            repeat < step.repeatCount - 1
              ? "AFTER_REPEAT"
              : si < b.steps.length - 1
                ? "UNSPECIFIED"
                : "AFTER_ROUND",
        })),
      ),
    ),
  ).flat();
  if (rows.length !== expected.length || !rows.length) return false;
  const blocks = [...new Set(rows.map((s) => s.blockId))];
  return expected.every((e, i) => {
    const r = rows[i];
    return (
      r.completion === "COMPLETED" &&
      r.kind !== "CONTINUOUS" &&
      r.roundIndex === e.round &&
      blocks.indexOf(r.blockId) === e.block &&
      e.distance !== null &&
      e.duration !== null &&
      r.distanceM === e.distance &&
      r.durationSeconds === e.duration &&
      (i === rows.length - 1 ||
        (e.rest !== null && r.restAfterSeconds === e.rest && r.restScope === e.scope))
    );
  });
}
