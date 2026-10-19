/**
 * 只读 view-model：把内置导入的《400米53秒多 完整专项训练体系 V4》(plan400-v4.json) 与
 * 本机执行记录（fk-plan400-v4-log / fk-plan400-v4-overrides / fk-schedule-v1）聚合给首页与计划页同一份口径。
 * 不写任何存储、不改原课表、不改日期；冲突只报告。
 */
import type { CompStatus, DayComponents } from './plan400-components-store'
export type V4Day = { orig: string; date: string; weekday: string; week: string; title: string; main: string[]; aux: string[]; strength: string[] }
export type V4Week = { week: string; title: string; range: string; principle: string }
export type V4Plan = { name: string; shiftDays: number; weeks: V4Week[]; days: V4Day[]; final?: V4Day }
export type V4Log = { done?: string; reps?: string; rest?: string; aux?: string; strength?: string; rpe?: string; pain?: string; r24?: string; r48?: string; note?: string; savedAt?: string }
export type DayKind = 'train' | 'recovery' | 'rest' | 'test'
export type DayStatus = 'rest' | 'not_started' | 'upcoming' | 'in_progress' | 'done' | 'reduced' | 'skipped' | 'unrecorded'
export const V4_PLAN_ID = 'plan400-v4'
export const V4_SOURCE_KEY = '400m-v4'

export const KIND_LABEL: Record<DayKind, string> = { train: '训练课', recovery: '恢复', rest: '休息日', test: '测试' }
export const STATUS_LABEL: Record<DayStatus, string> = { rest: '休息日', not_started: '未开始', upcoming: '未到日期', in_progress: '进行中', done: '已完成', reduced: '已完成·减量', skipped: '跳过/取消', unrecorded: '需补录' }

/** 按原课表标题归类（仅用于展示标签，不改变课程内容）。 */
export function dayKind(d: Pick<V4Day, 'title'>): DayKind {
  if (/休息/.test(d.title)) return 'rest'
  if (/恢复/.test(d.title)) return 'recovery'
  if (/测试/.test(d.title)) return 'test'
  return 'train'
}
/** 与 plan400.tsx 原有规则一致：力量文本以「无/可做/仅活动度」开头视为无正式力量部分。 */
export const hasStrength = (d: Pick<V4Day, 'strength'>) => { const t = d.strength.join(''); return Boolean(t) && !/^无|^可做|^仅活动度/.test(t) }
/** PDF 换行被拆成多行；展示时合并为一句，原始行在「原文」中原样保留。 */
export function joinLines(lines: string[]): string { return lines.join('').replace(/(.)观察：/g, '$1\n观察：') }
export const occurrenceId = (date: string) => `plan400:${date}`
export const strengthEntryId = (date: string) => `plan400:${date}:strength`
const RECORD_FIELDS: (keyof V4Log)[] = ['reps', 'rest', 'aux', 'strength', 'rpe', 'pain', 'note']
export const hasRecord = (l: V4Log | undefined) => Boolean(l && RECORD_FIELDS.some(k => String(l[k] ?? '').trim()))

/** 分项推出整天状态。只有所有应练分项明确完成才完成；跳过、未记录不能补成完成。
 * 手表跑步关联只算“跑步有实际记录”，不会让整天完成，也不会让力量完成。 */
