import { stampCN, activityLocalDay } from "@/lib/ui/activity-format";
/* v79：V4 组合课分项反馈（fk-plan400-v4-components-v1）+ 跑步分项 ↔ 手表跑步关联 + 导入后弹窗。 */
import { useEffect, useState } from "react"
import { loadComponents, saveComponent, markPrompted, hasFeedback, STATUS_TEXT, COMPONENTS_EVT, type CompStatus, type PartFeedback, type DayComponents } from "@/lib/ui/plan400-components-store"
import { saveRunLink, planVsActual, v4RunSlotId, allRunLinks, type RunLink } from "@/lib/ui/run-link"
import { lastRunMatch, loadRunMatch, type ActivityRow } from "@/lib/ui/training-read-model"
import type { DayParts, V4Day, V4Log } from "@/lib/ui/plan400-view"
import { pendingFeedback, partRated, type PendingItem } from "@/lib/ui/pending-feedback"
import { loadSchedule } from "@/lib/ui/day-schedule"
import { v4MovedOut } from "@/lib/ui/v4-effective-move"
import V4Json from "../lib/plan400-v4.json" with { type: "json" }
const hm = (iso: string) => stampCN(iso, "hm")
const km = (m: number | null) => m != null ? `${(m / 1000).toFixed(2)} km` : ""
export function useParts(date: string): DayComponents | undefined {
  const [v, setV] = useState<DayComponents | undefined>(() => loadComponents().days[date])
  useEffect(() => { const f = () => setV(loadComponents().days[date]); f(); window.addEventListener(COMPONENTS_EVT, f); window.addEventListener("storage", f); return () => { window.removeEventListener(COMPONENTS_EVT, f); window.removeEventListener("storage", f) } }, [date])
  return v
}
export function useRunMatch(): ReturnType<typeof lastRunMatch> {
  const [m, setM] = useState(() => { try { return loadRunMatch() } catch { return lastRunMatch() } })
  useEffect(() => { const f = () => { try { setM(loadRunMatch()) } catch { /* keep */ } }; const ns = ["fk-run-links", COMPONENTS_EVT, "fk-training-activities-changed", "fk-garmin-synced"]; ns.forEach(n => window.addEventListener(n, f)); return () => ns.forEach(n => window.removeEventListener(n, f)) }, [])
  return m
}
/** 整个周期的分项输入（分项反馈 + 已确认关联 + 同日候选 + 逐组/逐段执行），来自读模型同一次计算：计划列表 / 首页主卡 / 进度计数 / 日志共用。 */
export function usePartsAll(): Record<string, DayParts> {
  const m = useRunMatch(), [doc, setDoc] = useState(() => loadComponents())
  useEffect(() => { const f = () => setDoc(loadComponents()); window.addEventListener(COMPONENTS_EVT, f); window.addEventListener("storage", f); return () => { window.removeEventListener(COMPONENTS_EVT, f); window.removeEventListener("storage", f) } }, [])
  const out: Record<string, DayParts> = { ...(m.v4Parts ?? {}) }
  // 分项反馈刚保存、读模型还没刷新时，以最新分项为准（其余输入沿用）
  for (const [d, c] of Object.entries(doc.days)) out[d] = { ...(out[d] ?? {}), parts: c }
  return out
}
export function useV4RunLink(date: string): { link: RunLink | null; candidates: ActivityRow[] } {
  const m = useRunMatch(), id = v4RunSlotId(date)
  return { link: m.links.find(l => l.entry.id === id) ?? null, candidates: m.suggestions.find(s => s.entry.id === id)?.runs ?? [] }
}
/** 跑步部分：关联状态 + 计划 vs 实际；歧义时“是这次吗？” */
export function RunLinkPanel({ date, fallback }: { date: string; fallback: React.ReactNode }) {
  const { link, candidates } = useV4RunLink(date), m0 = useRunMatch()
  if (link) { const c = planVsActual(link.entry, link.run)
    return <div className="rounded-xl border border-line p-2.5 text-xs leading-5" data-testid="v4-run-link">
      <p className="keep"><b>已关联佳明跑步</b>{link.by === "auto" ? "（旧版本自动关联的；不对就点“取消关联”）" : "（你确认的）"}：{link.run.title || "跑步"} · {hm(link.run.startedAt)}</p>
      <p className="keep">实际 {c.actual}</p>
      <p className="keep text-muted">这是同一条记录：日志/复盘/方坤只算一次；力量部分不会因此算完成。</p>
      <button type="button" className="mt-1 min-h-9 font-bold text-accent underline" onClick={() => saveRunLink(link.entry.id, { rejected: [...(allRunLinks()[link.entry.id]?.rejected ?? []), link.run.id] })}>取消关联</button>
    </div> }
  if (candidates.length) { const sug = m0.suggestions.find(x => x.entry.id === v4RunSlotId(date))
    const reject = (id: string) => saveRunLink(v4RunSlotId(date), { rejected: [...(allRunLinks()[v4RunSlotId(date)]?.rejected ?? []), id] })
    return <div className="space-y-1 rounded-xl border border-warn/50 p-2.5 text-xs" data-testid="v4-run-suggest">
    <p className="keep font-bold">{sug?.likely ? "很可能是这条手表跑步，确认一下" : "是这次吗？"}{candidates.length > 1 ? `（${candidates.length} 条，选一条）` : ""}</p>
    {sug?.basis ? <p className="keep text-muted">依据：{sug.basis}。确认前不算关联，也不算跑步完成。</p> : null}
    {candidates.map(r => <div key={r.id} className="keep flex flex-wrap items-center justify-between gap-2"><span>{r.date.slice(5)} {hm(r.startedAt)} · {r.title || "跑步"} · {km(r.distanceM)}{r.durationSec ? ` · ${Math.round(r.durationSec / 60)} 分钟` : ""}</span>
      <span className="flex gap-1"><button type="button" className="fk-chip min-h-9" onClick={() => saveRunLink(v4RunSlotId(date), { garminId: r.id, by: "user" })}>是，关联</button><button type="button" className="fk-chip min-h-9" onClick={() => reject(r.id)}>不是这节</button></span></div>)}
  </div> }
  return <>{fallback}</>
}
const STATUSES: [CompStatus, string][] = [["done", "完成"], ["reduced", "减量完成"], ["skipped", "跳过这项"]]
/** 一个分项的评价：状态 / RPE / 疼痛 / 感受 / 备注；改已有值留修改记录。 */
export function PartFeedbackForm({ date, part, name }: { date: string; part: "running" | "strength"; name: string }) {
  const parts = useParts(date), cur: PartFeedback = (parts?.[part] as PartFeedback | undefined) ?? {}
  const [f, setF] = useState({ status: cur.status ?? "", rpe: cur.rpe != null ? String(cur.rpe) : "", area: cur.pain?.area ?? "", score: cur.pain?.score != null ? String(cur.pain.score) : "", feel: cur.feel ?? "", note: cur.note ?? "" })
  useEffect(() => { setF({ status: cur.status ?? "", rpe: cur.rpe != null ? String(cur.rpe) : "", area: cur.pain?.area ?? "", score: cur.pain?.score != null ? String(cur.pain.score) : "", feel: cur.feel ?? "", note: cur.note ?? "" }) }, [cur.savedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const [msg, setMsg] = useState("")
  // v87.2：过了计划日才记的，可以写实际哪天练的（补练）；记录与周统计按实际日期算，计划这天显示“补练于…”
  const todayL = activityLocalDay(new Date().toISOString()) ?? "", past = !!todayL && date < todayL
  const [on, setOn] = useState(cur.doneOn || date)
  useEffect(() => { setOn(cur.doneOn || date) }, [cur.savedAt, date]) // eslint-disable-line react-hooks/exhaustive-deps
  const num = (v: string, lo: number, hi: number) => { const n = Number(v); return v.trim() && Number.isFinite(n) && n >= lo && n <= hi ? n : null }
  const save = () => {
    const rpe = num(f.rpe, 1, 10), score = num(f.score, 0, 10)
    if (f.rpe.trim() && rpe == null) { setMsg("RPE 要在 1–10 之间"); return }
    if (past && (!/^\d{4}-\d\d-\d\d$/.test(on) || on > todayL)) { setMsg("实际日期不能晚于今天"); return }
    const ok = saveComponent(date, part, { ...(past || cur.doneOn ? { doneOn: past && on !== date ? on : "" } : {}), status: (f.status || undefined) as CompStatus | undefined, rpe, pain: f.area.trim() || score != null ? { area: f.area.trim(), score } : null, feel: f.feel.trim(), note: f.note.trim() })
    setMsg(ok ? `${name}已保存（只改${name}，另一项不动）` : "没有保存成功，原记录未改变")
  }
  const inp = "mt-0.5 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base"
  return <section className="home-card space-y-2 p-4" aria-label={`${name}评价`} data-testid={`part-${part}`}>
    <h3 className="font-bold">{name}评价</h3>
    <div className="grid grid-cols-3 gap-2" role="group" aria-label={`${name}状态`}>{STATUSES.map(([v, t]) => <button key={v} type="button" aria-pressed={f.status === v} onClick={() => setF({ ...f, status: f.status === v ? "" : v })} className={"min-h-11 rounded-xl border text-sm font-bold " + (f.status === v ? "border-accent bg-accent/15 text-accent" : "border-line")}>{t}</button>)}</div>
    {past ? <div className="space-y-1" data-testid={`doneon-${part}`}><span className="text-xs text-muted">{name}实际哪天练的（补练就选那天）</span>
      <div className="grid grid-cols-3 gap-2"><button type="button" aria-pressed={on === date} className={"min-h-11 rounded-xl border text-sm font-bold " + (on === date ? "border-accent bg-accent/15 text-accent" : "border-line")} onClick={() => setOn(date)}>计划当天</button><button type="button" aria-pressed={on === todayL} className={"min-h-11 rounded-xl border text-sm font-bold " + (on === todayL ? "border-accent bg-accent/15 text-accent" : "border-line")} onClick={() => setOn(todayL)}>今天补练</button><input type="date" aria-label={`${name}实际日期`} className="min-h-11 rounded-xl border border-line bg-surface px-1 text-sm" min={date} max={todayL} value={on} onChange={e => setOn(e.target.value)} /></div>
      <p className="keep text-xs text-muted">有逐组/手表记录的，以记录的时间为准。</p></div> : null}
    <label className="block"><span className="text-xs text-muted">{name} RPE（1–10，只算{name}）</span><input inputMode="numeric" aria-label={`${name} RPE`} className={inp} value={f.rpe} onChange={e => setF({ ...f, rpe: e.target.value })} /></label>
    <div className="grid grid-cols-2 gap-2"><label className="block"><span className="text-xs text-muted">疼痛部位</span><input aria-label={`${name}疼痛部位`} className={inp} value={f.area} onChange={e => setF({ ...f, area: e.target.value })} /></label><label className="block"><span className="text-xs text-muted">疼痛 0–10</span><input inputMode="numeric" aria-label={`${name}疼痛分数`} className={inp} value={f.score} onChange={e => setF({ ...f, score: e.target.value })} /></label></div>
    <details className="rounded-xl border border-line px-3 py-2" open={!!(cur.feel || cur.note) || undefined} data-testid={`part-${part}-more`}>
      <summary className="min-h-9 cursor-pointer text-sm text-muted">更多反馈（感受、备注，可选）</summary>
      <div className="mt-2 space-y-2">
        <label className="block"><span className="text-xs text-muted">感受</span><input aria-label={`${name}感受`} className={inp} value={f.feel} onChange={e => setF({ ...f, feel: e.target.value })} /></label>
        <label className="block"><span className="text-xs text-muted">备注</span><input aria-label={`${name}备注`} className={inp} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
      </div>
    </details>
    <button type="button" className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={save}>保存{name}评价</button>
    {msg ? <p role="status" className="keep text-xs">{msg}</p> : cur.savedAt ? <p className="keep text-xs text-muted">上次保存 {stampCN(cur.savedAt)}{cur.status ? ` · ${STATUS_TEXT[cur.status]}` : ""}</p> : null}
    {cur.corrections?.length ? <details className="text-xs" data-testid={`corrections-${part}`}><summary className="min-h-9 cursor-pointer text-muted">修改记录 · {cur.corrections.length} 次</summary><ul>{cur.corrections.map((c, i) => <li key={i} className="keep">{stampCN(c.at)} {LABEL[c.field] ?? c.field}：{show(c.from)} → {show(c.to)}</li>)}</ul></details> : null}
  </section>
}
const LABEL: Record<string, string> = { doneOn: "实际日期", status: "状态", rpe: "RPE", pain: "疼痛", feel: "感受", note: "备注", device: "关联的手表跑步" }
const show = (v: unknown) => v == null || v === "" ? "空" : typeof v === "object" ? [(v as { area?: string }).area, (v as { score?: number | null }).score].filter(x => x != null && x !== "").join(" ") || "空" : STATUS_TEXT[v as CompStatus] ?? String(v)
export function RecoveryParts({ date, late, daysSince = 3 }: { date: string; late: boolean; daysSince?: number }) {
  const parts = useParts(date), r = parts?.recovery ?? {}
  const [f, setF] = useState({ runLegs24: r.runLegs24 ?? "", runLegs48: r.runLegs48 ?? "", strengthSoreness24: r.strengthSoreness24 ?? "", strengthSoreness48: r.strengthSoreness48 ?? "" })
  const [msg, setMsg] = useState("")
  const F: [keyof typeof f, string][] = [["runLegs24", "24h 跑步腿感（沉/正常/轻快）"], ["strengthSoreness24", "24h 力量酸痛（部位·0–10）"], ["runLegs48", "48–72h 跑步腿感"], ["strengthSoreness48", "48–72h 力量酸痛"]]
  return <section className="home-card space-y-2 p-4" aria-label="分项恢复" data-testid="part-recovery">
    <h3 className="font-bold">跑步、力量分开的恢复</h3>
    {daysSince < 2 ? <p className="keep text-xs text-muted">48–72 小时的感觉到后天再填（现在填的只是 24 小时）。</p> : null}
    {F.filter(([k]) => daysSince >= 2 || !/48/.test(k) || !!f[k]).map(([k, l]) => <label key={k} className="block"><span className="text-xs text-muted">{l}</span><input aria-label={l} className="mt-0.5 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base" placeholder="没感觉就留空" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>)}
    <button type="button" className="min-h-12 w-full rounded-xl border border-accent font-bold text-accent" onClick={() => setMsg(saveComponent(date, "recovery", { ...f, late }) ? "已保存分项恢复" : "没有保存成功")}>保存分项恢复</button>
    {msg ? <p role="status" className="keep text-xs">{msg}</p> : null}
  </section>
}
/**
 * 导入/同步手表跑步后弹一次（v83 P1-07）：
 * - 同日候选（未确认）→ 关联到这节课 / 不是这节课（作为计划外保留） / 稍后；
 * - 已关联但没评价 → 立即填跑步评价 / 力量另行记录 / 稍后。
 * “稍后”只是不再弹窗：这一项留在日志顶部“待补反馈”里，填完评价或做了确认才消失。
 */
export function RunImportPrompt({ today }: { today: string }) {
  const m = useRunMatch()
  const [open, setOpen] = useState<{ kind: "link"; l: RunLink } | { kind: "cand"; entry: RunLink["entry"]; run: ActivityRow; basis?: string } | null>(null), [fill, setFill] = useState(false)
  useEffect(() => {
    if (open) return
    const doc = loadComponents(), seen = new Set(doc.prompted ?? [])
    const recent = (d: string) => Date.parse(today) - Date.parse(d) <= 3 * 864e5 && d <= today
    let logs: Record<string, V4Log> = {}; try { logs = JSON.parse(localStorage.getItem("fk-plan400-v4-log") || "{}") ?? {} } catch { logs = {} }
    const rated = (date: string) => { const d = (V4Json as { days: V4Day[] }).days.find(x => x.date === date); return d ? partRated(d, { parts: doc.days[date] }, logs[date], "running") : hasFeedback(doc.days[date]?.running) }
    const due = m.links.find(l => l.entry.id.startsWith("plan400:") && !seen.has(`${l.entry.date}|${l.run.id}`) && !rated(l.entry.date) && recent(l.entry.date))
    if (due) { setOpen({ kind: "link", l: due }); return }
    const cand = m.suggestions.find(x => x.entry.id.startsWith("plan400:") && x.runs.length === 1 && x.runs[0].date === x.entry.date && !seen.has(`${x.entry.date}|${x.runs[0].id}`) && recent(x.entry.date))
    if (cand) setOpen({ kind: "cand", entry: cand.entry, run: cand.runs[0], basis: cand.basis })
  }, [m, today, open])
  if (!open) return null
  const date = open.kind === "link" ? open.l.entry.date : open.entry.date, run = open.kind === "link" ? open.l.run : open.run
  const later = () => { markPrompted(`${date}|${run.id}`); setOpen(null); setFill(false) }
  if (open.kind === "cand") {
    const c = planVsActual(open.entry, open.run)
    return <div className="fixed inset-0 z-[60] flex items-end bg-black/50" role="dialog" aria-label="同日手表跑步待确认" data-testid="run-candidate-prompt">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-bg p-4">
        <p className="font-bold">这条手表跑步是 {date.slice(5)}「{open.entry.title}」的跑步部分吗？</p>
        <p className="keep text-xs text-muted">{run.title || "跑步"} · {hm(run.startedAt)} · 实际 {c.actual}{open.basis ? `。依据：${open.basis}` : ""}。确认前不算关联、不算跑步完成。</p>
        <div className="mt-3 grid gap-2">
          <button type="button" className="min-h-12 rounded-xl bg-accent font-bold text-accent-fg" onClick={() => { saveRunLink(v4RunSlotId(date), { garminId: run.id, by: "user" }); markPrompted(`${date}|${run.id}`); setOpen(null) }}>关联到这节课</button>
          <button type="button" className="min-h-12 rounded-xl border border-line font-bold" onClick={() => { saveRunLink(v4RunSlotId(date), { rejected: [...(allRunLinks()[v4RunSlotId(date)]?.rejected ?? []), run.id] }); markPrompted(`${date}|${run.id}`); setOpen(null) }}>不是这节课（作为计划外保留）</button>
          <button type="button" className="min-h-12 rounded-xl border border-line font-bold" onClick={later}>稍后（留在待补里）</button>
        </div>
      </div>
    </div>
  }
  const c = planVsActual(open.l.entry, open.l.run)
  return <div className="fixed inset-0 z-[60] flex items-end bg-black/50" role="dialog" aria-label="手表跑步已导入" data-testid="run-import-prompt">
    <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-bg p-4">
      <p className="font-bold">佳明跑步已关联到 {date.slice(5)}「{open.l.entry.title}」</p>
      <p className="keep text-xs text-muted">实际 {c.actual}。只关联跑步部分；力量部分不会因此算完成。</p>
      {fill ? <><PartFeedbackForm date={date} part="running" name="跑步" /><button type="button" className="mt-2 min-h-11 w-full rounded-xl border border-line font-bold" onClick={later}>完成</button></> :
        <div className="mt-3 grid gap-2">
          <button type="button" className="min-h-12 rounded-xl bg-accent font-bold text-accent-fg" onClick={() => setFill(true)}>立即填跑步评价</button>
          <button type="button" className="min-h-12 rounded-xl border border-accent font-bold text-accent" onClick={() => { later(); window.dispatchEvent(new CustomEvent("fk-open-plan400-day", { detail: { date, tab: "during" } })) }}>力量另行记录</button>
          <button type="button" className="min-h-12 rounded-xl border border-line font-bold" onClick={later}>稍后（留在待补里）</button>
        </div>}
    </div>
  </div>
}
/** v83（P1-07 / P1-04）：待补反馈（由事实推出；稍后过的也在这里）。点一项打开当天对应页。 */
export function PendingFeedbackList({ today, compact = false }: { today: string; compact?: boolean }) {
  const parts = usePartsAll(), [logs, setLogs] = useState<Record<string, V4Log>>({}), [prompted, setPrompted] = useState<string[]>([])
  const [movedDates, setMovedDates] = useState<Set<string>>(new Set())
  useEffect(() => { const f = () => { try { setLogs(JSON.parse(localStorage.getItem("fk-plan400-v4-log") || "{}") ?? {}) } catch { setLogs({}) } setPrompted(loadComponents().prompted ?? [])
      // v88（R1 改期）：原日期已改期 → 不在原日期催评分（有真实训练除外）
      try { const sch = loadSchedule().entries; setMovedDates(new Set((V4Json as { days: V4Day[] }).days.filter(d => !!v4MovedOut(d.date, sch)).map(d => d.date))) } catch { setMovedDates(new Set()) } }; f()
    const ns = ["fk-plan400-changed", COMPONENTS_EVT, "fk-schedule-changed", "storage"]; ns.forEach(n => window.addEventListener(n, f)); return () => ns.forEach(n => window.removeEventListener(n, f)) }, [])
  const items = today ? pendingFeedback((V4Json as { days: V4Day[] }).days, parts, logs, today, prompted, 14, movedDates) : []
  if (!items.length) return null
  const open = (it: PendingItem) => window.dispatchEvent(new CustomEvent("fk-open-plan400-day", { detail: { date: it.date, tab: it.kind === "confirm_run" ? "during" : "after" } }))
  if (compact) return <button type="button" className="mt-1 min-h-11 text-sm text-warn" data-testid="pending-feedback-compact" onClick={() => open(items[0])}>待补反馈 {items.length} 项 ›</button>
  return <section className="home-card mb-3 p-3" aria-label="待补反馈" data-testid="pending-feedback">
    <p className="text-sm font-bold">待补反馈 · {items.length} 项</p>
    <ul className="mt-1 divide-y divide-line">{items.map(it => <li key={`${it.date}|${it.kind}`}><button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm" onClick={() => open(it)}><span className="min-w-0"><b>{Number(it.date.slice(5, 7))}月{Number(it.date.slice(8, 10))}日</b> {it.text}{it.deferred ? <span className="text-xs text-muted">（你点过稍后）</span> : null}</span><span className="shrink-0 text-accent">去补 ›</span></button></li>)}</ul>
  </section>
}
