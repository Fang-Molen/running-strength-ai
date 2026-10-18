import { reviewHybridWeek } from '@/lib/core/coach-hybrid-review'
import type { CoachPlanCandidate, PlanningContext } from '@/lib/core/coach-plan'

export function CoachHybridReview({ candidate, context }: { candidate: CoachPlanCandidate; context: PlanningContext }) {
  const review = reviewHybridWeek(candidate, context)
  return <section data-testid="hybrid-review" className="mt-3 rounded-card border border-line bg-surface p-3 text-sm">
    <h3 className="font-bold">跑步与力量的安排核对</h3>
    <p className="mt-2">{review.primary === 'RUNNING' ? '当前有跑步目标，先按跑步优先方向讨论；力量的目标仍需你确认。' : '主要目标尚未明确，先核对跑步与力量的优先级。'}</p>
    {review.observations.map((text, i) => <p key={`o${i}`} className="mt-2">{text}</p>)}
    {review.questions.map((text, i) => <p key={`q${i}`} className="mt-2 text-muted">待确认：{text}</p>)}
    {review.options.map((option, i) => <p key={`p${i}`} className="mt-2">可讨论方向：{option.explanation}</p>)}
    <p className="mt-2 text-xs text-muted">以上仅核对候选日程，没有移动课程或改变训练量。</p>
  </section>
}
