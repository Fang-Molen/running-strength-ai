/** v88.3 日内样本本地存储：按运动员 + 日期，最多保留 14 天（v89：个人参考区间需≥7个可比日），单天单系列 ≤720 点。只存设备样本，不进健康单一来源的日指标。 */
import { currentAthleteId } from '../core/events.ts'
import { currentStore } from '../core/storage.ts'
import type { IntradayDay } from './garmin-intraday.ts'
export const INTRADAY_KEY = 'fk-garmin-intraday-v1'
export const KEEP_DAYS = 14
const key = (athlete: string) => `${INTRADAY_KEY}:${encodeURIComponent(athlete)}`
const valid = (d: any): d is IntradayDay => d && d.schemaVersion === 1 && /^\d{4}-\d\d-\d\d$/.test(d.day) && Array.isArray(d.hr) && Array.isArray(d.bb)
export function loadIntraday(athlete = currentAthleteId()): Record<string, IntradayDay> {
  try { const raw = JSON.parse(currentStore()?.getItem(key(athlete)) ?? 'null'); const days = raw?.schemaVersion === 1 && raw.days && typeof raw.days === 'object' ? raw.days : {}; return Object.fromEntries(Object.entries(days).filter(([k, v]) => valid(v) && (v as IntradayDay).day === k)) as Record<string, IntradayDay> } catch { return {} }
}
/** 合并写入：新的一天替换同日旧数据（同一来源的新版本），保留最近 14 天。返回写入天数。 */
export function saveIntraday(days: IntradayDay[], athlete = currentAthleteId()): number {
  const s = currentStore(); if (!s) return 0
  const all = { ...loadIntraday(athlete) }
  for (const d of days) if (valid(d)) all[d.day] = d
  const kept = Object.keys(all).sort().slice(-KEEP_DAYS)
  const raw = JSON.stringify({ schemaVersion: 1, days: Object.fromEntries(kept.map(k => [k, all[k]])) })
  try { s.setItem(key(athlete), raw); return s.getItem(key(athlete)) === raw ? days.length : 0 } catch { return 0 }
}
export function intradayDay(day: string, athlete = currentAthleteId()): IntradayDay | null { return loadIntraday(athlete)[day] ?? null }
/** 已过完的一天且是在当天结束后抓的，就不必再抓。 */
export function intradayComplete(day: string, athlete = currentAthleteId()): boolean {
  const d = intradayDay(day, athlete); return !!d && Date.parse(d.fetchedAt) > Date.parse(day + 'T23:59:59Z') + 14 * 3600e3
}
