import { useId, useRef, useState } from 'react';
import { Sheet } from '@/components/sheet';
import type { MuscleAction } from '@/lib/body/muscle-actions';
import { muscleSession } from '@/lib/body/muscle-workout';
import { uid, type Session } from '@/lib/strength/model';

/** Explicitly configured plan draft. Browsing an atlas never records a workout. */
export function MuscleWorkoutDraft({ action, onConfirm, onClose }: { action: MuscleAction; onClose: () => void; onConfirm: (session: Session) => Promise<{ ok: boolean; reason?: string }> }) {
  const [name, setName] = useState(`力量 · ${action.name}`), [sets, setSets] = useState(''), [amount, setAmount] = useState(''), [weight, setWeight] = useState(''), [rest, setRest] = useState('');
  const [mode, setMode] = useState(''), [side, setSide] = useState(''), [equipment, setEquipment] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const saving = useRef(false), sessionId = useRef(uid()), moveId = useRef(uid());
  const formId = useId();
  const control = 'mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3';
  async function save() {
    if (saving.current) return;
    const parsed = muscleSession(action, { name, sets, amount, weight, rest, mode, side, equipment }, sessionId.current, moveId.current);
    if (!parsed.ok) { setNotice(parsed.reason); return; }
    saving.current = true; setBusy(true); setNotice('');
    try { const result = await onConfirm(parsed.session); if (!result.ok) setNotice(result.reason || '没有保存，草稿保留。'); }
    catch { setNotice('没有核实保存，草稿保留。'); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Sheet title="加入力量课程" label="肌肉动作课程草稿" onClose={() => { if (!saving.current) onClose(); }} footer={<button type="submit" form={formId} disabled={busy} className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg">{busy ? '正在核实保存…' : '确认加入课程库'}</button>}><form id={formId} onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-3"><fieldset disabled={busy} className="space-y-3">
    <p className="keep text-sm">{action.name}</p>{action.source === 'external' ? <p className="keep text-xs text-amber-400">外部资料尚未审校，请先核对具体动作和计数口径。</p> : null}
    <label className="block text-sm">课程名称<input value={name} onChange={e => setName(e.target.value)} className={control} /></label>
    <div className="grid grid-cols-2 gap-3">{[[sets, setSets, '组数'], [amount, setAmount, mode === 'seconds' ? '每组秒数' : '每组次数'], [weight, setWeight, '总负重 kg（自重填0）'], [rest, setRest, '组间休息 秒']] .map(([value, setter, label]) => <label key={String(label)} className="text-sm">{label as string}<input className={control} inputMode="decimal" value={value as string} onChange={e => (setter as (value: string) => void)(e.target.value)} /></label>)}</div>
    {action.restSec !== null ? <button type="button" className="fk-chip" onClick={() => setRest(String(action.restSec))}>采用目录参考休息 {action.restSec} 秒</button> : null}
    <label className="block text-sm">计量<select className={control} value={mode} onChange={e => setMode(e.target.value)}><option value="">请选择</option><option value="reps">次数</option><option value="seconds">秒数</option></select></label>
    <label className="block text-sm">侧别与计数<select className={control} value={side} onChange={e => setSide(e.target.value)}><option value="">请选择</option><option>双侧一起</option><option>左右合计</option><option>仅左</option><option>仅右</option></select></label>
    <label className="block text-sm">实际使用器材<input className={control} placeholder="自重填无；其他请写明器材" value={equipment} onChange={e => setEquipment(e.target.value)} /></label>
    {notice ? <p className="keep text-sm text-amber-400" role="alert">{notice}</p> : null}
  </fieldset></form></Sheet>;
}
