import {coachImports} from '@/lib/core/coach-import-evidence'
import { activityLocalDay } from './activity-format'
import V4 from '../plan400-v4.json' with { type: 'json' }
import {garminViewKey} from '@/lib/health/garmin-view-scope'
import {occurrenceVoided, effectiveStrengthFields} from '@/lib/core/training-correction'
import {currentAthleteId} from '@/lib/core/events'
import { loadConfirmedTrainingImports } from '@/lib/core/training-import';
import { listTrainingOccurrences } from '@/lib/core/occurrence';
import { projectRunningExecution } from '@/lib/core/running-execution';
import { getRunningPlanSnapshot } from '@/lib/core/running-plan';
import { loadEvents } from '@/lib/core/events';
import { readTrainingFact } from '@/lib/core/fact-read';
import type { LoggedSession } from './coach-assessment';
import { addDays, weekOf } from './day-schedule-rules';
import { runningActualTotals } from './running-actual-totals';
import type { ScheduleEntry } from './day-schedule-rules';
import { matchRuns, v4RunSlots, allRunLinks, type RunLink } from './run-link';
import { loadComponents, hasFeedback, type DayComponents } from './plan400-components-store';
import { hasRunPart, hasStrength, hasExplicitParts, type V4Day } from './plan400-view';
import { actualSport, allComponentsCompleted, mergeComponentFacts, normalizePlanSessionId, type ComponentId, type ComponentFact } from './training-component-facts';
export type RowSource = 'execution' | 'phone' | 'import' | 'garmin'
export type ActivityRow = LoggedSession & { startedAt: string; source: RowSource; originIds: string[]; athleteId?: string; sessionId?: string; plannedComponents?: ComponentId[]; componentFacts?: ComponentFact[]; durationScope?: 'session' | 'component'; /** 仅无新分项时兼容显示，不能当作各分项已完成。 */ legacyStatus?: string; /** v77：completed=已完成；incomplete=已记录未完成（改了组数/开始了但没点完成） */ status?: 'completed' | 'incomplete'; timeUnknown?: boolean; appMade?: boolean; /** 来自 V4 计划记录 */ plan?: 'v4'; /** v76 显示用（只读） */ title?: string; avgHr?: number | null; garminId?: number | string; importId?: string; occurrenceId?: string; sources?: RowSource[]; /** v79：关联的计划跑步课（日程或 V4 跑步部分），同一条记录 */ runLink?: { entryId: string; title: string; by: 'auto' | 'user' }; /** v79：V4 分项反馈（fk-plan400-v4-components-v1） */ v4parts?: DayComponents };
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const day = (iso: string) => activityLocalDay(iso);
function sameActivity(a: ActivityRow, b: ActivityRow) {
  if ((a.athleteId ?? 'local') !== (b.athleteId ?? 'local')) return false;
  if (a.sessionId && b.sessionId && a.sessionId !== b.sessionId) return false;
  if (a.occurrenceId && b.occurrenceId && a.occurrenceId !== b.occurrenceId && a.componentFacts?.some(x => b.componentFacts?.some(y => x.componentId === y.componentId))) return false;
  if (a.originIds.some(id => b.originIds.includes(id))) return true;
  return false; // Coincident time/distance do not establish shared identity or protocol.
}
/** Conservative read-only deduplication. A shared date or title never identifies an activity. */
export function mergeActivities(rows: ActivityRow[]): ActivityRow[] {
  const result: ActivityRow[] = [], rank: Record<RowSource, number> = { execution: 0, phone: 1, import: 2, garmin: 3 };
  for (const row of [...rows].sort((a, b) => rank[a.source] - rank[b.source])) {
    const found = result.find(r => sameActivity(r, row));
    if (found) {
      const sessionDuration = found.durationScope === 'session' ? found.durationSec : row.durationScope === 'session' ? row.durationSec : null
      found.originIds = [...new Set([...found.originIds, ...row.originIds])]; found.sources = [...new Set([...(found.sources ?? [found.source]), ...(row.sources ?? [row.source])])];
      if (!found.title || /佳明账号同步|^力量训练$/.test(found.title)) found.title = row.title || found.title
      found.avgHr ??= row.avgHr; found.garminId ??= row.garminId; found.importId ??= row.importId; found.occurrenceId ??= row.occurrenceId
      if (row.plan === 'v4') { found.plan = 'v4'; found.title = row.title; found.v4parts = row.v4parts ?? found.v4parts }
      found.sessionId ??= row.sessionId; found.athleteId ??= row.athleteId
      found.plannedComponents = [...new Set([...(found.plannedComponents ?? []), ...(row.plannedComponents ?? [])])]
      const facts = mergeComponentFacts([...(found.componentFacts ?? []), ...(row.componentFacts ?? [])])
      if (facts.length) {
        found.componentFacts = facts; found.sport = actualSport(facts)
        found.status = allComponentsCompleted(found.plannedComponents, facts) ? 'completed' : 'incomplete'
        if (found.plannedComponents.length > 1) found.rpe = null
      } else if (row.status === 'completed') found.status = 'completed'
      found.legacyStatus ??= row.legacyStatus
      if (row.appMade) found.appMade = true; if (found.timeUnknown && !row.timeUnknown && row.date === found.date) { found.startedAt = row.startedAt; found.timeUnknown = false }
      found.distanceM ??= row.distanceM; found.durationSec ??= row.durationSec; if ((found.plannedComponents?.length ?? 0) < 2) found.rpe ??= row.rpe; found.sets ??= row.sets; found.strengthVolumeKg ??= row.strengthVolumeKg
      if (found.sport === 'MIXED') { found.durationSec = sessionDuration; found.durationScope = sessionDuration != null ? 'session' : undefined }
      continue;
    }
    result.push({ ...row, originIds: [...row.originIds], sources: [...new Set(row.sources ?? [row.source])] });
  }
  return result.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
/** Only confirmed component completion can count a planned course. Standalone imports/device candidates and historical whole-session marks cannot. */
export function completedPlanIds(rows: readonly ActivityRow[], date: string, athleteId = currentAthleteId()): string[] {
  return [...new Set(mergeActivities([...rows]).filter(r => r.date === date && (r.athleteId ?? 'local') === athleteId && r.sessionId && !/^qlog-/.test(r.id) && allComponentsCompleted(r.plannedComponents ?? [], r.componentFacts ?? [])).map(r => normalizePlanSessionId(r.sessionId!)))]
}
export const completedPlanCount = (rows: readonly ActivityRow[], date: string, athleteId = currentAthleteId()) => completedPlanIds(rows, date, athleteId).length
const v4Day = (date: string) => (V4.days as V4Day[]).find(d => d.date === date)
const v4Planned = (d: V4Day | undefined): ComponentId[] => d ? [...(hasRunPart(d) ? ['running' as const] : []), ...(hasStrength(d) ? ['strength' as const] : [])] : []
function feedbackFacts(sessionId: string, parts: DayComponents | undefined): ComponentFact[] {
  return (['running', 'strength'] as const).flatMap(componentId => {
    const p = parts?.[componentId]
    return p?.status || hasFeedback(p) ? [{ sessionId, componentId, status: p?.status ?? 'recorded', originIds: [sessionId], rpe: p?.rpe ?? null, provenance: 'component' as const }] : []
  })
}
function applyComponentFacts(row: ActivityRow, facts: ComponentFact[]) {
  row.componentFacts = mergeComponentFacts([...(row.componentFacts ?? []), ...facts])
  row.sport = actualSport(row.componentFacts)
  row.status = allComponentsCompleted(row.plannedComponents ?? [], row.componentFacts) ? 'completed' : 'incomplete'
  if (facts.length) { row.legacyStatus = undefined; row.rpe = null }
}
export function activityWeeks(rows: LoggedSession[], today: string, weeks = 4) {
  return Array.from({ length: weeks }, (_, i) => { const days = weekOf(addDays(today, -7 * (weeks - i - 1))); const records = rows.filter(r => days.includes(r.date) && r.date <= today); return { week: days[0], minutes: Math.round(records.reduce((s, r) => s + (r.durationSec ?? 0), 0) / 60), unknownDuration: records.filter(r => r.durationSec == null).length }; });
}
export function garminRows(raw: unknown, athleteId = currentAthleteId()): ActivityRow[] {
  if (!raw || typeof raw !== 'object') return [];
  return Object.values(raw as Record<string, Record<string, unknown>>).flatMap(g => {
    if (!g || typeof g.start !== 'string' || !day(g.start) || !g.id || (g.athleteId != null && g.athleteId !== athleteId)) return [];
    const sport = /run|track|treadmill/.test(String(g.type)) ? 'RUNNING' as const : /strength|weight|fitness|training/.test(String(g.type)) ? 'STRENGTH' as const : 'UNKNOWN' as const;
    if (sport === 'UNKNOWN') return [];
    const identity = typeof g.sourceIdentity === 'string' ? g.sourceIdentity : `garmin:${g.id}`;
    return [{ id: identity, athleteId, startedAt: g.start, date: day(g.start)!, sport, distanceM: finite(g.dist), durationSec: finite(g.dur), strengthVolumeKg: null, sets: finite(g.sets), rpe: garminRpe(g.rpe), source: 'garmin' as const, originIds: [identity], title: typeof g.name === 'string' ? g.name : '', avgHr: finite(g.avgHr), garminId: g.id as number }];
  });
}
export function loadTrainingActivities(): ActivityRow[] {
  const rows: ActivityRow[] = [], events = loadEvents().filter(e=>(e.athlete_id ?? 'local')===currentAthleteId()), ids=new Set(events.filter(e=>e.event_type==='TRAINING_STARTED').map(e=>e.event_id)), occurrences = listTrainingOccurrences().filter(o=>ids.has(o.trainingOccurrenceId)&&!occurrenceVoided(o.trainingOccurrenceId)&&o.startedAt&&Date.parse(o.startedAt)<=Date.now());
  const linkedDrafts = new Map<string, string[]>(), schedulePlans = new Map<string, ScheduleEntry>();
  try {
    const calendar = JSON.parse(localStorage.getItem('fk-schedule-v1') ?? '{}') as { entries?: (ScheduleEntry & { athleteId?: string })[] };
    for (const e of calendar.entries ?? []) {
      if ((e.athleteId ?? 'local') !== currentAthleteId()) continue
      schedulePlans.set(normalizePlanSessionId(e.id), e)
      const bound = e.actual?.occurrenceIds ?? occurrences.filter(o => o.planSlotId === e.id).map(o => o.trainingOccurrenceId);
      if (bound.length) linkedDrafts.set(`act-${e.id}`.replace(/[^0-9A-Za-z-]/g, '').slice(0, 55), bound);
    }
  } catch { /* no explicit schedule provenance */ }
  for (const o of occurrences) {
    if (!o.startedAt || !day(o.startedAt)) continue;
    const fact = readTrainingFact(o.trainingOccurrenceId), strength = occurrenceStrengthTotals(events, o.trainingOccurrenceId);
    const run = projectRunningExecution(o.trainingOccurrenceId, events), slots = [...run.repetitions, ...run.continuous].filter(s => s.status === 'COMPLETED');
    const isRun = run.availability === 'AVAILABLE' && slots.length > 0;
    // A start alone is not evidence that any work was performed; but recorded sets (even not finished) are shown as 已记录未完成.
    const anySets = events.some(e => e.event_type === 'TRAINING_SET_COMPLETED' && (e.payload as { trainingOccurrenceId?: string }).trainingOccurrenceId === o.trainingOccurrenceId)
    const doneCount = strength.sets
    if (!isRun && doneCount < 1 && !anySets) continue;
    const runComplete = isRun && o.lifecycle === 'COMPLETED' && [...run.repetitions, ...run.continuous].every(s => s.status === 'COMPLETED');
    const strengthComplete = o.lifecycle === 'COMPLETED' && doneCount > 0 && fact?.plannedSetCount != null && fact.plannedSetCount > 0 && doneCount >= fact.plannedSetCount && fact.skippedSetCount === 0 && fact.notRecordedSetCount === 0;
    const elapsed = o.endedAt ? (Date.parse(o.endedAt) - Date.parse(o.startedAt)) / 1000 : null;
    const totals = runningActualTotals(run);
    const sessionId = normalizePlanSessionId(o.planSlotId || o.sessionId), pd = v4Day(sessionId.match(/^plan400:(\d{4}-\d\d-\d\d)$/)?.[1] ?? '');
    const scheduled = schedulePlans.get(sessionId)
    const snapshotParts = getRunningPlanSnapshot(o.trainingOccurrenceId)?.components.map(c => c.modality === 'RUNNING' ? 'running' as const : 'strength' as const) ?? []
    const plannedComponents: ComponentId[] = pd ? v4Planned(pd) : scheduled?.trainingType === 'mixed' ? ['running', 'strength'] : snapshotParts.length ? [...new Set(snapshotParts)] : ['strength']
    const componentFacts: ComponentFact[] = []
    if (isRun) componentFacts.push({ sessionId, componentId: 'running', status: runComplete ? 'done' : 'recorded', rpe: null, originIds: [o.trainingOccurrenceId], provenance: 'execution', distanceM: totals.distanceM, durationSec: totals.durationSec })
    if (anySets) componentFacts.push({ sessionId, componentId: 'strength', status: strengthComplete ? 'done' : 'recorded', rpe: null, originIds: [o.trainingOccurrenceId], provenance: 'execution', sets: doneCount || null, strengthVolumeKg: strength.volumeKg, durationSec: null })
    const sport = actualSport(componentFacts), elapsedSec = elapsed != null && Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null
    rows.push({ id: o.trainingOccurrenceId, athleteId: currentAthleteId(), sessionId, plannedComponents, componentFacts, startedAt: o.startedAt, date: day(o.startedAt)!, sport, durationScope: sport === 'MIXED' && elapsedSec != null ? 'session' : 'component', distanceM: isRun ? totals.distanceM : null, durationSec: sport === 'MIXED' ? elapsedSec : isRun ? totals.durationSec : elapsedSec,
      strengthVolumeKg: strength.volumeKg,
      sets: doneCount || null, rpe: null, source: 'execution', originIds: [o.trainingOccurrenceId, ...(o.planSlotId ? [`sched:${o.planSlotId}`, `sched:${sessionId}`] : []), ...(/^plan400:\d{4}-\d\d-\d\d/.test(sessionId) ? [sessionId] : [])], occurrenceId: o.trainingOccurrenceId, status: allComponentsCompleted(plannedComponents, componentFacts) ? 'completed' : 'incomplete', title: o.sessionId ? sessionTitle(o.sessionId) : undefined });
  }
  for (const x of coachImports().filter(x=>!occurrenceVoided(x.confirmedImportId))) {
    if (!x.occurredAt.value || !day(x.occurredAt.value)) continue;
    const sets = x.strengthSets.filter(s => s.completion === 'COMPLETED');
    const identity = typeof x.sourceRecordIdentity === 'string' ? [x.sourceRecordIdentity] : [];
    rows.push({ id: x.draftId, athleteId: x.athleteId ?? 'local', ...(x.draftId.startsWith('qlog-') ? { timeUnknown: true } : {}), startedAt: x.occurredAt.value, date: day(x.occurredAt.value)!, sport: x.sport, distanceM: x.totalDistanceMeters.value, durationSec: x.durationSeconds.value,
      strengthVolumeKg: sets.length && sets.every(s => s.weightKg.value != null && s.repetitions.value != null) ? sets.reduce((sum, s) => sum + s.weightKg.value! * s.repetitions.value!, 0) : null, sets: sets.length || null, rpe: x.sessionRpe.value, source: 'import', originIds: [x.draftId, ...identity, ...(linkedDrafts.get(x.draftId) ?? [])], title: x.title.value ?? '', importId: x.confirmedImportId, status: 'completed', appMade: /^(act-|chk-|q-|qlog-)/.test(x.draftId) });
  }
  rows.push(...orphanSetRows(events, occurrences), ...phoneRows());
  try { rows.push(...garminRows(JSON.parse(localStorage.getItem(garminViewKey('fk-garmin-acts-v1')) ?? '{}'))); } catch { /* no device cache */ }
  return linkRuns(rows);
}
let lastMatch: { links: RunLink[]; suggestions: { entry: ScheduleEntry; runs: ActivityRow[] }[] } = { links: [], suggestions: [] }
/** v79：上一次 loadTrainingActivities 算出的 计划跑步课 ↔ 手表跑步 关联（日志、方坤、计划页共用同一份）。 */
export function loadRunMatch() { loadTrainingActivities(); return lastMatch }
export const lastRunMatch = () => lastMatch
/** 计划跑步课（日程 + V4 跑步部分）↔ 手表跑步：关联后 V4 那天与这条跑步合并成一条记录；日程跑步课本来就不生成记录。只算一次。 */
export function linkRuns(rows: ActivityRow[], store: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage, now = Date.now()): ActivityRow[] {
  rows = rows.map(r => ({ ...r, originIds: [...r.originIds] }))
  const today = day(new Date(now).toISOString())!, rawComps = loadComponents(store)
  const comps = { ...rawComps, days: Object.fromEntries(Object.entries(rawComps.days).filter(([, p]) => ((p as DayComponents & { athleteId?: string }).athleteId ?? 'local') === currentAthleteId())) }
  for (const row of rows) if (row.sessionId?.startsWith('plan400:') && (row.athleteId ?? 'local') === currentAthleteId()) {
    const facts = feedbackFacts(row.sessionId, comps.days[row.sessionId.slice(8)])
    if (facts.length) applyComponentFacts(row, facts)
  }
  const merged0 = mergeActivities(rows)
  let match: typeof lastMatch = { links: [], suggestions: [] }
  try {
    const sched = ((JSON.parse(store?.getItem('fk-schedule-v1') ?? '{}')?.entries ?? []) as (ScheduleEntry & { athleteId?: string })[]).filter(e => (e.athleteId ?? 'local') === currentAthleteId())
    const base = (() => { try { return currentAthleteId() === 'local' ? JSON.parse(store?.getItem('fk-run-links-v1') ?? '{}') ?? {} : {} } catch { return {} } })()
    match = matchRuns([...sched, ...(currentAthleteId() === 'local' ? v4RunSlots(V4.days as V4Day[], today, comps) : [])], merged0.filter(r => (r.athleteId ?? 'local') === currentAthleteId()), allRunLinks(comps, base), today)
    // Same-day uniqueness is a useful suggestion, not confirmation of ownership.
    for (const link of match.links.filter(l => l.by === 'auto')) match.suggestions.push({ entry: link.entry, runs: [link.run] })
    match.links = match.links.filter(l => l.by === 'user')
  } catch { /* 没有日程/关联：不关联 */ }
  const v4 = match.links.filter(l => l.entry.id.startsWith('plan400:'))
  let merged = merged0
  if (v4.length) {
    let changed = false
    for (const l of v4) {
      const sessionId = normalizePlanSessionId(l.entry.id), p = rows.find(r => r.sessionId === sessionId && (r.athleteId ?? 'local') === (l.run.athleteId ?? 'local'))
      const fact: ComponentFact = { sessionId, componentId: 'running', status: 'recorded', originIds: l.run.originIds, rpe: l.run.rpe, provenance: 'linked', distanceM: l.run.distanceM, durationSec: l.run.durationSec }
      if (p) { p.originIds = [...new Set([...p.originIds, ...l.run.originIds])]; applyComponentFacts(p, [fact]); changed = true }
      else { const r = rows.find(r => r.id === l.run.id); if (r) { r.sessionId = sessionId; r.plannedComponents = v4Planned(v4Day(l.entry.date)); applyComponentFacts(r, [fact]); changed = true } }
    }
    if (changed) merged = mergeActivities(rows)
  }
  for (const l of match.links) { const row = merged.find(r => r.originIds.some(id => l.run.originIds.includes(id))); if (row) row.runLink = { entryId: l.entry.id, title: l.entry.title, by: l.by } }
  lastMatch = match
  return merged.filter(r => r.sport !== 'UNKNOWN' || r.legacyStatus || r.distanceM != null || r.sets != null)
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
/** Sets are owned by the recorded occurrence, never by the latest execution of a reusable session template. */
export function occurrenceStrengthTotals(events: readonly Ev[], occurrenceId: string): { sets: number; volumeKg: number | null } {
  const sets = new Map<string, { mode: unknown; amount: number | null; weight: number | null; completed: boolean }>()
  for (const e of events) {
    const p = e.payload as Record<string, unknown>
    if (e.event_type !== 'TRAINING_SET_COMPLETED' || p.trainingOccurrenceId !== occurrenceId || typeof p.moveId !== 'string' || typeof p.setIndex !== 'number') continue
    const overlay = effectiveStrengthFields(p)
    const amount = p.mode === 'seconds' ? finite(p.actualAmount) : overlay.reps.status === 'UNKNOWN' ? null : finite(overlay.reps.value)
    const weight = overlay.weight.status === 'UNKNOWN' ? null : finite(overlay.weight.value)
    sets.set(`${p.moveId}:${p.setIndex}`, { mode: p.mode, amount, weight, completed: p.completed === true && p.skipped !== true })
  }
  const done = [...sets.values()].filter(s => s.completed && s.amount != null)
  return { sets: done.length, volumeKg: done.length && done.every(s => s.mode === 'reps' && s.amount != null && s.weight != null) ? done.reduce((sum, s) => sum + s.amount! * s.weight!, 0) : null }
}
/** 没有“开始训练”事件、直接记下的组（旧版本/今日卡片快速记录）：按动作所属课 + 组的记录日期（用户时区）归成一条。 */
export function orphanSetRows(events: Ev[], occurrences: { trainingOccurrenceId: string }[], athleteId = currentAthleteId()): ActivityRow[] {
  const occ = new Set(occurrences.map(o => o.trainingOccurrenceId)), groups = new Map<string, { sessionId: string; date: string; first: string; done: number; total: number; finished: boolean }>()
  for (const e of events) {
    if ((e.athlete_id ?? 'local') !== athleteId) continue
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
  return [...groups.values()].map(g => ({ id: `sets:${g.sessionId}:${g.date}`, athleteId, startedAt: g.first, date: g.date, sport: 'STRENGTH' as const, distanceM: null, durationSec: null, strengthVolumeKg: null, sets: g.done || null, rpe: null, source: 'phone' as const, appMade: true,
    originIds: [`sets:${g.sessionId}:${g.date}`], title: sessionTitle(g.sessionId) ?? '力量训练', status: g.finished ? 'completed' as const : 'incomplete' as const }))
}
type V4LogLite = { athleteId?: string; done?: string; reps?: string; rest?: string; aux?: string; strength?: string; rpe?: string; pain?: string; note?: string; savedAt?: string }
type Sched = { athleteId?: string; id: string; date: string; unplanned?: boolean; kind?: string; modality?: string; trainingType?: string; title?: string; status?: string; refId?: string | null; minutes?: number; actual?: { outcome?: string; executionState?: string; km?: number | null; minutes?: number | null; rpe?: number | null; at?: string; occurrenceIds?: string[] }; restLog?: unknown[]; exercises?: { sets?: string }[] }
type Check = { athleteId?: string; date?: string; sessionId?: string; moves?: Record<string, { done?: boolean }[]>; startedAt?: number | null; updatedAt?: number; rpe?: number | null; run?: { done?: boolean } | null }
const isStrength = (e: Sched) => e.modality === 'strength' || e.kind === 'strength' || e.trainingType === 'strength' || e.trainingType === 'mixed'
/** 日程（今日卡片、计划、+记一笔、400m 计划力量日）+ 今日逐组清单。日期 = 这节课的日期，不是保存时间。 */
export function phoneRows(store: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage, now = Date.now(), athleteId = currentAthleteId()): ActivityRow[] {
  const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(store?.getItem(k) ?? 'null'); return v ?? d } catch { return d } }
  const today = day(new Date(now).toISOString())!
  const owner = (value: { athleteId?: string } | undefined) => (value?.athleteId ?? 'local') === athleteId
  const checks = Object.values(read<Record<string, Check>>('fk-today-checklist-v1', {})).filter(c => c && owner(c) && typeof c.date === 'string' && typeof c.sessionId === 'string')
  // v79（t489）：只打开/动过清单（updatedAt/startedAt）不是训练证据；要勾过组或给过反馈（RPE）才算“记过”。
  const checkInfo = (c: Check) => { const sets = Object.values(c.moves ?? {}).flat(); return { done: sets.filter(x => x?.done).length, touched: c.rpe != null } }
  const used = new Set<string>(), rows: ActivityRow[] = []
  const sched = (read<{ entries?: Sched[] }>('fk-schedule-v1', {}).entries ?? []).filter(owner)
  for (const e of sched) {
    if (!e || typeof e.id !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(e.date ?? '') || e.date > today || !isStrength(e)) continue
    const uniqueRef = !!e.refId && sched.filter(x => x.date === e.date && x.refId === e.refId).length === 1
    const a = e.actual, c = checks.find(x => x.date === e.date && (x.sessionId === e.id || uniqueRef && x.sessionId === e.refId)), ci = c ? checkInfo(c) : null
    const did = (a && a.outcome && a.outcome !== 'missed') || e.status === 'done'
    const touched = !!(e.restLog?.length) || !!(ci && (ci.done || ci.touched)) || !!c?.run?.done
    if (!did && !touched) continue
    if (a?.outcome === 'missed' && !touched) continue
    if (c) used.add(`${c.date}|${c.sessionId}`)
    const startedMs = c?.startedAt && day(new Date(c.startedAt).toISOString()) === e.date ? c.startedAt : null
    const sessionId = normalizePlanSessionId(e.id), pd = v4Day(sessionId.match(/^plan400:(\d{4}-\d\d-\d\d)$/)?.[1] ?? '')
    const plannedComponents: ComponentId[] = e.unplanned ? [] : pd ? v4Planned(pd) : e.trainingType === 'mixed' ? ['running', 'strength'] : ['strength']
    const origins = [`sched:${e.id}`, sanitize(`act-${e.id}`), sanitize(`chk-${e.date}-${e.id}`), `chk:${e.date}:${e.id}`, ...(uniqueRef ? [sanitize(`chk-${e.date}-${e.refId}`), `sets:${e.refId}:${e.date}`, `chk:${e.date}:${e.refId}`] : []), ...(a?.occurrenceIds ?? []), ...(pd ? [sessionId] : [])]
    const mixed = e.trainingType === 'mixed', strengthTotal = c ? Object.values(c.moves ?? {}).flat().length : 0
    const componentFacts: ComponentFact[] = []
    // A mixed course's old whole-session outcome does not prove that either component was performed.
    if (!mixed || ci?.done) componentFacts.push({ sessionId, componentId: 'strength', status: mixed ? ci?.done && ci.done === strengthTotal ? 'done' : 'recorded' : did && a?.executionState !== 'PARTIAL' && a?.executionState !== 'INTERRUPTED' ? 'done' : 'recorded', rpe: mixed ? null : a?.rpe ?? c?.rpe ?? null, originIds: origins, provenance: !mixed && a?.executionState ? 'execution' : 'manual' })
    if (c?.run?.done || (a?.km != null && a.km > 0)) componentFacts.push({ sessionId, componentId: 'running', status: c?.run?.done ? 'done' : 'recorded', rpe: null, originIds: origins, provenance: 'manual', distanceM: a?.km != null ? a.km * 1000 : null })
    rows.push({ id: `sched:${e.id}`, athleteId, sessionId, plannedComponents, componentFacts, startedAt: startedMs ? new Date(startedMs).toISOString() : localNoon(e.date), timeUnknown: !startedMs, date: e.date, sport: actualSport(componentFacts), distanceM: a?.km != null ? a.km * 1000 : null,
      durationSec: a?.minutes != null ? a.minutes * 60 : null, strengthVolumeKg: null, sets: ci?.done || null, rpe: plannedComponents.length > 1 ? null : a?.rpe ?? c?.rpe ?? null, source: 'phone', appMade: true, title: e.title || '力量训练',
      status: allComponentsCompleted(plannedComponents, componentFacts) || e.unplanned && did ? 'completed' : 'incomplete', originIds: origins })
  }
  for (const c of checks) {
    if (used.has(`${c.date}|${c.sessionId}`) || !/^\d{4}-\d\d-\d\d$/.test(c.date!) || c.date! > today) continue
    const ci = checkInfo(c); if (!ci.done && !ci.touched) continue
    const strengthSets = Object.values(c.moves ?? {}).flat().length
    if (!strengthSets) continue
    rows.push({ id: `chk:${c.date}:${c.sessionId}`, athleteId, startedAt: c.startedAt ? new Date(c.startedAt).toISOString() : localNoon(c.date!), timeUnknown: !c.startedAt, date: c.date!, sport: 'STRENGTH', distanceM: null, durationSec: null, strengthVolumeKg: null, sets: ci.done || null, rpe: c.rpe ?? null, source: 'phone', appMade: true,
      title: sessionTitle(c.sessionId!) ?? '力量训练', status: 'incomplete', originIds: [`chk:${c.date}:${c.sessionId}`, sanitize(`chk-${c.date}-${c.sessionId}`), `sets:${c.sessionId}:${c.date}`] })
  }
  // V4 的计划分项只决定需要完成什么；实际项目只来自分项反馈或用户手填，不从标题补出。
  const p4 = read<Record<string, V4LogLite>>('fk-plan400-v4-log', {}), comps = loadComponents(store)
  const p4days = new Set([...Object.keys(p4 && typeof p4 === 'object' ? p4 : {}), ...Object.keys(comps?.days ?? {})])
  for (const d of p4days) {
    const rawLog = p4?.[d], rawParts = comps.days?.[d] as (DayComponents & { athleteId?: string }) | undefined
    const l = rawLog && owner(rawLog) ? rawLog : {}, c = rawParts && owner(rawParts) ? rawParts : undefined
    if (!/^\d{4}-\d\d-\d\d$/.test(d) || d > today) continue
    const explicit = hasExplicitParts(c), legacy = !explicit && (l.done === 'done' || l.done === 'reduced')
    if (!explicit && l.done === 'skipped') continue
    const sessionId = `plan400:${d}`, pd = v4Day(d), plannedComponents = v4Planned(pd), originIds = [`p400:${d}`, sessionId]
    const facts: ComponentFact[] = []
    for (const componentId of ['running', 'strength'] as const) {
      const part = c?.[componentId], manual = componentId === 'running' ? ['reps', 'rest', 'aux'].some(k => String(l[k as keyof V4LogLite] ?? '').trim()) : !!l.strength?.trim()
      if (!part?.status && !hasFeedback(part) && !manual) continue
      facts.push({ sessionId, componentId, status: part?.status ?? 'recorded', rpe: part?.rpe ?? null, originIds, provenance: hasFeedback(part) || part?.status ? 'component' : 'manual' })
    }
    const sport = actualSport(facts), recorded = facts.some(f => f.status === 'recorded' || f.status === 'done' || f.status === 'reduced')
    // Explicit skipped/missing parts must withdraw a legacy completion, without inventing an activity.
    if (!recorded && !legacy) {
      for (const row of rows.filter(r => r.sessionId === sessionId)) applyComponentFacts(row, facts)
      continue
    }
    const rpe = Number(l.rpe)
    rows.push({ id: `p400:${d}`, athleteId, sessionId, plannedComponents, componentFacts: facts, ...(legacy ? { legacyStatus: l.done } : {}), startedAt: localNoon(d), timeUnknown: true, date: d, sport, distanceM: null, durationSec: null, strengthVolumeKg: null, sets: null,
      rpe: !explicit && Number.isFinite(rpe) && rpe >= 1 && rpe <= 10 ? rpe : null, source: 'phone', appMade: true, plan: 'v4',
      title: `V4 ${pd?.title ?? '计划课'}${legacy ? '（历史整课）' : ''}${l.done === 'reduced' && legacy ? '（减量）' : ''}`, status: allComponentsCompleted(plannedComponents, facts) || legacy ? 'completed' : 'incomplete', ...(c ? { v4parts: c } : {}), originIds })
  }
  return rows
}

