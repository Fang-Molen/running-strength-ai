import { useEffect, useState } from 'react';
import { currentAthleteId } from '@/lib/core/events';
import { readGlobalCoachSnapshot, subscribeGlobalCoach, type GlobalCoachSnapshot } from '@/lib/coach/global-coach-host-v89';
import { pendingTaskId } from '@/lib/ui/pending-feedback';
import { Activity, ArrowRight, ArrowUpRight, ClipboardList, FileClock, HeartPulse, Utensils, ShieldCheck } from 'lucide-react';
import { coachCoordinationNext, coachCoordinationView, type CoachCoordinationInput, type CoachOrganTarget } from '@/lib/ui/coach-coordination-view';

/** Shared host facts and task IDs; derived views never write a training record. */
function GlobalCoachDigest({ input, onNavigate }: { input: CoachCoordinationInput; onNavigate: (tab: CoachOrganTarget) => void }) {
  const [snapshot, setSnapshot] = useState<GlobalCoachSnapshot | null>(null);
  useEffect(() => {
    let live = true, sequence = 0;
    const refresh = () => {
      const request = ++sequence, owner = currentAthleteId();
      setSnapshot(null);
      void readGlobalCoachSnapshot().then(next => {
        if (live && request === sequence && owner === currentAthleteId()) setSnapshot(next);
      }).catch(() => { if (live && request === sequence) setSnapshot(null); });
    };
    refresh(); const off = subscribeGlobalCoach(refresh);
    return () => { live = false; sequence++; off(); };
  }, []);
  const current = snapshot?.athleteId === currentAthleteId() ? snapshot : null;
  const data = current?.data;
  if (!input.loaded || !current || !data) return <p className="keep mt-2 text-sm text-muted" role="status">全局健康与训练数据暂未完整读取；不据此判断身体正常或没有训练。</p>;
  const openTask = (id: string, target: string) => {
    const pending = current.pending.find(item => pendingTaskId(item, current.athleteId) === id);
    if (pending) {
      window.dispatchEvent(new CustomEvent('fk-open-plan400-day', { detail: {date: pending.date, tab:pending.kind==='confirm_run'?'during':'after'} }));
      return;
    }
    if (target === 'coach' || id.startsWith('proposal:')) {
      window.dispatchEvent(new CustomEvent('fk-coach-review-open')); return;
    }
    onNavigate(target as CoachOrganTarget);
  };
  return <div className="mt-2 rounded-xl border border-line p-3 text-sm" aria-label="方坤全局观察（只读）" data-testid="global-coach-v89" data-revision={current.revision}>
    <p className="font-bold">全局观察 · {data.day}</p>
    <p className="keep mt-1">恢复：{data.fatigue.title}。</p>
    {data.muscleRecovery?<details className="mt-2" data-testid="global-muscle-u11"><summary className="min-h-11 cursor-pointer py-2">肌群观察 · {data.muscleRecovery.summary}</summary><p className="keep whitespace-pre-line">{data.muscleRecovery.explanation}</p></details>:null}
    <p className="keep mt-1">{data.nutrition.count ? `饮食已记录 ${data.nutrition.count} 条，已知热量小计 ${Math.round(data.nutrition.knownKcal)} kcal${data.nutrition.pending ? `，${data.nutrition.pending} 项热量待核` : ''}；全天是否完整未知。` : '饮食尚无可确认的记录，不按摄入 0 计算。'}</p>
    <p className="keep mt-1">{data.balance.from}—{data.balance.to}：有开始与完成来源的训练 {data.coreActual.sessions} 次，已知时长 {Math.round(data.coreActual.knownMinutes)} 分钟{data.coreActual.unknownMinutes ? `，另有 ${data.coreActual.unknownMinutes} 次时长未知` : ''}；不代表所有历史渠道都完整。</p>
    {current.result.tasks.length ? <ul className="mt-2 divide-y divide-line" aria-label="全局待办">{current.result.tasks.slice(0,5).map(task => <li key={task.id} data-task-id={task.id}>
      <button type="button" className="min-h-11 w-full py-2 text-left text-sm" onClick={()=>openTask(task.id,task.target)}><b>{task.title} ›</b><span className="block text-muted">{task.detail}</span></button>
    </li>)}</ul> : <p className="keep mt-2 text-muted">当前已读取来源没有待处理事项；不代表所有模块均完整或已获训练许可。</p>}
    <details className="mt-2"><summary className="min-h-11 cursor-pointer py-2 font-bold">查看依据与缺失信息</summary>
      <ul className="space-y-2">{current.evidence.filter(e=>e.availability!=='MISSING').map(e=><li key={e.id} className="break-words"><p>{e.summary}</p><p className="keep text-xs text-muted">来源 {e.sourceId} · 观测 {e.observedAt??'UNKNOWN'} · 入库 {e.knownAt??'UNKNOWN'} · 版本 {e.revision}</p></li>)}</ul>
      {[...current.result.warnings,...current.limitations].map((text,i)=><p key={i} className="keep mt-2 text-muted">{text}</p>)}
      <p className="keep mt-2 text-muted">正式改课仍须完整日历、写入协调与安全复核；此处不授予执行权限。</p>
    </details>
    <div className="mt-2 flex flex-wrap gap-3"><button type="button" className="min-h-11 text-accent" onClick={()=>onNavigate('body')}>核对健康来源 ›</button><button type="button" className="min-h-11 text-accent" onClick={()=>onNavigate('diet')}>核对饮食记录 ›</button></div>
  </div>;
}
const ICONS = {
  plan: ClipboardList,
  today: Activity,
  log: FileClock,
  body: HeartPulse,
  diet: Utensils,
} as const;