export type DayParts = { parts?: DayComponents; runLinked?: boolean }
export const hasRunPart = (d: Pick<V4Day, 'title'>) => dayKind(d) !== 'rest' && !/^力量/.test(d.title)
/** 明确的「未记录」也属于新口径；设备候选、恢复问卷及保存时间不属于训练分项事实。 */
export const hasExplicitParts = (p: DayComponents | undefined) => [p?.running, p?.strength].some(q => !!q && (q.status != null || q.rpe != null || !!q.feel || !!q.note || !!(q.pain && (q.pain.area || q.pain.score != null))))
export function partsDayStatus(d: V4Day, x: DayParts | undefined): DayStatus | null {
  const p = x?.parts; if (!p && !x?.runLinked) return null
  const need: (CompStatus | undefined)[] = [...(hasRunPart(d) ? [p?.running?.status] : []), ...(hasStrength(d) ? [p?.strength?.status] : [])].map(v => v === 'not_recorded' ? undefined : v)
  if (need.length && need.every(v => v === 'skipped')) return 'skipped'
  if (need.length && need.every(v => v === 'done' || v === 'reduced')) return need.includes('reduced') ? 'reduced' : 'done'
  const any = need.some(Boolean) || x?.runLinked || [p?.running, p?.strength].some(q => q && (q.rpe != null || q.feel || q.note || (q.pain && (q.pain.area || q.pain.score != null))))
  return any ? 'in_progress' : null
}
export function dayStatus(d: V4Day, log: V4Log | undefined, today: string, strengthInProgress = false, extra?: DayParts): DayStatus {
  const fromParts = partsDayStatus(d, extra)
  if (fromParts && fromParts !== 'in_progress') return fromParts
  if (!hasExplicitParts(extra?.parts) && !extra?.runLinked) {
    if (log?.done === 'done') return 'done'
    if (log?.done === 'reduced') return 'reduced'
    if (log?.done === 'skipped') return 'skipped'
  }
  if (strengthInProgress || hasRecord(log) || fromParts === 'in_progress') return 'in_progress'
  if (dayKind(d) === 'rest') return 'rest'
  if (d.date < today) return 'unrecorded'
  return d.date === today ? 'not_started' : 'upcoming'
}
export type PrimaryCta = { label: string; action: 'start' | 'continue' | 'review' | 'reason' | 'rest' | 'backfill' | 'none' }
/** 每个状态只给一个主操作。 */
export function primaryCta(s: DayStatus): PrimaryCta {
  switch (s) {
    case 'not_started': return { label: '开始今日训练', action: 'start' }
    case 'in_progress': return { label: '继续训练', action: 'continue' }
    case 'done': case 'reduced': return { label: '查看本节记录', action: 'review' }
    case 'skipped': return { label: '查看取消记录', action: 'reason' }
    case 'rest': return { label: '查看休息日安排', action: 'rest' }
    case 'unrecorded': return { label: '补录这节训练', action: 'backfill' }
    default: return { label: '查看课表', action: 'none' }
  }
}

export function allDays(p: V4Plan): V4Day[] { return p.days }
export function dayOf(p: V4Plan, date: string): V4Day | undefined { return p.days.find(d => d.date === date) }
/** 当前周：包含 today 的周；早于计划时为第一周，晚于计划时为最后一周。 */
export function currentWeek(p: V4Plan, today: string): string {
  const exact = p.days.find(d => d.date === today && d.week !== 'TEST')
  if (exact) return exact.week
  const next = p.days.find(d => d.date >= today && d.week !== 'TEST')
  return (next ?? p.days.filter(d => d.week !== 'TEST').at(-1))?.week ?? p.weeks[0]?.week ?? ''
}
export function weekDays(p: V4Plan, week: string): V4Day[] { return p.days.filter(d => d.week === week) }

export type ProgressCounts = { calendarEntries: number; trainingDays: number; recoveryDays: number; restDays: number; testDays: number; recordedDays: number; completedTrainingDays: number; skippedDays: number }
/** 「已练 0/71」的 71 是日程条目数（70 个日历日 + 1 次最终测试，含休息/恢复日），不是训练节数。 */
export function progressCounts(p: V4Plan, logs: Record<string, V4Log>, parts: Record<string, DayParts> = {}): ProgressCounts {
  const c: ProgressCounts = { calendarEntries: p.days.length, trainingDays: 0, recoveryDays: 0, restDays: 0, testDays: 0, recordedDays: 0, completedTrainingDays: 0, skippedDays: 0 }
  for (const d of p.days) {
    const k = dayKind(d), l = logs[d.date]
    if (k === 'train') c.trainingDays++; else if (k === 'recovery') c.recoveryDays++; else if (k === 'rest') c.restDays++; else c.testDays++
    const ps = dayStatus(d, l, d.date, false, parts[d.date])
    if (l?.done || hasRecord(l) || partsDayStatus(d, parts[d.date])) c.recordedDays++
    if ((k === 'train' || k === 'test') && (ps === 'done' || ps === 'reduced')) c.completedTrainingDays++
    if (ps === 'skipped') c.skippedDays++
  }
  return c
}

