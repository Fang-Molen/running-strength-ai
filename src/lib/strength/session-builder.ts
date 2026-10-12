import { exerciseContent } from './exercise-content';
import { CATALOG, exerciseById, type ExerciseGroup } from './catalog';
import { type Move, type Plan, type Session, uid } from './model';

export const PLAN_KEY = 'fr255-strength-plan-v3';
export type DraftMove = { key: string; catalogId: string; sets: string; amount: string; rest: string; weight: string; mode: 'reps' | 'seconds'; side: '' | 'both' | 'each' | 'left' | 'right'; equipment: string; repeatReason: string };
export function filterExercises(groups: ExerciseGroup[], query = '') {
  if (!groups.length) return [];
  return CATALOG.filter(x => groups.includes(x.group) && x.name.includes(query.trim()));
}
export function addDraftMove(rows: DraftMove[], id: string, repeatReason = ''): DraftMove[] {
  const item = exerciseById(id);
  if (!item || (rows.some(x => x.catalogId === id) && !repeatReason.trim())) return rows;
  return [...rows, { key: uid(), catalogId: id, sets: '', amount: '', rest: '', weight: '', mode: item.timed ? 'seconds' : 'reps', side: '', equipment: '', repeatReason: repeatReason.trim() }];
}
export function previewSession(name: string, groups: ExerciseGroup[], rows: DraftMove[]): { ok: true; session: Session } | { ok: false; reason: string } {
  if (!name.trim() || !groups.length || !rows.length) return { ok: false, reason: '请填写课程名，选择部位和至少一个动作。' };
  const seen = new Set<string>();
  const moves: Move[] = [];
  for (const row of rows) {
    const item = exerciseById(row.catalogId);
    const values = [row.sets, row.amount, row.rest, row.weight];
    const [sets, amount, restSec, weightKg] = values.map(Number);
    if (!item || values.some(x => !x.trim()) || values.some(x => !Number.isFinite(Number(x))) || !Number.isInteger(sets) || sets < 1 || sets > 100 || amount <= 0 || (row.mode === 'reps' && !Number.isInteger(amount)) || restSec < 0 || weightKg < 0 || !row.side || !row.equipment.trim()) return { ok: false, reason: '逐项确认组数、次数/秒数、重量、休息、侧别和器材；0 必须明确填写，空白不代表 0。' };
    const required=exerciseContent(item.id)?.equipment ?? [];
    const mismatches=required.filter(x=>!['无器械','器材要求待补全'].includes(x) && !x.split('或').some(token=>row.equipment.includes(token)));
    if(mismatches.length)return {ok:false,reason:`${item.name}：器材与动作要求不一致（${required.join('、')}），请改选动作或核对器材。`};
    if (seen.has(item.id) && !row.repeatReason.trim()) return { ok: false, reason: '重复动作需要明确原因。不会合并组数或自动加量。' };
    seen.add(item.id);
    moves.push({ id: row.key, catalogId: item.id, customName: '', sets, amount, restSec, weightKg, mode: row.mode, executionNote: `侧别：${({both:'双侧一起',each:'左右合计',left:'仅左',right:'仅右'} as const)[row.side]}；器材：${row.equipment.trim()}${row.repeatReason ? `；重复原因：${row.repeatReason}` : ''}` });
  }
  return { ok: true, session: { id: uid(), name: name.trim(), focus: `自选组合：${groups.join('、')}。参数由用户确认，不代表个体适配判断。`, moves } };
}
export type PlanStore = Pick<Storage, 'getItem' | 'setItem'>;
/** Caller must serialize with the same Web Lock. One key contains the whole plan. */
export function savePlanCompared(store: PlanStore, expected: string | null, next: Plan): { ok: true; raw: string } | { ok: false; reason: string } {
  try {
    const raw = JSON.stringify(next);
    const actual = store.getItem(PLAN_KEY);
    if (actual === raw) return { ok: true, raw };
    if (actual !== expected) return { ok: false, reason: '课表已被其他操作修改。请备份当前草稿并刷新后重新确认。' };
    store.setItem(PLAN_KEY, raw);
    if (store.getItem(PLAN_KEY) !== raw) return { ok: false, reason: '课表写入未核实，不能报告成功。草稿保留，请检查存储后重试。' };
    return { ok: true, raw };
  } catch { return { ok: false, reason: '课表没有保存。草稿保留，请检查本机存储后重试。' }; }
}
export function appendSessionCompared(store: PlanStore, expected: string | null, plan: Plan, session: Session) {
  if (plan.sessions.some(x => x.id === session.id)) return { ok: false as const, reason: '课程编号已存在，不能重复添加。' };
  const next = { ...plan, sessions: [...plan.sessions, session] };
  const result = savePlanCompared(store, expected, next);
  return result.ok ? { ...result, plan: next } : result;
}