/** Read-only cross-module overview; only host writers may modify plans after confirmation. */
export function CoachCoordinationHub({
  input,
  onNavigate,
}: {
  input: CoachCoordinationInput;
  onNavigate: (tab: CoachOrganTarget) => void;
}) {
  const organs = coachCoordinationView(input);
  const next = coachCoordinationNext(input);
  return (
    <section className="fangkun-hub" aria-label="方坤AI协同中枢">
      <div className="fangkun-hub-core">
        <span className="fangkun-core-mark" aria-hidden="true">方</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold tracking-wide text-accent">方坤 AI · 教练中枢</p>
          <h3 className="mt-0.5 text-base font-bold">让训练、记录与恢复形成闭环</h3>
          <p className="mt-1 text-xs text-muted">各模块提供事实和执行入口，方坤依据证据解释；计划修改仍由你确认。</p>
        </div>
      </div>
      <div className="fangkun-next" role="group" aria-label="下一步操作入口">
        <div className="min-w-0 flex-1">
          <p className="fangkun-next-eyebrow">下一步 · 基于已显示的记录</p>
          <p className="fangkun-next-title" aria-live="polite">{next.title}</p>
          <p className="fangkun-next-detail">{next.detail}</p>
        </div>
        <button type="button" className="fangkun-next-action" onClick={() => onNavigate(next.target)} aria-label={`${next.title}，打开相应页面`}>
          前往 <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
      <GlobalCoachDigest input={input} onNavigate={onNavigate} />
      <p className="fangkun-organ-heading">协同工作区 <span>点击查看事实和训练任务</span></p>
      <div className="fangkun-organ-grid" aria-label="查看协作模块">
        {organs.map(({ id, label, role, readout }) => {
          const Icon = ICONS[id];
          return (
            <button key={id} type="button" onClick={() => onNavigate(id)} className="fangkun-organ" aria-label={`前往${label}：${role}`}>
              <span className="fangkun-organ-icon" aria-hidden="true"><Icon size={17} strokeWidth={2} /></span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-[13px] font-bold">{label}<span className="ml-1 text-[11px] font-normal text-muted">· {role}</span></span>
                <span className="mt-0.5 block text-[11px] text-muted">{readout}</span>
              </span>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <details className="fangkun-mechanism-rail" aria-label="训练机制理解路径">
        <summary className="fangkun-mechanism-summary">了解方坤如何理解训练 <span>展开</span></summary>
        <p className="mt-2 text-xs text-muted">训练刺激 <span aria-hidden="true">→</span> 身体响应 <span aria-hidden="true">→</span> 恢复与适应 <span aria-hidden="true">→</span> 专项表现</p>
        <p className="mt-1 text-[11px] text-muted">理解共通机制，不等于已确认你的个人适应；实际建议仍须核对证据。</p>
      </details>
      <p className="fangkun-hub-boundary"><ShieldCheck size={14} aria-hidden="true" /> 本地优先 · 未记录不等于正常 · 未经确认不改计划</p>
    </section>
  );
}
