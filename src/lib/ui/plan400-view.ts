/**
 * 只读 view-model：把内置导入的《400米53秒多 完整专项训练体系 V4》(plan400-v4.json) 与
 * 本机执行记录（fk-plan400-v4-log / fk-plan400-v4-overrides / fk-schedule-v1）聚合给首页与计划页同一份口径。
 * 不写任何存储、不改原课表、不改日期；冲突只报告。
 */
import type { CompStatus, DayComponents, PartFeedback } from './plan400-components-store'
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

/** v83（P0-01/P0-02）：V4 一天 = 一节课（Session）＋ 计划里应练的分项（跑步 / 力量，Component）。
 * 这里是唯一的分项事实投影：首页主卡、计划页周列表/进度、日志、方坤事实包都从这里派生，不各自猜。
 * 层次：计划（应练哪些分项）→ 观测/证据（手填、逐组/逐段执行、用户确认关联的手表跑步）→ 用户明确终态（完成/减量/跳过）。
 * - 候选手表跑步（同日但未确认）只是 candidate，不算记录、不算完成；用户确认关联也只是“跑步有实测”，不等于跑步完成。
 * - 用户填过分项（状态/RPE/疼痛/感受/备注）后，整天只由分项派生；旧整课 done 不再覆盖。
 * - 只有旧整课记录（fk-plan400-v4-log.done）时，整天按旧口径显示并标“历史整课”，绝不拆成两项各自完成，也不复制 RPE。 */
