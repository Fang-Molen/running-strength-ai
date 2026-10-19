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
export type RowSource = 'execution' | 'phone' | 'import' | 'garmin'
export type ActivityRow = LoggedSession & { startedAt: string; source: RowSource; originIds: string[]; /** v77：completed=已完成；incomplete=已记录未完成（改了组数/开始了但没点完成） */ status?: 'completed' | 'incomplete'; timeUnknown?: boolean; appMade?: boolean; /** 来自 V4 计划记录 */ plan?: 'v4'; /** v76 显示用（只读） */ title?: string; avgHr?: number | null; garminId?: number | string; importId?: string; occurrenceId?: string; sources?: RowSource[] };
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const day = (iso: string) => activityLocalDay(iso);
function sameActivity(a: ActivityRow, b: ActivityRow) {
  if (a.originIds.some(id => b.originIds.includes(id))) return true;
  return false; // Coincident time/distance do not establish shared identity or protocol.
}
/** Conservative read-only deduplication. A shared date or title never identifies an activity. */
export function mergeActivities(rows: ActivityRow[]): ActivityRow[] {
  const result: ActivityRow[] = [], rank: Record<RowSource, number> = { execution: 0, phone: 1, import: 2, garmin: 3 };
  for (const row of [...rows].sort((a, b) => rank[a.source] - rank[b.source])) {
    const found = result.find(r => sameActivity(r, row));
    if (found) {
      found.originIds = [...new Set([...found.originIds, ...row.originIds])]; found.sources = [...new Set([...(found.sources ?? [found.source]), row.source])];
      if (!found.title || /佳明账号同步|^力量训练$/.test(found.title)) found.title = row.title || found.title
      found.avgHr ??= row.avgHr; found.garminId ??= row.garminId; found.importId ??= row.importId; found.occurrenceId ??= row.occurrenceId
      if (row.plan === 'v4') { found.plan = 'v4'; found.title = row.title; if (found.sport !== row.sport) found.sport = 'MIXED' }
      if (row.status === 'completed') found.status = 'completed'; if (row.appMade) found.appMade = true; if (found.timeUnknown && !row.timeUnknown && row.date === found.date) { found.startedAt = row.startedAt; found.timeUnknown = false }
      found.distanceM ??= row.distanceM; found.durationSec ??= row.durationSec; found.rpe ??= row.rpe; found.sets ??= row.sets
      continue;
    }
    result.push({ ...row, originIds: [...row.originIds], sources: [row.source] });
  }
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
      sets: isRun ? null : fact?.completedSetCount ?? null, rpe: null, source: 'execution', originIds: [o.trainingOccurrenceId, ...(o.planSlotId ? [`sched:${o.planSlotId}`] : []), ...(/^plan400:\d{4}-\d\d-\d\d/.test(o.planSlotId ?? '') ? [o.planSlotId!.slice(0, 18)] : [])], occurrenceId: o.trainingOccurrenceId, status: incomplete ? 'incomplete' : 'completed', title: o.sessionId ? sessionTitle(o.sessionId) : undefined });
  }
  for (const x of coachImports().filter(x=>!occurrenceVoided(x.confirmedImportId))) {
    if (!x.occurredAt.value || !day(x.occurredAt.value)) continue;
    const sets = x.strengthSets.filter(s => s.completion === 'COMPLETED');
    const identity = typeof x.sourceRecordIdentity === 'string' ? [x.sourceRecordIdentity] : [];
    rows.push({ id: x.draftId, startedAt: x.occurredAt.value, date: day(x.occurredAt.value)!, sport: x.sport, distanceM: x.totalDistanceMeters.value, durationSec: x.durationSeconds.value,
      strengthVolumeKg: sets.length && sets.every(s => s.weightKg.value != null && s.repetitions.value != null) ? sets.reduce((sum, s) => sum + s.weightKg.value! * s.repetitions.value!, 0) : null, sets: sets.length || null, rpe: x.sessionRpe.value, source: 'import', originIds: [x.draftId, ...identity, ...(linkedDrafts.get(x.draftId) ?? [])], title: x.title.value ?? '', importId: x.confirmedImportId, status: 'completed', appMade: /^(act-|chk-|q-)/.test(x.draftId) });
  }
  rows.push(...orphanSetRows(events, occurrences), ...phoneRows());
  try { rows.push(...garminRows(JSON.parse(localStorage.getItem(garminViewKey('fk-garmin-acts-v1')) ?? '{}'))); } catch { /* no device cache */ }
  return mergeActivities(rows);
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
type Sched = { id: string; date: string; kind?: string; modality?: string; trainingType?: string; title?: string; status?: string; refId?: string | null; minutes?: number; actual?: { outcome?: string; minutes?: number | null; rpe?: number | null; at?: string; occurrenceIds?: string[] }; restLog?: unknown[]; exercises?: { sets?: string }[] }
type Check = { date?: string; sessionId?: string; moves?: Record<string, { done?: boolean }[]>; startedAt?: number | null; updatedAt?: number; rpe?: number | null; run?: { done?: boolean } | null }
const isStrength = (e: Sched) => e.modality === 'strength' || e.kind === 'strength' || e.trainingType === 'strength' || e.trainingType === 'mixed'
/** 日程（今日卡片、计划、+记一笔、400m 计划力量日）+ 今日逐组清单。日期 = 这节课的日期，不是保存时间。 */
export function phoneRows(store: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage, now = Date.now()): ActivityRow[] {
  const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(store?.getItem(k) ?? 'null'); return v ?? d } catch { return d } }
  const today = day(new Date(now).toISOString())!
  const checks = Object.values(read<Record<string, Check>>('fk-today-checklist-v1', {})).filter(c => c && typeof c.date === 'string' && typeof c.sessionId === 'string')
  const checkInfo = (c: Check) => { const sets = Object.values(c.moves ?? {}).flat(); return { done: sets.filter(x => x?.done).length, touched: (c.updatedAt ?? 0) > 0 || c.startedAt != null || c.rpe != null } }
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
    rows.push({ id: `sched:${e.id}`, startedAt: startedMs ? new Date(startedMs).toISOString() : localNoon(e.date), timeUnknown: !startedMs, date: e.date, sport: e.trainingType === 'mixed' ? 'MIXED' : 'STRENGTH', distanceM: null,
      durationSec: a?.minutes ? a.minutes * 60 : null, strengthVolumeKg: null, sets: ci?.done || null, rpe: a?.rpe ?? c?.rpe ?? null, source: 'phone', appMade: true, title: e.title || '力量训练',
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
  const p4 = read<Record<string, V4LogLite>>('fk-plan400-v4-log', {})
  for (const [d, l] of Object.entries(p4 && typeof p4 === 'object' ? p4 : {})) {
    if (!/^\d{4}-\d\d-\d\d$/.test(d) || d > today || !l || typeof l !== 'object' || l.done === 'skipped') continue
    const recorded = (['reps', 'rest', 'aux', 'strength', 'rpe', 'pain', 'note'] as const).some(k => String(l[k] ?? '').trim())
    if (!recorded && l.done !== 'done' && l.done !== 'reduced') continue
    const pd = (V4.days as { date: string; title: string; main: string[]; strength: string[] }[]).find(x => x.date === d)
    const strengthText = (l.strength ?? '').trim(), planStrength = pd ? pd.strength.join('') : ''
    const hasRun = pd ? !/休息/.test(pd.title) && !/^力量/.test(pd.title) : !strengthText
    const hasLift = !!strengthText || (!!planStrength && !/^无|^可做|^仅活动度/.test(planStrength) && (l.done === 'done' || l.done === 'reduced'))
    const rpe = Number(l.rpe)
    rows.push({ id: `p400:${d}`, startedAt: localNoon(d), timeUnknown: true, date: d, sport: hasRun && hasLift ? 'MIXED' : hasRun ? 'RUNNING' : 'STRENGTH', distanceM: null, durationSec: null, strengthVolumeKg: null, sets: null,
      rpe: Number.isFinite(rpe) && rpe >= 1 && rpe <= 10 ? rpe : null, source: 'phone', appMade: true, plan: 'v4',
      title: `V4 ${pd?.title ?? '计划课'}${l.done === 'reduced' ? '（减量）' : ''}`, status: l.done === 'done' || l.done === 'reduced' ? 'completed' : 'incomplete',
      originIds: [`p400:${d}`, `plan400:${d}`, `sched:plan400:${d}:strength`] })
  }
  return rows
}

