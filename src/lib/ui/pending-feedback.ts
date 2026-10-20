/**
 * v83（整改包 P1-07）：“待补反馈”由事实推出，而不是由“弹过一次窗”决定。
 * 稍后 = 不再弹窗，但仍在待补列表；填了评价（或确认/否认了手表跑步）才离开列表。
 * 不写任何存储；旧版 prompted[]（弹过窗）只用来标“已推迟”。
 */
import { v4DayFact, type DayParts, type V4Day, type V4Log } from './plan400-view'
import type { DayComponents } from './plan400-components-store'
export type PendingKind = 'confirm_run' | 'rate_run' | 'rate_lift'
export type PendingItem = { date: string; part: 'running' | 'strength'; kind: PendingKind; text: string; deferred: boolean }
/** Shared logical identity across home, log and coach. Never use array position. */
export function pendingTaskId(item: PendingItem, athleteId: string): string {
  return `feedback:${encodeURIComponent(athleteId)}:v4:${item.date}:${item.part}:${item.kind}`
}
/** v88.1：首页一行说清是哪天哪节哪一项（不只写“1 项”）。48–72h 恢复补填从不进待补列表。 */
export function pendingLabel(it: PendingItem, title?: string): string { return `${Number(it.date.slice(5, 7))}月${Number(it.date.slice(8, 10))}日${title ? `「${title}」` : ''} ${it.text}` }
const fb = (p: DayComponents[keyof DayComponents] | undefined) => {
  const q = p as { status?: string; rpe?: number | null; feel?: string; note?: string; pain?: unknown } | undefined
  return !!q && ((!!q.status && q.status !== 'not_recorded') || q.rpe != null || !!q.feel || !!q.note)
}
/** v87.1：非组合课（恢复课、单跑/单力量）的「课后」页只有整课反馈表，存在 fk-plan400-v4-log[date]（done/rpe/pain/note）。
 * 那里填过 = 这节已评价。组合课的课后只给分项表，旧整课分不复制给分项，所以只在非组合课时算。 */
const LEGACY_FB = ['done', 'rpe', 'pain', 'note'] as const
export const legacyRated = (log: V4Log | undefined) => !!log && LEGACY_FB.some(k => String(log[k] ?? '').trim().length > 0)
/** 这一天的这个分项是否已有用户评价（任何保存路径：分项表 / 非组合课整课表）。待补列表与导入弹窗共用这一个判断。 */
export function partRated(d: V4Day, x: DayParts | undefined, log: V4Log | undefined, part: 'running' | 'strength'): boolean {
  if (fb(x?.parts?.[part])) return true
  // v88.1（用户 10-20）：在「24–72h」里填过这一项的恢复（跑步腿感 / 力量酸痛，哪怕填“无”）也是给过反馈，不再催
  const rec = x?.parts?.recovery as Record<string, unknown> | undefined
  if (rec && (part === 'running' ? ['runLegs24', 'runLegs48'] : ['strengthSoreness24', 'strengthSoreness48']).some(k => String(rec[k] ?? '').trim())) return true
  return !v4DayFact(d, log, x ?? {}).combo && legacyRated(log)
}
export function pendingFeedback(days: V4Day[], parts: Record<string, DayParts>, logs: Record<string, V4Log>, today: string, prompted: string[] = [], windowDays = 14, movedOriginalDates: ReadonlySet<string> = new Set()): PendingItem[] {
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - windowDays * 864e5).toISOString().slice(0, 10)
  const out: PendingItem[] = []
  for (const d of days) {
    if (d.date > today || d.date < from) continue
    const x = parts[d.date]; if (!x) continue
    const f = v4DayFact(d, logs[d.date], x), deferred = prompted.some(p => p.startsWith(`${d.date}|`))
    // v88（R1 改期）：原日期已改期且没有实际 → 不再催原日确认/评分；有真实训练仍保留
    if (movedOriginalDates.has(d.date) && !f.actualRun && !f.actualLift) continue
    const r = f.running, s = f.strength
    // 已手动评价了跑步、但同日手表跑步还没确认/否认的，也要确认（否则计划外与计划课可能重复计）
    if (r?.state === 'candidate' || (r && !x.runLinked && (x.runCandidates ?? 0) > 0)) out.push({ date: d.date, part: 'running', kind: 'confirm_run', text: '跑步：有同日手表跑步，确认是不是这节', deferred })
    else if (r && (r.source === 'device' || r.source === 'execution') && !partRated(d, x, logs[d.date], 'running')) out.push({ date: d.date, part: 'running', kind: 'rate_run', text: r.source === 'device' ? '跑步：已关联手表·待评价' : '跑步：逐段已记·待评价', deferred })
    if (s && s.source === 'execution' && (s.state === 'done' || s.state === 'partial') && !partRated(d, x, logs[d.date], 'strength')) out.push({ date: d.date, part: 'strength', kind: 'rate_lift', text: '力量：逐组已记·待评价', deferred })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}
