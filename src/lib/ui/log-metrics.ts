/** 训练日志按版本显示的指标。进阶：近 4 周每周时长趋势；专业：+ 急/慢性负荷比（时长×强度系数，经验规则，参考 Gabbett 2016，仅作提示）。 */
import { addDays, weekOf, type ScheduleEntry } from "./day-schedule-rules.ts"
import { canShow, type Tier } from "./watch-mode.ts"
const W = { EASY: 1, MODERATE: 2, HARD: 3 } as const
// v83：旧版本“记一笔”的分钟数是默认值（跑步 30 / 力量按组数估），不是实际用时 → 不计入负荷
const legacyQuickDefault = (e: ScheduleEntry) => !!e.unplanned && /^q-/.test(e.id) && e.actual?.note === "记一笔" && (e.modality !== "run" || e.minutes === 30)
const minutesOf = (e: ScheduleEntry) => legacyQuickDefault(e) ? 0 : (e.actual?.outcome === "missed" ? 0 : e.actual?.outcome === "different" ? e.actual.minutes ?? 0 : e.minutes)
const loadOf = (e: ScheduleEntry) => minutesOf(e) * W[e.actual?.intensity ?? e.intensity]
export function weeklyMinutes(entries: ScheduleEntry[], today: string, weeks = 4): { week: string; minutes: number }[] {
  const out: { week: string; minutes: number }[] = []
  for (let i = weeks - 1; i >= 0; i--) { const wk = weekOf(addDays(today, -7 * i)); out.push({ week: wk[0], minutes: entries.filter((e) => e.actual && wk.includes(e.date) && e.date <= today).reduce((s, e) => s + minutesOf(e), 0) }) }
  return out
}
export function loadRatio(entries: ScheduleEntry[], today: string): { acute: number; chronicWeekly: number; ratio: number | null } {
  const done = entries.filter((e) => e.actual && e.date <= today)
  const acute = done.filter((e) => e.date > addDays(today, -7)).reduce((s, e) => s + loadOf(e), 0)
  const chronic = done.filter((e) => e.date > addDays(today, -28)).reduce((s, e) => s + loadOf(e), 0) / 4
  return { acute, chronicWeekly: Math.round(chronic), ratio: chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null }
}
export type LogMetrics = { trend: ReturnType<typeof weeklyMinutes> | null; load: ReturnType<typeof loadRatio> | null; dynamics: boolean }
export function logMetrics(tier: Tier, entries: ScheduleEntry[], today: string): LogMetrics {
  return { trend: canShow(tier, "trainingTrend") ? weeklyMinutes(entries, today) : null, load: canShow(tier, "trainingLoad") ? loadRatio(entries, today) : null, dynamics: canShow(tier, "runDynamics") }
}
