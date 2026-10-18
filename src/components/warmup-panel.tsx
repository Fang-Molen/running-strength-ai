import { useEffect, useState } from 'react';
import { Sheet } from './sheet';
import { WarmupEditor } from './warmup-editor';
import { WarmupDemoSheet } from './warmup-player';
import { loadSchedule, saveScheduledEntry } from '@/lib/ui/day-schedule';
import { beginWarmup, clockElapsed, finishWarmup, latestWarmup, readWarmupClock, recordWarmupStep, toggleWarmupClock, readWarmupInput, saveWarmupInput, skipWarmup, warmupDose, warmupError, warmupMainError, type WarmupInput, type WarmupClock, type WarmupPlan, type WarmupRecord, type WarmupStep } from '@/lib/ui/warmup';
import type { ScheduleEntry } from '@/lib/ui/day-schedule-rules';
const fmt = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds)) % 60).padStart(2, '0')}`;
const field = 'min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-base';
function Clock({ record, step, onError, rest = false }: { record: WarmupRecord; step: WarmupStep; onError: (e: string) => void; rest?: boolean }) {
  const clockId = `${step.id}${rest ? ':rest' : ''}`;
  const [clock, setClock] = useState<WarmupClock>(() => readWarmupClock(record.id, clockId)), [tick, setTick] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setTick(Date.now()), 250); const sync = () => { setClock(readWarmupClock(record.id, clockId)); setTick(Date.now()); }; window.addEventListener('storage', sync); window.addEventListener('fk-warmup-clock-changed', sync); return () => { clearInterval(timer); window.removeEventListener('storage', sync); window.removeEventListener('fk-warmup-clock-changed', sync); }; }, [record.id, clockId]);
  const seconds = Math.floor(clockElapsed(clock, tick) / 1000);
  const update = () => { try { setClock(toggleWarmupClock(record.id, clockId)); setTick(Date.now()); onError(''); } catch (e) { onError((e as Error).message); } };
  if (rest) return <div className="my-3 rounded-xl border border-line p-3"><p className="text-xs text-muted">累计休息 · 单次参考{step.restSec == null ? '未设置' : `${step.restSec}秒`}</p><div className="mt-2 flex items-center justify-between gap-2"><b className="text-2xl tabular-nums">{fmt(seconds)}</b><button type="button" className="fk-chip min-h-11" onClick={update}>{clock.runningSince != null ? '结束本段休息' : '开始一段休息'}</button></div><p className="keep mt-2 text-xs text-muted">动作与休息计时互斥；记录数量仍需手动确认。</p></div>;
  return <div className="my-3 rounded-xl border border-line p-3"><div className="flex items-center justify-between gap-2"><div><b className="text-3xl tabular-nums">{fmt(seconds)}</b><p className="keep text-xs text-muted">{step.unit === 'sec' ? `动作目标 ${fmt(step.amount * step.sets)}` : step.windowSeconds ? `参考时间窗 ${fmt(step.windowSeconds)}，含调整与恢复` : '动作计时'}{step.unit === 'sec' && seconds >= step.amount * step.sets ? ' · 到时后请确认实际完成' : ''}</p></div><button type="button" className="fk-chip min-h-12 px-5 font-bold" onClick={update}>{clock.runningSince != null ? '暂停' : clock.started ? '继续计时' : '开始计时'}</button></div><p className="keep mt-2 text-xs text-muted">计时不会自动把动作记为完成；关闭后可继续。</p></div>;
}
function WarmupWork({ record, onUpdate, onError }: { record: WarmupRecord; onUpdate: (r: WarmupRecord) => void; onError: (e: string) => void }) {
  const step = record.plan.steps.find(s => !record.steps.some(a => a.stepId === s.id));
  const [demo, setDemo] = useState<WarmupStep | null>(null), [different, setDifferent] = useState(false), [sets, setSets] = useState(''), [amount, setAmount] = useState(''), [weight, setWeight] = useState(''), [rest, setRest] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (step) { const p = readWarmupInput(record.id, step); setDifferent(p.different); setSets(p.sets); setAmount(p.amount); setWeight(p.weight); setRest(p.rest); } }, [record.id, step?.id]);
  const input = (patch: Partial<WarmupInput>) => { if (!step) return; const p = { different, sets, amount, weight, rest, ...patch }; setDifferent(p.different); setSets(p.sets); setAmount(p.amount); setWeight(p.weight); setRest(p.rest); try { saveWarmupInput(record.id, step.id, p); } catch (e) { onError((e as Error).message); } };
  async function action(kind: 'complete' | 'skip' | 'finish' | 'end') {
    if (busy) return; setBusy(true); onError('');
    try {
      if (kind === 'finish' || kind === 'end') onUpdate(await finishWarmup(record, kind === 'end'));
      else if (step) { const c = readWarmupClock(record.id, step.id), rc = readWarmupClock(record.id, `${step.id}:rest`); const seconds = c.started ? Math.round(clockElapsed(c) / 1000) : null;
        if (kind === 'complete' && different && (!sets.trim() || !amount.trim())) throw Error('请填写实际组数和数量。');
        if (kind === 'complete' && different && weight.trim() && (!Number.isFinite(Number(weight)) || Number(weight) < 0)) throw Error('实际负重无效。');
        if (kind === 'complete' && rest.trim() && (!Number.isFinite(Number(rest)) || Number(rest) < 0)) throw Error('实际休息需为非负秒数，未知可留空。');
        onUpdate(await recordWarmupStep(record, step.id, kind === 'skip' ? 'SKIPPED' : 'COMPLETED', seconds, { sets: different ? Number(sets) : step.sets, amount: different ? Number(amount) : step.amount, weightKg: different ? weight.trim() ? Number(weight) : null : step.weightKg ?? null, restSeconds: rest.trim() ? Number(rest) : rc.started ? Math.round(clockElapsed(rc) / 1000) : null }));
      }
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="mt-3"><p className="text-xs text-muted">已处理 {record.steps.length}/{record.plan.steps.length} 项 · 完成数量由你确认</p>
    {step ? <article className="mt-2 rounded-2xl border border-accent p-3"><h4 className="text-lg font-bold">{step.name}</h4><p className="mt-1 text-sm text-accent">{warmupDose(step)}{step.weightKg != null ? ` · ${step.weightKg} kg` : ''}</p>{step.restSec != null ? <p className="mt-1 text-sm">组间休息 {step.restSec} 秒</p> : step.sets > 1 ? <p className="mt-1 text-sm text-muted">组间恢复未设置，可按实际填写</p> : null}<button type="button" className="mt-2 min-h-11 font-bold text-accent" onClick={() => setDemo(step)}>动作要点与3D演示 ›</button>
      <Clock key={step.id} record={record} step={step} onError={onError} />
      {step.sets > 1 ? <Clock key={`${step.id}:rest`} rest record={record} step={step} onError={onError} /> : null}
      <button type="button" className="mb-2 min-h-11 text-sm text-accent" onClick={() => input({ different: !different })}>{different ? '收起实际修改' : '实际做得不同？'}</button>
      {different ? <div className="mb-3 grid grid-cols-2 gap-2 text-sm"><label>实际组数<input className={field} inputMode="numeric" value={sets} onChange={e => input({ sets: e.target.value })} /></label><label>实际每组数量<input className={field} inputMode="decimal" value={amount} onChange={e => input({ amount: e.target.value })} /></label><label className="col-span-2">实际总负重kg（未知留空）<input className={field} inputMode="decimal" value={weight} onChange={e => input({ weight: e.target.value })} /></label></div> : null}
      {step.sets > 1 ? <label className="mb-3 block text-sm">实际休息合计（秒，选填覆盖计时）<input className={field} inputMode="decimal" value={rest} placeholder="留空采用已计时休息，无计时则未知" onChange={e => input({ rest: e.target.value })} /></label> : null}
      <div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy} className="min-h-12 rounded-xl bg-accent p-2 font-bold text-accent-fg disabled:opacity-40" onClick={() => void action('complete')}>{different ? '保存实际完成' : '按所示数量完成'}</button><button type="button" disabled={busy} className="min-h-12 rounded-xl border border-line font-bold" onClick={() => void action('skip')}>跳过本项</button></div>
    </article> : <button type="button" disabled={busy} className="mt-3 min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={() => void action('finish')}>结束热身 · 准备主训练</button>}
    {step ? <button type="button" disabled={busy} className="mt-2 min-h-11 w-full text-sm text-muted" onClick={() => void action('end')}>结束本次热身，跳过剩余</button> : null}
    {record.steps.length ? <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-2">查看已记录动作</summary>{record.steps.map(a => <p key={a.stepId} className="keep border-t border-line py-2">{record.plan.steps.find(s => s.id === a.stepId)?.name} · {a.status === 'SKIPPED' ? '已跳过' : `${a.sets}组 × ${a.amount}${a.unit === 'm' ? '米' : a.unit === 'sec' ? '秒' : '次'}`}{a.elapsedSeconds != null ? ` · 计时${fmt(a.elapsedSeconds)}` : ''}</p>)}</details> : null}
    {demo ? <WarmupDemoSheet step={demo} onClose={() => setDemo(null)} /> : null}
  </div>;
}
export function WarmupPanel({ entry, onChanged, mainLive = false, canBegin, main }: { entry: ScheduleEntry; onChanged: () => void; mainLive?: boolean; canBegin: () => string | null; main?: { id?: string; name: string; catalogId?: string | null }[] }) {
  const [record, setRecord] = useState(() => latestWarmup(entry.id)), [edit, setEdit] = useState(false), [draft, setDraft] = useState<WarmupPlan | undefined>(entry.warmup), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { const sync = () => setRecord(latestWarmup(entry.id)); window.addEventListener('fk-warmup-changed', sync); window.addEventListener('storage', sync); return () => { window.removeEventListener('fk-warmup-changed', sync); window.removeEventListener('storage', sync); }; }, [entry.id]);
  const live = record?.status === 'IN_PROGRESS';
  const update = (r: WarmupRecord) => { setRecord(r); onChanged(); };
  const perform = async (skip: boolean) => { if (busy) return; const block = canBegin(); if (block && !live) { setError(block); return; } setBusy(true); setError(''); try { if (skip) update(await skipWarmup(entry.id, entry.date, entry.warmup)); else if (entry.warmup?.enabled) { const why = warmupMainError(entry.warmup, main ?? entry.exercises ?? []); if (why) throw Error(why); update(await beginWarmup(entry.id, entry.date, entry.warmup, canBegin)); } else { setDraft(entry.warmup); setEdit(true); } } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const save = async () => { if (!draft || busy) return; const why = warmupError(draft); if (why) { setError(why); return; } setBusy(true); try { const old = loadSchedule().entries.find(e => e.id === entry.id); if (!old) throw Error('训练安排已变化，请重新打开。'); const result = await saveScheduledEntry({ ...old, warmup: draft }, old); if (!result.ok) throw Error(result.reason); setEdit(false); onChanged(); setError(''); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <section className="mb-4 rounded-2xl border border-line bg-surface p-3" aria-label="训练前热身"><div className="flex items-start justify-between gap-2"><div><h3 className="text-lg font-bold">先热身，再进入主课</h3><p className="keep mt-1 text-xs text-muted">{entry.warmup?.enabled ? `${entry.warmup.budgetMinutes ?? '自定'}分钟预算 · ${entry.warmup.steps.length}个动作` : '热身未启用，可按本次需要选择'}</p></div><button type="button" disabled={live || mainLive} className="min-h-11 shrink-0 px-2 text-sm font-bold text-accent disabled:opacity-35" onClick={() => { setDraft(entry.warmup); setEdit(true); }}>设置</button></div>
    {error ? <p className="keep mt-2 text-sm text-amber-400" role="alert">{error}</p> : null}
    {live ? <WarmupWork record={record} onUpdate={update} onError={setError} /> : <>
      {record ? <div className="mt-3 rounded-xl border border-line p-3 text-sm"><b>{record.status === 'COMPLETED' ? '本次热身已完成' : record.status === 'PARTIAL' ? '热身已结束，含未完成项' : '本次已选择不使用热身'}</b><p className="keep mt-1 text-xs text-muted">完成{record.steps.filter(s => s.status === 'COMPLETED').length}项 · {record.mainOccurrenceIds.length ? '已关联主课记录' : '可进入下方主训练'}</p></div> : null}
      {!mainLive ? <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={busy} className="min-h-12 rounded-xl bg-accent px-2 font-bold text-accent-fg disabled:opacity-40" onClick={() => void perform(false)}>{entry.warmup?.enabled ? record ? '再次热身' : '开始热身' : '配置并使用热身'}</button><button type="button" disabled={busy} className="min-h-12 rounded-xl border border-line px-2 font-bold" onClick={() => void perform(true)}>本次不使用</button></div> : <p className="keep mt-2 text-xs text-muted">主课已开始，可直接继续下方当前组；热身记录保持独立。</p>}
    </>}
    {edit ? <Sheet full label="本节热身设置" title="本节热身设置" sub="选择任务、时间和配套动作" onClose={() => { if (!busy) setEdit(false); }} footer={<button type="button" disabled={busy || !draft} className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg disabled:opacity-40" onClick={() => void save()}>保存热身安排</button>}><WarmupEditor value={draft} onChange={setDraft} type={entry.modality} main={main ?? entry.exercises ?? []} />{error ? <p role="alert" className="keep mt-3 text-sm text-amber-400">{error}</p> : null}</Sheet> : null}
  </section>;
}
