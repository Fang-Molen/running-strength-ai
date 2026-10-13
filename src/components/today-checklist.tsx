import { useEffect, useMemo, useRef, useState } from "react"
import { Pause, Timer } from "lucide-react"
import { displayName, type Session } from "@/lib/strength/model"
import { STATE_LABELS, editSet, initChecklist, loadChecklist, progress, reconcile, saveChecklist, toggleMove, toggleSet, type ChecklistState, type StateTag } from "@/lib/ui/today-checklist"
import { SavedBadge } from "@/components/saved-badge"
import { syncChecklistToLog } from "@/lib/ui/checklist-log"

const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` }

export function TodayChecklist({ slotId, title: cardTitle, session, runTitle, onOpenRun, onOpenFull, onAskCoach, bare = false, onProgress }: { slotId?: string; title?: string; session: Session | undefined; runTitle: string | null; onOpenRun: () => void; onOpenFull: () => void; onAskCoach: () => void; bare?: boolean; onProgress?: (done: number, total: number) => void }) {
  const date = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }, [])
  const sid = slotId ?? session?.id ?? "none"
  const [logNote, setLogNote] = useState("")
  const [s, setS] = useState<ChecklistState | null>(null)
  const [stamp, setStamp] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const first = useRef(true)
  useEffect(() => {
    const fresh = initChecklist(date, sid, (session?.moves ?? []).map((m) => ({ id: m.id, sets: m.sets, amount: m.amount, weightKg: m.weightKg })), Boolean(runTitle))
    setS(reconcile(loadChecklist(window.localStorage, date, sid), fresh))
  }, [date, sid, session, runTitle])
  useEffect(() => { if (!s) return; if (first.current) { first.current = false; return } if (saveChecklist(window.localStorage, s)) setStamp(Date.now())
    const p0 = progress(s); onProgress?.(p0.done, p0.total)
    const t = window.setTimeout(() => { const r = syncChecklistToLog(s, cardTitle ?? session?.name ?? runTitle ?? "训练", Object.fromEntries((session?.moves ?? []).map((m) => [m.id, displayName(m)]))); setLogNote(r.ok ? "已同步到训练日志，方坤可见" : `日志未同步：${r.reason}`) }, 1200)
    return () => window.clearTimeout(t) }, [s])
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [])
  if (!s || (!session && !runTitle)) return null
  const p = progress(s)
  const rest = s.restEndsAt && s.restEndsAt > now ? s.restEndsAt - now : 0
  const upd = (next: ChecklistState) => setS(next)
  return <section aria-label="今日训练清单" className={bare ? "pt-1" : "home-card mb-3 px-3 py-3"}>
    {bare ? null : <div className="flex items-center justify-between gap-2 px-1">
      <div className="min-w-0"><p className="product-eyebrow">今日清单</p><h2 className="truncate text-lg font-bold">{session?.name ?? runTitle}</h2></div>
      <div className="flex flex-col items-end"><strong className="text-lg">{p.done}/{p.total}</strong><SavedBadge stamp={stamp} /></div>
    </div>}
    {bare ? <div className="flex items-center justify-between px-1 text-xs text-muted"><span>{p.done}/{p.total} 完成</span><SavedBadge stamp={stamp} /></div> : null}
    <div className="mx-1 mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-[#269775] transition-all" style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></div>
    {s.startedAt || rest ? <div className="fk-timer mt-3" aria-live="polite">
      <span className="flex items-center gap-1.5 text-sm"><Timer className="size-4" />{rest ? <>组间休息 <b className="text-lg tabular-nums">{mmss(rest)}</b></> : <>已练 <b className="tabular-nums">{mmss(now - (s.startedAt ?? now))}</b></>}</span>
      {rest ? <span className="flex gap-2"><button type="button" className="fk-chip" onClick={() => upd({ ...s, restEndsAt: (s.restEndsAt ?? now) + 30000, updatedAt: now })}>+30 秒</button><button type="button" className="fk-chip" onClick={() => upd({ ...s, restEndsAt: null, updatedAt: now })}><Pause className="size-3.5" />跳过</button></span> : null}
    </div> : null}
    <div className="mt-1 px-1">
      {s.run ? <div className="fk-check-row">
        <button type="button" className="fk-tick" aria-pressed={s.run.done} aria-label="完成跑步" onClick={() => upd({ ...s, run: { ...s.run!, done: !s.run!.done }, startedAt: s.startedAt ?? now, updatedAt: now })}>✓</button>
        <div className="min-w-0 flex-1"><p className="font-bold">{runTitle}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <label className="flex items-center gap-1">距离<input inputMode="decimal" value={s.run.km ?? ""} placeholder="km" onChange={(e) => upd({ ...s, run: { ...s.run!, km: e.target.value ? Number(e.target.value) : null }, updatedAt: now })} className="fk-cell w-16" /></label>
            <label className="flex items-center gap-1">配速<input value={s.run.pace} placeholder="5:30" onChange={(e) => upd({ ...s, run: { ...s.run!, pace: e.target.value.slice(0, 8) }, updatedAt: now })} className="fk-cell w-16" /></label>
            <button type="button" className="fk-link" onClick={onOpenRun}>分段记录 ›</button>
          </div></div>
      </div> : null}
      {(session?.moves ?? []).map((m) => {
        const sets = s.moves[m.id] ?? []
        const all = sets.length > 0 && sets.every((x) => x.done)
        return <div key={m.id} className="fk-check-row items-start">
          <button type="button" className="fk-tick mt-0.5" aria-pressed={all} aria-label={`完成${displayName(m)}全部组`} onClick={() => upd(toggleMove(s, m.id, Date.now()))}>✓</button>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2"><p className={"font-bold " + (all ? "text-muted line-through" : "")}>{displayName(m)}</p><button type="button" className="fk-link shrink-0 text-xs" onClick={() => setEditing(editing === m.id ? null : m.id)}>{editing === m.id ? "完成" : "改数"}</button></div>
            <p className="text-xs text-muted">{m.sets}×{m.amount}{m.mode === "seconds" ? "秒" : "次"}{m.weightKg ? ` · ${m.weightKg}kg` : ""}{m.restSec ? ` · 休 ${m.restSec}s` : ""}</p>
            <div className="fk-set-dots">{sets.map((x, i) => editing === m.id
              ? <span key={i} className="flex items-center gap-1 text-xs"><input inputMode="numeric" aria-label={`第${i + 1}组次数`} value={x.reps} onChange={(e) => upd(editSet(s, m.id, i, { reps: Number(e.target.value) || 0 }, Date.now()))} className="fk-cell w-11" />×<input inputMode="decimal" aria-label={`第${i + 1}组重量`} value={x.kg} onChange={(e) => upd(editSet(s, m.id, i, { kg: Number(e.target.value) || 0 }, Date.now()))} className="fk-cell w-12" />kg</span>
              : <button key={i} type="button" className="fk-set" aria-pressed={x.done} onClick={() => upd(toggleSet(s, m.id, i, Date.now(), m.restSec))}>{x.done ? "✓ " : ""}{x.reps}{x.kg ? `×${x.kg}` : ""}</button>)}</div>
          </div>
        </div>
      })}
    </div>
    <div className="mt-3 space-y-2 px-1">
      <div className="fk-chips" role="group" aria-label="今天状态">{(Object.keys(STATE_LABELS) as StateTag[]).map((k) => <button key={k} type="button" className="fk-chip" aria-pressed={s.state === k} onClick={() => upd({ ...s, state: s.state === k ? null : k, updatedAt: Date.now() })}>{STATE_LABELS[k]}</button>)}</div>
      <div className="fk-chips" role="group" aria-label="主观用力 RPE"><span className="self-center text-xs text-muted">RPE</span>{[5, 6, 7, 8, 9, 10].map((n) => <button key={n} type="button" className="fk-chip" aria-pressed={s.rpe === n} onClick={() => upd({ ...s, rpe: s.rpe === n ? null : n, updatedAt: Date.now() })}>{n}</button>)}</div>
      {s.state === "tired" || s.state === "short" ? <p className="text-xs text-muted">已标记“{STATE_LABELS[s.state]}”：这次只说明今天的状态，不会当成能力下降。</p> : null}
      {s.state === "pain" ? <p className="text-xs text-[var(--color-risk)]">有疼痛先停下该动作。<button type="button" className="fk-link" onClick={onAskCoach}>告诉方坤部位 ›</button></p> : null}
      {logNote ? <p className="text-xs text-muted">{logNote}</p> : null}
      <button type="button" className="fk-link text-sm" onClick={onOpenFull}>逐组详细记录（含疼痛部位）›</button>
    </div>
  </section>
}
