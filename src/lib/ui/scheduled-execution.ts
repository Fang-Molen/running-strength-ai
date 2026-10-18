import type { Plan, Session, Move } from '@/lib/strength/model';
import { exerciseById } from '@/lib/strength/catalog';
import type { RunningPlan, SessionComponent } from '@/lib/core/running-plan';
import type { ScheduleEntry } from './day-schedule-rules';

/** Each calendar slot has its own execution identity, even when it uses the same template. */
export const scheduleExecutionId = (id: string, part: 'strength' | 'run') => `scheduled:${id}:${part}`;
export type ScheduledCourse = { entry: ScheduleEntry; strength: Session | null; run: RunningPlan | null; errors: string[] };
const number = (s: string | undefined, min: number, integer = false) => {
  if (s == null || !s.trim()) return null;
  const n = Number(s); return Number.isFinite(n) && n >= min && (!integer || Number.isInteger(n)) ? n : null;
};
export function resolveScheduledCourse(entry: ScheduleEntry, plan: Pick<Plan, 'sessions'>, running: RunningPlan[]): ScheduledCourse {
  const errors: string[] = [];
  let strength: Session | null = null, run: RunningPlan | null = null;
  if (entry.modality === 'rest' || entry.status === 'proposed' || ['skipped', 'rejected'].includes(entry.status)) return { entry, strength, run, errors: ['这节训练尚未确认或已取消，不能开始执行。'] };
  const wantsStrength = entry.modality === 'strength';
  const wantsRun = entry.modality === 'run' || entry.trainingType === 'mixed';
  if (wantsStrength) {
    let moves: Move[] = [];
    if (entry.exercises?.length) {
      for (const [i, e] of entry.exercises.entries()) {
        if (e.sourceId?.startsWith('external:') && (!e.unit || !e.counting)) { errors.push(`${e.name}：请明确选择计量单位与侧别，外部目录未提供这些参数。`); continue; }
        const sets = number(e.sets, 1, true), amount = number(e.reps, 0.001, e.unit !== 'sec'), weight = number(e.weight, 0);
        if (!e.name.trim() || sets == null || sets > 100 || amount == null || weight == null || e.restSec == null || !Number.isFinite(e.restSec) || e.restSec < 0) {
          errors.push(`${e.name || `动作${i + 1}`}：请补齐组数、数量、负重和组间休息。自重或不休息填0。`); continue;
        }
        if (e.unit === 'm') { errors.push(`${e.name}：按距离的力量动作暂用详细记录，不能换算成次数。`); continue; }
        const catalogId = e.catalogId && exerciseById(e.catalogId) ? e.catalogId : null;
        moves.push({ id: e.id ?? `${entry.id}:move:${i + 1}`, catalogId, customName: e.name, sets, amount,
          mode: e.unit === 'sec' ? 'seconds' : 'reps', weightKg: weight, restSec: e.restSec,
          ...(e.perSide || e.counting === 'perSide' ? { perSide: true, sideRestSec: e.sideRestSec ?? null } : {}), ...(entry.betweenRestSec != null ? { betweenRestSec: entry.betweenRestSec } : {}),
          executionNote: [e.counting === 'left' ? '仅左侧' : e.counting === 'right' ? '仅右侧' : '', e.perSide ? `每侧${amount}${e.unit === 'sec' ? '秒' : '次'}；两侧完成后确认一组；换侧休息${e.sideRestSec == null ? '未设置' : `${e.sideRestSec}秒`}` : '', entry.betweenRestSec == null ? '' : `动作之间休息${entry.betweenRestSec}秒`, e.sourceId ? `目录：${e.sourceId}` : '', e.sourceUrl ? `来源：${e.sourceUrl}` : ''].filter(Boolean).join('；') });
      }
    } else {
      const template = plan.sessions.find(s => s.id === entry.refId);
      if (template) moves = structuredClone(template.moves);
      else errors.push('这节力量课没有可执行动作，请先补充动作与参数。');
    }
    if (moves.length) strength = { id: scheduleExecutionId(entry.id, 'strength'), name: entry.title, focus: `${entry.date} · ${entry.focus.join('、')}`, moves };
  }
  if (wantsRun) {
    let components: SessionComponent[] | null = entry.runComponents?.length ? structuredClone(entry.runComponents) : null;
    if (!components && entry.refId) components = structuredClone(running.find(r => r.planId === entry.refId)?.components ?? null);
    if (!components && typeof entry.km === 'number' && entry.km > 0) components = [{ componentId: 'run', modality: 'RUNNING', purpose: 'UNSPECIFIED', structure: { kind: 'CONTINUOUS', plannedDistanceMeters: entry.km * 1000, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } }];
    if (components?.some(c => c.modality === 'RUNNING')) run = { runningPlanSchemaVersion: 1, planId: scheduleExecutionId(entry.id, 'run'), planSlotId: scheduleExecutionId(entry.id, 'run'), components };
    else errors.push('这节跑步课尚缺明确的距离、目标时间或分段结构，请补全后开始；不会从标题猜测。');
  }
  return { entry, strength, run, errors };
}
export function scheduledChoices(entries: ScheduleEntry[], date: string): ScheduleEntry[] {
  return entries.filter(e => e.date === date && e.modality !== 'rest' && (e.status === 'planned' || e.status === 'done'));
}
