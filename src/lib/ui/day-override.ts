/** “今天临时改”：只改当天，不改档案/计划（借鉴 Fitbod 单次修改）。 */
import type { ScheduleEntry } from "./day-schedule-rules.ts"
export const OVERRIDE_KEY = "fk-day-override-v1"
export type Override = { date: string; short?: boolean; home?: boolean }
export function applyOverride(entries: ScheduleEntry[], o: Override | null): ScheduleEntry[] {
  if (!o || (!o.short && !o.home)) return entries
  return entries.map((e) => {
    if (e.date !== o.date || e.status === "done" || e.actual) return e
    let n = { ...e }
    if (o.short && n.minutes > 20) n = { ...n, minutes: 20, intensity: n.intensity === "HARD" ? "MODERATE" : n.intensity, overrideNote: "只有 20 分钟：保留主项、减组数" }
    if (o.home && n.modality === "strength") n = { ...n, lowerHeavy: false, title: n.title.includes("在家") ? n.title : `${n.title}（在家版）`, overrideNote: [n.overrideNote, "在家：换成哑铃/徒手动作"].filter(Boolean).join("；") }
    if (o.home && n.modality === "run") n = { ...n, overrideNote: [n.overrideNote, "在家：可改原地/跑步机，或换力量"].filter(Boolean).join("；") }
    return n
  })
}
/** 计划 vs 实际色带（TrainingPeaks 阈值）：绿 80–120%，黄 50–79%/121–150%，橙 <50% 或 >150%，红 没练，灰 计划外。 */
export type Band = "green" | "yellow" | "orange" | "red" | "grey" | null
/** 计划按距离（跑步且 km 有值）时按距离比，否则按时长；basis="time" 可强制按时长。 */
export function bandBasisOf(e: ScheduleEntry, basis: "auto" | "time" | "distance" = "auto"): "time" | "distance" { return basis !== "time" && e.modality === "run" && !!e.km && e.actual?.km != null ? "distance" : "time" }
export function planBand(e: ScheduleEntry, basis: "auto" | "time" | "distance" = "auto"): Band {
  if (!e.actual) return null
  if (e.actual.outcome === "missed") return "red"
  if (e.source === "custom" && e.status === "done" && e.unplanned) return "grey"
  if (e.actual.outcome === "as_planned") return "green"
  if(e.actual.minutes==null && (bandBasisOf(e,basis)!=="distance" || e.actual.km==null)) return null
  const r = bandBasisOf(e, basis) === "distance" ? (e.actual.km ?? 0) / e.km! : (e.actual.minutes ?? 0) / Math.max(1, e.minutes)
  return r >= 0.8 && r <= 1.2 ? "green" : r >= 0.5 && r <= 1.5 ? "yellow" : "orange"
}
export const BAND_COLOR: Record<Exclude<Band, null>, string> = { green: "#269775", yellow: "#d9b33b", orange: "#e07b2b", red: "#c0392b", grey: "#9aa5ad" }
