import {readTrainingDraft,saveTrainingDraft,clearSavedTrainingDraft} from '@/lib/ui/training-draft-store';
import { initializeTrainingDraft, trainingTemplateDraftKey } from '@/lib/ui/training-draft-initialization';
import { useEffect, useId, useRef, useState } from 'react';
import { Dumbbell, Footprints } from 'lucide-react';
import { Sheet } from './sheet';
import { WarmupEditor } from './warmup-editor';
import { ExerciseEditor, type Ex } from './exercise-editor';
import type { ScheduleEntry } from '@/lib/ui/day-schedule-rules';
import { draftEntry, entryDraft, newTrainingDraft, type TrainingDraft } from '@/lib/ui/training-editor';
import type { Plan } from '@/lib/strength/model';
import { listTrackPlans, describeTrackPlan } from '@/lib/ui/running-workouts';
import type { MuscleAction } from '@/lib/body/muscle-actions';
const draftStore=()=>{try{return typeof window==='undefined'?null:window.localStorage;}catch{return null;}};
const uid = () => crypto.randomUUID();
const control = 'mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-base';
export function TrainingEditorSheet({ date, initial, template, seedAction, initialType, templates, openMuscleInitially = false, onClose, onSave }: { date: string; initial?: ScheduleEntry; template?: ScheduleEntry; seedAction?: MuscleAction; initialType?: TrainingDraft['type']; templates?: Plan; openMuscleInitially?: boolean; onClose: () => void; onSave: (entry: ScheduleEntry) => Promise<{ ok: boolean; reason?: string }> }) {
  const templateDraftKey = trainingTemplateDraftKey(template);
  const [draft, setDraft] = useState<TrainingDraft>(() => {
    if (initial) return entryDraft(initial, templates, listTrackPlans());
    const saved = readTrainingDraft(draftStore(), date, templateDraftKey);
    const existing = saved ?? (template ? entryDraft({ ...template, id: `custom:${uid()}`, date, actual: undefined, status: 'planned' }, templates, listTrackPlans()) : null);
    return initializeTrainingDraft({ date, id: `custom:${uid()}`, existing, initialType, seedAction, openMuscleInitially, createExerciseId: uid });
  });
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stored, setStored] = useState(false);
  const saving = useRef(false), done = useRef(false), formId = useId();
  const change = <K extends keyof TrainingDraft>(k: K, v: TrainingDraft[K]) => setDraft(d => ({ ...d, [k]: v }));
  useEffect(() => { if (initial || done.current) return; setStored(saveTrainingDraft(draftStore(),date,draft,templateDraftKey)); }, [draft,initial,date,templateDraftKey]);
  async function save() {
    if (saving.current) return;
    const parsed = draftEntry(draft); if (!parsed.ok) { setNotice(parsed.reason); return; }
    const entry = initial ? { ...initial, ...parsed.entry, source: initial.source, refId: initial.refId, actual: initial.actual, status: initial.status, edited: true } : parsed.entry;
    saving.current = true; setBusy(true); setNotice('');
    try {
      const result = await onSave(entry);
      if (!result.ok) { setNotice(result.reason ?? '训练未保存，草稿保留。'); return; }
      done.current = true; if (!initial) clearSavedTrainingDraft(draftStore(),date,draft.id,templateDraftKey); onClose();
    } catch { setNotice('训练未核实保存，草稿保留。'); }
    finally { saving.current = false; setBusy(false); }
  }
  const count = draft.exercises.length;
  const typeLabel = draft.type === 'run' ? '跑步' : draft.type === 'mixed' ? '跑步＋力量' : draft.type === 'other' ? '其他' : '力量';
  const intensityLabel = draft.intensity === 'EASY' ? '轻松' : draft.intensity === 'HARD' ? '高强度' : '中等';
  return <Sheet full label={initial ? '编辑这节训练' : '添加训练'} title={initial ? '编辑这节训练' : '添加训练'} onClose={() => { if (!saving.current) onClose(); }} footer={<div>
    {notice ? <p role="alert" className="keep mb-2 text-sm text-amber-400">{notice}</p> : null}
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{typeLabel}{count && (draft.type === 'strength' || draft.type === 'mixed') ? ` · ${count}个动作` : ''}</span>{!initial && stored ? <span>草稿已保存</span> : null}</div>
    <button type="submit" form={formId} disabled={busy} className="min-h-12 w-full rounded-xl bg-accent px-3 font-bold text-accent-fg disabled:opacity-50">{busy ? '正在保存…' : initial ? '保存这节训练' : `加入 ${draft.date.slice(5).replace('-', '月')}日训练`}</button>
  </div>}>
    <form id={formId} className="fk-training-editor space-y-4" onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy} className="space-y-4">
      <section className="fk-editor-basics space-y-3" aria-label="训练安排">
        <div className="grid grid-cols-2 gap-2">{([['run', '跑步运动', Footprints], ['strength', '力量训练', Dumbbell]] as const).map(([type, text, Icon]) => <button key={type} type="button" aria-pressed={draft.type === type} onClick={() => change('type', type)} className={'flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 font-bold ' + (draft.type === type ? 'border-accent bg-accent/10 text-accent' : 'border-line')}><Icon size={19} />{text}</button>)}</div>
        <details className="text-sm"><summary className={'min-h-11 cursor-pointer py-2 ' + (draft.type === 'mixed' || draft.type === 'other' ? 'font-bold text-accent' : 'text-muted')}>{draft.type === 'mixed' || draft.type === 'other' ? `已选：${typeLabel}` : '其他类型'}</summary><div className="flex flex-wrap gap-2">{([['mixed', '跑步＋力量'], ['other', '其他训练']] as const).map(([type, text]) => <button type="button" key={type} className="fk-chip min-h-11" aria-pressed={draft.type === type} onClick={() => change('type', type)}>{text}</button>)}</div></details>
        <div className="grid grid-cols-2 gap-3"><label className="min-w-0 text-sm">训练日期<input aria-label="训练日期" type="date" className={control} value={draft.date} onChange={e => change('date', e.target.value)} /></label><label className="min-w-0 text-sm">预计时长（分钟）<input aria-label="预计时长分钟" className={control} inputMode="decimal" placeholder="如40" value={draft.minutes} onChange={e => change('minutes', e.target.value)} /></label></div>
        <label className="block text-sm">训练名称（选填）<input className={control} maxLength={100} value={draft.name} onChange={e => change('name', e.target.value)} placeholder={draft.type === 'run' ? '如：轻松跑' : draft.type === 'strength' ? '如：下肢力量' : '留空自动命名'} /></label>
      </section>
      {draft.type !== 'other' ? <section className="fk-editor-content border-t border-line pt-4" aria-label="训练内容"><h3 className="font-bold">{draft.type === 'strength' ? '力量动作' : '训练内容'}</h3>
        {draft.type === 'strength' || draft.type === 'mixed' ? <div className="mt-3"><ExerciseEditor initialMuscle={openMuscleInitially} value={draft.exercises as Ex[]} onChange={v => change('exercises', v)} parts={[]} betweenRest={draft.betweenRest} onBetweenRest={v => change('betweenRest', v)} /></div> : null}
        {(draft.type === 'run' || draft.type === 'mixed') && draft.preservedRun ? <div className="mt-3 rounded-xl bg-surface p-3 text-sm"><p className="font-bold">多段跑步</p><p className="keep mt-1">{describeTrackPlan({ runningPlanSchemaVersion: 1, planId: draft.id, planSlotId: draft.id, components: draft.preservedRun })}</p><p className="mt-2 text-muted">保留分段结构，可调整日期与安排。</p></div> : null}
        {(draft.type === 'run' || draft.type === 'mixed') && !draft.preservedRun ? <div className="mt-3 space-y-3"><div className="flex flex-wrap gap-2">{([['continuous', '连续跑'], ['repeated', '间歇／重复跑']] as const).map(([v, label]) => <button type="button" key={v} aria-pressed={draft.runMode === v} className="fk-chip min-h-11" onClick={() => change('runMode', v)}>{label}</button>)}</div><div className="grid grid-cols-2 gap-3"><label className="min-w-0 text-sm">{draft.runMode === 'repeated' ? '每次距离（米）' : '距离（米）'}<input aria-label="跑步距离米" className={control} inputMode="decimal" placeholder={draft.runMode === 'repeated' ? '如200' : '如8000'} value={draft.distance} onChange={e => change('distance', e.target.value)} /></label><label className="min-w-0 text-sm">{draft.runMode === 'repeated' ? '每次目标时间（秒）' : '目标时间（秒）'}<input aria-label="跑步目标秒" className={control} inputMode="decimal" placeholder="可留空" value={draft.target} onChange={e => change('target', e.target.value)} /></label></div>{draft.runMode === 'repeated' ? <div className="grid grid-cols-2 gap-3">{([['repeats', '每轮次数'], ['rounds', '轮数'], ['repeatRest', '次间休息（秒）'], ['roundRest', '轮间休息（秒）']] as const).map(([k, label]) => <label key={k} className="min-w-0 text-sm">{label}<input className={control} inputMode={k === 'repeats' || k === 'rounds' ? 'numeric' : 'decimal'} placeholder={k === 'repeatRest' || k === 'roundRest' ? '未设置' : undefined} value={draft[k]} onChange={e => change(k, e.target.value)} /></label>)}</div> : null}</div> : null}
      </section> : null}
      <details className="fk-editor-options border-t border-line pt-1"><summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 text-sm"><span className="font-bold">热身</span><span className="text-muted">{draft.warmup?.enabled ? `${draft.warmup.budgetMinutes != null ? `${draft.warmup.budgetMinutes}分钟 · ` : ''}${draft.warmup.steps.length}项` : '未启用'} ›</span></summary><WarmupEditor value={draft.warmup} onChange={v => change('warmup', v)} type={draft.type} main={draft.exercises} /></details>
      <details className="fk-editor-options border-t border-line pt-1"><summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 text-sm"><span className="font-bold">更多设置</span><span className="text-muted">{draft.slot === 'am' ? '上午' : '下午／晚上'} · {intensityLabel} ›</span></summary><div className="grid grid-cols-2 gap-3 pb-3"><label className="min-w-0 text-sm">时段<select className={control} value={draft.slot} onChange={e => change('slot', e.target.value as 'am' | 'pm')}><option value="am">上午</option><option value="pm">下午／晚上</option></select></label><label className="min-w-0 text-sm">计划强度<select className={control} value={draft.intensity} onChange={e => change('intensity', e.target.value as TrainingDraft['intensity'])}><option value="EASY">轻松</option><option value="MODERATE">中等</option><option value="HARD">高强度</option></select></label></div>
        {!initial ? <button type="button" className="min-h-11 text-sm text-muted" onClick={() => { setDraft({ ...newTrainingDraft(draft.date, `custom:${uid()}`), type: draft.type }); setNotice('已清空这份草稿。'); }}>清空草稿</button> : null}
      </details>
    </fieldset></form>
  </Sheet>;
}
