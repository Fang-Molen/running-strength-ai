/** Read-only labels: original interval and clipped chart interval remain distinct. */
import { clock } from './garmin-intraday.ts'
import type { Event } from './intraday-recovery-u10.ts'
import type { RestRecord } from './intraday/sleep.ts'

export function durationLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  return m >= 60 ? `${Math.floor(m / 60)}小时${m % 60 ? `${m % 60}分` : ''}` : `${m}分钟`
}
export function eventTimeLabel(ms: number, day: string, offset: number): string {
  const local = new Date(ms + offset * 60000).toISOString().slice(0, 10)
  const delta = Math.round((Date.parse(local) - Date.parse(day)) / 864e5)
  const prefix = delta === 0 ? '' : delta === -1 ? '前一天 ' : delta === 1 ? '次日 ' : `${local.slice(5).replace('-', '/')} `
  return prefix + clock(ms, offset)
}
export function eventReadout(event: Event, day: string, offset: number) {
  const start = Date.parse(event.startAt), end = Date.parse(event.endAt)
  const total = (end - start) / 60000, inside = (event.endHour - event.startHour) * 60
  return {
    time: `${eventTimeLabel(start, day, offset)}–${eventTimeLabel(end, day, offset)}`,
    duration: `时段 ${durationLabel(total)}${Math.abs(total - inside) > .5 ? ` · 当天 ${durationLabel(inside)}` : ''}`,
  }
}
export function restOnDay(records: readonly RestRecord[], day: string, offset: number) {
  const start = Date.parse(day + 'T00:00:00Z') - offset * 60000, end = start + 864e5
  return records.filter(r => r.form === 'INTERVAL'
    ? r.occurredStart !== null && r.occurredEnd !== null && r.occurredStart < end && r.occurredEnd > start
    : r.contextDay === day && r.duration !== null)
}
export function restReadout(r: RestRecord, day: string, offset: number) {
  if (r.form === 'INTERVAL' && r.occurredStart !== null && r.occurredEnd !== null) {
    const start = Date.parse(day + 'T00:00:00Z') - offset * 60000
    return eventReadout({eventId:'',kind:'REST',sourceId:r.sourceNamespace,status:'CONFIRMED',startAt:new Date(r.occurredStart).toISOString(),endAt:new Date(r.occurredEnd).toISOString(),startHour:Math.max(0,(r.occurredStart-start)/36e5),endHour:Math.min(24,(r.occurredEnd-start)/36e5)}, day, offset)
  }
  const d = r.duration
  return { time: '未填写具体时刻', duration: d ? d.high === null ? `至少 ${d.low} 分钟` : `约 ${d.low}${d.high !== d.low ? `–${d.high}` : ''} 分钟` : '时长未知' }
}
