import { getTrainingOccurrence, listTrainingOccurrences } from '@/lib/core/occurrence';
import { latestWarmup, loadWarmups, linkWarmup, warmupForPart, warmupGate, warmupStoreError, type WarmupPlan } from './warmup';
import { scheduleExecutionId } from './scheduled-execution';

/** Continue an already-started main occurrence even if its preparation is consumed. */
export function scheduledWarmupBlock(entryId: string, sessionId: string, plan?: WarmupPlan): string | null {
  const occurrences = listTrainingOccurrences();
  if (occurrences.some(o => o.sessionId === sessionId && o.lifecycle === 'IN_PROGRESS')) return null;
  const storeError = warmupStoreError(); if (storeError) return storeError;
  const other = loadWarmups().find(r => r.status === 'IN_PROGRESS' && r.entryId !== entryId);
  if (other) return '已有另一节热身进行中，请先继续或结束。';
  return warmupGate(plan, warmupForPart(entryId, sessionId, occurrences));
}

/** Link only an explicit canonical occurrence belonging to this calendar entry. */
export async function linkScheduledWarmup(entryId: string, occurrenceId: string) {
  const occurrence = getTrainingOccurrence(occurrenceId);
  if (!occurrence || !['run', 'strength'].some(p => occurrence.sessionId === scheduleExecutionId(entryId, p as 'run' | 'strength'))) throw Error('热身与主课编号不一致，尚未关联。');
  for (let i = 0; i < 2; i++) {
    const latest = latestWarmup(entryId);
    if (latest?.mainOccurrenceIds.includes(occurrenceId)) return latest;
    const record = warmupForPart(entryId, occurrence.sessionId, listTrainingOccurrences());
    if (!record) return null;
    if (!record.endedAt || !occurrence.startedAt || Date.parse(record.endedAt) > Date.parse(occurrence.startedAt)) return null;
    try { return await linkWarmup(record, occurrenceId); } catch (error) { if (i === 1) throw error; }
  }
}
