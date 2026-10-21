/** v77 单一格式化：日志列表/详情、佳明活动、方坤本地复盘、联网事实包、五维输入都用这里，保证同一活动处处数值一致。
 * 时间：佳明 startTimeLocal 形如 "2026-10-18 13:54:00"（Safari 不认空格），统一换成 T 再解析；日期 = 开始时间在用户时区的日期。
 * 取整：先把总秒数四舍五入再拆分，避免出现 5'60"。心率取整。距离 ≥1000 米用 km（两位小数），否则用 m。 */
export function parseActivityTime(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s)
  return Number.isFinite(d.getTime()) ? d : null
}
const pad = (n: number) => String(n).padStart(2, '0')
export function activityLocalDay(s: string | null | undefined): string | null {
  const d = parseActivityTime(s); return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null
}
export function activityLocalTime(s: string | null | undefined): string {
  const d = parseActivityTime(s); return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ''
}
export function fmtDistance(m: number | null | undefined): string | null {
  if (m == null || !Number.isFinite(m)) return null
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`
}
export function fmtDuration(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '—'
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}
function durationTicks(s: number | null | undefined): number | null {
  if (s == null || !Number.isFinite(s) || s < 0) return null
  const ticks = Math.round((s + Number.EPSILON * s) * 100)
  return Number.isSafeInteger(ticks) ? ticks : null
}
const fractionText = (hundredths: number) => hundredths ? `.${pad(hundredths).replace(/0$/, '')}` : ''
/** UI 计时显示：最多保留两位小数秒，不改变原始数值或方坤事实包的格式。 */
export function fmtDurationPrecise(s: number | null | undefined): string {
  const ticks = durationTicks(s)
  if (ticks == null) return '—'
  const t = Math.floor(ticks / 100), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60)
  const sec = `${pad(t % 60)}${fractionText(ticks % 100)}`
  return h ? `${h}:${pad(m)}:${sec}` : `${m}:${sec}`
}
/** 单段成绩与间歇休息用明确的秒单位；不改变保存的原始秒数。 */
export function fmtSeconds(s: number | null | undefined): string {
  const ticks = durationTicks(s)
  return ticks == null ? '—' : `${Math.floor(ticks / 100)}${fractionText(ticks % 100)} 秒`
}
export function fmtPaceSec(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null
  const t = Math.round(sec); return `${Math.floor(t / 60)}'${pad(t % 60)}"/km`
}
export const paceSecOf = (m: number | null | undefined, s: number | null | undefined) => !m || !s ? null : s / (m / 1000)
export const fmtPace = (m: number | null | undefined, s: number | null | undefined) => fmtPaceSec(paceSecOf(m, s))
export const fmtHr = (hr: number | null | undefined) => hr == null || !Number.isFinite(hr) ? null : Math.round(hr)
export const activityTs = (s: string | null | undefined) => parseActivityTime(s)?.getTime() ?? 0

/** v79.1：把存下的 UTC 时间戳（ISO）按北京时间显示。"md" = MM-DD HH:mm，"ymd" = YYYY-MM-DD HH:mm，"hm" = HH:mm。解析不了就原样截短，不编造。 */
export function stampCN(iso: string | null | undefined, form: 'md' | 'ymd' | 'hm' = 'md'): string {
  if (!iso) return ''
  const t = Date.parse(iso); if (!Number.isFinite(t) || !/[zZ]|[+-]\d\d:?\d\d$|T/.test(iso)) return String(iso).slice(0, 16).replace('T', ' ')
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map(x => [x.type, x.value]))
  const hm = `${p.hour}:${p.minute}`
  return form === 'hm' ? hm : form === 'ymd' ? `${p.year}-${p.month}-${p.day} ${hm}` : `${p.month}-${p.day} ${hm}`
}
