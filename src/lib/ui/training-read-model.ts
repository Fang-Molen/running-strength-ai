import {coachImports} from '@/lib/core/coach-import-evidence'
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
export type ActivityRow = LoggedSession & { startedAt: string; source: 'execution' | 'import' | 'garmin'; originIds: string[] };
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const day = (iso: string) => { const d = new Date(iso.replace(' ', 'T')); return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null; };
function sameActivity(a: ActivityRow, b: ActivityRow) {
  if (a.originIds.some(id => b.originIds.includes(id))) return true;
  return false; // Coincident time/distance do not establish shared identity or protocol.
}
/** Conservative read-only deduplication. A shared date or title never identifies an activity. */
export function mergeActivities(rows: ActivityRow[]): ActivityRow[] {
  const result: ActivityRow[] = [], rank = { execution: 0, import: 1, garmin: 2 };
  for (const row of [...rows].sort((a, b) => rank[a.source] - rank[b.source])) {
    const found = result.find(r => sameActivity(r, row));
    if (found) { found.originIds = [...new Set([...found.originIds, ...row.originIds])]; continue; }
    result.push({ ...row, originIds: [...row.originIds] });
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
    return [{ id: identity, startedAt: g.start, date: day(g.start)!, sport, distanceM: finite(g.dist), durationSec: finite(g.dur), strengthVolumeKg: null, sets: finite(g.sets), rpe: null, source: 'garmin' as const, originIds: [identity] }];
  });
}
export function loadTrainingActivities(): ActivityRow[] {
  const rows: ActivityRow[] = [], events = loadEvents().filter(e=>e.athlete_id===currentAthleteId()), ids=new Set(events.filter(e=>e.event_type==='TRAINING_STARTED').map(e=>e.event_id)), occurrences = listTrainingOccurrences().filter(o=>ids.has(o.trainingOccurrenceId)&&!occurrenceVoided(o.trainingOccurrenceId)&&o.startedAt&&Date.parse(o.startedAt)<=Date.now());
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
    // A start alone is not evidence that any work was performed.
    if (!isRun && (!fact?.completedSetCount || fact.completedSetCount < 1)) continue;
    const elapsed = o.endedAt ? (Date.parse(o.endedAt) - Date.parse(o.startedAt)) / 1000 : null;
    const totals = runningActualTotals(run);
    rows.push({ id: o.trainingOccurrenceId, startedAt: o.startedAt, date: day(o.startedAt)!, sport: isRun ? 'RUNNING' : 'STRENGTH', distanceM: isRun ? totals.distanceM : null, durationSec: isRun ? totals.durationSec : elapsed != null && Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
      strengthVolumeKg: completed.length && completed.every(s => s.mode === 'reps' && s.actualWeight != null) ? completed.reduce((sum, s) => sum + s.actualWeight! * s.actualAmount!, 0) : null,
      sets: isRun ? null : fact?.completedSetCount ?? null, rpe: null, source: 'execution', originIds: [o.trainingOccurrenceId] });
  }
  for (const x of coachImports().filter(x=>!occurrenceVoided(x.confirmedImportId))) {
    if (!x.occurredAt.value || !day(x.occurredAt.value)) continue;
    const sets = x.strengthSets.filter(s => s.completion === 'COMPLETED');
    const identity = typeof x.sourceRecordIdentity === 'string' ? [x.sourceRecordIdentity] : [];
    rows.push({ id: x.draftId, startedAt: x.occurredAt.value, date: day(x.occurredAt.value)!, sport: x.sport, distanceM: x.totalDistanceMeters.value, durationSec: x.durationSeconds.value,
      strengthVolumeKg: sets.length && sets.every(s => s.weightKg.value != null && s.repetitions.value != null) ? sets.reduce((sum, s) => sum + s.weightKg.value! * s.repetitions.value!, 0) : null, sets: sets.length || null, rpe: x.sessionRpe.value, source: 'import', originIds: [x.draftId, ...identity, ...(linkedDrafts.get(x.draftId) ?? [])] });
  }
  try { rows.push(...garminRows(JSON.parse(localStorage.getItem(garminViewKey('fk-garmin-acts-v1')) ?? '{}'))); } catch { /* no device cache */ }
  return mergeActivities(rows);
}
