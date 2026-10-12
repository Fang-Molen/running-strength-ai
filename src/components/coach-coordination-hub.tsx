import { Activity, ArrowRight, ArrowUpRight, ClipboardList, FileClock, HeartPulse, ShieldCheck } from 'lucide-react';
import { coachCoordinationNext, coachCoordinationView, type CoachCoordinationInput, type CoachOrganTarget } from '@/lib/ui/coach-coordination-view';

const ICONS = {
  plan: ClipboardList,
  today: Activity,
  log: FileClock,
  body: HeartPulse,
} as const;

/** Navigation and provenance only. This hub never modifies or approves a plan. */
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
