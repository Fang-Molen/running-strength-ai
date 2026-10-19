import type { ScheduleEntry } from "./day-schedule-rules"
/** v78：过去日期里“排了但没标记”的课（自己加的 自定 / 方坤 / 计划）。它们不是训练记录，不计入统计；这里列出来，一点就能标记。 */
export function unmarkedEntries(entries: ScheduleEntry[], start: string, end: string, today: string, kind: "all" | "run" | "lift", recordIds: Set<string>): ScheduleEntry[] {
  return entries.filter(e => e && e.date >= start && e.date <= end && e.date < today && !e.actual && (e.status === "planned" || e.status === "edited" as never) && (e.modality === "strength" || e.modality === "run")
    && (kind === "all" || (kind === "lift" ? e.modality === "strength" : e.modality === "run")) && !recordIds.has(`sched:${e.id}`)).sort((a, b) => b.date.localeCompare(a.date))
}
