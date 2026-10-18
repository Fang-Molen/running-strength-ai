import { useEffect, useState } from "react"
import { Bot, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react"
import { assess, FEEDBACK_LABELS, type Assessment, type Feedback, type FeedbackReason } from "@/lib/ui/coach-assessment"
import { loadFeedback, loadLoggedSessions, saveFeedback } from "@/lib/ui/assessment-store"
import { loadSchedule } from "@/lib/ui/day-schedule"
import { recoveryVerdict } from "@/lib/ui/recovery-verdict"
import { readRecoveryInput } from "@/components/health-extras"
import { SavedBadge } from "@/components/saved-badge"
import { onAppEvent } from '@/lib/core/events';

const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }

function FeedbackBar({ targetId, excludeIds, feedback, onSave }: { targetId: string; excludeIds: string[]; feedback: Feedback[]; onSave: (f: Feedback) => void }) {
  const mine = [...feedback].reverse().find((f) => f.targetId === targetId)
  const [down, setDown] = useState(false), [reasons, setReasons] = useState<FeedbackReason[]>(mine?.reasons ?? []), [text, setText] = useState(mine?.text ?? "")
  const save = (vote: "up" | "down", r = reasons, t = text) => onSave({ targetId, vote, reasons: vote === "up" ? [] : r, text: vote === "up" ? "" : t, at: new Date().toISOString(), excludeIds: vote === "down" ? excludeIds : [] })
  return <div className="mt-1">
    <div className="flex items-center gap-1.5 text-xs">
      <button type="button" className="fk-chip" aria-pressed={mine?.vote === "up"} onClick={() => { setDown(false); save("up") }}><ThumbsUp className="size-3.5" />说得对</button>
      <button type="button" className="fk-chip" aria-pressed={mine?.vote === "down" || down} onClick={() => { setDown(!down); if (!down) save("down") }}><ThumbsDown className="size-3.5" />不准</button>
    </div>
    {down ? <div className="mt-1.5 space-y-1.5">
      <div className="fk-chips flex-wrap">{(Object.keys(FEEDBACK_LABELS) as FeedbackReason[]).map((r) => <button key={r} type="button" className="fk-chip" aria-pressed={reasons.includes(r)} onClick={() => { const n = reasons.includes(r) ? reasons.filter((x) => x !== r) : [...reasons, r]; setReasons(n); save("down", n) }}>{FEEDBACK_LABELS[r]}</button>)}</div>
      <input value={text} onChange={(e) => setText(e.target.value.slice(0, 80))} onBlur={() => save("down")} placeholder="补充一句（可选）" className="fk-cell min-h-9 w-full text-xs" aria-label="反馈补充" />
    </div> : null}
  </div>
}

export function AssessmentPanel() {
  const [a, setA] = useState<Assessment | null>(null)
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [stamp, setStamp] = useState(0)
  const run = (fb = loadFeedback()) => { const today = localDay(); setFeedback(fb); setA(assess({ today, entries: loadSchedule().entries, logs: loadLoggedSessions(), recovery: recoveryVerdict(readRecoveryInput(today)), feedback: fb })) }
  useEffect(() => { const refresh = () => run(); run(); const unsubscribe = onAppEvent(refresh); window.addEventListener('fk-schedule-changed', refresh); window.addEventListener('fk-training-activities-changed', refresh); window.addEventListener('storage', refresh); return () => { unsubscribe(); window.removeEventListener('fk-schedule-changed', refresh); window.removeEventListener('fk-training-activities-changed', refresh); window.removeEventListener('storage', refresh); }; }, [])
  const onSave = (f: Feedback) => { const next = [...feedback.filter((x) => x.targetId !== f.targetId), f]; if (saveFeedback(next)) setStamp(Date.now()); setFeedback(next) }
  if (!a) return null
  return <section aria-label="方坤评估" className="home-card mx-auto mb-3 max-w-3xl p-4 text-sm">
    <div className="flex items-center justify-between"><h2 className="flex items-center gap-1.5 text-base font-bold"><Bot className="size-4 text-[#7a5cc7]" />方坤评估 · 本周</h2><span className="flex items-center gap-2"><SavedBadge stamp={stamp} /><button type="button" className="fk-chip" onClick={() => run(feedback)}><RefreshCw className="size-3.5" />重新评估</button></span></div>
    {a.adjustments.length ? <p className="mt-2 rounded-lg bg-[#7a5cc7]/10 p-2 text-xs">已根据你的反馈调整：{a.adjustments.join("；")}</p> : null}
    <p className="mt-2 text-base font-bold">{a.verdict}</p>
    <FeedbackBar targetId={a.id} excludeIds={a.worstIds} feedback={feedback} onSave={onSave} />
    <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">{a.records.map((r) => <li key={r} className="rounded-lg bg-surface-2 px-2 py-1.5">{r}</li>)}</ul>
    <p className="mt-3 text-xs font-bold text-muted">建议</p>
    <ol className="mt-1 space-y-2">{a.suggestions.map((s, i) => <li key={s.id}><p>{i + 1}. {s.text}</p><FeedbackBar targetId={s.id} excludeIds={a.worstIds} feedback={feedback} onSave={onSave} /></li>)}</ol>
    {a.evidence.length ? <details className="mt-3 text-xs text-muted"><summary className="min-h-9 cursor-pointer font-bold">依据</summary><ul className="list-disc space-y-0.5 pl-5">{a.evidence.map((x) => <li key={x}>{x}</li>)}</ul><p className="mt-1">只用实际记录；一次没做好不下结论；状态问题不等于能力下降（方坤手册）。</p></details> : null}
  </section>
}
