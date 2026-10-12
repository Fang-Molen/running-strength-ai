import { useRef, useState } from 'react';
import { GROUPS, exerciseById, type ExerciseGroup } from '@/lib/strength/catalog';
import { addDraftMove, filterExercises, previewSession, type DraftMove } from '@/lib/strength/session-builder';
import { exerciseContent } from "@/lib/strength/exercise-content";
import type { Session } from '@/lib/strength/model';

export function SessionBuilder({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (session: Session) => Promise<{ok: boolean; reason?: string}> }) {
  const [groups, setGroups] = useState<ExerciseGroup[]>([]);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<DraftMove[]>([]);
  const [preview, setPreview] = useState<Session | null>(null);
  const [notice, setNotice] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  function patch(key: string, change: Partial<DraftMove>) { setRows(xs => xs.map(x => x.key === key ? {...x, ...change} : x)); setPreview(null); setChecked(false); }
  const input = 'mt-1 min-h-11 w-full rounded-xl border border-line bg-bg px-3';
  return <section aria-label="多部位组合草稿"><fieldset disabled={busy} className="space-y-4">
    <p className="text-sm text-muted">先选择动作，再自行确认参数。预览、清空和取消均不保存课表。</p>
    <label className="block text-sm">课程名<input className={input} value={name} onChange={e => {setName(e.target.value); setPreview(null);}} /></label>
    <div className="flex flex-wrap gap-2" role="group" aria-label="多选训练部位">{GROUPS.map(g => <button type="button" key={g} aria-pressed={groups.includes(g)} className={'min-h-11 rounded-full border border-line px-4 ' + (groups.includes(g) ? 'bg-accent text-accent-fg' : '')} onClick={() => {setGroups(xs => xs.includes(g) ? xs.filter(x => x !== g) : [...xs, g]); setPreview(null);}}>{g}</button>)}</div>
    <label className="block text-sm">筛选动作<input value={query} onChange={e => setQuery(e.target.value)} className={input} /></label>
    {!groups.length ? <p className="text-sm text-muted">选择部位后显示现有动作。</p> : <div className="max-h-60 overflow-y-auto rounded-xl border border-line">{filterExercises(groups, query).map(x => <button type="button" className="flex min-h-11 w-full justify-between gap-2 border-b border-line px-3 py-2 text-left text-sm" key={x.id} onClick={() => {setRows(xs => addDraftMove(xs, x.id)); setPreview(null);}}><span>{x.name} · {x.group}</span><span>{rows.some(r => r.catalogId === x.id) ? '已选' : '添加'}</span></button>)}</div>}
    {rows.map((row, i) => <article key={row.key} className="rounded-card border border-line p-3">
      <h3 className="font-bold">{i+1}. {exerciseById(row.catalogId)?.name}</h3><p className="mt-1 text-xs text-muted">动作器材：{exerciseContent(row.catalogId)?.equipment.join("、")}。请核对实际可用器材；不匹配时移除或改选动作。</p>
      <div className="mt-2 grid grid-cols-2 gap-3">{([['sets','组数'],['amount',row.mode === 'seconds' ? '秒数' : '次数'],['weight','重量 kg（自重填 0）'],['rest','组间休息 秒']] as const).map(([key,label]) => <label key={key} className="text-xs text-muted">{label}<input className={input} inputMode="decimal" value={row[key]} onChange={e => patch(row.key, {[key]:e.target.value})} /></label>)}</div>
      <label className="mt-2 block text-sm">计量<select className={input} value={row.mode} onChange={e => patch(row.key,{mode:e.target.value as DraftMove['mode']})}><option value="reps">次数</option><option value="seconds">秒数</option></select></label>
      <label className="mt-2 block text-sm">侧别（左右合计值，不自动翻倍）<select className={input} value={row.side} onChange={e => patch(row.key,{side:e.target.value as DraftMove['side']})}><option value="">请选择</option><option value="both">双侧一起</option><option value="each">左右合计</option><option value="left">仅左</option><option value="right">仅右</option></select></label>
      <label className="mt-2 block text-sm">实际可用器材（自重填“无”）<input className={input} value={row.equipment} onChange={e => patch(row.key,{equipment:e.target.value})} /></label>
      <label className="mt-2 block text-sm">再次安排此动作的原因<input className={input} value={row.repeatReason} onChange={e => patch(row.key,{repeatReason:e.target.value})} /></label>
      <div className="mt-2 flex flex-wrap gap-2">{[-1,1].map(d => <button type="button" className="min-h-11 px-3 text-sm" disabled={i+d<0 || i+d>=rows.length} key={d} onClick={() => {const xs=[...rows]; [xs[i],xs[i+d]]=[xs[i+d]!,xs[i]!]; setRows(xs); setPreview(null);}}>{d===-1?'上移':'下移'}</button>)}<button type="button" className="min-h-11 px-3 text-sm" onClick={() => {if(!row.repeatReason.trim()){setNotice('先填写重复原因，再单独确认重复动作的参数。');return;} setRows(xs => addDraftMove(xs,row.catalogId,row.repeatReason));setPreview(null);}}>明确重复</button><button type="button" className="min-h-11 px-3 text-sm text-risk" onClick={() => {setRows(xs=>xs.filter(x=>x.key!==row.key));setPreview(null);}}>移除</button></div>
    </article>)}
    <button type="button" className="min-h-12 w-full rounded-xl border border-line font-bold" onClick={() => {const result=previewSession(name,groups,rows); if(!result.ok){setNotice(result.reason); return;} setPreview(result.session);setChecked(false);setNotice('');}}>预览这一课</button>
    {preview ? <div className="space-y-3 rounded-card bg-surface-2 p-3"><h3 className="font-bold">{preview.name} · {preview.moves.length} 个动作</h3><ol className="space-y-2 text-sm">{preview.moves.map(m=><li key={m.id}>{exerciseById(m.catalogId!)?.name}：{m.sets} 组 × {m.amount} {m.mode==='seconds'?'秒':'次'} · {m.weightKg} kg · 休息 {m.restSec} 秒<br/>{m.executionNote}</li>)}</ol><label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} />我已核对器材、运动限制及已有训练负荷；有疼痛或动作不熟练时先咨询专业人员。此组合未做个人适配评估。</label><button type="button" disabled={!checked||busy} className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg disabled:opacity-50" onClick={async()=>{if(saving.current)return;saving.current=true;setBusy(true);try{const r=await onConfirm(preview);if(!r.ok)setNotice(r.reason??'没有保存，草稿保留。');}catch{setNotice('没有核实保存，草稿保留。');}finally{saving.current=false;setBusy(false);}}}>{busy?'正在核实保存':'确认添加一节课程'}</button></div> : null}
    {notice ? <p role="alert" className="text-sm text-risk">{notice}</p> : null}
    <div className="flex gap-2"><button type="button" disabled={busy} className="min-h-11 flex-1 rounded-xl border border-line" onClick={()=>{setRows([]);setGroups([]);setName('');setPreview(null);setNotice('');setChecked(false);}}>清空草稿</button><button type="button" disabled={busy} className="min-h-11 flex-1 rounded-xl border border-line" onClick={onCancel}>取消</button></div>
  </fieldset></section>;
}
