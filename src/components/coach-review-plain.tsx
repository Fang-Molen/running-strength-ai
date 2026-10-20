import type { ReactNode } from 'react'
import type { PlainReview } from '@/lib/coach/review-view/plain-review'

/** 复盘结果（人话版）：几张短卡片 + 折叠的“查看依据”。只展示 plainReview 已给出的内容。 */
export function CoachReviewPlain({ plain, children }: { plain: PlainReview; children?: ReactNode }) {
  return <div data-testid="review-plain" className="space-y-2">
    {plain.sections.map(s => <div key={s.key} data-testid={`review-${s.key}`} className={'rounded-card border bg-surface p-3 ' + (s.key === 'safety' ? 'border-accent' : 'border-line')}>
      <h4 className="font-bold">{s.title}</h4>
      {s.emphasis && <p className="mt-1 text-base font-bold text-accent">{s.emphasis}</p>}
      {s.key === 'need'
        ? <ul className="mt-1 list-disc space-y-1 pl-5">{s.lines.map((l, i) => <li key={i} className="break-words">{l}</li>)}</ul>
        : s.lines.map((l, i) => <p key={i} className="mt-1 break-words">{l}</p>)}
    </div>)}
    <details data-testid="review-evidence" className="rounded-card border border-line bg-surface px-3">
      <summary className="min-h-11 cursor-pointer py-3">查看依据</summary>
      <p className="break-words pb-3 text-xs whitespace-pre-line">{plain.evidence}</p>
      {children}
    </details>
  </div>
}