const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
export type DateConflict = { week: string; text: string; mentioned: string; shownRange: string; originalRange: string; matchedDay?: { orig: string; date: string; weekday: string; title: string } }
/** 周标题/原则里写死的日期若不在当前展示周内，报告冲突（不修正）。year 取该周日程的年份。 */
export function dateConflicts(p: V4Plan): DateConflict[] {
  const out: DateConflict[] = []
  for (const w of p.weeks) {
    const ds = weekDays(p, w.week); if (!ds.length) continue
    const year = ds[0].date.slice(0, 4), from = ds[0].date, to = ds[ds.length - 1].date
    const text = `${w.title}｜${w.principle}`
    const seen = new Set<string>()
    for (const m of text.matchAll(/(\d{1,2})月(\d{1,2})日|(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) {
      const mm = Number(m[1] ?? m[3]), dd = Number(m[2] ?? m[4]); if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) continue
      const iso = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
      if (seen.has(iso) || (iso >= from && iso <= to)) continue
      seen.add(iso)
      const hit = p.days.find(d => d.orig === iso)
      out.push({ week: w.week, text: m[0], mentioned: iso, shownRange: `${md(from)}—${md(to)}`, originalRange: w.range, ...(hit ? { matchedDay: { orig: hit.orig, date: hit.date, weekday: hit.weekday, title: hit.title } } : {}) })
    }
  }
  return out
}
export function shiftSummary(p: V4Plan): { shifted: number; total: number; shiftDays: number; uniform: boolean } {
  const deltas = p.days.filter(d => d.orig).map(d => Math.round((Date.parse(d.date) - Date.parse(d.orig)) / 864e5))
  return { shifted: deltas.filter(x => x !== 0).length, total: p.days.length, shiftDays: p.shiftDays, uniform: deltas.every(x => x === deltas[0]) }
}

/** 临时/自建训练与正式周期的关系：只按真实 id/source 判断，不按日期或标题。 */
export type EntryLink = { linkedToV4: boolean; sourceLabel: string; sameDayV4?: { title: string; kind: DayKind } }
export function entryLink(p: V4Plan, e: { id: string; date: string; source: string; unplanned?: boolean }): EntryLink {
  const linked = e.id.startsWith('plan400:')
  const v = dayOf(p, e.date)
  return {
    linkedToV4: linked,
    sourceLabel: linked ? 'V4 计划·力量部分' : e.source === 'fangkun' ? '方坤安排' : e.unplanned ? '临时记录' : '自建训练',
    ...(v && !linked && dayKind(v) !== 'rest' ? { sameDayV4: { title: v.title, kind: dayKind(v) } } : {}),
  }
}

/* v78：用户确认“V4 从 10/19 = W1 开始，整体顺延 7 天是对的”。只存确认，不改导入的原课表。 */
export const DATE_CONFIRM_KEY = 'fk-plan400-dates-confirmed-v1'
export type DateConfirm = { shiftDays: number; at: string; by: string }
type KV = Pick<Storage, 'getItem' | 'setItem'> | null
const kv = (): KV => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
export function loadDateConfirm(p: V4Plan, s: KV = kv()): DateConfirm | null {
  try { const v = JSON.parse(s?.getItem(DATE_CONFIRM_KEY) ?? 'null'); return v && v.shiftDays === p.shiftDays && typeof v.at === 'string' ? v : null } catch { return null }
}
export function saveDateConfirm(p: V4Plan, by: string, s: KV = kv(), at = new Date().toISOString()): DateConfirm | null {
  const v = { shiftDays: p.shiftDays, at, by }; try { s?.setItem(DATE_CONFIRM_KEY, JSON.stringify(v)); return v } catch { return null }
}
export function clearDateConfirm(s: Pick<Storage, 'removeItem'> | null = kv() as never) { try { s?.removeItem(DATE_CONFIRM_KEY) } catch { /* ignore */ } }
/** 2026-10-19 用户（t486）确认：W1 = 10/19，+7 天日程正确。v78 升级时写一次；之后用户可在详情里撤销。 */
export function migrateUserConfirmedDates(p: V4Plan, s: KV = kv()): void {
  try { if (p.shiftDays === 7 && !s?.getItem(DATE_CONFIRM_KEY) && !s?.getItem(DATE_CONFIRM_KEY + ':revoked') && p.days.some(d => d.date === '2026-10-19' && d.week === 'W1')) saveDateConfirm(p, '用户确认（2026-10-19：W1 从 10/19 开始）', s, '2026-10-19T02:46:00Z') } catch { /* ignore */ }
}
/** 显示用：标题/原则里写的原日期（如「10月31日」）换成顺延后的日期（「11月7日」）。原数据不改。 */
export function shiftedText(p: V4Plan, week: string, text: string): string {
  const cs = dateConflicts(p).filter(c => c.week === week && c.matchedDay)
  return cs.reduce((t, c) => { const [, m, d] = c.matchedDay!.date.split('-').map(Number); const rep = /月/.test(c.text) ? `${m}月${d}日` : `${m}/${d}`; return t.split(c.text).join(rep) }, text)
}
