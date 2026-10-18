import { useEffect, useMemo, useState } from 'react';
import { Sheet } from './sheet';
import { TrainingDecisionCard } from './training-decision-card';
import { TrackRunner } from './track-session';
import { resolveScheduledCourse, scheduleExecutionId, scheduledChoices } from '@/lib/ui/scheduled-execution';
import { loadSchedule } from '@/lib/ui/day-schedule';
import { syncScheduleProgress } from '@/lib/ui/schedule-progress';
import { listTrackPlans, openTrackOccurrence, startTrackSessionSafely, describeTrackPlan } from '@/lib/ui/running-workouts';
import { getRunningPlan } from '@/lib/core/running-plan';
import { listTrainingOccurrences } from '@/lib/core/occurrence';
import { onAppEvent } from '@/lib/core/events';
import type { Plan, Session } from '@/lib/strength/model';
import type { ScheduleEntry } from '@/lib/ui/day-schedule-rules';
import { startScheduledRun, activeTrainingBlock } from '@/lib/ui/scheduled-start';
import { WarmupPanel } from './warmup-panel';
import { loadWarmups } from '@/lib/ui/warmup';
import { scheduledWarmupBlock, linkScheduledWarmup } from '@/lib/ui/warmup-execution';
import { displayName } from '@/lib/strength/model';
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function SchedulePicker({ date, onChoose, onClose, onAdd }: { date: string; onChoose: (e: ScheduleEntry) => void; onClose: () => void; onAdd: () => void }) {
  const entries = scheduledChoices(loadSchedule().entries, date), open = listTrainingOccurrences().filter(o => o.lifecycle === 'IN_PROGRESS');
  return <Sheet label="选择当天训练" title={`${date.slice(5).replace('-', '月')}日 · 训练计时`} sub="与首页所选日期的训练一致" onClose={onClose} footer={<button type="button" className="min-h-12 w-full rounded-xl border border-accent font-bold text-accent" onClick={onAdd}>添加训练</button>}>
    <div className="space-y-3">{entries.map(e => { const live = open.some(o => [scheduleExecutionId(e.id, 'run'), scheduleExecutionId(e.id, 'strength')].includes(o.sessionId)); return <button key={e.id} type="button" className="flex min-h-20 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 text-left" onClick={() => onChoose(e)}><span><b className="block">{e.title}</b><span className="mt-1 block text-sm text-muted">{e.date} · {e.minutes}分钟 · {e.exercises?.length ? `${e.exercises.length}个动作` : e.modality === 'run' ? '跑步' : '力量'}</span></span><span className="shrink-0 font-bold text-accent">{live ? '继续' : e.status === 'done' ? '查看' : '进入'} ›</span></button>; })}{!entries.length ? <p className="keep py-5 text-sm text-muted">这一天还没有确认的训练，请先添加。</p> : null}</div>
  </Sheet>;
}

