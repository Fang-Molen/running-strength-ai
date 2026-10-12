import { COACH_KNOWLEDGE_VERSION, selectCoachKnowledge, type KnowledgeMode } from "@/lib/core/coach-knowledge"

export function CoachKnowledgePanel({ mode }: { mode: KnowledgeMode }) {
  return <details className="mt-3 rounded-card border border-line bg-surface p-3">
    <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">教练的一般知识依据</summary>
    <p className="mt-2 text-xs text-muted">这些是一般研究与执教原则，不能代替你的训练事实，也不能证明已经恢复。个人数字仍需单独的记录来源。</p>
    <div className="mt-3 space-y-3">{selectCoachKnowledge(mode).map((card) => <article key={card.id} className="min-w-0 rounded-card bg-bg p-3 text-sm">
      <h4 className="font-bold">{card.title}</h4><p className="mt-1">{card.principle}</p>
      <p className="mt-1 text-xs text-muted">应用限制：{card.limit}</p><p className="mt-1 text-xs text-muted">研究范围：{card.population}</p>
      <a href={card.url} target="_blank" rel="noreferrer noopener" className="mt-2 block break-words text-xs text-accent underline">{card.sourceTitle}</a>
    </article>)}</div>
    <p className="mt-3 text-xs text-muted">知识版本 {COACH_KNOWLEDGE_VERSION} · 查阅日期 2026-10-08。计划与上传复盘使用这组原则；普通对话和后续恢复反馈尚未统一接入。</p>
  </details>
}
