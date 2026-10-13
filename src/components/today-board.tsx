import { useEffect, useMemo, useState } from "react"
import { Bot, Check, ChevronDown, Dumbbell, Footprints, Pencil, Plus, RefreshCw, TriangleAlert, X } from "lucide-react"
import type { Plan, Session } from "@/lib/strength/model"
import type { RunningPlan } from "@/lib/core/running-plan"
import { REASON_LABELS, SWAP_LABELS, applyAction, findConflicts, logActual, review, swapProposal, weekOf, weekSummary, type Conflict, type ConflictAction, type DeviationReason, type Intensity, type ScheduleEntry, type SwapReason } from "@/lib/ui/day-schedule-rules"
import { classifyRun, classifyStrength, loadSchedule, proposeWeek, readRecovery, runEntry, saveSchedule, strengthEntry, syncFangkun, type ScheduleStore } from "@/lib/ui/day-schedule"
import { syncActualToLog } from "@/lib/ui/checklist-log"
import { PARTS, injuryAdvice, loadInjury, needsInjuryAsk, saveInjury, type Injury, type InjuryStore, type Part } from "@/lib/ui/injury"
import { displayName } from "@/lib/strength/model"
import { EnergyGauge } from "@/components/energy-gauge"
import { BAND_COLOR, applyOverride, planBand, type Band, type Override } from "@/lib/ui/day-override"
import { TodayChecklist } from "@/components/today-checklist"
import { SavedBadge } from "@/components/saved-badge"

const WD = ["一", "二", "三", "四", "五", "六", "日"]
const INT: Record<Intensity, string> = { EASY: "轻松", MODERATE: "中等", HARD: "高强度" }
const ACT: Record<ConflictAction, string> = { postpone: "顺延一天", reduce: "降强度", keepOne: "仅保留一个", ack: "我知道了" }
const dot = (e: ScheduleEntry) => e.modality === "run" ? "bg-[#2182bd]" : "bg-[#d07a2b]"
const shown = (e: ScheduleEntry) => e.status !== "rejected"