export type ExecState = 'COMPLETED' | 'PARTIAL' | 'INTERRUPTED' | null
export type DayParts = { parts?: DayComponents; runLinked?: boolean; runCandidates?: number; strengthExec?: ExecState; runExec?: ExecState; strengthMissed?: boolean; /** 日程条目 plan400:<date>:strength 上用户手动标的结果（按计划完成/实际不同/没练），没有逐组执行时才用 */ strengthMarked?: 'as_planned' | 'different' | 'missed' | null }
export const hasRunPart = (d: Pick<V4Day, 'title'>) => dayKind(d) !== 'rest' && !/^力量/.test(d.title)
export type PartState = 'done' | 'reduced' | 'skipped' | 'partial' | 'live' | 'candidate' | 'none'
export type PartFact = { state: PartState; label: string; source: 'user' | 'execution' | 'device' | 'hand' | 'feedback' | 'candidate' | null; rpe: number | null; detail?: string }
export type V4DayFact = { plannedRun: boolean; plannedLift: boolean; combo: boolean; running: PartFact | null; strength: PartFact | null; split: boolean; legacy: { done: string | null; rpe: string | null; pain: string | null }; legacyOverall: boolean; overall: 'done' | 'reduced' | 'skipped' | 'in_progress' | null; actualRun: boolean; actualLift: boolean; summary: string }
const PART_TEXT: Record<CompStatus, string> = { done: '完成', reduced: '减量完成', skipped: '跳过（没做）', not_recorded: '未记录' }
const filledV = (v: unknown) => String(v ?? '').trim().length > 0
const userStatus = (p: PartFeedback | undefined): Exclude<CompStatus, 'not_recorded'> | null => p?.status && p.status !== 'not_recorded' ? p.status : null
const partFeedback = (p: PartFeedback | undefined) => !!p && (p.rpe != null || !!p.feel || !!p.note || !!p.pain?.area || p.pain?.score != null)
/** 用户明确填过的分项信息（状态/RPE/疼痛/感受/备注）。设备关联、逐组执行不算“用户分项决定”。 */
export const hasEnteredPart = (x: DayParts | undefined): boolean => [x?.parts?.running, x?.parts?.strength].some(p => !!userStatus(p) || partFeedback(p))
const TERMINAL: PartState[] = ['done', 'reduced', 'skipped']
const ACTUAL: PartState[] = ['done', 'reduced', 'partial']
export function v4DayFact(d: V4Day, log: V4Log | undefined, x: DayParts | undefined = {}, strengthLive = false): V4DayFact {
  const l = log ?? {}, p = x?.parts
  const plannedRun = hasRunPart(d), plannedLift = hasStrength(d) && dayKind(d) !== 'rest'
  const withRpe = (label: string, q: PartFeedback | undefined) => label + (q?.rpe != null ? ` · RPE ${q.rpe}` : '')
  let running: PartFact | null = null, strength: PartFact | null = null
  if (plannedRun) {
    const q = p?.running, us = userStatus(q), linked = !!x?.runLinked
    running = us ? { state: us, label: withRpe(PART_TEXT[us], q), source: 'user', rpe: q?.rpe ?? null, ...(linked ? { detail: '已关联手表跑步（你确认的）' } : {}) }
      : x?.runExec === 'COMPLETED' ? { state: 'done', label: '逐段记录已完成', source: 'execution', rpe: q?.rpe ?? null }
      : x?.runExec === 'PARTIAL' || x?.runExec === 'INTERRUPTED' ? { state: 'partial', label: '逐段记录未做完', source: 'execution', rpe: q?.rpe ?? null }
      : linked ? { state: 'partial', label: '已关联手表跑步 · 待评价', source: 'device', rpe: q?.rpe ?? null }
      : filledV(l.reps) || filledV(l.rest) || filledV(l.aux) ? { state: 'partial', label: '已手填跑步记录', source: 'hand', rpe: q?.rpe ?? null, ...(x?.runCandidates ? { detail: `另有 ${x.runCandidates} 条同日手表跑步（未关联）` } : {}) }
      : partFeedback(q) ? { state: 'partial', label: withRpe('有评价 · 未标完成', q), source: 'feedback', rpe: q?.rpe ?? null }
      : x?.runCandidates ? { state: 'candidate', label: x.runCandidates === 1 ? '有同日手表跑步 · 待你确认' : `有 ${x.runCandidates} 条同日手表跑步 · 待你确认`, source: 'candidate', rpe: null }
      : { state: 'none', label: '未记录', source: null, rpe: null }
  }
  if (plannedLift) {
    const q = p?.strength, us = userStatus(q)
    strength = strengthLive ? { state: 'live', label: '逐组引导进行中', source: 'execution', rpe: null }
      : us ? { state: us, label: withRpe(PART_TEXT[us], q), source: 'user', rpe: q?.rpe ?? null }
      : x?.strengthExec === 'COMPLETED' ? { state: 'done', label: '逐组记录已完成', source: 'execution', rpe: q?.rpe ?? null }
      : x?.strengthExec === 'PARTIAL' || x?.strengthExec === 'INTERRUPTED' ? { state: 'partial', label: '逐组记录未做完', source: 'execution', rpe: q?.rpe ?? null }
      : x?.strengthMissed || x?.strengthMarked === 'missed' ? { state: 'skipped', label: '标记没练', source: 'user', rpe: null }
      : x?.strengthMarked === 'as_planned' ? { state: 'done', label: '已标按计划完成', source: 'user', rpe: q?.rpe ?? null }
      : x?.strengthMarked === 'different' ? { state: 'done', label: '已记录（实际与计划不同）', source: 'user', rpe: q?.rpe ?? null }
      : filledV(l.strength) ? { state: 'partial', label: '已手填力量记录', source: 'hand', rpe: q?.rpe ?? null }
      : partFeedback(q) ? { state: 'partial', label: withRpe('有评价 · 未标完成', q), source: 'feedback', rpe: q?.rpe ?? null }
      : { state: 'none', label: '尚未记录', source: null, rpe: null }
  }
  const need = [running, strength].filter((v): v is PartFact => !!v)
  const fromParts: V4DayFact['overall'] = need.length && need.every(v => TERMINAL.includes(v.state)) ? (need.every(v => v.state === 'skipped') ? 'skipped' : need.some(v => v.state === 'reduced' || v.state === 'skipped') ? 'reduced' : 'done')
    : need.some(v => v.state !== 'none' && v.state !== 'candidate') ? 'in_progress' : null
  const split = hasEnteredPart(x)
  const legacyDone = l.done === 'done' || l.done === 'reduced' || l.done === 'skipped' ? l.done : null
  const legacyOverall = !split && !!legacyDone
  const overall: V4DayFact['overall'] = split ? fromParts ?? 'in_progress' : legacyDone ? legacyDone : fromParts ?? (hasRecord(l) ? 'in_progress' : null)
  const actualRun = !!running && ACTUAL.includes(running.state), actualLift = !!strength && ACTUAL.includes(strength.state)
  const combo = plannedRun && plannedLift && dayKind(d) !== 'recovery'
  const summary = legacyOverall ? `历史整课记录（旧口径，跑步与力量没分开）：${legacyDone === 'done' ? '完成' : legacyDone === 'reduced' ? '减量完成' : '没练/取消'}`
    : !combo ? (running ? `跑步：${running.label}` : strength ? `力量：${strength.label}` : '')
    : `跑步：${running!.label} · 力量：${strength!.label}`
  return { plannedRun, plannedLift, combo, running, strength, split, legacy: { done: filledV(l.done) ? String(l.done) : null, rpe: filledV(l.rpe) ? String(l.rpe) : null, pain: filledV(l.pain) ? String(l.pain) : null }, legacyOverall, overall, actualRun, actualLift, summary }
}
/** 兼容旧调用：只看分项（不看旧整课）推出的整天状态。 */
export function partsDayStatus(d: V4Day, x: DayParts | undefined): DayStatus | null {
  if (!x) return null
  return v4DayFact(d, undefined, x).overall
}
export function dayStatus(d: V4Day, log: V4Log | undefined, today: string, strengthInProgress = false, extra?: DayParts): DayStatus {
  const f = v4DayFact(d, log, extra, strengthInProgress)
  if (f.overall) return f.overall
  if (strengthInProgress) return 'in_progress'
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
    const f = v4DayFact(d, l, parts[d.date])
    if (f.overall || hasRecord(l) || f.actualRun || f.actualLift) c.recordedDays++
    if ((k === 'train' || k === 'test') && (f.overall === 'done' || f.overall === 'reduced')) c.completedTrainingDays++
    if (f.overall === 'skipped') c.skippedDays++
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
