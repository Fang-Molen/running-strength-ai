/* R5: 方坤回答展示——先一句结论 + 下一课，理由可展开。只改展示，回答原文逐句保留。 */
import { digestCoachAnswer } from "@/lib/ui/coach-answer-digest"

export function CoachAnswerView({ text }: { text: string }) {
  const d = digestCoachAnswer(text)
  return <div data-testid="coach-answer" className="space-y-1.5">
    {d.tag ? <p className="text-[11px] text-muted">{d.tag}</p> : null}
    <p data-testid="coach-conclusion" className="whitespace-pre-wrap font-bold leading-snug">{d.conclusion}</p>
    {d.next ? <p data-testid="coach-next" className="whitespace-pre-wrap rounded-lg border-l-2 border-accent bg-surface-2/60 px-2 py-1 leading-snug"><span className="mr-1 text-[11px] font-bold tracking-wide text-accent">下一课</span>{d.next}</p> : null}
    {d.reasoning.length ? <details data-testid="coach-reasoning" open={d.risk} className="text-[13px]">
      <summary className="min-h-8 cursor-pointer text-xs font-bold text-muted">{d.risk ? "收起理由" : `看理由（${d.reasoning.length} 句）`}</summary>
      <p className="whitespace-pre-wrap leading-relaxed text-fg/90">{d.reasoning.join("\n")}</p>
    </details> : null}
  </div>
}
