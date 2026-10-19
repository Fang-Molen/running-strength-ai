import { useEffect, useState } from "react"
import { Check, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react"
import { buildReview, loadReviews, upsertReview, type Review, type ReviewKind } from "@/lib/ui/review"
import { BAND_COLOR } from "@/lib/ui/day-override"
import { loadSchedule } from "@/lib/ui/day-schedule"
import { loadTier } from "@/lib/ui/watch-mode"
import { loadSettings } from "@/lib/ui/app-settings"
import { type FeedbackReason } from "@/lib/ui/coach-assessment"
import { loadFeedback, saveFeedback } from "@/lib/ui/assessment-store"
import { SavedBadge } from "@/components/saved-badge"
import { loadTrainingActivities } from "@/lib/ui/training-read-model"
import type { RecordRef } from "@/lib/ui/review"
const REVIEW_REASONS: [FeedbackReason, string][] = [["wrongData", "数据错误"], ["conclusion" as FeedbackReason, "结论不符"], ["advice" as FeedbackReason, "建议不适用"]]
export const openLogRecord = (date: string, ids: string[]) => window.dispatchEvent(new CustomEvent("fk-log-focus", { detail: { date, ids } }))
const stamp16 = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : iso.slice(5, 16) }
export function recordRefs(): RecordRef[] { try { return loadTrainingActivities().map((r) => ({ id: r.id, date: r.date, sport: r.sport, label: `${r.source === "garmin" ? "佳明" : r.source === "import" ? "上传" : "方坤记录"} ${r.sport === "RUNNING" ? "跑步" : r.sport === "STRENGTH" ? "力量" : "训练"}${r.distanceM ? ` ${(r.distanceM / 1000).toFixed(2)}km` : ""}${r.durationSec ? ` ${Math.round(r.durationSec / 60)}分钟` : ""}` })) } catch { return [] } }

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
    <div className="flex items-center gap-2"><span className="rounded-full bg-[#7a5cc7]/12 px-2 py-0.5 text-[11px] font-bold text-[#6a4cb7]">{KIND[r.kind]}</span><span className="keep text-[11px] text-muted">训练日期 {r.trainingDates?.length ? r.trainingDates.map((d) => d.slice(5)).join("、") : r.range[0] === r.range[1] ? r.range[0].slice(5) : `${r.range[0].slice(5)}–${r.range[1].slice(5)}`} · 复盘生成 {stamp16(r.createdAt)}</span><span className="ml-auto"><SavedBadge stamp={stamp} /></span></div>
    <p className="mt-1.5 text-base font-bold">{r.verdict}</p>
    {r.bands.length ? <ul className="mt-2 space-y-1" aria-label="计划vs实际">{r.bands.map((b) => <li key={b.id} className="flex items-center gap-2 text-xs"><i className="h-4 w-1.5 rounded" style={{ background: b.band ? BAND_COLOR[b.band] : "#ccc" }} />{b.title}</li>)}</ul> : null}
    {r.highlights.length ? <div className="mt-2"><p className="text-xs font-bold text-[#1d7a5e]">亮点</p><ul className="list-disc pl-5">{r.highlights.map((h) => <li key={h}>{h}</li>)}</ul></div> : null}
    {r.issues.length ? <div className="mt-2"><p className="text-xs font-bold text-[#c0612b]">问题</p><ul className="space-y-0.5">{r.issues.map((i) => <li key={i.text} className="flex gap-1.5"><span className={"shrink-0 rounded px-1 text-[10px] font-bold " + (i.type === "ability" ? "bg-[#c0612b]/15 text-[#a04f20]" : "bg-line")}>{ISSUE[i.type]}</span><span>{i.text}</span></li>)}</ul></div> : null}
    {r.adjustment ? <div className="mt-2 rounded-xl bg-surface-2 p-2"><p className="text-xs font-bold">下周调整</p><p>{r.adjustment.note}</p>
      <button type="button" disabled={r.accepted} className="fk-chip mt-1" onClick={() => save({ ...r, accepted: true })}><Check className="size-3.5" />{r.accepted ? "已接受，方坤排课时生效" : "接受调整"}</button></div> : null}
    {r.evidence.length || r.linked?.length ? <><button type="button" className="fk-link mt-1 min-h-9 text-xs" aria-expanded={ev} onClick={() => setEv(!ev)}>{ev ? "收起依据" : "看依据"}</button>{ev ? <div className="mt-1 text-xs">{r.linked?.length ? <ul className="space-y-1">{r.linked.map((l) => <li key={l.entryId} className="keep"><b>{l.date.slice(5)} {l.title}</b>：{l.recordIds.length ? <>{l.recordLabels.map((label, i) => <button key={l.recordIds[i]} type="button" className="fk-chip ml-1" onClick={() => openLogRecord(l.date, [l.recordIds[i]])}>打开记录 · {label}</button>)}</> : <span className="text-muted">只有“按计划完成”标记，没有对应的训练记录</span>}</li>)}</ul> : null}<ul className="mt-1 text-muted">{r.evidence.map((e) => <li key={e}>{e}</li>)}</ul></div> : null}</> : null}
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
      <button type="button" className="fk-chip" aria-pressed={r.feedback?.vote === "up"} onClick={() => { setWhy(false); vote("up", []) }}><ThumbsUp className="size-3.5" />说得对</button>
      <button type="button" className="fk-chip" aria-pressed={r.feedback?.vote === "down"} onClick={() => { setWhy(true); vote("down") }}><ThumbsDown className="size-3.5" />不准</button>
    </div>
    {why || r.feedback?.vote === "down" ? <div className="mt-1.5 flex flex-wrap gap-1.5">{REVIEW_REASONS.map(([k, label]) => { const on = r.feedback?.reasons.includes(k); return <button key={k} type="button" className="fk-chip" aria-pressed={on} onClick={() => vote("down", on ? r.feedback!.reasons.filter((x) => x !== k) : [...(r.feedback?.reasons ?? []), k])}>{label}</button> })}
      {r.feedback?.reasons.includes("wrongData") && r.linked?.some((l) => l.recordIds.length) ? <p className="keep w-full text-xs">数据错了请在原始记录里更正（复盘不会改原始数据，也不会改能力分）：{r.linked.filter((l) => l.recordIds.length).map((l) => <button key={l.entryId} type="button" className="fk-link ml-1" onClick={() => openLogRecord(l.date, l.recordIds)}>打开 {l.date.slice(5)} 的记录</button>)}</p> : null}
      <input aria-label="补充说明" placeholder="补充一句（可选）" value={text} onChange={(e) => setText(e.target.value.slice(0, 80))} onBlur={() => vote("down", r.feedback?.reasons ?? [], text)} className="fk-cell w-full" /></div> : null}
  </article>
}

