import type { ScheduleEntry } from "../../ui/day-schedule-rules";
const n = (value: number | null | undefined, unit: string) =>
  value == null ? "未知" : `${value}${unit}`;
/** Preserve rounds, steps and rests; never flatten 2 rounds × 4 repetitions to 8. */
export function cycleCourseLines(e: ScheduleEntry): string[] {
  const lines: string[] = [];
  for (const c of e.runComponents ?? []) {
    if (c.modality !== "RUNNING") {
      lines.push("力量部分：需核对关联力量课程");
      continue;
    }
    if (c.structure.kind === "CONTINUOUS")
      lines.push(
        `连续跑：${n(c.structure.plannedDistanceMeters, "米")} / ${n(c.structure.plannedDurationSeconds, "秒")}`,
      );
    else
      for (const [i, b] of c.structure.blocks.entries()) {
        lines.push(
          `第${i + 1}块：${b.roundCount}轮；轮间休息${n(b.recoveryAfterRoundSeconds, "秒")}`,
        );
        for (const [j, s] of b.steps.entries())
          lines.push(
            `每轮第${j + 1}步：${s.repeatCount}次 × ${n(s.plannedDistanceMeters, "米")} / ${n(s.plannedDurationSeconds, "秒")}；次间休息${n(s.recoveryAfterRepeatSeconds, "秒")}；步间休息${n(s.recoveryBeforeNextStepSeconds, "秒")}`,
          );
      }
  }
  for (const x of e.exercises ?? [])
    lines.push(
      `${x.name}：${x.sets || "未知"}组 × ${x.reps || "未知"}${x.unit === "sec" ? "秒" : x.unit === "m" ? "米" : "次"}；负重${x.weight.trim() ? x.weight + "公斤" : "未知"}；组间休息${n(x.restSec, "秒")}${x.perSide ? "；每侧" : ""}`,
    );
  return lines.length ? lines : ["结构尚未记录"];
}