export function TodayBoard({ plan, runPlans, today, onOpenRun, onOpenLift, onAskCoach, onFood, revision = 0, override = null, band = true }: { plan: Plan; runPlans: RunningPlan[]; today: string; onOpenRun: (planId: string) => void; onOpenLift: (sessionId: string) => void; onAskCoach: () => void; onFood?: () => void; revision?: number; override?: Override | null; band?: boolean }) {
  const [store, setStore] = useState<ScheduleStore>({ entries: [], acks: [] })
  const [day, setDay] = useState(today)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [stamp, setStamp] = useState(0)
  const [note, setNote] = useState("")
  useEffect(() => { const s = syncFangkun(loadSchedule()); setStore(s); saveSchedule(s) }, [revision])
  useEffect(() => { setDay(today) }, [today])
  const week = useMemo(() => weekOf(day || today), [day, today])
  const conflicts = useMemo(() => findConflicts(store.entries, week, today, readRecovery(today), store.acks), [store, week, today])
  const summary = useMemo(() => weekSummary(store.entries, week, today), [store, week, today])
  const commit = (next: ScheduleStore) => { setStore(next); if (saveSchedule(next)) setStamp(Date.now()) }
  const setEntries = (entries: ScheduleEntry[]) => commit({ ...store, entries })
  const act = (c: Conflict, a: ConflictAction) => commit(a === "ack" ? { ...store, acks: [...store.acks, c.id] } : { ...store, entries: applyAction(store.entries, c, a) })
  const sessionOf = (e: ScheduleEntry) => e.modality === "strength" ? plan.sessions.find((s) => s.id === e.refId) : undefined
  const saveActual = (e: ScheduleEntry, actual: Parameters<typeof logActual>[2]) => {
    const entries = logActual(store.entries, e.id, actual); setEntries(entries)
    const r = syncActualToLog(entries.find((x) => x.id === e.id)!, sessionOf(e)); setNote(r.ok ? (r.reason ?? (actual.outcome === "missed" ? "已记下没练，原因会给方坤参考。" : "已记入训练日志，方坤可见。")) : `日志未同步：${r.reason}`)
  }
  const list = applyOverride(store.entries.filter((e) => e.date === day && shown(e)), override)
  const sloted = list.some((e) => e.slot)
  const [inj, setInj] = useState<InjuryStore>({ asked: true, items: [] })
  useEffect(() => { setInj(loadInjury()) }, [revision])
  const askInjury = needsInjuryAsk(inj, list.some((e) => e.modality === "strength"))
  const groups: [string, ScheduleEntry[]][] = sloted ? [["上午", list.filter((e) => e.slot !== "pm")], ["今晚", list.filter((e) => e.slot === "pm")]] : [["", list]]
  const proposals = store.entries.filter((e) => week.includes(e.date) && e.status === "proposed")
  const rank = (c: Conflict) => c.id.startsWith("rec:") ? 0 : c.level === "warn" ? 1 : 2
  const dayConflicts = conflicts.filter((c) => c.date === day || c.entryIds.some((id) => list.some((e) => e.id === id))).sort((x, y) => rank(x) - rank(y))
  return <section aria-label="本周训练" className="home-card mb-3 px-3 py-3">
    <div className="flex items-center justify-between px-1"><h2 className="text-lg font-bold">{day === today ? "今日训练" : `${+day.slice(5, 7)}月${+day.slice(8)}日`}</h2><SavedBadge stamp={stamp} /></div>
    <div className="mt-2 grid grid-cols-7 gap-1" role="tablist" aria-label="本周">
      {week.map((d, i) => { const es = store.entries.filter((e) => e.date === d && (e.status === "planned" || e.status === "done" || e.status === "proposed")); const warn = conflicts.some((c) => c.date === d && c.level === "warn")
        return <button key={d} type="button" role="tab" aria-selected={d === day} onClick={() => { setDay(d); setOpen(null) }} className={"flex min-h-16 flex-col items-center justify-center rounded-xl border text-xs " + (d === day ? "border-accent bg-accent text-accent-fg" : d === today ? "border-accent" : "border-line bg-surface-2")}>
          <span className="opacity-80">{d === today ? "今天" : `周${WD[i]}`}</span><b className="text-sm">{+d.slice(8)}</b>
          <span className="mt-0.5 flex h-2 gap-0.5">{es.slice(0, 3).map((e) => <i key={e.id} className={"size-1.5 rounded-full " + dot(e) + (e.status === "proposed" ? " opacity-40" : "")} />)}{warn ? <i className="size-1.5 rounded-full bg-[#c0392b]" /> : null}</span>
        </button> })}
    </div>
    {proposals.length ? <p className="mt-2 px-1 text-xs text-muted">方坤本周有 {proposals.length} 节建议待你确认（浅色点）。</p> : null}
    {dayConflicts.slice(0, 2).map((c) => <div key={c.id} className={"mt-3 rounded-xl border p-2.5 text-sm " + (c.level === "warn" ? "border-[#e0a46b] bg-[#fdf3e8] dark:bg-transparent" : "border-line bg-surface-2")} role="status">
      <p className="flex gap-1.5 font-bold"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{c.text}</p>
      <p className="mt-0.5 text-[11px] text-muted">方坤 · {c.basis}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">{c.actions.map((a) => <button key={a} type="button" className="fk-chip" onClick={() => act(c, a)}>{ACT[a]}</button>)}</div>
    </div>)}
    <div className="mt-3 space-y-2">
      {askInjury ? <InjuryCard onSave={(v) => { saveInjury(v); setInj(v) }} /> : null}
      {groups.map(([label, items]) => items.length ? <div key={label} className="space-y-2">{label ? <p className="px-1 text-xs font-bold text-muted">{label}</p> : null}{items.map((e) => <EntryCard key={e.id} e={e} injuries={inj.items} band={band ? planBand(e) : null} today={today} open={open === e.id} session={sessionOf(e)} onToggle={() => setOpen(open === e.id ? null : e.id)}
        onReview={(d, patch) => setEntries(review(store.entries, e.id, d, patch))}
        onSwap={(why) => { const n = swapProposal(e, why); setEntries([...review(store.entries, e.id, "reject"), n]); setOpen(n.id) }}
        onActual={(a) => saveActual(e, a)} onSkip={() => setEntries(store.entries.map((x) => x.id === e.id ? { ...x, status: "rejected" } : x))}
        onOpenRun={() => e.refId && e.kind === "run" ? onOpenRun(e.refId) : onAskCoach()} onOpenFull={() => { const s = sessionOf(e); if (s) onOpenLift(s.id); else if (e.refId && e.modality === "run") onOpenRun(e.refId); else onAskCoach() }} onAskCoach={onAskCoach} onFood={onFood} />)}</div> : null)}
      {!list.length ? <p className="px-1 py-2 text-sm text-muted">这天还没有安排。</p> : null}
      {note ? <p className="px-1 text-xs text-muted" role="status">{note}</p> : null}
    </div>
    <div className="mt-2 flex flex-wrap gap-3 px-1">
      <button type="button" className="fk-link flex items-center gap-1 text-sm" aria-expanded={adding} onClick={() => setAdding(!adding)}><Plus className="size-4" />自己加一节</button>
      {week.some((d) => d >= today && !store.entries.some((e) => e.date === d && shown(e))) ? <button type="button" className="fk-link flex items-center gap-1 text-sm" onClick={() => commit(proposeWeek(store, week, today, plan.sessions, runPlans))}><Bot className="size-4" />让方坤排本周空档</button> : null}
    </div>
    {adding ? <div className="fk-chips mt-1 flex-wrap px-1" role="group" aria-label="可添加的课">
      {plan.sessions.map((s) => <button key={s.id} type="button" className="fk-chip" onClick={() => { setEntries([...store.entries, strengthEntry(s, day, "custom")]); setAdding(false) }}><Dumbbell className="size-3.5" />力量 · {classifyStrength(s).focus.join("+") || s.name}</button>)}
      {runPlans.map((r) => <button key={r.planId} type="button" className="fk-chip" onClick={() => { setEntries([...store.entries, runEntry(r, day, "custom")]); setAdding(false) }}><Footprints className="size-3.5" />{classifyRun(r).title}</button>)}
      <p className="w-full text-[11px] text-muted">自己加的课和方坤的建议同样参与冲突检查。</p>
    </div> : null}
    <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm" aria-label="本周计划与实际">
      <p className="font-bold">本周 计划 vs 实际</p>
      <p className="mt-1">计划 {summary.planned} 节 · 按计划 <b>{summary.asPlanned}</b> · 有变 <b>{summary.different}</b> · 没练 <b>{summary.missed}</b>{summary.open ? ` · 待做 ${summary.open}` : ""}</p>
      <p className="text-xs text-muted">时长 实际 {summary.actualMin} / 计划 {summary.plannedMin} 分钟{summary.reasons.length ? ` · 主要原因：${summary.reasons.slice(0, 2).map(([r, n]) => `${REASON_LABELS[r]}×${n}`).join("、")}` : ""}</p>
      <p className="mt-1 text-xs"><Bot className="mr-1 inline size-3.5" />{summary.note}</p>
    </div>
  </section>
}

