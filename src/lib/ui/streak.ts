/** 连续打卡：当天完成一节课或登记一次实际不同/没练原因都算；每周（周一起）最多 2 次自动“休息不断签”；提醒每天最多 2 条。 */
import { weekOf, type ScheduleEntry } from "./day-schedule-rules.ts"
export const FREEZES_PER_WEEK = 2
const dayNum = (d: string) => Date.parse(d + "T00:00:00Z") / 864e5
const iso = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10)
export function dayCounts(entries: ScheduleEntry[], date: string): boolean {
  return entries.some((e) => e.date === date && !!e.actual && (e.actual.outcome !== "missed" || e.actual.reasons.length > 0))
}
export type Streak = { days: number; frozen: string[]; todayDone: boolean; freezesLeft: number }
export function computeStreak(entries: ScheduleEntry[], today: string): Streak {
  const todayDone = dayCounts(entries, today)
  let d = todayDone ? dayNum(today) : dayNum(today) - 1, days = 0
  const frozen: string[] = [], used = new Map<string, number>()
  for (let guard = 0; guard < 400; guard++, d--) {
    const date = iso(d)
    if (dayCounts(entries, date)) { days++; continue }
    const wk = weekOf(date)[0], u = used.get(wk) ?? 0
    if (u < FREEZES_PER_WEEK && hasHistoryBefore(entries, date)) { used.set(wk, u + 1); frozen.push(date); continue }
    break
  }
  return { days, frozen: days ? frozen : [], todayDone, freezesLeft: FREEZES_PER_WEEK - (used.get(weekOf(today)[0]) ?? 0) }
}
const hasHistoryBefore = (entries: ScheduleEntry[], date: string) => entries.some((e) => e.date < date && dayCounts(entries, e.date))

/** 提醒：上次训练后约 24 小时一条；21:00 仍没记录再一条（可关）；每天最多 2 条。 */
export type ReminderPrefs = { master: boolean; training: boolean; pending: boolean; stale: boolean; evening: boolean }
export function planReminders(lastSessionIso: string | null, now: Date, todayLogged: boolean, p: ReminderPrefs, sentToday = 0): { at: string; text: string }[] {
  if (!p.master || todayLogged) return []
  const out: { at: string; text: string }[] = []
  if (p.training && lastSessionIso) { const at = new Date(Date.parse(lastSessionIso) + 24 * 3600e3); if (at.toDateString() === now.toDateString() && at > now) out.push({ at: at.toISOString(), text: "到点了：看看今天的课" }) }
  if (p.evening) { const at = new Date(now); at.setHours(21, 0, 0, 0); if (at > now) out.push({ at: at.toISOString(), text: "今天还没记录，记一笔也算打卡" }) }
  return out.slice(0, Math.max(0, 2 - sentToday))
}
