import {readTrainingDraft,saveTrainingDraft,clearSavedTrainingDraft} from '@/lib/ui/training-draft-store';
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
const control = 'mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3';
export function TrainingEditorSheet({ date, initial, template, seedAction, initialType, templates, openMuscleInitially = false, onClose, onSave }: { date: string; initial?: ScheduleEntry; template?: ScheduleEntry; seedAction?: MuscleAction; initialType?: TrainingDraft['type']; templates?: Plan; openMuscleInitially?: boolean; onClose: () => void; onSave: (entry: ScheduleEntry) => Promise<{ ok: boolean; reason?: string }> }) {
  const [draft, setDraft] = useState<TrainingDraft>(() => {
    if (initial) return entryDraft(initial, templates, listTrackPlans());
    if (template) { const saved=readTrainingDraft(draftStore(),date,template.id); return saved ?? entryDraft({ ...template, id: `custom:${uid()}`, date, actual: undefined, status: 'planned' }, templates, listTrackPlans()); }
    let d = newTrainingDraft(date, `custom:${uid()}`);
    const saved=readTrainingDraft(draftStore(),date); if(saved)d={...d,...saved};
    if (initialType || openMuscleInitially) d.type = initialType ?? 'strength';
    if (seedAction) d = { ...d, type: 'strength', exercises: d.exercises.some(e => e.sourceId === seedAction.id) ? d.exercises : [...d.exercises, { id: uid(), catalogId: seedAction.catalogId, sourceId: seedAction.id, sourceUrl: seedAction.sourceUrl ?? undefined, name: seedAction.name, sets: '', reps: '', weight: '', rpe: '', unit: seedAction.unit ?? undefined, restSec: seedAction.restSec ?? 75 }] };
    return d;
  });
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stored, setStored] = useState(false);
  const saving = useRef(false), done = useRef(false), formId = useId();
  const change = <K extends keyof TrainingDraft>(k: K, v: TrainingDraft[K]) => setDraft(d => ({ ...d, [k]: v }));
  useEffect(() => { if (initial || done.current) return; setStored(saveTrainingDraft(draftStore(),date,draft,template?.id)); }, [draft,initial,date,template?.id]);
  async function save() {
    if (saving.current) return;
    const parsed = draftEntry(draft); if (!parsed.ok) { setNotice(parsed.reason); return; }
    const entry = initial ? { ...initial, ...parsed.entry, source: initial.source, refId: initial.refId, actual: initial.actual, status: initial.status, edited: true } : parsed.entry;
    saving.current = true; setBusy(true); setNotice('');
    try {
      const result = await onSave(entry);
      if (!result.ok) { setNotice(result.reason ?? '训练未保存，草稿保留。'); return; }
      done.current = true; if (!initial) clearSavedTrainingDraft(draftStore(),date,draft.id,template?.id); onClose();
    } catch { setNotice('训练未核实保存，草稿保留。'); }
    finally { saving.current = false; setBusy(false); }
  }
  const count = draft.exercises.length;
  return <Sheet full label={initial ? '编辑这节训练' : '添加训练'} title={initial ? '编辑这节训练' : '添加训练'} sub={!initial && stored ? '草稿已保留，可关闭后继续' : '保存后进入所选日期的训练安排'} onClose={() => { if (!saving.current) onClose(); }} footer={<div><p className="mb-2 text-xs text-muted">{draft.date} · {draft.type === 'run' ? '跑步' : draft.type === 'mixed' ? '跑步＋力量' : draft.type === 'other' ? '其他' : '力量'}{count ? ` · ${count}个动作` : ''}</p><button type="submit" form={formId} disabled={busy} className="min-h-12 w-full rounded-xl bg-accent px-3 font-bold text-accent-fg disabled:opacity-50">{busy ? '正在保存…' : initial ? '保存这节训练' : `加入 ${draft.date.slice(5).replace('-', '月')}日训练`}</button></div>}>
    <form id={formId} className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy} className="space-y-4">
      <section className="rounded-2xl border border-line p-3"><h3 className="font-bold">1 · 日期与类型</h3><label className="mt-3 block text-sm">训练日期<input aria-label="训练日期" type="date" className={control} value={draft.date} onChange={e => change('date', e.target.value)} /></label><div className="mt-3 grid grid-cols-2 gap-2">{([['run', '跑步运动', Footprints], ['strength', '力量训练', Dumbbell]] as const).map(([type, text, Icon]) => <button key={type} type="button" aria-pressed={draft.type === type} onClick={() => change('type', type)} className={'flex min-h-14 items-center justify-center gap-2 rounded-xl border px-3 font-bold ' + (draft.type === type ? 'border-accent bg-accent/10 text-accent' : 'border-line')}><Icon size={19} />{text}</button>)}</div><details className="mt-2 text-sm"><summary className="min-h-10 cursor-pointer py-2 text-muted">混合与其他训练</summary><div className="flex gap-2">{([['mixed', '跑步＋力量'], ['other', '其他训练']] as const).map(([type, text]) => <button type="button" key={type} className="fk-chip" aria-pressed={draft.type === type} onClick={() => change('type', type)}>{text}</button>)}</div></details></section>
      <WarmupEditor value={draft.warmup} onChange={v => change('warmup', v)} type={draft.type} main={draft.exercises} />
      <section className="rounded-2xl border border-line p-3"><h3 className="font-bold">2 · 训练内容</h3>
        {draft.type === 'strength' || draft.type === 'mixed' ? <div className="mt-3"><ExerciseEditor initialMuscle={openMuscleInitially} value={draft.exercises as Ex[]} onChange={v => change('exercises', v)} parts={[]} betweenRest={draft.betweenRest} onBetweenRest={v => change('betweenRest', v)} /><p className="keep mt-2 text-xs text-muted">参数暂不确定可留空保存计划；开始执行前需确认。自重负重填0，不休息填0。</p></div> : null}
        {(draft.type === 'run' || draft.type === 'mixed') && draft.preservedRun ? <p className="keep mt-3 rounded-xl border border-line p-3 text-sm">已保留原多段跑步结构：{describeTrackPlan({ runningPlanSchemaVersion: 1, planId: draft.id, planSlotId: draft.id, components: draft.preservedRun })}。此处可改名称、日期和安排。</p> : null}
        {(draft.type === 'run' || draft.type === 'mixed') && !draft.preservedRun ? <div className="mt-3 space-y-3"><div className="flex gap-2">{([['continuous', '连续跑'], ['repeated', '间歇／重复跑']] as const).map(([v, label]) => <button type="button" key={v} aria-pressed={draft.runMode === v} className="fk-chip" onClick={() => change('runMode', v)}>{label}</button>)}</div><div className="grid grid-cols-2 gap-3"><label className="text-sm">{draft.runMode === 'repeated' ? '每次距离（米）' : '距离（米）'}<input aria-label="跑步距离米" className={control} inputMode="decimal" placeholder="如8000" value={draft.distance} onChange={e => change('distance', e.target.value)} /></label><label className="text-sm">{draft.runMode === 'repeated' ? '每次目标时间（秒）' : '目标时间（秒）'}<input aria-label="跑步目标秒" className={control} inputMode="decimal" placeholder="可留空" value={draft.target} onChange={e => change('target', e.target.value)} /></label></div>{draft.runMode === 'repeated' ? <><div className="grid grid-cols-2 gap-3">{([['repeats', '每轮次数'], ['rounds', '轮数'], ['repeatRest', '次间休息（秒）'], ['roundRest', '轮间休息（秒）']] as const).map(([k, label]) => <label key={k} className="text-sm">{label}<input className={control} inputMode="numeric" value={draft[k]} onChange={e => change(k, e.target.value)} /></label>)}</div><p className="keep text-xs text-muted">例如200米 × 4次 × 2轮，完整保留两轮结构。休息留空为未设置。</p></> : null}</div> : null}
        {draft.type === 'other' ? <p className="keep mt-3 text-sm text-muted">可保存名称与预计时长，完成后记录实际情况。</p> : null}
      </section>
      <section className="rounded-2xl border border-line p-3"><h3 className="font-bold">3 · 名称与安排</h3><label className="mt-3 block text-sm">训练名称（选填）<input className={control} maxLength={100} value={draft.name} onChange={e => change('name', e.target.value)} placeholder="如：下肢力量A" /></label><div className="mt-3 grid grid-cols-2 gap-3"><label className="text-sm">预计时长（分钟）<input aria-label="预计时长分钟" className={control} inputMode="decimal" placeholder="如40" value={draft.minutes} onChange={e => change('minutes', e.target.value)} /></label><label className="text-sm">时段<select className={control} value={draft.slot} onChange={e => change('slot', e.target.value as 'am' | 'pm')}><option value="am">上午</option><option value="pm">下午／晚上</option></select></label></div><label className="mt-3 block text-sm">计划强度<select className={control} value={draft.intensity} onChange={e => change('intensity', e.target.value as TrainingDraft['intensity'])}><option value="EASY">轻松</option><option value="MODERATE">中等</option><option value="HARD">高强度</option></select></label></section>
      {notice ? <p role="alert" className="keep rounded-xl border border-amber-500 p-3 text-sm text-amber-400">{notice}</p> : null}
      {!initial ? <button type="button" className="min-h-11 text-sm text-muted" onClick={() => { setDraft(newTrainingDraft(date, `custom:${uid()}`)); setNotice('已清空这份草稿。'); }}>清空草稿</button> : null}
    </fieldset></form>
  </Sheet>;
}
