import type { ScheduleEntry } from "../../ui/day-schedule-rules";
import type { Profile } from "../../strength/profile";
import type { BodyCheck } from "../../nutrition/body";
import type { SymptomInput } from "../../health/symptom-store";
import { analysisDigest } from "../../health/analysis-evidence";
export type SchedulePair = { before: ScheduleEntry | null; after: ScheduleEntry };
export type R5Command = {
  schema: 1;
  id: string;
  athleteId: string;
  question: string;
  createdAt: string;
  expiresAt: string;
  basisVersion: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "UNDONE" | "STALE";
  kind: "MEASUREMENT" | "PROFILE" | "SCHEDULE" | "SYMPTOM" | "WEEK";
  diff: string[];
  warnings: string[];
  history: { at: string; action: string }[];
  acceptedBasis?: string;
  measurement?: { day: string; weight: number; before: BodyCheck | null };
  profile?: { patch: Partial<Profile>; before: Partial<Profile>; absent?: (keyof Profile)[] };
  pairs?: SchedulePair[];
  symptom?: SymptomInput;
  receipt?: {
    at: string;
    afterBody?: BodyCheck;
    profileVersion?: string;
    symptomId?: string;
    symptomRevision?: number;
    symptomVersion?: string;
  };
};
export const entryVersion = (entry: ScheduleEntry) => analysisDigest(entry);
export function plannedRunDose(entry: ScheduleEntry) {
  const components = entry.runComponents?.filter((c) => c.modality === "RUNNING") ?? [];
  const distances: (number | null)[] = [],
    durations: (number | null)[] = [];
  for (const c of components) {
    if (c.modality !== "RUNNING") continue;
    if (c.structure.kind === "CONTINUOUS") {
      distances.push(c.structure.plannedDistanceMeters);
      durations.push(c.structure.plannedDurationSeconds);
    } else
      for (const b of c.structure.blocks)
        for (const step of b.steps) {
          distances.push(
            step.plannedDistanceMeters === null
              ? null
              : step.plannedDistanceMeters * step.repeatCount * b.roundCount,
          );
          durations.push(
            step.plannedDurationSeconds === null
              ? null
              : step.plannedDurationSeconds * step.repeatCount * b.roundCount,
          );
        }
  }
  const total = (xs: (number | null)[]) =>
    xs.length && xs.every((x): x is number => x !== null) ? xs.reduce((a, b) => a + b, 0) : null;
  return { distanceM: total(distances), durationSeconds: total(durations) };
}
export function easyRun(entry: ScheduleEntry): ScheduleEntry {
  const existing = entry.runComponents?.filter((c) => c.modality === "RUNNING") ?? [];
  if (entry.modality !== "run" && entry.trainingType !== "mixed" && !existing.length)
    throw Error("所选课程没有可确认的跑步部分");
  const mixed = entry.trainingType === "mixed" || !!entry.exercises?.length;
  // Preserve the parallel strength component; no guessed pace/distance. Existing duration is an upper cap.
  const originalDose = plannedRunDose(entry);
  const duration = originalDose.durationSeconds ?? (!mixed ? entry.minutes * 60 : null);
  if (duration === null && originalDose.distanceM === null)
    throw Error("组合课跑步部分的时长和距离都未知，请先确认其中一项；不会套用整课时长");
  const running = {
    componentId: existing[0]?.componentId ?? `r5-run:${entry.id}`,
    modality: "RUNNING" as const,
    purpose: "EASY_AEROBIC" as const,
    structure: {
      kind: "CONTINUOUS" as const,
      plannedDistanceMeters: duration === null ? originalDose.distanceM : null,
      plannedDistanceMaxMeters: null,
      plannedDurationSeconds: duration,
    },
  };
  return {
    ...entry,
    minutes: !mixed && duration !== null ? duration / 60 : entry.minutes,
    km: undefined,
    refId: mixed ? entry.refId : null,
    title: mixed ? "轻松跑＋原力量部分" : "轻松跑",
    intensity: "EASY",
    lowerHeavy: mixed ? entry.lowerHeavy : false,
    focus: mixed
      ? [...new Set([...entry.focus.filter((x) => x !== "速度" && x !== "强度"), "轻松"])]
      : ["轻松"],
    runComponents: [
      running,
      ...(entry.runComponents?.filter((c) => c.modality === "STRENGTH") ?? []),
    ],
    reduced: true,
    edited: true,
    swapReason: "用户确认替换跑步部分；未变更平行力量课",
  };
}
export function reduceSets(entry: ScheduleEntry): ScheduleEntry {
  if (!entry.exercises?.length)
    throw Error(`${entry.title}缺少可执行的逐动作组数，请先打开课程补齐；不从标题猜组数`);
  if (entry.exercises.some((e) => !/^\d+$/.test(e.sets) || Number(e.sets) < 1))
    throw Error("原组数含范围或未记录，请先确认每个动作的组数");
  if (entry.exercises.every((e) => Number(e.sets) <= 1))
    throw Error("各动作已经只有一组；没有继续减组");
  return {
    ...entry,
    exercises: entry.exercises.map((e) => ({
      ...e,
      sets: String(Math.max(1, Number(e.sets) - 1)),
    })),
    reduced: true,
    edited: true,
    swapReason: "用户确认：每个动作减少一组，至少保留一组；负重、次数与组休不变",
  };
}
export function describePair(pair: SchedulePair): string {
  const { before: b, after: a } = pair;
  const dose = (e: ScheduleEntry) =>
    `${e.title}，${e.minutes}分钟，${e.intensity}${e.exercises?.length ? "；" + e.exercises.map((x) => `${x.name} ${x.sets}组×${x.reps} / ${x.weight || "未知"}kg`).join("、") : ""}`;
  return `${a.date}：${b ? dose(b) : "原无该课"} → ${dose(a)}`;
}
