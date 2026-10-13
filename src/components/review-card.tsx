import { useEffect, useState } from "react"
import { Check, ThumbsDown, ThumbsUp } from "lucide-react"
import { buildReview, loadReviews, upsertReview, type Review, type ReviewKind } from "@/lib/ui/review"
import { BAND_COLOR } from "@/lib/ui/day-override"
import { loadSchedule } from "@/lib/ui/day-schedule"
import { loadTier, TIER_LABEL } from "@/lib/ui/watch-mode"
import { loadSettings } from "@/lib/ui/app-settings"
import { FEEDBACK_LABELS, type FeedbackReason } from "@/lib/ui/coach-assessment"
import { loadFeedback, saveFeedback } from "@/lib/ui/assessment-store"
import { SavedBadge } from "@/components/saved-badge"

const KIND: Record<ReviewKind, string> = { day: "今日复盘", week: "本周复盘", session: "单课复盘" }
const ISSUE: Record<string, string> = { state: "状态", ability: "能力", data: "数据" }

export function ReviewCard({ review, onChange }: { review: Review; onChange?: (r: Review) => void }) {
  const [r, setR] = useState(review), [stamp, setStamp] = useState(0), [why, setWhy] = useState(false), [text, setText] = useState(review.feedback?.text ?? "")
  const [ev, setEv] = useState(false)
  useEffect(() => { setEv(loadSettings().showEvidence) }, [])
  const save = (n: Review) => { setR(n); upsertReview(n); setStamp(Date.now()); onChange?.(n) }
  const vote = (v: "up" | "down", reasons: FeedbackReason[] = r.feedback?.reasons ?? [], t = text) => {
    const fb = { vote: v, reasons, text: t, at: new Date().toISOString() }; save({ ...r, feedback: fb })
    saveFeedback([...loadFeedback().filter((f) => f.targetId !== r.id), { targetId: r.id, vote: v, reasons, text: t, at: fb.at, excludeIds: v === "down" && (reasons.includes("special") || reasons.includes("wrongData")) ? r.bands.map((b) => b.id) : [] }])
  }
  return <article className="rounded-2xl border border-line bg-surface p-3 text-sm" aria-label={KIND[r.kind]}>
    <div className="flex items-center gap-2"><span className="rounded-full bg-[#7a5cc7]/12 px-2 py-0.5 text-[11px] font-bold text-[#6a4cb7]">{KIND[r.kind]}</span><span className="text-[11px] text-muted">{r.range[0] === r.range[1] ? r.range[0].slice(5) : `${r.range[0].slice(5)}–${r.range[1].slice(5)}`} · {TIER_LABEL[r.tier]}</span><span className="ml-auto"><SavedBadge stamp={stamp} /></span></div>
    <p className="mt-1.5 text-base font-bold">{r.verdict}</p>
    {r.bands.length ? <ul className="mt-2 space-y-1" aria-label="计划vs实际">{r.bands.map((b) => <li key={b.id} className="flex items-center gap-2 text-xs"><i className="h-4 w-1.5 rounded" style={{ background: b.band ? BAND_COLOR[b.band] : "#ccc" }} />{b.title}</li>)}</ul> : null}
    {r.highlights.length ? <div className="mt-2"><p className="text-xs font-bold text-[#1d7a5e]">亮点</p><ul className="list-disc pl-5">{r.highlights.map((h) => <li key={h}>{h}</li>)}</ul></div> : null}
    {r.issues.length ? <div className="mt-2"><p className="text-xs font-bold text-[#c0612b]">问题</p><ul className="space-y-0.5">{r.issues.map((i) => <li key={i.text} className="flex gap-1.5"><span className={"shrink-0 rounded px-1 text-[10px] font-bold " + (i.type === "ability" ? "bg-[#c0612b]/15 text-[#a04f20]" : "bg-line")}>{ISSUE[i.type]}</span><span>{i.text}</span></li>)}</ul></div> : null}
    {r.adjustment ? <div className="mt-2 rounded-xl bg-surface-2 p-2"><p className="text-xs font-bold">下周调整</p><p>{r.adjustment.note}</p>
      <button type="button" disabled={r.accepted} className="fk-chip mt-1" onClick={() => save({ ...r, accepted: true })}><Check className="size-3.5" />{r.accepted ? "已接受，方坤排课时生效" : "接受调整"}</button></div> : null}
    {r.evidence.length ? <><button type="button" className="fk-link mt-1 text-xs" onClick={() => setEv(!ev)}>{ev ? "收起依据" : "看依据"}</button>{ev ? <ul className="mt-1 text-xs text-muted">{r.evidence.map((e) => <li key={e}>{e}</li>)}</ul> : null}</> : null}
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
      <button type="button" className="fk-chip" aria-pressed={r.feedback?.vote === "up"} onClick={() => { setWhy(false); vote("up", []) }}><ThumbsUp className="size-3.5" />说得对</button>
      <button type="button" className="fk-chip" aria-pressed={r.feedback?.vote === "down"} onClick={() => { setWhy(true); vote("down") }}><ThumbsDown className="size-3.5" />不准</button>
    </div>
    {why || r.feedback?.vote === "down" ? <div className="mt-1.5 flex flex-wrap gap-1.5">{(Object.keys(FEEDBACK_LABELS) as FeedbackReason[]).map((k) => { const on = r.feedback?.reasons.includes(k); return <button key={k} type="button" className="fk-chip" aria-pressed={on} onClick={() => vote("down", on ? r.feedback!.reasons.filter((x) => x !== k) : [...(r.feedback?.reasons ?? []), k])}>{FEEDBACK_LABELS[k]}</button> })}
      <input aria-label="补充说明" placeholder="补充一句（可选）" value={text} onChange={(e) => setText(e.target.value.slice(0, 80))} onBlur={() => vote("down", r.feedback?.reasons ?? [], text)} className="fk-cell w-full" /></div> : null}
  </article>
}

