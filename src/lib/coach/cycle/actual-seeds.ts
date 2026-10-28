/** Course proposals from confirmed execution when no calendar row exists. Never persists an actual. */
import type { TrainingFact } from "../../health/analysis-contract";
import type { ScheduleEntry } from "../../ui/day-schedule-rules";
import { exerciseContent } from "../../strength/exercise-content";
import { exerciseRegions } from "../../health/muscle-recovery-u11";
import { localDay } from "../../health/observation";
import { analysisDigest } from "../../health/analysis-evidence";
export function actualCourseSeeds(
  training: TrainingFact[],
  entries: readonly ScheduleEntry[],
): ScheduleEntry[] {
  const linked = new Set(entries.flatMap((e) => e.actual?.occurrenceIds ?? []));
  return training.flatMap((t) => {
    if (
      linked.has(t.occurrenceId) ||
      t.actualDurationSeconds === null ||
      t.actualDurationSeconds <= 0
    )
      return [];
    // An occurrence with multiple components must remain a combined execution, never split into extra days.
    if (training.some((o) => o !== t && o.occurrenceId === t.occurrenceId)) return [];
    const base: ScheduleEntry = {
      id: "actual-seed:" + t.id,
      athleteId: t.athleteId,
      date: localDay(new Date(t.startedAt)),
      kind: t.modality === "RUN" ? "run" : "strength",
      modality: t.modality === "RUN" ? "run" : "strength",
      title: "已完成课程候选",
      focus: [],
      minutes: t.actualDurationSeconds / 60,
      intensity: "MODERATE",
      lowerHeavy: false,
      source: "fangkun",
      refId: null,
      status: "done",
      actual: {
        outcome: "different",
        executionState: "COMPLETED",
        minutes: t.actualDurationSeconds / 60,
        intensity: null,
        rpe: t.sessionRpe,
        reasons: [],
        note: "实际结构生成的候选；候选强度不代表历史测量",
        at: t.knownAt,
        occurrenceIds: [t.occurrenceId],
      },
    };
    if (t.modality === "RUN") {
      const s = t.runSegments[0];
      if (
        t.runSegments.length !== 1 ||
        s.completion !== "COMPLETED" ||
        s.kind !== "CONTINUOUS" ||
        s.durationSeconds === null ||
        s.durationSeconds <= 0 ||
        s.distanceM === null ||
        !t.observedTypeBasis.length
      )
        return [];
      const easy = ["EASY", "EASY_AEROBIC", "LONG"].includes(t.observedType ?? ""),
        hard = [
          "TEMPO",
          "THRESHOLD",
          "INTERVAL",
          "SPRINT",
          "SPEED_ENDURANCE",
          "TEMPO_THRESHOLD",
        ].includes(t.observedType ?? "");
      if (!easy && !hard) return [];
      base.intensity = easy ? "EASY" : "HARD";
      base.actual!.intensity = base.intensity;
      base.actual!.km = s.distanceM / 1000;
      base.title = t.observedType === "LONG" ? "实际支持的耐力连续课" : easy ? "实际支持的轻松跑" : "实际支持的节奏跑";
      base.runComponents = [
        {
          componentId: t.componentId,
          modality: "RUNNING",
          purpose: t.observedType === "LONG" ? "LONG" : easy ? "EASY_AEROBIC" : "TEMPO_THRESHOLD",
          structure: {
            kind: "CONTINUOUS",
            plannedDistanceMeters: s.distanceM,
            plannedDistanceMaxMeters: null,
            plannedDurationSeconds: s.durationSeconds,
          },
        },
      ];
    } else if (t.modality === "STRENGTH") {
      if (
        !t.strengthSets.length ||
        t.strengthSets.some(
          (s) =>
            s.completion !== "COMPLETED" ||
            !s.catalogId ||
            s.loadKg === null ||
            s.reps === null ||
            s.reps <= 0 ||
            !["TOTAL_EXTERNAL", "BODYWEIGHT"].includes(s.loadBasis) ||
            s.side !== "BILATERAL",
        )
      )
        return [];
      const groups = new Map<string, typeof t.strengthSets>();
      for (const s of t.strengthSets) {
        const k = analysisDigest([s.catalogId, s.loadKg, s.loadBasis, s.reps, s.side]);
        groups.set(k, [...(groups.get(k) ?? []), s]);
      }
      // Varying loads/reps for the same exercise need explicit course editing rather than flattening.
      if (new Set([...groups.values()].map((ss) => ss[0].catalogId)).size !== groups.size)
        return [];
      base.exercises = [...groups.values()].map((ss) => ({
        catalogId: ss[0].catalogId?.replace(/^local:/, ""),
        name:
          exerciseContent(ss[0].catalogId?.replace(/^local:/, "") ?? null)?.name ??
          ss[0].catalogId!,
        sets: String(ss.length),
        reps: String(ss[0].reps),
        weight: String(ss[0].loadKg),
        rpe: "",
        unit: "reps",
        restSec: null,
      }));
      base.title = "实际支持的力量课";
      base.lowerHeavy = t.strengthSets.some(
        (s) =>
          s.loadKg! > 0 &&
          exerciseRegions(s.catalogId!).some((r) => ["quads", "glutes", "hamstrings"].includes(r)),
      );
    } else return [];
    return [base];
  });
}
