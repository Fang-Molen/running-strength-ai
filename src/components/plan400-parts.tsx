/* v79：V4 组合课分项反馈（fk-plan400-v4-components-v1）+ 跑步分项 ↔ 手表跑步关联 + 导入后弹窗。 */
import { useEffect, useState } from "react"
import { loadComponents, saveComponent, markPrompted, hasFeedback, STATUS_TEXT, COMPONENTS_EVT, type CompStatus, type PartFeedback, type DayComponents } from "@/lib/ui/plan400-components-store"
import { saveRunLink, planVsActual, v4RunSlotId, allRunLinks, type RunLink } from "@/lib/ui/run-link"
import { lastRunMatch, loadRunMatch, type ActivityRow } from "@/lib/ui/training-read-model"
const hm = (iso: string) => { try { return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }) } catch { return "" } }
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
export function useV4RunLink(date: string): { link: RunLink | null; candidates: ActivityRow[] } {
  const m = useRunMatch(), id = v4RunSlotId(date)
  return { link: m.links.find(l => l.entry.id === id) ?? null, candidates: m.suggestions.find(s => s.entry.id === id)?.runs ?? [] }
}
/** 跑步部分：关联状态 + 计划 vs 实际；歧义时“是这次吗？” */
export function RunLinkPanel({ date, fallback }: { date: string; fallback: React.ReactNode }) {
  const { link, candidates } = useV4RunLink(date)
  if (link) { const c = planVsActual(link.entry, link.run)
    return <div className="rounded-xl border border-line p-2.5 text-xs leading-5" data-testid="v4-run-link">
      <p className="keep"><b>已关联佳明跑步</b>{link.by === "auto" ? "（同一天只有这一条，自动关联）" : "（你确认的）"}：{link.run.title || "跑步"} · {hm(link.run.startedAt)}</p>
      <p className="keep">实际 {c.actual}</p>
      <p className="keep text-muted">这是同一条记录：日志/复盘/方坤只算一次；力量部分不会因此算完成。</p>
      <button type="button" className="mt-1 min-h-9 font-bold text-accent underline" onClick={() => saveRunLink(link.entry.id, { rejected: [...(allRunLinks()[link.entry.id]?.rejected ?? []), link.run.id] })}>取消关联</button>
    </div> }
  if (candidates.length) return <div className="space-y-1 rounded-xl border border-warn/50 p-2.5 text-xs" data-testid="v4-run-suggest">
    <p className="keep font-bold">是这次吗？{candidates.length > 1 ? `（${candidates.length} 条，选一条）` : ""}</p>
    {candidates.map(r => <p key={r.id} className="keep flex items-center justify-between gap-2"><span>{r.date.slice(5)} {hm(r.startedAt)} · {r.title || "跑步"} · {km(r.distanceM)}{r.durationSec ? ` · ${Math.round(r.durationSec / 60)} 分钟` : ""}</span>
      <button type="button" className="fk-chip min-h-9" onClick={() => saveRunLink(v4RunSlotId(date), { garminId: r.id, by: "user" })}>是，关联</button></p>)}
  </div>
  return <>{fallback}</>
}
const STATUSES: [CompStatus, string][] = [["done", "完成"], ["reduced", "减量完成"], ["skipped", "跳过这项"]]
/** 一个分项的评价：状态 / RPE / 疼痛 / 感受 / 备注；改已有值留修改记录。 */
export function PartFeedbackForm({ date, part, name }: { date: string; part: "running" | "strength"; name: string }) {
  const parts = useParts(date), cur: PartFeedback = (parts?.[part] as PartFeedback | undefined) ?? {}
  const [f, setF] = useState({ status: cur.status ?? "", rpe: cur.rpe != null ? String(cur.rpe) : "", area: cur.pain?.area ?? "", score: cur.pain?.score != null ? String(cur.pain.score) : "", feel: cur.feel ?? "", note: cur.note ?? "" })
  useEffect(() => { setF({ status: cur.status ?? "", rpe: cur.rpe != null ? String(cur.rpe) : "", area: cur.pain?.area ?? "", score: cur.pain?.score != null ? String(cur.pain.score) : "", feel: cur.feel ?? "", note: cur.note ?? "" }) }, [cur.savedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const [msg, setMsg] = useState("")
  const num = (v: string, lo: number, hi: number) => { const n = Number(v); return v.trim() && Number.isFinite(n) && n >= lo && n <= hi ? n : null }
  const save = () => {
    const rpe = num(f.rpe, 1, 10), score = num(f.score, 0, 10)
    if (f.rpe.trim() && rpe == null) { setMsg("RPE 要在 1–10 之间"); return }
    const ok = saveComponent(date, part, { status: (f.status || undefined) as CompStatus | undefined, rpe, pain: f.area.trim() || score != null ? { area: f.area.trim(), score } : null, feel: f.feel.trim(), note: f.note.trim() })
    setMsg(ok ? `${name}已保存（只改${name}，另一项不动）` : "没有保存成功，原记录未改变")
  }
  const inp = "mt-0.5 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base"
  return <section className="home-card space-y-2 p-4" aria-label={`${name}评价`} data-testid={`part-${part}`}>
    <h3 className="font-bold">{name}评价</h3>
    <div className="grid grid-cols-3 gap-2" role="group" aria-label={`${name}状态`}>{STATUSES.map(([v, t]) => <button key={v} type="button" aria-pressed={f.status === v} onClick={() => setF({ ...f, status: f.status === v ? "" : v })} className={"min-h-11 rounded-xl border text-sm font-bold " + (f.status === v ? "border-accent bg-accent/15 text-accent" : "border-line")}>{t}</button>)}</div>
    <label className="block"><span className="text-xs text-muted">{name} RPE（1–10，只算{name}）</span><input inputMode="numeric" aria-label={`${name} RPE`} className={inp} value={f.rpe} onChange={e => setF({ ...f, rpe: e.target.value })} /></label>
    <div className="grid grid-cols-2 gap-2"><label className="block"><span className="text-xs text-muted">疼痛部位</span><input aria-label={`${name}疼痛部位`} className={inp} value={f.area} onChange={e => setF({ ...f, area: e.target.value })} /></label><label className="block"><span className="text-xs text-muted">疼痛 0–10</span><input inputMode="numeric" aria-label={`${name}疼痛分数`} className={inp} value={f.score} onChange={e => setF({ ...f, score: e.target.value })} /></label></div>
    <label className="block"><span className="text-xs text-muted">感受</span><input aria-label={`${name}感受`} className={inp} value={f.feel} onChange={e => setF({ ...f, feel: e.target.value })} /></label>
    <label className="block"><span className="text-xs text-muted">备注</span><input aria-label={`${name}备注`} className={inp} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
    <button type="button" className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={save}>保存{name}评价</button>
    {msg ? <p role="status" className="keep text-xs">{msg}</p> : cur.savedAt ? <p className="keep text-xs text-muted">上次保存 {cur.savedAt.slice(5, 16).replace("T", " ")}{cur.status ? ` · ${STATUS_TEXT[cur.status]}` : ""}</p> : null}
    {cur.corrections?.length ? <details className="text-xs" data-testid={`corrections-${part}`}><summary className="min-h-9 cursor-pointer text-muted">修改记录 · {cur.corrections.length} 次</summary><ul>{cur.corrections.map((c, i) => <li key={i} className="keep">{c.at.slice(5, 16).replace("T", " ")} {LABEL[c.field] ?? c.field}：{show(c.from)} → {show(c.to)}</li>)}</ul></details> : null}
  </section>
}
const LABEL: Record<string, string> = { status: "状态", rpe: "RPE", pain: "疼痛", feel: "感受", note: "备注", device: "关联的手表跑步" }
const show = (v: unknown) => v == null || v === "" ? "空" : typeof v === "object" ? [(v as { area?: string }).area, (v as { score?: number | null }).score].filter(x => x != null && x !== "").join(" ") || "空" : STATUS_TEXT[v as CompStatus] ?? String(v)
export function RecoveryParts({ date, late }: { date: string; late: boolean }) {
  const parts = useParts(date), r = parts?.recovery ?? {}
  const [f, setF] = useState({ runLegs24: r.runLegs24 ?? "", runLegs48: r.runLegs48 ?? "", strengthSoreness24: r.strengthSoreness24 ?? "", strengthSoreness48: r.strengthSoreness48 ?? "" })
  const [msg, setMsg] = useState("")
  const F: [keyof typeof f, string][] = [["runLegs24", "24h 跑步腿感（沉/正常/轻快）"], ["strengthSoreness24", "24h 力量酸痛（部位·0–10）"], ["runLegs48", "48–72h 跑步腿感"], ["strengthSoreness48", "48–72h 力量酸痛"]]
  return <section className="home-card space-y-2 p-4" aria-label="分项恢复" data-testid="part-recovery">
    <h3 className="font-bold">跑步、力量分开的恢复</h3>
    {F.map(([k, l]) => <label key={k} className="block"><span className="text-xs text-muted">{l}</span><input aria-label={l} className="mt-0.5 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base" placeholder="没感觉就留空" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>)}
    <button type="button" className="min-h-12 w-full rounded-xl border border-accent font-bold text-accent" onClick={() => setMsg(saveComponent(date, "recovery", { ...f, late }) ? "已保存分项恢复" : "没有保存成功")}>保存分项恢复</button>
    {msg ? <p role="status" className="keep text-xs">{msg}</p> : null}
  </section>
}
/** 导入/同步到一条关联到 V4 跑步部分的手表跑步后弹一次：立即填跑步评价 / 力量另行记录 / 稍后。 */
export function RunImportPrompt({ today }: { today: string }) {
  const m = useRunMatch(), [open, setOpen] = useState<RunLink | null>(null), [fill, setFill] = useState(false)
  useEffect(() => {
    if (open) return
    const doc = loadComponents(), seen = new Set(doc.prompted ?? [])
    const due = m.links.find(l => l.entry.id.startsWith("plan400:") && !seen.has(`${l.entry.date}|${l.run.id}`) && !hasFeedback(doc.days[l.entry.date]?.running) && Date.parse(today) - Date.parse(l.entry.date) <= 3 * 864e5)
    if (due) setOpen(due)
  }, [m, today, open])
  if (!open) return null
  const done = () => { markPrompted(`${open.entry.date}|${open.run.id}`); setOpen(null); setFill(false) }
  const c = planVsActual(open.entry, open.run)
  return <div className="fixed inset-0 z-[60] flex items-end bg-black/50" role="dialog" aria-label="手表跑步已导入" data-testid="run-import-prompt">
    <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-bg p-4">
      <p className="font-bold">佳明跑步已关联到 {open.entry.date.slice(5)}「{open.entry.title}」</p>
      <p className="keep text-xs text-muted">实际 {c.actual}。只关联跑步部分；力量部分不会因此算完成。</p>
      {fill ? <><PartFeedbackForm date={open.entry.date} part="running" name="跑步" /><button type="button" className="mt-2 min-h-11 w-full rounded-xl border border-line font-bold" onClick={done}>完成</button></> :
        <div className="mt-3 grid gap-2">
          <button type="button" className="min-h-12 rounded-xl bg-accent font-bold text-accent-fg" onClick={() => setFill(true)}>立即填跑步评价</button>
          <button type="button" className="min-h-12 rounded-xl border border-accent font-bold text-accent" onClick={() => { done(); window.dispatchEvent(new CustomEvent("fk-open-plan400-day", { detail: { date: open.entry.date, tab: "during" } })) }}>力量另行记录</button>
          <button type="button" className="min-h-12 rounded-xl border border-line font-bold" onClick={done}>稍后</button>
        </div>}
    </div>
  </div>
}