export function ReviewPanel({ today, title = "复盘" }: { today: string; title?: string }) {
  const [list, setList] = useState<Review[]>([]), [cur, setCur] = useState<Review | null>(null)
  useEffect(() => { setList(loadReviews()) }, [])
  const make = (kind: ReviewKind) => {
    const entries = loadSchedule().entries
    const last = kind === "session" ? entries.filter((e) => e.actual && e.date <= today).sort((a, b) => (a.actual!.at < b.actual!.at ? 1 : -1))[0] : undefined
    const r = buildReview(kind, entries, today, loadTier(), last?.id); setCur(r); setList(upsertReview(r))
  }
  return <section className="space-y-2" aria-label="复盘">
    <div className="flex items-center gap-1.5"><h2 className="mr-auto text-base font-bold">{title}</h2>{(["day", "week", "session"] as ReviewKind[]).map((k) => <button key={k} type="button" className="fk-chip" onClick={() => make(k)}>{({ day: "今日", week: "本周", session: "最近一课" })[k]}</button>)}</div>
    {cur ? <ReviewCard key={cur.id} review={cur} onChange={(n) => setList(loadReviews())} /> : null}
    {list.filter((x) => x.id !== cur?.id).length ? <details className="rounded-2xl bg-surface p-3 text-sm"><summary className="min-h-10 cursor-pointer font-bold">历史复盘（{list.filter((x) => x.id !== cur?.id).length}）</summary>
      <ul className="mt-1 divide-y divide-line">{list.filter((x) => x.id !== cur?.id).slice(0, 20).map((x) => <li key={x.id}><button type="button" className="flex min-h-11 w-full items-center gap-2 text-left" onClick={() => setCur(x)}><span className="text-xs text-muted">{x.createdAt.slice(5, 10)}</span><b className="text-xs">{({ day: "今日", week: "本周", session: "单课" })[x.kind]}</b><span className="flex-1 truncate">{x.verdict}</span>{x.feedback ? (x.feedback.vote === "up" ? "👍" : "👎") : null}{x.accepted ? <Check className="size-3.5 text-[#269775]" /> : null}</button></li>)}</ul></details> : null}
  </section>
}
