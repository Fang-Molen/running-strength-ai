import { listTrainingOccurrences } from '@/lib/core/occurrence';
import { getRunningPlan, saveRunningPlan, type RunningPlan } from '@/lib/core/running-plan';
import { startTrackSession, withRunningWriteLock } from './running-workouts';
import { loadSchedule } from './day-schedule';
import { scheduleExecutionId } from './scheduled-execution';
import { scheduledWarmupBlock } from './warmup-execution';

export const activeTrainingBlock = (targetId: string) => listTrainingOccurrences().some(o => o.lifecycle === 'IN_PROGRESS' && o.sessionId !== targetId) ? '已有另一节或另一部分训练进行中，请先继续或结束，再开启下一项。' : null;
/** The currently displayed calendar plan is confirmed only by the explicit start click. */
export async function startScheduledRun(plan: RunningPlan) {
  return withRunningWriteLock(() => {
    const blocked = activeTrainingBlock(plan.planId); if (blocked) return { ok: false as const, reason: blocked };
    const entry = loadSchedule().entries.find(e => scheduleExecutionId(e.id, 'run') === plan.planId);
    const prepBlock = entry ? scheduledWarmupBlock(entry.id, plan.planId, entry.warmup) : null;
    if (prepBlock) return { ok: false as const, reason: prepBlock };
    const existing = getRunningPlan(plan.planId);
    if (existing && !listTrainingOccurrences().some(o => o.sessionId === plan.planId && o.lifecycle === 'IN_PROGRESS') && JSON.stringify(existing.components) !== JSON.stringify(plan.components)) {
      const saved = saveRunningPlan(plan); if (!saved.ok) return { ok: false as const, reason: '修改后的跑步结构未保存，请核对目标与休息设置。' };
    }
    return startTrackSession(plan.planId, existing ? undefined : plan);
  });
}