export function ScheduledTraining({ entry, plan, onClose, onEdit, onChanged, onResumeOther }: { entry: ScheduleEntry; plan: Plan; onClose: () => void; onEdit: () => void; onChanged: () => void; onResumeOther: (sessionId: string) => void }) {
  const course = useMemo(() => resolveScheduledCourse(entry, plan, listTrackPlans()), [entry, plan]);
  const [strength, setStrength] = useState<Session | null>(course.strength), [runId, setRunId] = useState<string | null>(() => course.run ? openTrackOccurrence(course.run.planId)?.trainingOccurrenceId ?? null : null);
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const ownIds = [course.strength?.id, course.run?.planId], openOther = listTrainingOccurrences().find(o => o.lifecycle === 'IN_PROGRESS' && !ownIds.includes(o.sessionId));
  const otherWarmup = loadWarmups().find(r => r.status === 'IN_PROGRESS' && r.entryId !== entry.id);
  const mainLive = listTrainingOccurrences().some(o => o.lifecycle === 'IN_PROGRESS' && ownIds.includes(o.sessionId));
  const after = () => { syncScheduleProgress(); setRevision(n => n + 1); onChanged(); };
  useEffect(() => { const unsubscribe = onAppEvent(() => { syncScheduleProgress(); setRevision(n => n + 1); }); return unsubscribe; }, []);
  useEffect(() => { const sync = () => setRevision(n => n + 1); window.addEventListener('fk-warmup-changed', sync); window.addEventListener('storage', sync); return () => { window.removeEventListener('fk-warmup-changed', sync); window.removeEventListener('storage', sync); }; }, []);
  const blocked = (targetId?: string) => {
    if (entry.date > localDate()) return '这是未来日期的安排，可查看或编辑，到训练当天再开始。';
    return targetId ? activeTrainingBlock(targetId) || scheduledWarmupBlock(entry.id, targetId, entry.warmup) : null;
  };
  async function link(occurrenceId: string) { try { await linkScheduledWarmup(entry.id, occurrenceId); setPendingLink(null); after(); } catch (e) { setPendingLink(occurrenceId); setNotice(`主课已开始，热身关联暂未保存：${(e as Error).message}`); } }
  useEffect(() => { for (const o of listTrainingOccurrences().filter(o => ownIds.includes(o.sessionId) && o.lifecycle === 'IN_PROGRESS')) void link(o.trainingOccurrenceId); }, [entry.id]);
  async function startRun() {
    const error = blocked(course.run?.planId); if (error) { setNotice(error); return; }
    if (!course.run || busy) return;
    setBusy(true);
    const result = await startScheduledRun(course.run);
    if (result.ok) { setRunId(result.trainingOccurrenceId); void link(result.trainingOccurrenceId); } else setNotice(result.reason);
    setBusy(false);
  }
  return <Sheet full label="本节训练执行" title={entry.title} sub={`${entry.date} · ${entry.modality === 'run' ? '跑步' : entry.trainingType === 'mixed' ? '跑步＋力量' : '力量'} · 与首页同一节训练`} onClose={() => { after(); onClose(); }} footer={<button type="button" className="min-h-12 w-full rounded-xl border border-line font-bold" onClick={() => { after(); onClose(); }}>返回首页 · 保留进度</button>}>
    {openOther ? <div role="status" className="mb-3 rounded-xl border border-accent p-3"><p className="text-sm">已有另一节训练进行中，先继续那一节。</p><button type="button" className="mt-2 min-h-11 font-bold text-accent" onClick={() => onResumeOther(openOther.sessionId)}>继续进行中的训练 ›</button></div> : null}
    {otherWarmup ? <div role="status" className="mb-3 rounded-xl border border-accent p-3"><p className="text-sm">另一节训练的热身尚未结束。</p><button type="button" className="mt-2 min-h-11 text-accent" onClick={() => onResumeOther(scheduleExecutionId(otherWarmup.entryId, 'run'))}>继续那节热身 ›</button></div> : null}
    {course.errors.length ? <div className="mb-3 rounded-xl border border-amber-500 p-3"><ul className="list-disc pl-5 text-sm">{course.errors.map(e => <li key={e}>{e}</li>)}</ul><button type="button" className="mt-2 min-h-11 font-bold text-accent" onClick={onEdit}>补充这节训练的参数 ›</button></div> : null}
    {notice ? <p role="alert" className="keep mb-3 text-sm text-amber-400">{notice}</p> : null}
    {pendingLink ? <button type="button" className="mb-3 min-h-11 font-bold text-accent" onClick={() => void link(pendingLink)}>重试关联热身（保留已开始的主课）</button> : null}
    <WarmupPanel entry={entry} onChanged={after} mainLive={mainLive} main={strength?.moves.map(m => ({ id: m.id, name: displayName(m), catalogId: m.catalogId }))} canBegin={() => entry.date > localDate() ? '这是未来日期的安排，到训练当天再开始。' : listTrainingOccurrences().some(o => o.lifecycle === 'IN_PROGRESS') ? '请先继续或结束当前主课。' : otherWarmup ? '已有另一节热身进行中，请先继续或结束。' : null} />
    {!course.errors.length && !openOther ? <>
      {course.run ? <section className="mb-3 rounded-2xl border border-line p-3"><h3 className="font-bold">{course.strength ? '跑步部分' : '跑步训练'}</h3><p className="keep mt-2 text-sm">{describeTrackPlan(course.run)}</p>{runId ? <TrackRunner embedded key={runId} occurrenceId={runId} onClose={() => { setRunId(null); after(); }} /> : <button type="button" disabled={busy || entry.date > localDate()} className="mt-3 min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg disabled:opacity-50" onClick={() => void startRun()}>{openTrackOccurrence(course.run.planId) ? '继续这节跑步' : listTrainingOccurrences().some(o => o.sessionId === course.run!.planId) ? '再次开始跑步（新课次）' : '开始这节跑步'}</button>}</section> : null}
      {strength ? <TrainingDecisionCard embeddedRunner key={strength.id} plan={{ ...plan, sessions: [strength] }} session={strength} planSlotId={entry.id} onApply={setStrength} onLive={() => setRevision(n => n + 1)} onStarted={id => void link(id)} onFinished={after} beforeStart={() => blocked(strength.id)} /> : null}
    </> : null}
    <details className="mt-3 rounded-xl border border-line p-3 text-sm"><summary className="min-h-11 cursor-pointer font-bold">本节训练与已保存状态</summary><p className="keep">计划名称：{entry.title}。逐组、分段、休息与完成记录绑定本节训练。</p><p className="keep mt-2">返回后可继续未结束的训练；完成状态只依据实际保存的记录更新。</p><button type="button" className="mt-2 min-h-11 font-bold text-accent" onClick={onEdit}>编辑训练安排 ›</button><span hidden>{revision}</span></details>
  </Sheet>;
}
