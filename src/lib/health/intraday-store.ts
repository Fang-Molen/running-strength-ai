/** v88.3 日内样本本地存储：按运动员 + 日期，最多保留 28 天（v89.1）；7 天前的日子压到每系列 ≤288 点（约 5 分钟一点）以控制本机空间，单天单系列 ≤720 点。只存设备样本，不进健康单一来源的日指标。 */
import { currentAthleteId } from '../core/events.ts'
import { currentStore } from '../core/storage.ts'
import { tidy, type IntradayDay } from './garmin-intraday.ts'
export const INTRADAY_KEY = 'fk-garmin-intraday-v1'
export const KEEP_DAYS = 28
export const RECENT_FULL_DAYS = 7, OLD_DAY_POINTS = 288
const key = (athlete: string) => `${INTRADAY_KEY}:${encodeURIComponent(athlete)}`
const valid = (d: any): d is IntradayDay => d && d.schemaVersion === 1 && /^\d{4}-\d\d-\d\d$/.test(d.day) && Array.isArray(d.hr) && Array.isArray(d.bb)
export function loadIntraday(athlete = currentAthleteId()): Record<string, IntradayDay> {
  try { const raw = JSON.parse(currentStore()?.getItem(key(athlete)) ?? 'null'); const days = raw?.schemaVersion === 1 && raw.days && typeof raw.days === 'object' ? raw.days : {}; return Object.fromEntries(Object.entries(days).filter(([k, v]) => valid(v) && (v as IntradayDay).day === k)) as Record<string, IntradayDay> } catch { return {} }
}
/** 合并写入：新的一天替换同日旧数据（同一来源的新版本），保留最近 28 天；空间不够时从最旧的日子开始舍弃（不动其他键）。返回写入天数。 */
export function saveIntraday(days: IntradayDay[], athlete = currentAthleteId()): number {
  const s = currentStore(); if (!s) return 0
  const all = { ...loadIntraday(athlete) }
  for (const d of days) if (valid(d)) all[d.day] = d
  const kept = Object.keys(all).sort().slice(-KEEP_DAYS)
  const fullFrom = kept.slice(-RECENT_FULL_DAYS)[0] ?? ''
  const slim = (d: IntradayDay): IntradayDay => d.day >= fullFrom ? d : { ...d, hr: tidy(d.hr, OLD_DAY_POINTS), bb: tidy(d.bb, OLD_DAY_POINTS), ...(d.st ? { st: tidy(d.st, OLD_DAY_POINTS) } : {}) }
  const wanted = new Set(days.map(d => d.day))
  for (let drop = 0; drop < kept.length; drop++) {
    const use = kept.slice(drop)
    const raw = JSON.stringify({ schemaVersion: 1, days: Object.fromEntries(use.map(k => [k, slim(all[k])])) })
    try { s.setItem(key(athlete), raw); if (s.getItem(key(athlete)) === raw) return days.filter(d => use.includes(d.day) && wanted.has(d.day)).length } catch { /* 空间不足：舍弃最旧的一天再试 */ }
  }
  return 0
}
export function intradayDay(day: string, athlete = currentAthleteId()): IntradayDay | null { return loadIntraday(athlete)[day] ?? null }
/** 已过完的一天（按手表当地时区）且是在当天结束 2 小时后抓的、并且确实有样本，才算取全；否则下次同步重取。 */
export function intradayComplete(day: string, athlete = currentAthleteId()): boolean {
  const d = intradayDay(day, athlete); if (!d || (!d.hr.length && !d.bb.length)) return false
  const offset = d.offsetMin ?? -new Date(Date.parse(day + 'T12:00:00Z')).getTimezoneOffset()
  const localEnd = Date.parse(day + 'T00:00:00Z') + 864e5 - offset * 60e3
  return Date.parse(d.fetchedAt) > localEnd + 2 * 3600e3
}
