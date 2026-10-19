import {coachImports} from '@/lib/core/coach-import-evidence'
import { activityLocalDay } from './activity-format'
import V4 from '../plan400-v4.json' with { type: 'json' }
import {garminViewKey} from '@/lib/health/garmin-view-scope'
import {occurrenceVoided} from '@/lib/core/training-correction'
import {currentAthleteId} from '@/lib/core/events'
import { loadConfirmedTrainingImports } from '@/lib/core/training-import';
import { listTrainingOccurrences } from '@/lib/core/occurrence';
import { executionOf } from '@/lib/core/execution';
import { projectRunningExecution } from '@/lib/core/running-execution';
import { loadEvents } from '@/lib/core/events';
import { readTrainingFact } from '@/lib/core/fact-read';
import type { LoggedSession } from './coach-assessment';
import { addDays, weekOf } from './day-schedule-rules';
import { runningActualTotals } from './running-actual-totals';
import type { ScheduleEntry } from './day-schedule-rules';
import { matchRuns, v4RunSlots, allRunLinks, v4RunSlotId, type RunLink, type RunSuggestion } from './run-link';
import { loadComponents, type DayComponents, type ComponentsDoc } from './plan400-components-store';
import { v4DayFact, type DayParts, type V4Day, type V4DayFact, type V4Log } from './plan400-view';
import { legacyQuickAudit, type LegacyQuickAudit } from './quick-log-save'
import { v4ExecFrom, type V4Exec } from './v4-exec';
export type RowSource = 'execution' | 'phone' | 'import' | 'garmin'
export type ActivityRow = LoggedSession & { startedAt: string; source: RowSource; originIds: string[]; /** v77：completed=已完成；incomplete=已记录未完成（改了组数/开始了但没点完成） */ status?: 'completed' | 'incomplete'; timeUnknown?: boolean; appMade?: boolean; /** 来自 V4 计划记录 */ plan?: 'v4'; /** v76 显示用（只读） */ title?: string; avgHr?: number | null; garminId?: number | string; importId?: string; occurrenceId?: string; sources?: RowSource[]; /** v79：关联的计划跑步课（日程或 V4 跑步部分），同一条记录 */ runLink?: { entryId: string; title: string; by: 'auto' | 'user' }; /** v79：V4 分项反馈（fk-plan400-v4-components-v1） */ v4parts?: DayComponents; /** v83：V4 当天课的分项事实投影（唯一口径：首页/计划/日志/方坤共用） */ v4?: V4DayFact & { date: string }; /** v83：合并进这一条的原始记录（各自来源/项目/时长），用于分项时长与追溯 */ members?: { id: string; source: RowSource; sport: LoggedSession['sport']; durationSec: number | null; status?: 'completed' | 'incomplete' }[]; /** v83：有分项缺时长，durationSec 只是已知部分之和 */ durationPartial?: boolean; /** v83：记一笔（计划外）生成 */ quickLog?: boolean; /** v83：数据口径说明（如“用时未知（旧版本可能填了默认 30 分钟）”） */ note?: string };
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const day = (iso: string) => activityLocalDay(iso);
function sameActivity(a: ActivityRow, b: ActivityRow) {
  if (a.originIds.some(id => b.originIds.includes(id))) return true;
  return false; // Coincident time/distance do not establish shared identity or protocol.
}
const memberOf = (r: ActivityRow) => ({ id: r.id, source: r.source, sport: r.sport, durationSec: r.durationSec, status: r.status })
/** Conservative read-only deduplication. A shared date or title never identifies an activity. */
export function mergeActivities(rows: ActivityRow[]): ActivityRow[] {
  const result: ActivityRow[] = [], rank: Record<RowSource, number> = { execution: 0, phone: 1, import: 2, garmin: 3 };
  for (const row of [...rows].sort((a, b) => rank[a.source] - rank[b.source])) {
    const found = result.find(r => sameActivity(r, row));
    if (found) {
      found.members = [...(found.members ?? []), memberOf(row)];
      found.originIds = [...new Set([...found.originIds, ...row.originIds])]; found.sources = [...new Set([...(found.sources ?? [found.source]), row.source])];
      if (!found.title || /佳明账号同步|^力量训练$/.test(found.title)) found.title = row.title || found.title
      found.avgHr ??= row.avgHr; found.garminId ??= row.garminId; found.importId ??= row.importId; found.occurrenceId ??= row.occurrenceId
      if (row.plan === 'v4') { found.plan = 'v4'; found.title = row.title; if (row.v4) found.v4 = row.v4; else if (found.sport !== row.sport) found.sport = 'MIXED'; if (row.v4parts) found.v4parts = row.v4parts }
      else if (found.sport !== row.sport && found.sport !== 'MIXED') found.sport = 'MIXED' // v81：同一节的跑步分段＋逐组力量 = 一条；v83：任何来源合并出两种项目都如实标“跑+力量”，不让一项盖掉另一项
      if (row.status === 'completed') found.status = 'completed'; if (row.appMade) found.appMade = true; if (found.timeUnknown && !row.timeUnknown && row.date === found.date) { found.startedAt = row.startedAt; found.timeUnknown = false }
      found.distanceM ??= row.distanceM; found.rpe ??= row.rpe; found.sets ??= row.sets
      // v83：不同项目的分项各有时长 → 已知部分相加（缺的标“部分”）；同一项目的多来源 = 同一次活动，取第一条有值的
      if (row.sport !== found.members![0].sport && row.durationSec != null && found.durationSec != null && !found.v4) { found.durationSec += row.durationSec } else found.durationSec ??= row.durationSec
      continue;
    }
    result.push({ ...row, originIds: [...row.originIds], sources: [row.source], members: [memberOf(row)] });
  }
  // v83：并入 V4 投影的那一条，项目/状态/时长按分项事实重算（“合并里有一条完成”不等于整课完成）
  for (const r of result) if (r.v4) applyV4Fact(r, r.v4)
  return result.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
export function activityWeeks(rows: LoggedSession[], today: string, weeks = 4) {
  return Array.from({ length: weeks }, (_, i) => { const days = weekOf(addDays(today, -7 * (weeks - i - 1))); const records = rows.filter(r => days.includes(r.date) && r.date <= today); return { week: days[0], minutes: Math.round(records.reduce((s, r) => s + (r.durationSec ?? 0), 0) / 60), unknownDuration: records.filter(r => r.durationSec == null).length }; });
}
export function garminRows(raw: unknown): ActivityRow[] {
  if (!raw || typeof raw !== 'object') return [];
  return Object.values(raw as Record<string, Record<string, unknown>>).flatMap(g => {
    if (!g || typeof g.start !== 'string' || !day(g.start) || !g.id) return [];
    const sport = /run|track|treadmill/.test(String(g.type)) ? 'RUNNING' as const : /strength|weight|fitness|training/.test(String(g.type)) ? 'STRENGTH' as const : 'UNKNOWN' as const;
    if (sport === 'UNKNOWN') return [];
    const identity = typeof g.sourceIdentity === 'string' ? g.sourceIdentity : `garmin:${g.id}`;
    return [{ id: identity, startedAt: g.start, date: day(g.start)!, sport, distanceM: finite(g.dist), durationSec: finite(g.dur), strengthVolumeKg: null, sets: finite(g.sets), rpe: garminRpe(g.rpe), source: 'garmin' as const, originIds: [identity], title: typeof g.name === 'string' ? g.name : '', avgHr: finite(g.avgHr), garminId: g.id as number }];
  });
}
export function loadTrainingActivities(): ActivityRow[] {
  const rows: ActivityRow[] = [], events = loadEvents().filter(e=>(e.athlete_id ?? 'local')===currentAthleteId()), ids=new Set(events.filter(e=>e.event_type==='TRAINING_STARTED').map(e=>e.event_id)), occurrences = listTrainingOccurrences().filter(o=>ids.has(o.trainingOccurrenceId)&&!occurrenceVoided(o.trainingOccurrenceId)&&o.startedAt&&Date.parse(o.startedAt)<=Date.now());
  const linkedDrafts = new Map<string, string[]>();
  try {
    const calendar = JSON.parse(localStorage.getItem('fk-schedule-v1') ?? '{}') as { entries?: ScheduleEntry[] };
    for (const e of calendar.entries ?? []) {
      const bound = e.actual?.occurrenceIds ?? occurrences.filter(o => o.planSlotId === e.id).map(o => o.trainingOccurrenceId);
      if (bound.length) linkedDrafts.set(`act-${e.id}`.replace(/[^0-9A-Za-z-]/g, '').slice(0, 55), bound);
    }
  } catch { /* no explicit schedule provenance */ }
  for (const o of occurrences) {
    if (!o.startedAt || !day(o.startedAt)) continue;
    const latest = [...occurrences].reverse().find(x => x.sessionId === o.sessionId)?.trainingOccurrenceId === o.trainingOccurrenceId;
    const fact = readTrainingFact(o.trainingOccurrenceId), state = executionOf(o.sessionId), completed = latest ? state.sets.filter(s => s.completed && !s.skipped && s.actualAmount != null) : [];
    const run = projectRunningExecution(o.trainingOccurrenceId, events), slots = [...run.repetitions, ...run.continuous].filter(s => s.status === 'COMPLETED');
    const isRun = run.availability === 'AVAILABLE' && slots.length > 0;
    // A start alone is not evidence that any work was performed; but recorded sets (even not finished) are shown as 已记录未完成.
    const anySets = events.some(e => e.event_type === 'TRAINING_SET_COMPLETED' && (e.payload as { trainingOccurrenceId?: string }).trainingOccurrenceId === o.trainingOccurrenceId)
    const doneCount = fact?.completedSetCount ?? 0
    if (!isRun && doneCount < 1 && !anySets) continue;
    const incomplete = !isRun && (doneCount < 1 || o.lifecycle === 'IN_PROGRESS');
    const elapsed = o.endedAt ? (Date.parse(o.endedAt) - Date.parse(o.startedAt)) / 1000 : null;
    const totals = runningActualTotals(run);
    rows.push({ id: o.trainingOccurrenceId, startedAt: o.startedAt, date: day(o.startedAt)!, sport: isRun ? 'RUNNING' : 'STRENGTH', distanceM: isRun ? totals.distanceM : null, durationSec: isRun ? totals.durationSec : elapsed != null && Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
      strengthVolumeKg: completed.length && completed.every(s => s.mode === 'reps' && s.actualWeight != null) ? completed.reduce((sum, s) => sum + s.actualWeight! * s.actualAmount!, 0) : null,
      sets: isRun ? null : fact?.completedSetCount ?? null, rpe: null, source: 'execution', originIds: [o.trainingOccurrenceId, ...(o.planSlotId ? [`sched:${o.planSlotId}`] : []), ...(/^plan400:\d{4}-\d\d-\d\d/.test(o.planSlotId ?? '') ? [o.planSlotId!.slice(0, 18)] : []), ...(/^scheduled:plan400:\d{4}-\d\d-\d\d/.test(o.planSlotId ?? '') ? [o.planSlotId!.slice(10, 28), `sched:${o.planSlotId!.slice(10).replace(/:run$/, '')}`] : [])], occurrenceId: o.trainingOccurrenceId, status: incomplete ? 'incomplete' : 'completed', title: o.sessionId ? sessionTitle(o.sessionId) : undefined });
  }
  // v83（P0-03）：旧版本记一笔的默认用时，读时如实改成“未知”（不改存储）
  let qa = new Map<string, LegacyQuickAudit>()
  try { qa = legacyQuickAudit(JSON.parse(localStorage.getItem('fk-schedule-v1') ?? '{}')?.entries ?? [], JSON.parse(localStorage.getItem('fk-notes-v1') ?? '[]')) } catch { /* 无日程/笔记 */ }
  for (const x of coachImports().filter(x=>!occurrenceVoided(x.confirmedImportId))) {
    if (!x.occurredAt.value || !day(x.occurredAt.value)) continue;
    const sets = x.strengthSets.filter(s => s.completion === 'COMPLETED');
    const identity = typeof x.sourceRecordIdentity === 'string' ? [x.sourceRecordIdentity] : [];
    rows.push({ id: x.draftId, startedAt: x.occurredAt.value, date: day(x.occurredAt.value)!, sport: x.sport, distanceM: x.totalDistanceMeters.value, durationSec: x.durationSeconds.value,
      strengthVolumeKg: sets.length && sets.every(s => s.weightKg.value != null && s.repetitions.value != null) ? sets.reduce((sum, s) => sum + s.weightKg.value! * s.repetitions.value!, 0) : null, sets: sets.length || null, rpe: x.sessionRpe.value, source: 'import', originIds: [x.draftId, ...identity, ...(linkedDrafts.get(x.draftId) ?? [])], title: x.title.value ?? '', importId: x.confirmedImportId, status: 'completed', appMade: /^(act-|chk-|q-)/.test(x.draftId) });
    const q = qa.get(x.draftId), last = rows[rows.length - 1]
    if (q) { last.durationSec = q.durationSec; last.distanceM ??= q.distanceM; last.title = q.title; if (q.note) last.note = q.note; last.quickLog = true }
    else if (/^act-q-n-/.test(x.draftId)) last.quickLog = true
  }
  rows.push(...orphanSetRows(events, occurrences), ...phoneRows());
  try { rows.push(...garminRows(JSON.parse(localStorage.getItem(garminViewKey('fk-garmin-acts-v1')) ?? '{}'))); } catch { /* no device cache */ }
  let exec: Record<string, V4Exec> = {}
  try { exec = v4ExecFrom(listTrainingOccurrences().filter(o => ids.has(o.trainingOccurrenceId)), events, occurrenceVoided) } catch { exec = {} }
  return linkRuns(rows, typeof localStorage === 'undefined' ? null : localStorage, Date.now(), exec);
}
/** v83：v4Parts = 每个 V4 日期送进 v4DayFact 的同一份分项输入（首页主卡/计划/日志/方坤共用，避免各算各的） */
export type V4DayInput = DayParts & { strengthLive?: boolean }
let lastMatch: { links: RunLink[]; suggestions: RunSuggestion[]; v4Parts?: Record<string, V4DayInput> } = { links: [], suggestions: [], v4Parts: {} }
/** v79：上一次 loadTrainingActivities 算出的 计划跑步课 ↔ 手表跑步 关联（日志、方坤、计划页共用同一份）。 */
export function loadRunMatch() { loadTrainingActivities(); return lastMatch }
export const lastRunMatch = () => lastMatch
/** 计划跑步课（日程 + V4 跑步部分）↔ 手表跑步：关联后 V4 那天与这条跑步合并成一条记录；日程跑步课本来就不生成记录。只算一次。 */
export function linkRuns(rows: ActivityRow[], store: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage, now = Date.now(), exec: Record<string, V4Exec> = {}): ActivityRow[] {
  const today = day(new Date(now).toISOString())!
  let match: typeof lastMatch = { links: [], suggestions: [] }
  let comps: ComponentsDoc = { schemaVersion: 1, days: {} }, p4: Record<string, V4Log> = {}
  try { comps = loadComponents(store) } catch { /* 读不到分项：按空 */ }
  try { p4 = JSON.parse(store?.getItem('fk-plan400-v4-log') ?? '{}') ?? {} } catch { p4 = {} }
  let sched: ScheduleEntry[] = []
  try {
    sched = (JSON.parse(store?.getItem('fk-schedule-v1') ?? '{}')?.entries ?? []) as ScheduleEntry[]
    const base = (() => { try { return JSON.parse(store?.getItem('fk-run-links-v1') ?? '{}') ?? {} } catch { return {} } })()
    match = matchRuns([...sched, ...v4RunSlots(V4.days as V4Day[], today, comps)], mergeActivities(rows), allRunLinks(comps, base), today)
  } catch { /* 没有日程/关联：不关联 */ }
  // v83：V4 当天只要有任何证据（手机执行 / 用户确认关联的手表跑步 / 记录），就有且只有一条 V4 投影行；同一课的执行与已确认的手表跑步并入这一条，只算一次。
  const v4Linked = new Map(match.links.filter(l => l.entry.id.startsWith('plan400:')).map(l => [l.entry.date, l]))
  const haveP4 = new Set(rows.filter(r => r.plan === 'v4').map(r => r.date))
  for (const d of new Set([...Object.keys(exec), ...v4Linked.keys()])) {
    if (haveP4.has(d) || d > today) continue
    const pd = (V4.days as V4Day[]).find(x => x.date === d); if (!pd) continue
    const e = exec[d]; if (!e?.strength && !e?.run && !v4Linked.has(d)) continue
    rows.push({ id: `p400:${d}`, startedAt: localNoon(d), timeUnknown: true, date: d, sport: 'STRENGTH', distanceM: null, durationSec: null, strengthVolumeKg: null, sets: null, rpe: null, source: 'phone', appMade: true, plan: 'v4', title: `V4 ${pd.title}`, status: 'incomplete', originIds: [`p400:${d}`, `plan400:${d}`, `sched:plan400:${d}:strength`] })
  }
  const v4Parts: Record<string, V4DayInput> = {}
  const v4Dates = new Set([...Object.keys(comps.days ?? {}), ...Object.keys(exec), ...v4Linked.keys(), ...Object.keys(p4 ?? {}),
    ...match.suggestions.filter(s => s.entry.id.startsWith('plan400:')).map(s => s.entry.date), ...sched.filter(e => typeof e?.id === 'string' && e.id.startsWith('plan400:')).map(e => e.date)])
  for (const d of v4Dates) {
    if (!/^\d{4}-\d\d-\d\d$/.test(d)) continue
    const se = sched.find(e => e?.id === `plan400:${d}:strength`)?.actual
    v4Parts[d] = { parts: comps.days?.[d], runLinked: v4Linked.has(d), runCandidates: v4Linked.has(d) ? 0 : match.suggestions.find(s => s.entry.id === v4RunSlotId(d))?.runs.length ?? 0,
      strengthExec: exec[d]?.strength ?? (se?.executionState ?? null), runExec: exec[d]?.run ?? null, strengthMarked: se && !se.executionState ? se.outcome : null, strengthLive: !!exec[d]?.strengthLive }
  }
  for (const [d, l] of v4Linked) { const p = rows.find(r => r.id === `p400:${d}`); if (p) p.originIds = [...new Set([...p.originIds, ...l.run.originIds])] }
  const merged = mergeActivities(rows)
  for (const l of match.links) { const row = merged.find(r => r.originIds.some(id => l.run.originIds.includes(id))); if (row) row.runLink = { entryId: l.entry.id, title: l.entry.title, by: l.by } }
  for (const row of merged) {
    const d = row.originIds.map(id => /^plan400:(\d{4}-\d\d-\d\d)$/.exec(id)?.[1]).find(Boolean); if (!d) continue
    const pd = (V4.days as V4Day[]).find(x => x.date === d); if (!pd) continue
    const x = v4Parts[d] ?? {}
    const f = v4DayFact(pd, p4[d], x, !!x.strengthLive)
    applyV4Fact(row, { ...f, date: d })
  }
  lastMatch = { ...match, v4Parts }
  return merged
}
/** v83：V4 投影行的项目/状态/时长只由分项事实决定（不由计划标题、不由“合并里有一条完成”决定）。 */
export function applyV4Fact(row: ActivityRow, f: V4DayFact & { date: string }) {
  row.v4 = f; row.plan = 'v4'
  row.sport = f.actualRun && f.actualLift ? 'MIXED' : f.actualRun ? 'RUNNING' : f.actualLift ? 'STRENGTH' : f.legacyOverall && f.overall !== 'skipped' ? (f.plannedRun && f.plannedLift ? 'MIXED' : f.plannedRun ? 'RUNNING' : 'STRENGTH') : row.sport
  const partDone = [f.running?.state, f.strength?.state].some(s => s === 'done' || s === 'reduced')
  // 手表实测的跑步（已关联）是真实发生的训练：这一条计入次数/距离（V4 分项状态仍是“有记录·未标完成”，不等于跑步完成）
  const measured = (row.members ?? []).some(m => m.source === 'garmin' && m.status !== 'incomplete') || row.source === 'garmin'
  row.status = f.overall === 'done' || f.overall === 'reduced' || partDone || measured ? 'completed' : 'incomplete'
  const ms = (row.members ?? []).filter(m => m.source !== 'phone' || m.durationSec != null)
  const known = ms.filter(m => m.durationSec != null)
  if (ms.length > 1) { row.durationSec = known.length ? known.reduce((s, m) => s + m.durationSec!, 0) : null; row.durationPartial = known.length > 0 && known.length < ms.length }
  const tag = f.legacyOverall ? '（历史整课）' : f.combo && f.overall !== 'done' && f.overall !== 'skipped' && (f.actualRun || f.actualLift) ? `（${f.actualRun && f.running?.state !== 'partial' ? '跑步完成' : f.actualRun ? '跑步有记录' : '跑步' + (f.running?.state === 'skipped' ? '跳过' : '待补')}／${f.actualLift && f.strength?.state !== 'partial' ? '力量完成' : f.actualLift ? '力量有记录' : '力量' + (f.strength?.state === 'skipped' ? '跳过' : '待补')}）` : ''
  const pd = (V4.days as V4Day[]).find(x => x.date === f.date)
  row.title = `V4 ${pd?.title ?? '计划课'}${f.overall === 'reduced' ? '（减量）' : ''}${tag}`
}
/** 佳明“训练后自评强度”directWorkoutRpe 为 10–100（10 = RPE1）；换算成 1–10。 */
export function garminRpe(v: unknown): number | null { const n = typeof v === 'number' && Number.isFinite(v) ? v : null; return n == null ? null : n >= 10 && n <= 100 ? Math.round(n / 10) : n >= 1 && n <= 10 ? n : null }

/* ---------------- v77：手机上记录的力量课（所有存储路径） ---------------- */
const sanitize = (v: string) => v.replace(/[^0-9A-Za-z-]/g, '').slice(0, 55)
const localNoon = (d: string) => { const t = new Date(`${d}T12:00:00`); return Number.isFinite(t.getTime()) ? t.toISOString() : `${d}T04:00:00Z` }
function sessionTitle(sessionId: string): string | undefined {
  try { const plan = JSON.parse(localStorage.getItem('fr255-strength-plan-v3') ?? 'null'); const s = (plan?.data ?? plan)?.sessions?.find((x: { id?: string }) => x?.id === sessionId); return typeof s?.name === 'string' && s.name ? s.name : undefined } catch { return undefined }
}
type Ev = ReturnType<typeof loadEvents>[number]
/** 没有“开始训练”事件、直接记下的组（旧版本/今日卡片快速记录）：按动作所属课 + 组的记录日期（用户时区）归成一条。 */
export function orphanSetRows(events: Ev[], occurrences: { trainingOccurrenceId: string }[]): ActivityRow[] {
  const occ = new Set(occurrences.map(o => o.trainingOccurrenceId)), groups = new Map<string, { sessionId: string; date: string; first: string; done: number; total: number; finished: boolean }>()
  for (const e of events) {
    // 组记录，或力量页“完成这节”（logSession 只发 TRAINING_COMPLETED，没有开始事件/训练实例）
    if (e.event_type !== 'TRAINING_SET_COMPLETED' && e.event_type !== 'TRAINING_COMPLETED') continue
    const p = e.payload as { sessionId?: string; trainingOccurrenceId?: string; timestamp?: string; completed?: boolean; skipped?: boolean }
    if (p.trainingOccurrenceId) continue // 绑定到训练实例的由执行记录负责（作废/未开始的不显示）
    void occ
    const at = typeof p.timestamp === 'string' && Number.isFinite(Date.parse(p.timestamp)) ? p.timestamp : e.timestamp, d = at ? day(at) : null
    if (!d || !p.sessionId || Date.parse(at) > Date.now()) continue
    const k = `${p.sessionId}|${d}`, g = groups.get(k) ?? { sessionId: p.sessionId, date: d, first: at, done: 0, total: 0, finished: false }
    if (e.event_type === 'TRAINING_COMPLETED') g.finished = true
    else { g.total++; if (p.completed && !p.skipped) g.done++ }
    if (at < g.first) g.first = at; groups.set(k, g)
  }
  return [...groups.values()].map(g => ({ id: `sets:${g.sessionId}:${g.date}`, startedAt: g.first, date: g.date, sport: 'STRENGTH' as const, distanceM: null, durationSec: null, strengthVolumeKg: null, sets: g.done || null, rpe: null, source: 'phone' as const, appMade: true,
    originIds: [`sets:${g.sessionId}:${g.date}`], title: sessionTitle(g.sessionId) ?? '力量训练', status: g.finished ? 'completed' as const : 'incomplete' as const }))
}
type V4LogLite = { done?: string; reps?: string; rest?: string; aux?: string; strength?: string; rpe?: string; pain?: string; note?: string; savedAt?: string }
type Sched = { id: string; date: string; unplanned?: boolean; kind?: string; modality?: string; trainingType?: string; title?: string; status?: string; refId?: string | null; minutes?: number; actual?: { outcome?: string; note?: string; minutes?: number | null; rpe?: number | null; at?: string; occurrenceIds?: string[]; executionState?: 'COMPLETED' | 'PARTIAL' | 'INTERRUPTED' }; restLog?: unknown[]; exercises?: { sets?: string }[] }
type Check = { date?: string; sessionId?: string; moves?: Record<string, { done?: boolean }[]>; startedAt?: number | null; updatedAt?: number; rpe?: number | null; run?: { done?: boolean } | null }
const isStrength = (e: Sched) => e.modality === 'strength' || e.kind === 'strength' || e.trainingType === 'strength' || e.trainingType === 'mixed'
/** 日程（今日卡片、计划、+记一笔、400m 计划力量日）+ 今日逐组清单。日期 = 这节课的日期，不是保存时间。 */
export function phoneRows(store: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage, now = Date.now()): ActivityRow[] {
  const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(store?.getItem(k) ?? 'null'); return v ?? d } catch { return d } }
  const today = day(new Date(now).toISOString())!
  const checks = Object.values(read<Record<string, Check>>('fk-today-checklist-v1', {})).filter(c => c && typeof c.date === 'string' && typeof c.sessionId === 'string')
  // v79（t489）：只打开/动过清单（updatedAt/startedAt）不是训练证据；要勾过组或给过反馈（RPE）才算“记过”。
  const checkInfo = (c: Check) => { const sets = Object.values(c.moves ?? {}).flat(); return { done: sets.filter(x => x?.done).length, touched: c.rpe != null } }
  const used = new Set<string>(), rows: ActivityRow[] = []
  const sched = read<{ entries?: Sched[] }>('fk-schedule-v1', {}).entries ?? []
  for (const e of sched) {
    if (!e || typeof e.id !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(e.date ?? '') || e.date > today || !isStrength(e)) continue
    const a = e.actual, c = checks.find(x => x.date === e.date && (x.sessionId === e.refId || x.sessionId === e.id)), ci = c ? checkInfo(c) : null
    const did = (a && a.outcome && a.outcome !== 'missed') || e.status === 'done'
    const touched = !!(e.restLog?.length) || !!(ci && (ci.done || ci.touched))
    if (!did && !touched) continue
    if (a?.outcome === 'missed' && !touched) continue
    if (c) used.add(`${c.date}|${c.sessionId}`)
    const startedMs = c?.startedAt && day(new Date(c.startedAt).toISOString()) === e.date ? c.startedAt : null
    // v83（P0-02）：plan400:<date>:strength 只是 V4 当天的力量执行入口，不能因 trainingType=mixed 就说跑过（跑步分项另算）
    rows.push({ id: `sched:${e.id}`, startedAt: startedMs ? new Date(startedMs).toISOString() : localNoon(e.date), timeUnknown: !startedMs, date: e.date, sport: e.trainingType === 'mixed' && !e.id.startsWith('plan400:') ? 'MIXED' : 'STRENGTH', distanceM: null,
      durationSec: a?.minutes && !(e.unplanned && /^q-/.test(e.id) && a.note === '记一笔') ? a.minutes * 60 : null, strengthVolumeKg: null, sets: ci?.done || null, rpe: a?.rpe ?? c?.rpe ?? null, source: 'phone', appMade: true, title: e.title || '力量训练',
      status: did ? 'completed' : 'incomplete',
      originIds: [`sched:${e.id}`, sanitize(`act-${e.id}`), ...(e.refId ? [sanitize(`chk-${e.date}-${e.refId}`)] : []), sanitize(`chk-${e.date}-${e.id}`), ...(e.refId ? [`sets:${e.refId}:${e.date}`, `chk:${e.date}:${e.refId}`] : []), `chk:${e.date}:${e.id}`, ...(a?.occurrenceIds ?? [])] })
  }
  for (const c of checks) {
    if (used.has(`${c.date}|${c.sessionId}`) || !/^\d{4}-\d\d-\d\d$/.test(c.date!) || c.date! > today) continue
    const ci = checkInfo(c); if (!ci.done && !ci.touched) continue
    const strengthSets = Object.values(c.moves ?? {}).flat().length
    if (!strengthSets) continue
    rows.push({ id: `chk:${c.date}:${c.sessionId}`, startedAt: c.startedAt ? new Date(c.startedAt).toISOString() : localNoon(c.date!), timeUnknown: !c.startedAt, date: c.date!, sport: 'STRENGTH', distanceM: null, durationSec: null, strengthVolumeKg: null, sets: ci.done || null, rpe: c.rpe ?? null, source: 'phone', appMade: true,
      title: sessionTitle(c.sessionId!) ?? '力量训练', status: 'incomplete', originIds: [`chk:${c.date}:${c.sessionId}`, sanitize(`chk-${c.date}-${c.sessionId}`), `sets:${c.sessionId}:${c.date}`] })
  }
  // V4 计划记录（fk-plan400-v4-log，首页/计划页/训练中都写这里，按计划日期记）：有实际记录或已完成/减量的一天 = 一条记录。
  // 跑步部分与手表活动没有可靠 id 关联，不合并；它没有距离/时长，不会把手表数据重复计入总量。
  const p4 = read<Record<string, V4LogLite>>('fk-plan400-v4-log', {}), comps = read<ComponentsDoc>('fk-plan400-v4-components-v1', { schemaVersion: 1, days: {} })
  const p4days = new Set([...Object.keys(p4 && typeof p4 === 'object' ? p4 : {}), ...Object.keys(comps?.days ?? {})])
  for (const d of p4days) {
    const l = (p4?.[d] ?? {}) as V4LogLite, c = comps?.days?.[d] as DayComponents | undefined
    if (!/^\d{4}-\d\d-\d\d$/.test(d) || d > today || !l || typeof l !== 'object') continue
    const pd = (V4.days as V4Day[]).find(x => x.date === d)
    if (!pd) {
      // 旧日期（不在当前 V4 课表里，例如 +7 天平移前写下的 10-15/10-18）：照旧按旧整课只读显示，不丢；项目只按实际填写的内容判断
      if (l.done === 'skipped') continue
      const strengthText = String(l.strength ?? '').trim(), runText = (['reps', 'rest', 'aux'] as const).some(k => String(l[k] ?? '').trim())
      const recorded = runText || !!strengthText || (['rpe', 'pain', 'note'] as const).some(k => String(l[k] ?? '').trim())
      if (!recorded && l.done !== 'done' && l.done !== 'reduced') continue
      const hasRun = runText || !strengthText, hasLift = !!strengthText, rpe0 = Number(l.rpe)
      rows.push({ id: `p400:${d}`, startedAt: localNoon(d), timeUnknown: true, date: d, sport: hasRun && hasLift ? 'MIXED' : hasLift ? 'STRENGTH' : 'RUNNING', distanceM: null, durationSec: null, strengthVolumeKg: null, sets: null,
        rpe: Number.isFinite(rpe0) && rpe0 >= 1 && rpe0 <= 10 ? rpe0 : null, source: 'phone', appMade: true, plan: 'v4',
        title: `V4 计划课（历史整课${l.done === 'reduced' ? '·减量' : ''}）`, status: l.done === 'done' || l.done === 'reduced' ? 'completed' : 'incomplete', ...(c ? { v4parts: c } : {}),
        originIds: [`p400:${d}`, `plan400:${d}`, `sched:plan400:${d}:strength`] })
      continue
    }
    // v83（P0-02）：项目与状态来自分项事实（v4DayFact），不从计划标题猜“跑过”；跳过不等于完成；候选手表跑步不算。
    const se = sched.find(e => e?.id === `plan400:${d}:strength`)?.actual
    const f = v4DayFact(pd, l as V4Log, { parts: c, strengthExec: se?.executionState ?? null, strengthMarked: se && !se.executionState ? se.outcome as 'as_planned' | 'different' | 'missed' : null })
    if (!f.overall && !f.actualRun && !f.actualLift) continue
    if (f.overall === 'skipped' && !f.actualRun && !f.actualLift) continue
    const rpe = Number(l.rpe)
    const row: ActivityRow = { id: `p400:${d}`, startedAt: localNoon(d), timeUnknown: true, date: d, sport: 'RUNNING', distanceM: null, durationSec: null, strengthVolumeKg: null, sets: null,
      // 旧整课 RPE 只在纯旧记录（没有分项）时作为这一条的 RPE；有分项时各自 RPE 在分项里，不合并、不平均。
      rpe: f.legacyOverall && Number.isFinite(rpe) && rpe >= 1 && rpe <= 10 ? rpe : null, source: 'phone', appMade: true, plan: 'v4',
      title: `V4 ${pd.title}`, status: 'incomplete', ...(c ? { v4parts: c } : {}),
      originIds: [`p400:${d}`, `plan400:${d}`, `sched:plan400:${d}:strength`] }
    applyV4Fact(row, { ...f, date: d })
    rows.push(row)
  }
  return rows
}

