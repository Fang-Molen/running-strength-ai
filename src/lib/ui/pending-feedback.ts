/**
 * v83（整改包 P1-07）：“待补反馈”由事实推出，而不是由“弹过一次窗”决定。
 * 稍后 = 不再弹窗，但仍在待补列表；填了评价（或确认/否认了手表跑步）才离开列表。
 * 不写任何存储；旧版 prompted[]（弹过窗）只用来标“已推迟”。
 */
import { v4DayFact, type DayParts, type V4Day, type V4Log } from './plan400-view'
import type { DayComponents } from './plan400-components-store'
export type PendingKind = 'confirm_run' | 'rate_run' | 'rate_lift'
export type PendingItem = { date: string; part: 'running' | 'strength'; kind: PendingKind; text: string; deferred: boolean }
const fb = (p: DayComponents[keyof DayComponents] | undefined) => {
  const q = p as { status?: string; rpe?: number | null; feel?: string; note?: string; pain?: unknown } | undefined
  return !!q && ((!!q.status && q.status !== 'not_recorded') || q.rpe != null || !!q.feel || !!q.note)
}
export function pendingFeedback(days: V4Day[], parts: Record<string, DayParts>, logs: Record<string, V4Log>, today: string, prompted: string[] = [], windowDays = 14): PendingItem[] {
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - windowDays * 864e5).toISOString().slice(0, 10)
  const out: PendingItem[] = []
  for (const d of days) {
    if (d.date > today || d.date < from) continue
    const x = parts[d.date]; if (!x) continue
    const f = v4DayFact(d, logs[d.date], x), deferred = prompted.some(p => p.startsWith(`${d.date}|`))
    const r = f.running, s = f.strength, c = x.parts
    if (r?.state === 'candidate') out.push({ date: d.date, part: 'running', kind: 'confirm_run', text: '跑步：有同日手表跑步，确认是不是这节', deferred })
    else if (r && (r.source === 'device' || r.source === 'execution') && !fb(c?.running)) out.push({ date: d.date, part: 'running', kind: 'rate_run', text: r.source === 'device' ? '跑步：已关联手表·待评价' : '跑步：逐段已记·待评价', deferred })
    if (s && s.source === 'execution' && (s.state === 'done' || s.state === 'partial') && !fb(c?.strength)) out.push({ date: d.date, part: 'strength', kind: 'rate_lift', text: '力量：逐组已记·待评价', deferred })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}
