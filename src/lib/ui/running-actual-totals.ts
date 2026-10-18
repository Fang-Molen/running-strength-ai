import type { RunningExecutionProjection } from '@/lib/core/running-execution';
/** Only a fully recorded structure can establish a whole-course total. */
export function runningActualTotals(view: RunningExecutionProjection) {
  const work = [...view.repetitions, ...view.continuous];
  const complete = work.length > 0 && work.every(s => s.status === 'COMPLETED');
  return {
    distanceM: complete && work.every(s => s.actualDistanceMeters != null) ? work.reduce((n, s) => n + s.actualDistanceMeters!, 0) : null,
    durationSec: complete && work.every(s => s.actualDurationSeconds != null) && view.recoveries.every(r => r.actualRecoverySeconds != null) ? work.reduce((n, s) => n + s.actualDurationSeconds!, 0) + view.recoveries.reduce((n, r) => n + r.actualRecoverySeconds!, 0) : null,
  };
}
