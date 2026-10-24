import {withScheduleLock} from './schedule-writer'
import { currentAthleteId, loadEvents } from '@/lib/core/events';
import { listTrainingOccurrences, getTrainingPlanSnapshot } from '@/lib/core/occurrence';
import { executionOf } from '@/lib/core/execution';
import { projectRunningExecution } from '@/lib/core/running-execution';
import { readTrainingFact } from '@/lib/core/fact-read';
import { loadSchedule, saveSchedule } from './day-schedule';
import { scheduleExecutionId } from './scheduled-execution';
import type { Actual, ScheduleEntry } from './day-schedule-rules';
import { runningActualTotals } from './running-actual-totals';
import { effectiveStrengthFields, occurrenceVoided } from '@/lib/core/training-correction';

/** Project only verified, closed occurrences. Planned minutes never become actual minutes. */
export function syncScheduleProgress(): boolean {
  const store = loadSchedule(), occurrences = listTrainingOccurrences().filter(o => !occurrenceVoided(o.trainingOccurrenceId)), events = loadEvents();
  let changed = false;
  const entries = store.entries.map(entry => {
    if (entry.status === 'rejected' || entry.status === 'proposed') return entry;
    const ids = [entry.modality === 'strength' ? scheduleExecutionId(entry.id, 'strength') : null, entry.modality === 'run' || entry.trainingType === 'mixed' ? scheduleExecutionId(entry.id, 'run') : null].filter((x): x is string => !!x);
    const parts = ids.map(id => [...occurrences].reverse().find(o => o.sessionId === id));
    if (!parts.length || parts.some(o => !o || o.lifecycle === 'IN_PROGRESS' || !o.endedAt)) return entry;
    const closed = parts.filter((o): o is NonNullable<typeof o> => !!o);
    // An existing manually-entered result is not silently overwritten by an execution projection.
    if (entry.actual && !entry.actual.occurrenceIds) return entry;
    let complete = closed.every(o => o.lifecycle === 'COMPLETED'), exact = complete, distance = 0, distanceKnown = false;
    for (const o of closed) {
      if (o.sessionId.endsWith(':strength')) {
        const state = executionOf(o.sessionId), snap = o.trainingPlanSnapshotId ? getTrainingPlanSnapshot(o.trainingPlanSnapshotId) : null;
        const fact = readTrainingFact(o.trainingOccurrenceId), expected = fact?.plannedSetCount;
        complete = complete && expected != null && expected > 0 && fact?.completedSetCount === expected && fact?.duplicateSetCount === 0 && fact?.notRecordedSetCount === 0 && fact?.skippedSetCount === 0;
        // A reduced execution snapshot can be completed, but is not the original calendar prescription.
        const original = entry.exercises;
        const start = events.find(e => e.event_id === o.startEventId);
        const samePrescription = original?.length ? !!snap && snap.exercises.length === original.length && snap.exercises.every((m, i) => {
          const e = original[i];
          return (e.id == null || e.id === m.moveId) && e.sets.trim() !== '' && e.reps.trim() !== '' && e.weight.trim() !== '' && Number(e.sets) === m.sets && Number(e.reps) === m.amount && Number(e.weight) === m.weightKg && (e.unit === 'sec' ? 'seconds' : 'reps') === m.mode;
        }) : start?.payload.selectedAction === 'ORIGINAL_PLAN';
        exact = exact && samePrescription;
        exact = exact && fact?.extraSetCount === 0 && state.sets.length > 0 && state.sets.every(s => {const corrected=effectiveStrengthFields({...s,trainingOccurrenceId:o.trainingOccurrenceId});return s.completed && !s.skipped && s.effective !== 'UNKNOWN' && (s.mode==='seconds'?s.actualAmount:corrected.reps.value) === s.plannedAmount && corrected.weight.value === s.plannedWeight});
      } else {
        const view = projectRunningExecution(o.trainingOccurrenceId, events), slots = [...view.repetitions, ...view.continuous];
        complete = complete && view.availability === 'AVAILABLE' && slots.length > 0 && slots.every(s => s.status === 'COMPLETED');
        exact = exact && slots.length > 0 && slots.every(s => s.status === 'COMPLETED' && (s.plannedDistanceMeters == null || s.actualDistanceMeters === s.plannedDistanceMeters) && (s.plannedDurationSeconds == null || s.actualDurationSeconds === s.plannedDurationSeconds));
        for (const s of slots) if (s.status === 'COMPLETED' && s.actualDistanceMeters != null) { distance += s.actualDistanceMeters; distanceKnown = true; }
      }
    }
    const duration = closed.reduce((sum, o) => { const seconds = o.sessionId.endsWith(':run') ? runningActualTotals(projectRunningExecution(o.trainingOccurrenceId, events)).durationSec ?? NaN : o.startedAt && o.endedAt ? (Date.parse(o.endedAt) - Date.parse(o.startedAt)) / 1000 : NaN; return !Number.isFinite(sum) || !Number.isFinite(seconds) || seconds < 0 ? NaN : sum + seconds; }, 0);
    const at = closed.map(o => o.endedAt!).sort().at(-1)!;
    const actual: Actual = { outcome: complete && exact ? 'as_planned' : 'different', executionState: complete ? 'COMPLETED' : closed.some(o => o.lifecycle === 'INTERRUPTED') ? 'INTERRUPTED' : 'PARTIAL', occurrenceIds: closed.map(o => o.trainingOccurrenceId), minutes: Number.isFinite(duration) ? Math.round(duration / 6) / 10 : null, km: distanceKnown ? distance / 1000 : null, intensity: null, reasons: [], at, note: '由本节逐组／分段实际记录汇总；跑步时长只在分段与休息齐全时合计，力量时长为执行计时。' };
    if (JSON.stringify(entry.actual) === JSON.stringify(actual)) return entry;
    changed = true; return { ...entry, actual, status: complete ? 'done' as const : 'planned' as const };
  });
  return !changed || saveSchedule({ ...store, entries }, 'schedule-progress');
}

/** Production entrypoint; synchronous projection is retained for isolated replay. */
export async function syncScheduleProgressCoordinated():Promise<boolean>{
 const owner=currentAthleteId()
 return (await withScheduleLock(()=>currentAthleteId()===owner?syncScheduleProgress():false)).value
}
