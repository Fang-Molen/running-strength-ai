import { knownCatalogId, type MuscleAction } from './muscle-actions';
import type { Session } from '@/lib/strength/model';
export type MuscleDraft = { name: string; sets: string; amount: string; weight: string; rest: string; mode: string; side: string; equipment: string };
export function muscleSession(action: MuscleAction, draft: MuscleDraft, sessionId: string, moveId: string): { ok: true; session: Session } | { ok: false; reason: string } {
  const values = [draft.sets, draft.amount, draft.weight, draft.rest], [sets, amount, weightKg, restSec] = values.map(Number);
  if (!draft.name.trim() || !draft.equipment.trim() || !['双侧一起', '左右合计', '仅左', '仅右'].includes(draft.side) || !['reps', 'seconds'].includes(draft.mode)
    || values.some(v => !v.trim() || !Number.isFinite(Number(v))) || !Number.isInteger(sets) || sets < 1 || sets > 100 || amount <= 0 || (draft.mode === 'reps' && !Number.isInteger(amount)) || weightKg < 0 || restSec < 0) {
    return { ok: false, reason: '请确认课程名、器材、组数、计量、侧别、负重与休息。自重或不休息请明确填 0。' };
  }
  return { ok: true, session: { id: sessionId, name: draft.name.trim(), focus: '用户按肌群选择并确认的课程，尚未执行。', moves: [{ id: moveId, catalogId: knownCatalogId(action), customName: action.name,
    sets, amount, mode: draft.mode as 'reps' | 'seconds', weightKg, restSec,
    executionNote: `侧别：${draft.side}；器材：${draft.equipment.trim()}；目录：${action.id}${action.sourceUrl ? `；来源：${action.sourceUrl}` : ''}` }] } };
}
