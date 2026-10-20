import { useEffect, useState } from 'react'
import { C03_FOLLOWUP_CHANGED_EVENT, readC03FollowupView, withdrawDisplayedC03Hypothesis } from '@/lib/coach/c03/runtime'

const statusText: Record<string, string> = { PENDING: '待验证', STALE_NEEDS_REVIEW: '新证据出现，需重看',
  WITHDRAWN: '已撤回', WEAKENED: '证据削弱', SUPPORTED_OBSERVATION: '观察支持，仍非因果结论' }
function read() { try { return readC03FollowupView() } catch { return null } }
/** Small view of the same journal. No duplicate reminder centre or training editor. */
export function CoachC03FollowupPanel({ revision = 0 }: { revision?: number }) {
  const [view, setView] = useState<ReturnType<typeof read>>(null), [notice, setNotice] = useState('')
  useEffect(() => { const refresh = () => setView(read()); refresh()
    window.addEventListener(C03_FOLLOWUP_CHANGED_EVENT, refresh); window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(C03_FOLLOWUP_CHANGED_EVENT, refresh); window.removeEventListener('storage', refresh) }
  }, [revision])
  if (!view || view.status !== 'AVAILABLE') return <p role="status" data-testid="c03-followups-unavailable" className="text-xs text-muted">长期跟进暂不可读；原训练记录不受影响。</p>
  if (!view.hypotheses.length) return <p role="status" data-testid="c03-followups-empty" className="text-xs text-muted">长期跟进：有明确课次来源的复盘展示后，才保存待验证解释；目前没有已登记的 C03 判断。</p>
  return <details className="rounded-card border border-line p-3" data-testid="c03-followups">
    <summary className="cursor-pointer text-sm font-bold">长期跟进 · {view.hypotheses.length} 项判断记录</summary>
    <p className="keep mt-2 text-xs text-muted">保留原依据与反证；采纳不代表执行，不自动修改计划或能力分。</p>
    {view.hypotheses.map(h => <article className="mt-3 border-t border-line pt-3 text-xs leading-5" key={`${h.id}:${h.revision}`}>
      <p className="font-bold">{statusText[h.status] ?? h.status} · 版本 {h.revision}</p>
      <p>{h.explanation}</p>
      <p>支持观察：{h.supportingObservations?.join('；') || '见所用正式来源。'}</p>
      <p>反证条件：{h.counterConditions?.join('；') || '尚缺可比结果，不以缺失当改善。'}</p>
      <p>下次观察：{h.nextObservation}</p>
      <p className="text-muted">正式来源 {h.supportEvidence.map(e => e.sourceId).join('、')}；缺失 {h.missing.join('；') || '仍需持续可比观察'}。</p>
      {h.status !== 'WITHDRAWN' && <button type="button" className="mt-2 min-h-11 rounded-card border border-line px-3" onClick={() => {
        const result = withdrawDisplayedC03Hypothesis(h.id)
        setNotice(result.ok ? '已撤回这项判断，原依据和训练记录保留。' : '撤回未保存，请重试；没有修改训练记录。'); setView(read())
      }}>撤回这项判断</button>}
    </article>)}
    {notice && <p role="status" className="mt-2 text-xs">{notice}</p>}
  </details>
}