export function ReviewPanel({ today, title = "复盘" }: { today: string; title?: string }) {
  const [list, setList] = useState<Review[]>([]), [cur, setCur] = useState<Review | null>(null), [hist, setHist] = useState(false)
  useEffect(() => { setList(loadReviews()) }, [])
  const make = (kind: ReviewKind) => {
    const entries = loadSchedule().entries
    const last = kind === "session" ? entries.filter((e) => e.actual && e.date <= today).sort((a, b) => (a.actual!.at < b.actual!.at ? 1 : -1))[0] : undefined
    const r = buildReview(kind, entries, today, loadTier(), last?.id, new Date().toISOString(), recordRefs()); setCur(r); setList(upsertReview(r))
  }
  return <section className="fk-dash-card space-y-2 p-3" aria-label="复盘">
    <h2 className="fk-dash-title text-base"><Sparkles className="size-5" />{title}</h2>
    <div className="grid grid-cols-3 gap-1 rounded-xl border border-line p-0.5">{(["day", "week", "session"] as ReviewKind[]).map((k) => <button key={k} type="button" aria-pressed={cur?.kind === k} className={"min-h-9 rounded-lg text-sm " + (cur?.kind === k ? "bg-accent font-bold text-accent-fg" : "")} onClick={() => make(k)}>{({ day: "今日", week: "本周", session: "最近一课" })[k]}</button>)}</div>
    {cur ? <ReviewCard key={cur.id} review={cur} onChange={(n) => setList(loadReviews())} /> : null}
    {list.filter((x) => x.id !== cur?.id).length ? <div className="text-sm"><button type="button" className="fk-link text-xs" aria-expanded={hist} onClick={() => setHist(!hist)}>历史复盘（{list.filter((x) => x.id !== cur?.id).length}）›</button>{hist ? <>
      <ul className="mt-1 divide-y divide-line">{list.filter((x) => x.id !== cur?.id).slice(0, 20).map((x) => <li key={x.id}><button type="button" className="flex min-h-11 w-full items-center gap-2 text-left" onClick={() => setCur(x)}><span className="text-xs text-muted">{x.createdAt.slice(5, 10)}</span><b className="text-xs">{({ day: "今日", week: "本周", session: "单课" })[x.kind]}</b><span className="flex-1 truncate">{x.verdict}</span>{x.feedback ? (x.feedback.vote === "up" ? "👍" : "👎") : null}{x.accepted ? <Check className="size-3.5 text-[#269775]" /> : null}</button></li>)}</ul></> : null}</div> : null}
  </section>
}
