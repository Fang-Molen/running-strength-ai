import type { Intensity, ScheduleEntry } from './day-schedule-rules';
import type { RunningComponent, SessionComponent, RunningPlan } from '@/lib/core/running-plan';
import type { Plan } from '@/lib/strength/model';
import { displayName } from '@/lib/strength/model';
import { warmupError, type WarmupPlan } from './warmup';
export type ExerciseDraft = NonNullable<ScheduleEntry['exercises']>[number];
export type TrainingDraft = { id: string; date: string; type: 'run' | 'strength' | 'mixed' | 'other'; name: string; minutes: string; intensity: Intensity; slot: 'am' | 'pm'; exercises: ExerciseDraft[]; betweenRest: number | null; runMode: 'continuous' | 'repeated'; distance: string; target: string; repeats: string; rounds: string; repeatRest: string; roundRest: string; preservedRun?: SessionComponent[]; runTemplate?: RunningComponent; warmup?: WarmupPlan };
export const TRAINING_DRAFT_KEY = 'fk-training-draft-v71';
export function newTrainingDraft(date: string, id: string): TrainingDraft {
  return { id, date, type: 'strength', name: '', minutes: '', intensity: 'MODERATE', slot: 'pm', exercises: [], betweenRest: null, runMode: 'continuous', distance: '', target: '', repeats: '', rounds: '', repeatRest: '', roundRest: '' };
}
export function validDate(v: string) { const d = new Date(v + 'T12:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v; }
const positive = (s: string) => s.trim() && Number.isFinite(Number(s)) && Number(s) > 0 ? Number(s) : null;
const rest = (s: string) => !s.trim() ? null : Number.isFinite(Number(s)) && Number(s) >= 0 ? Number(s) : NaN;
export function draftEntry(d: TrainingDraft): { ok: true; entry: ScheduleEntry } | { ok: false; reason: string } {
  const mins = positive(d.minutes);
  if (d.warmup) { const error = warmupError(d.warmup); if (error) return { ok: false, reason: error }; }
  if (!validDate(d.date) || !d.id || mins == null || mins > 1440) return { ok: false, reason: '请确认训练日期与预计时长（1—1440分钟）。' };
  if ((d.type === 'strength' || d.type === 'mixed') && !d.exercises.length) return { ok: false, reason: '请至少添加一个力量动作。' };
  for (const e of d.type === 'strength' || d.type === 'mixed' ? d.exercises : []) {
    if (!e.name.trim()) return { ok: false, reason: '动作名称不能为空。' };
    // Drafts may retain unknown doses. Execution performs the stricter check later.
    if ([e.sets, e.reps, e.weight, e.rpe].some(s => s.trim() && (!Number.isFinite(Number(s)) || Number(s) < 0))) return { ok: false, reason: `${e.name}的训练参数需填写有效数字。` };
    if ((e.sets.trim() && (!Number.isInteger(Number(e.sets)) || Number(e.sets) < 1 || Number(e.sets) > 100)) || (e.reps.trim() && Number(e.reps) <= 0) || (e.unit !== 'sec' && e.reps.trim() && !Number.isInteger(Number(e.reps))) || (e.rpe.trim() && (Number(e.rpe) < 1 || Number(e.rpe) > 10)) || [e.restSec, e.sideRestSec].some(v => v != null && (!Number.isFinite(v) || v < 0))) return { ok: false, reason: `${e.name}的组数、数量、RPE或休息超出有效范围。` };
  }
  const components: SessionComponent[] = d.preservedRun && (d.type === 'run' || d.type === 'mixed') ? structuredClone(d.preservedRun) : [];
  if ((d.type === 'run' || d.type === 'mixed') && !d.preservedRun) {
    const distance = positive(d.distance), target = positive(d.target);
    if (distance == null && target == null) return { ok: false, reason: '请明确填写跑步距离（米）或目标时间（秒），至少一项。' };
    if ((d.distance.trim() && distance == null) || (d.target.trim() && target == null)) return { ok: false, reason: '跑步距离与目标时间须为正数。' };
    if (d.runMode === 'continuous') components.push({ componentId: d.runTemplate?.componentId ?? 'run', modality: 'RUNNING', purpose: d.runTemplate?.purpose ?? 'UNSPECIFIED', structure: { kind: 'CONTINUOUS', plannedDistanceMeters: distance, plannedDistanceMaxMeters: null, plannedDurationSeconds: target } });
    else {
      const repeats = positive(d.repeats), rounds = positive(d.rounds), rr = rest(d.repeatRest), br = rest(d.roundRest);
      if (repeats == null || rounds == null || !Number.isInteger(repeats) || !Number.isInteger(rounds) || repeats * rounds > 500 || Number.isNaN(rr) || Number.isNaN(br)) return { ok: false, reason: '请确认每轮次数、轮数与休息；轮次保持原结构，休息留空表示未设置。' };
      if ((repeats === 1 && rr != null) || (rounds === 1 && br != null)) return { ok: false, reason: '只有1次时没有次间休息，只有1轮时没有轮间休息，请将对应项留空。' };
      const oldBlock = d.runTemplate?.structure.kind === 'REPEATED' ? d.runTemplate.structure.blocks[0] : null;
      components.push({ componentId: d.runTemplate?.componentId ?? 'run', modality: 'RUNNING', purpose: d.runTemplate?.purpose ?? 'UNSPECIFIED', structure: { kind: 'REPEATED', blocks: [{ blockId: oldBlock?.blockId ?? 'main', roundCount: rounds, recoveryAfterRoundSeconds: br, steps: [{ stepId: oldBlock?.steps[0]?.stepId ?? 'rep', repeatCount: repeats, plannedDistanceMeters: distance, plannedDurationSeconds: target, recoveryAfterRepeatSeconds: rr, recoveryBeforeNextStepSeconds: null }] }] } });
    }
  }
  const title = d.name.trim() || (d.type === 'run' ? `跑步 · ${d.distance ? `${d.distance}米` : `${d.target}秒`}${d.runMode === 'repeated' ? ` × ${d.repeats}次 × ${d.rounds}轮` : ''}` : d.type === 'mixed' ? '跑步＋力量' : d.type === 'other' ? '其他训练' : `力量 · ${d.exercises.length}个动作`);
  return { ok: true, entry: { id: d.id, date: d.date, title, kind: d.type === 'run' || d.type === 'other' ? 'run' : 'strength', modality: d.type === 'run' || d.type === 'other' ? 'run' : 'strength', trainingType: d.type, ...(d.warmup ? { warmup: structuredClone(d.warmup) } : {}), focus: d.exercises.map(e => e.name), minutes: mins, intensity: d.intensity, lowerHeavy: false, source: 'custom', refId: null, status: 'planned', slot: d.slot, ...(d.type === 'strength' || d.type === 'mixed' ? { exercises: structuredClone(d.exercises), betweenRestSec: d.betweenRest } : {}), ...(components.length ? { runComponents: components } : {}) } };
}
export function entryDraft(e: ScheduleEntry, templates?: Pick<Plan, 'sessions'>, running: RunningPlan[] = []): TrainingDraft {
  if (!e.exercises?.length && e.refId && e.modality === 'strength') {
    const s = templates?.sessions.find(s => s.id === e.refId);
    if (s) e = { ...e, exercises: s.moves.map(m => ({ id: m.id, catalogId: m.catalogId, name: displayName(m), sets: String(m.sets), reps: String(m.amount), weight: String(m.weightKg), restSec: m.restSec, rpe: '', unit: m.mode === 'seconds' ? 'sec' : 'reps' })) };
  }
  if (!e.runComponents && e.refId && e.modality === 'run') e = { ...e, runComponents: running.find(p => p.planId === e.refId)?.components };
  const d: TrainingDraft = { ...newTrainingDraft(e.date, e.id), type: e.trainingType ?? (e.modality === 'strength' ? 'strength' : 'run'), name: e.title, minutes: String(e.minutes), intensity: e.intensity, slot: e.slot ?? 'pm', exercises: structuredClone(e.exercises ?? []), betweenRest: e.betweenRestSec ?? null, warmup: structuredClone(e.warmup) };
  const run = e.runComponents?.find(c => c.modality === 'RUNNING');
  if (run?.modality === 'RUNNING') d.runTemplate = structuredClone(run);
  if ((e.runComponents?.length ?? 0) > 1) d.preservedRun = structuredClone(e.runComponents);
  else if (run?.modality === 'RUNNING' && run.structure.kind === 'CONTINUOUS' && run.structure.plannedDistanceMaxMeters != null) d.preservedRun = structuredClone(e.runComponents);
  else if (run?.modality === 'RUNNING' && run.structure.kind === 'CONTINUOUS') { d.distance = run.structure.plannedDistanceMeters == null ? '' : String(run.structure.plannedDistanceMeters); d.target = run.structure.plannedDurationSeconds == null ? '' : String(run.structure.plannedDurationSeconds); }
  else if (run?.modality === 'RUNNING' && run.structure.kind === 'REPEATED' && run.structure.blocks.length === 1 && run.structure.blocks[0].steps.length === 1) {
    const b = run.structure.blocks[0], s = b.steps[0]; d.runMode = 'repeated'; d.distance = s.plannedDistanceMeters == null ? '' : String(s.plannedDistanceMeters); d.target = s.plannedDurationSeconds == null ? '' : String(s.plannedDurationSeconds); d.repeats = String(s.repeatCount); d.rounds = String(b.roundCount); d.repeatRest = s.recoveryAfterRepeatSeconds == null ? '' : String(s.recoveryAfterRepeatSeconds); d.roundRest = b.recoveryAfterRoundSeconds == null ? '' : String(b.recoveryAfterRoundSeconds);
  } else if (run) d.preservedRun = structuredClone(e.runComponents);
  else if (e.km != null) d.distance = String(e.km * 1000);
  return d;
}