function EntryCard({ e, injuries = [], band, today, open, session, onToggle, onReview, onSwap, onActual, onSkip, onOpenRun, onOpenFull, onAskCoach, onFood }: {
  e: ScheduleEntry; injuries?: Injury[]; band?: Band; today: string; open: boolean; session: Session | undefined; onToggle: () => void
  onReview: (d: "accept" | "reject", patch?: Partial<Pick<ScheduleEntry, "title" | "minutes" | "intensity" | "date">>) => void
  onSwap: (why: SwapReason) => void; onActual: (a: Parameters<typeof logActual>[2]) => void; onSkip: () => void
  onOpenRun: () => void; onOpenFull: () => void; onAskCoach: () => void; onFood?: () => void
}) {
  const [mode, setMode] = useState<"none" | "edit" | "swap" | "diff" | "miss">("none")
  const [title, setTitle] = useState(e.title), [mins, setMins] = useState(e.minutes), [inten, setInten] = useState<Intensity>(e.intensity)
  const [aMin, setAMin] = useState(e.actual?.minutes ?? e.minutes), [aInt, setAInt] = useState<Intensity>(e.actual?.intensity ?? e.intensity), [aNote, setANote] = useState(e.actual?.note ?? ""), [reasons, setReasons] = useState<DeviationReason[]>(e.actual?.reasons ?? [])
  const [aRpe, setARpe] = useState<number | null>(e.actual?.rpe ?? null)
  const Icon = e.modality === "run" ? Footprints : Dumbbell
  const proposed = e.status === "proposed"
  const reasonChips = <div className="fk-chips flex-wrap">{(Object.keys(REASON_LABELS) as DeviationReason[]).map((r) => <button key={r} type="button" className="fk-chip" aria-pressed={reasons.includes(r)} onClick={() => setReasons(reasons.includes(r) ? reasons.filter((x) => x !== r) : [...reasons, r])}>{REASON_LABELS[r]}</button>)}</div>
  const a = e.actual
  const adv = e.modality === "strength" && injuries.length ? injuryAdvice(session ? session.moves.map((m) => displayName(m)) : [e.title], injuries, today) : null
  return <div style={band ? { borderLeft: `5px solid ${BAND_COLOR[band]}` } : undefined} data-band={band ?? undefined} className={"rounded-2xl border bg-surface-2 " + (proposed ? "border-dashed border-[#7a5cc7]" : "border-line")}>
    <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 p-3 text-left">
      <span className={"relative grid size-10 shrink-0 place-items-center rounded-xl text-white " + dot(e)}><Icon className="size-5" />{e.source === "fangkun" ? <Bot className="absolute -bottom-1 -right-1 size-4 rounded-full bg-surface p-0.5 text-[#7a5cc7]" /> : null}</span>
      <span className="min-w-0 flex-1"><span className="block truncate font-bold">{e.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">{e.minutes} 分钟 · <span className={e.intensity === "HARD" ? "font-bold text-[#c0612b]" : ""}>{INT[e.intensity]}</span>
          <span className={"rounded-full px-1.5 py-0.5 text-[10px] font-bold " + (e.source === "fangkun" ? "bg-[#7a5cc7]/15 text-[#6a4cb7]" : "bg-line text-fg")}>{e.source === "fangkun" ? "方坤" : "自定"}</span>
          {proposed ? <span className="rounded-full bg-[#7a5cc7] px-1.5 py-0.5 text-[10px] font-bold text-white">待确认</span> : null}
          {e.overrideNote ? <span className="text-[10px] font-bold text-[#6a4cb7]">今天临时改</span> : null}{e.unplanned ? <span className="text-[10px]">计划外</span> : null}
          {e.edited ? <span className="text-[10px]">已改</span> : null}{e.reduced ? <span className="text-[10px]">已降强度</span> : null}{e.movedFrom ? <span className="text-[10px]">由 {e.movedFrom.slice(5)} 顺延</span> : null}
          {a ? <span className={"text-[10px] font-bold " + (a.outcome === "as_planned" ? "text-[#269775]" : a.outcome === "different" ? "text-[#c0612b]" : "text-muted")}>{a.outcome === "as_planned" ? "✓ 按计划" : a.outcome === "different" ? `实际 ${a.minutes ?? "?"} 分钟` : "没练"}</span> : null}</span></span>
      <ChevronDown className={"size-4 shrink-0 transition " + (open ? "rotate-180" : "")} />
    </button>
    {proposed ? <div className="border-t border-line px-3 pb-3 pt-2">
      {e.swapReason ? <p className="mb-2 text-xs text-muted">方坤：{e.swapReason}</p> : null}{e.overrideNote ? <p className="mb-2 text-xs text-[#6a4cb7]">{e.overrideNote}</p> : null}
      <div className="grid grid-cols-4 gap-1.5">
        <button type="button" className="fk-chip justify-center" onClick={() => onReview("accept")}><Check className="size-3.5" />接受</button>
        <button type="button" className="fk-chip justify-center" aria-pressed={mode === "edit"} onClick={() => setMode(mode === "edit" ? "none" : "edit")}><Pencil className="size-3.5" />自己改</button>
        <button type="button" className="fk-chip justify-center" aria-pressed={mode === "swap"} onClick={() => setMode(mode === "swap" ? "none" : "swap")}><RefreshCw className="size-3.5" />换一个</button>
        <button type="button" className="fk-chip justify-center" onClick={() => onReview("reject")}><X className="size-3.5" />不要</button>
      </div>
      {mode === "edit" ? <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-1.5 text-sm">
        <input aria-label="课程名称" value={title} onChange={(x) => setTitle(x.target.value.slice(0, 32))} className="fk-cell min-w-0" />
        <label className="flex items-center gap-1"><input aria-label="分钟" inputMode="numeric" value={mins} onChange={(x) => setMins(Number(x.target.value) || 0)} className="fk-cell w-14" />分</label>
        <select aria-label="强度" value={inten} onChange={(x) => setInten(x.target.value as Intensity)} className="fk-cell">{(Object.keys(INT) as Intensity[]).map((k) => <option key={k} value={k}>{INT[k]}</option>)}</select>
        <button type="button" className="fk-primary col-span-3 min-h-10" onClick={() => onReview("accept", { title, minutes: Math.max(5, mins), intensity: inten })}>按我改的加入计划</button>
      </div> : null}
      {mode === "swap" ? <div className="mt-2"><p className="mb-1 text-xs text-muted">为什么换？（可选，方坤据此换一节不更累的）</p><div className="fk-chips flex-wrap">{(Object.keys(SWAP_LABELS) as SwapReason[]).map((w) => <button key={w} type="button" className="fk-chip" onClick={() => onSwap(w)}>{SWAP_LABELS[w]}</button>)}</div></div> : null}
    </div> : open ? <div className="border-t border-line px-3 pb-3 pt-2">
      {adv && (adv.avoid.length || adv.caution.length || adv.safety.length) ? <div className="mb-2 space-y-1 text-xs" aria-label="伤病调整">
        {adv.safety.filter((x) => x.red).map((x) => <p key={x.text} role="alert" className="rounded-lg border-2 border-[var(--color-risk)] p-2 font-bold text-[var(--color-risk)]">{x.text} <span className="font-normal">（手册 {x.rule}）</span></p>)}
        {adv.avoid.length ? <p>今天先不做：<b>{adv.avoid.join("、")}</b>（换不引起疼痛的替代）</p> : null}
        {adv.caution.length ? <p>从轻重量开始：{adv.caution.join("、")}</p> : null}
        {adv.safety.filter((x) => !x.red).map((x) => <p key={x.text} className="text-muted">{x.text}（{x.rule}）</p>)}
      </div> : null}
      {e.date === today || (e.date < today && !a) ? <>
        <div className="grid grid-cols-3 gap-1.5">
          <button type="button" className="fk-chip justify-center" aria-pressed={a?.outcome === "as_planned"} onClick={() => { setMode("none"); onActual({ outcome: "as_planned", minutes: null, intensity: null, note: "", reasons: [] }) }}>按计划完成</button>
          <button type="button" className="fk-chip justify-center" aria-pressed={mode === "diff" || a?.outcome === "different"} onClick={() => setMode(mode === "diff" ? "none" : "diff")}>实际不同</button>
          <button type="button" className="fk-chip justify-center" aria-pressed={mode === "miss" || a?.outcome === "missed"} onClick={() => setMode(mode === "miss" ? "none" : "miss")}>没练</button>
        </div>
        {mode === "diff" ? <div className="mt-2 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-1">实际<input aria-label="实际分钟" inputMode="numeric" value={aMin} onChange={(x) => setAMin(Number(x.target.value) || 0)} className="fk-cell w-14" />分钟</label>
            <select aria-label="实际强度" value={aInt} onChange={(x) => setAInt(x.target.value as Intensity)} className="fk-cell">{(Object.keys(INT) as Intensity[]).map((k) => <option key={k} value={k}>{INT[k]}</option>)}</select></div>
          <EnergyGauge compact mode={e.modality === "run" ? "run" : "strength"} label="实际用力（气力槽）" value={aRpe} onChange={setARpe} />
          <input aria-label="实际做了什么" placeholder="实际做了什么（可选）" value={aNote} onChange={(x) => setANote(x.target.value.slice(0, 60))} className="fk-cell w-full" />
          {reasonChips}
          <button type="button" className="fk-primary min-h-10 w-full" onClick={() => { setMode("none"); onActual({ outcome: "different", minutes: aMin, intensity: aInt, note: aNote, reasons, rpe: aRpe }) }}>保存实际</button>
        </div> : null}
        {mode === "miss" ? <div className="mt-2 space-y-2">{reasonChips}<button type="button" className="fk-primary min-h-10 w-full" onClick={() => { setMode("none"); onActual({ outcome: "missed", minutes: 0, intensity: null, note: "", reasons }) }}>记为没练</button></div> : null}
        {reasons.includes("tired") || reasons.includes("short") ? <p className="mt-1 text-xs text-muted">状态差/时间不够只说明当天状态，方坤不会据此判定能力下降。</p> : null}
        {reasons.includes("pain") ? <p className="mt-1 text-xs text-[var(--color-risk)]">有疼痛：<button type="button" className="fk-link" onClick={onAskCoach}>告诉方坤部位 ›</button></p> : null}
        {e.date === today ? <details className="mt-2"><summary className="min-h-9 cursor-pointer text-xs font-bold text-muted">逐组打勾（可选，细节同步到日志）</summary>
          <TodayChecklist bare slotId={e.id} title={e.title} session={session} runTitle={e.modality === "run" ? e.title : null} onOpenRun={onOpenRun} onOpenFull={onOpenFull} onAskCoach={onAskCoach} />
        </details> : null}
      </> : <p className="text-sm text-muted">{a ? `已记录：${a.outcome === "as_planned" ? "按计划完成" : a.outcome === "different" ? `实际 ${a.minutes} 分钟 · ${a.intensity ? INT[a.intensity] : ""}` : "没练"}${a.reasons.length ? ` · ${a.reasons.map((r) => REASON_LABELS[r]).join("、")}` : ""}` : "到当天再记录完成情况。"}{e.focus.length ? ` 重点：${e.focus.join("、")}` : ""}</p>}
      <div className="mt-2 flex items-center gap-3"><button type="button" className="fk-link text-xs" onClick={onOpenFull}>详细记录 ›</button>{onFood ? <button type="button" className="fk-link text-xs" onClick={onFood}>练前后吃什么 ›</button> : null}<button type="button" className="fk-chip ml-auto" onClick={onSkip}><X className="size-3.5" />{e.source === "custom" ? "移除" : "不做这节"}</button></div>
    </div> : null}
  </div>
}

/** 第一次排力量课时问一次伤病（部位 + 旧伤/当前疼）。 */
function InjuryCard({ onSave }: { onSave: (v: InjuryStore) => void }) {
  const [items, setItems] = useState<Injury[]>([])
  const today = new Date().toISOString().slice(0, 10)
  const toggle = (part: Part) => setItems(items.some((x) => x.part === part) ? items.filter((x) => x.part !== part) : [...items, { part, kind: "old" }])
  const patch = (part: Part, p: Partial<Injury>) => setItems(items.map((x) => x.part === part ? { ...x, ...p } : x))
  return <div className="rounded-2xl border-2 border-[#d07a2b] bg-surface p-3 text-sm" aria-label="伤病确认">
    <p className="font-bold">排力量课前问一句：哪里有旧伤或现在疼？</p>
    <p className="text-xs text-muted">方坤据此挑动作；不说病名，只判断要不要避开或找专业人员。</p>
    <div className="mt-2 flex flex-wrap gap-1.5">{PARTS.map((p) => <button key={p} type="button" className="fk-chip" aria-pressed={items.some((x) => x.part === p)} onClick={() => toggle(p)}>{p}</button>)}</div>
    {items.map((it) => <div key={it.part} className="mt-2 flex flex-wrap items-center gap-1.5 text-xs"><b className="w-16">{it.part}</b>
      <button type="button" className="fk-chip" aria-pressed={it.kind === "old"} onClick={() => patch(it.part, { kind: "old", score: undefined })}>旧伤</button>
      <button type="button" className="fk-chip" aria-pressed={it.kind === "current"} onClick={() => patch(it.part, { kind: "current", score: it.score ?? 2, since: it.since ?? today })}>当前疼</button>
      {it.kind === "current" ? <label className="flex items-center gap-1">疼痛<input aria-label={`${it.part}疼痛分`} type="range" min={1} max={10} value={it.score ?? 2} onChange={(e) => patch(it.part, { score: Number(e.target.value) })} /><b>{it.score}/10</b></label> : null}</div>)}
    <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" className="fk-primary min-h-11" onClick={() => onSave({ asked: true, items })}>{items.length ? "保存" : "都没有"}</button><button type="button" className="fk-chip justify-center" onClick={() => onSave({ asked: true, items: [] })}>以后再说</button></div>
  </div>
}
