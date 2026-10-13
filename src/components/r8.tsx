import { useEffect, useMemo, useRef, useState } from "react"
import { Bell, Camera, ChevronRight, FileUp, Flame, Plus, X } from "lucide-react"
import { DEFAULTS, EQUIPMENT, EXPERIENCE, GOALS, ONBOARD_KEY, PRESET, QUESTIONS, VENUES, WHEN, goalLabel, previewWeek, tierFor, toggleGoal, type Answers } from "@/lib/ui/first-run"
import { BRANDS, GROUP_HINT, TIERS, TIER_LABEL, WATCHES, gateRecovery, loadBrand, loadTier, loadWatch, saveTier, saveWatch, type Tier, type WatchId } from "@/lib/ui/watch-mode"
import { loadSchedule, saveSchedule } from "@/lib/ui/day-schedule"
import { addDays, weekOf, weekSummary, type ScheduleEntry } from "@/lib/ui/day-schedule-rules"
import { parseQuickLog, type Parsed } from "@/lib/ui/quick-log"
import { computeStreak } from "@/lib/ui/streak"
import { OVERRIDE_KEY, type Override } from "@/lib/ui/day-override"
import { COLLECTED, effective, loadSettings, saveSettings, type AppSettings } from "@/lib/ui/app-settings"
import { logMetrics } from "@/lib/ui/log-metrics"
import { syncActualToLog } from "@/lib/ui/checklist-log"
import { recoveryVerdict } from "@/lib/ui/recovery-verdict"
import { readRecoveryInput, lastDeviceSync } from "@/components/health-extras"
import { loadVitals } from "@/lib/nutrition/vitals"
import { upsertCheck } from "@/lib/nutrition/body"
import { createTrainingImportDraft, confirmTrainingImport } from "@/lib/core/training-import"
import { ocr } from "@/components/device-import"
import { SavedBadge } from "@/components/saved-badge"

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } }
export const loadAnswers = (): (Answers & { done?: boolean }) | null => read(ONBOARD_KEY, null)

/* ---------------- 1) 首次引导 ---------------- */
export function Onboarding({ today, onDone }: { today: string; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [a, setA] = useState<Answers>(DEFAULTS)
  const [brand, setBrand] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const week = weekOf(today)
  const preview = useMemo(() => previewWeek(a, week, today), [a, week, today])
  const set = (p: Partial<Answers>) => setA({ ...a, ...p })
  const next = () => setStep(step + 1)
  const finish = (accept: boolean) => {
    saveWatch(a.source, undefined, brand)
    const s = loadSchedule(); const ids = new Set(s.entries.map((e) => e.id))
    const add = preview.filter((e) => !ids.has(e.id)).map(({ why, ...e }) => ({ ...e, status: accept ? "planned" : "proposed", swapReason: why } as ScheduleEntry))
    saveSchedule({ ...s, entries: [...s.entries, ...add] })
    localStorage.setItem(ONBOARD_KEY, JSON.stringify({ ...a, done: true, at: new Date().toISOString() }))
    setAccepted(true)
  }
  const askNotify = async () => {
    let ok = false
    try { if (typeof Notification !== "undefined") ok = (await Notification.requestPermission()) === "granted" } catch { /* unsupported */ }
    const s = loadSettings(); saveSettings({ ...s, reminders: { ...s.reminders, master: ok } }); onDone()
  }
  const Opt = ({ on, onClick, label, sub }: { on: boolean; onClick: () => void; label: string; sub?: string }) => <button type="button" aria-pressed={on} onClick={onClick} className={"w-full rounded-2xl border p-3 text-left " + (on ? "border-accent bg-accent/10" : "border-line bg-surface")}><b>{label}</b>{sub ? <span className="block text-xs text-muted">{sub}</span> : null}</button>
  const body = step === 0 ? <div className="space-y-2">{WATCHES.map(([id, l]) => <Opt key={id} on={a.source === id} onClick={() => { set({ source: id }); setBrand(null) }} label={l} sub={`${GROUP_HINT[id]} · ${TIER_LABEL[TIERS[tierFor({ ...a, source: id })] ? tierFor({ ...a, source: id }) : "basic"]}`} />)}
      {BRANDS[a.source].length ? <select aria-label="品牌" className="fk-cell w-full" value={brand ?? ""} onChange={(e) => setBrand(e.target.value || null)}><option value="">品牌（只决定显示哪份说明）</option>{BRANDS[a.source].map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select> : null}</div>
    : step === 1 ? <div className="space-y-2"><p className="text-xs text-muted">最多选 2 个，第一个算主目标。</p>{GOALS.map(([id, l]) => <Opt key={id} on={a.goals.includes(id)} onClick={() => set({ goals: toggleGoal(a.goals, id) })} label={l} sub={a.goals[0] === id ? "主目标" : undefined} />)}</div>
    : step === 2 ? <div className="space-y-2"><p className="text-xs text-muted">按时间选，不用自我评价。</p>{EXPERIENCE.map(([id, l]) => <Opt key={id} on={a.experience === id} onClick={() => set({ experience: id })} label={`规律训练：${l}`} />)}</div>
    : step === 3 ? <div className="space-y-2">{VENUES.map(([id, l]) => <Opt key={id} on={a.venue === id} onClick={() => set({ venue: id, equipment: PRESET[id] })} label={l} />)}
      <p className="pt-1 text-xs text-muted">已按场地预勾，删改即可：</p><div className="flex flex-wrap gap-1.5">{EQUIPMENT.map((q) => <button key={q} type="button" className="fk-chip" aria-pressed={a.equipment.includes(q)} onClick={() => set({ equipment: a.equipment.includes(q) ? a.equipment.filter((x) => x !== q) : [...a.equipment, q] })}>{q}</button>)}</div></div>
    : step === 4 ? <div className="space-y-3"><p className="text-sm font-bold">每周哪几天</p><div className="grid grid-cols-7 gap-1">{["一", "二", "三", "四", "五", "六", "日"].map((d, i) => <button key={d} type="button" aria-pressed={a.days.includes(i)} onClick={() => set({ days: a.days.includes(i) ? a.days.filter((x) => x !== i) : [...a.days, i] })} className={"grid aspect-square place-items-center rounded-full border text-sm font-bold " + (a.days.includes(i) ? "border-accent bg-accent text-accent-fg" : "border-line")}>{d}</button>)}</div>
      <p className="text-sm font-bold">每次多长</p><div className="grid grid-cols-4 gap-1.5">{([20, 30, 45, 60] as const).map((m) => <button key={m} type="button" className="fk-chip justify-center" aria-pressed={a.minutes === m} onClick={() => set({ minutes: m })}>{m === 60 ? "60+" : m} 分</button>)}</div>
      <p className="text-sm font-bold">通常什么时候练 <span className="text-xs font-normal text-muted">（可选，提醒按这个来）</span></p><div className="grid grid-cols-3 gap-1.5">{WHEN.map(([id, l]) => <button key={id} type="button" className="fk-chip justify-center" aria-pressed={a.when === id} onClick={() => set({ when: a.when === id ? null : id })}>{l}</button>)}</div></div>
    : null
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-bg" role="dialog" aria-label="首次引导">
    <div className="mx-auto max-w-xl px-4 pb-10 pt-5">
      {step < 5 ? <>
        <div className="flex items-center gap-3"><span className="text-sm font-bold">{step + 1}/5</span><div className="h-1.5 flex-1 rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${(step + 1) * 20}%` }} /></div></div>
        <h1 className="mt-4 text-2xl font-bold">{["你的数据从哪来？", "你想练成什么？", "你规律训练多久了？", "在哪练？有什么器械？", "每周能练多少？"][step]}</h1>
        <p className="mt-1 text-xs text-muted">{QUESTIONS[step]} · 伤病和饮食等用到时再问</p>
        <div className="mt-4">{body}</div>
        <div className="mt-6 flex gap-2">{step ? <button type="button" className="fk-chip min-h-12 px-4" onClick={() => setStep(step - 1)}>上一步</button> : null}<button type="button" className="fk-primary min-h-12 flex-1" onClick={next}>下一步</button></div>
        <button type="button" className="fk-link mt-3 w-full text-center text-sm" onClick={() => { setA({ ...a, ...pickDefault(step) }); next() }}>跳过，用默认</button>
      </> : !accepted ? <>
        <h1 className="text-2xl font-bold">这是你本周的计划</h1>
        <p className="mt-1 text-sm text-muted">为了「{goalLabel(a.goals[0] ?? "fitness")}」· {TIER_LABEL[tierFor(a)]} · 每节都是方坤的建议，可以逐个改。</p>
        <div className="mt-3 space-y-2">{preview.length ? preview.map((e) => <div key={e.id} className={"rounded-2xl border-l-4 bg-surface p-3 " + (e.modality === "run" ? "border-l-[#2182bd]" : "border-l-[#d07a2b]")}><p className="font-bold">周{"一二三四五六日"[week.indexOf(e.date)]} · {e.title} · {e.minutes} 分钟{e.slot ? (e.slot === "pm" ? " · 今晚" : " · 上午") : ""}</p><p className="text-xs text-muted">{e.why}</p></div>) : <p className="text-sm text-muted">本周剩下的日子没有你选的训练日，下周一开始。</p>}</div>
        <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" className="fk-primary min-h-12" onClick={() => finish(true)}>接受</button><button type="button" className="fk-chip min-h-12 justify-center" onClick={() => finish(false)}>逐个调整</button></div>
        <p className="mt-2 text-xs text-muted">“逐个调整”会放到首页的待确认卡上：接受 / 自己改 / 换一个 / 不要。</p>
      </> : <>
        <Bell className="size-10 text-accent" /><h1 className="mt-3 text-2xl font-bold">要不要到点提醒你？</h1>
        <p className="mt-1 text-sm text-muted">到点提醒你今天的课；晚上还没记录再提醒一次。每天最多 2 条，随时可在设置里关。</p>
        <button type="button" className="fk-primary mt-5 min-h-12 w-full" onClick={askNotify}>打开提醒</button>
        <button type="button" className="fk-link mt-3 w-full text-center text-sm" onClick={onDone}>暂不需要</button>
      </>}
    </div>
  </div>
}
const pickDefault = (step: number): Partial<Answers> => [{ source: DEFAULTS.source }, { goals: DEFAULTS.goals }, { experience: DEFAULTS.experience }, { venue: DEFAULTS.venue, equipment: DEFAULTS.equipment }, { days: DEFAULTS.days, minutes: DEFAULTS.minutes, when: null }][step] ?? {}

/* ---------------- 2) 首页摘要：目标回响 + 连续打卡 + 基线 + 恢复一句话 + 今天临时改 ---------------- */
export function HomeHeader({ today, revision, onRecovery, onOverride }: { today: string; revision: number; onRecovery: () => void; onOverride: (o: Override | null) => void }) {
  const [st, setSt] = useState<{ goal: string | null; done: number; planned: number; streak: ReturnType<typeof computeStreak>; baseline: number; verdict: string; reason: string; ov: Override | null } | null>(null)
  useEffect(() => {
    if (!today) return
    const s = loadSchedule(), wk = weekOf(today), ans = loadAnswers(), sum = weekSummary(s.entries, wk, today)
    const tier = loadTier(), v = recoveryVerdict(gateRecovery(tier, readRecoveryInput(today)))
    const days = new Set(loadVitals().records.map((r) => r.observedOn)); for (const c of read<{ date: string }[]>("fk-checkin-v1", [])) days.add(c.date)
    const ov = read<Override | null>(OVERRIDE_KEY, null)
    setSt({ goal: ans?.goals?.[0] ? goalLabel(ans.goals[0]) : null, done: sum.asPlanned + sum.different, planned: sum.planned, streak: computeStreak(s.entries, today), baseline: Math.max(0, 7 - days.size), verdict: v.title, reason: v.reasons[0] ?? "", ov: ov?.date === today ? ov : null })
  }, [today, revision])
  if (!st) return null
  const setOv = (p: Partial<Override>) => { const n = { ...(st.ov ?? { date: today }), ...p, date: today }; const val = n.short || n.home ? n : null; localStorage.setItem(OVERRIDE_KEY, JSON.stringify(val)); setSt({ ...st, ov: val }); onOverride(val) }
  return <section className="mb-3 space-y-2" aria-label="今日摘要">
    <div className="flex items-center gap-2 px-1 text-sm">
      {st.goal ? <span className="rounded-full bg-[#7a5cc7]/12 px-2.5 py-1 font-bold text-[#6a4cb7]">为了{st.goal}：本周 {st.done}/{st.planned}</span> : null}
      <span className="ml-auto flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 font-bold" title="完成一节或登记实际不同都算；每周 2 次休息不断签"><Flame className={"size-4 " + (st.streak.todayDone ? "text-[#e07b2b]" : "text-muted")} />连续 {st.streak.days} 天{st.streak.frozen.length ? <span className="text-[10px] font-normal text-muted">（含休息 {st.streak.frozen.length}）</span> : null}</span>
    </div>
    <button type="button" onClick={onRecovery} className="flex w-full items-center gap-2 rounded-2xl border-l-4 border-l-[#269775] bg-surface px-3 py-2 text-left text-sm" aria-label="今日恢复">
      <b className="shrink-0 text-[#1d7a5e]">恢复</b><span className="min-w-0 flex-1 truncate">{st.verdict}{st.reason ? ` · ${st.reason}` : ""}</span>
      {st.baseline ? <span className="shrink-0 text-[11px] text-muted">还需 {st.baseline} 天建立基线</span> : null}<ChevronRight className="size-4 shrink-0 text-muted" />
    </button>
    <div className="flex flex-wrap items-center gap-1.5 px-1"><span className="text-xs text-muted">今天临时改：</span>
      <button type="button" className="fk-chip" aria-pressed={!!st.ov?.short} onClick={() => setOv({ short: !st.ov?.short })}>只有 20 分钟</button>
      <button type="button" className="fk-chip" aria-pressed={!!st.ov?.home} onClick={() => setOv({ home: !st.ov?.home })}>今天在家</button>
      {st.ov ? <span className="text-[11px] text-muted">只改今天，不改档案</span> : null}</div>
  </section>
}

/* ---------------- 3) 全局“+记一笔” ---------------- */
const f = <T,>(v: T | null) => v == null ? { value: null, status: "ABSENT", sourceIds: [] } : { value: v, status: "RECORDED", sourceIds: ["user-confirmed"] }
function saveParsed(p: Parsed, today: string): string {
  if (p.kind === "weight") return upsertCheck({ date: today, weight: p.kg } as never) ? `已记体重 ${p.kg} kg` : "保存失败"
  if (p.kind === "unknown") return "没认出来"
  const s = loadSchedule(), at = new Date().toISOString()
  const id = `q-${Date.now().toString(36)}`
  const minutes = p.kind === "run" ? p.minutes ?? 30 : Math.max(10, p.sets * 3)
  const e: ScheduleEntry = { id, date: today, kind: p.kind === "run" ? "run" : "strength", modality: p.kind === "run" ? "run" : "strength", title: p.kind === "run" ? `${p.title}${p.km ? ` ${p.km} 公里` : ""}` : `${p.name} ${p.sets}×${p.reps}${p.kg ? ` ${p.kg}kg` : ""}`, focus: [], minutes, intensity: "EASY", lowerHeavy: false, source: "custom", refId: null, status: "done", unplanned: true, slot: p.kind === "run" ? p.when ?? undefined : undefined, actual: { outcome: "as_planned", minutes, intensity: null, note: "记一笔", reasons: [], at } }
  saveSchedule({ ...s, entries: [...s.entries, e] })
  if (p.kind === "run") { const r = syncActualToLog(e, undefined); return r.ok ? "已记入训练日志" : `日志未同步：${r.reason}` }
  const draft = createTrainingImportDraft({ sport: "STRENGTH", occurredAt: f(at.replace(/\.\d+Z$/, "Z")), title: f(e.title), durationSeconds: f(null), totalDistanceMeters: f(null), runningStructure: "UNAVAILABLE", runningSegments: [], strengthSets: Array.from({ length: p.sets }, (_, i) => ({ id: `q${i + 1}`, exerciseName: f(p.name), setOrdinal: f(i + 1), weightKg: f(p.kg), repetitions: f(p.reps), durationSeconds: f(null), recoverySeconds: f(null), completion: "COMPLETED" })), sessionRpe: f(null), subjectiveRecovery: f(null), sleepHours: f(null), pain: f(null), soreness: f(null), uncertainFields: [], conflicts: [], warnings: ["记一笔"] } as never, "TEXT", ["user-confirmed"])
  draft.draftId = `act-${id}`
  const r = confirmTrainingImport(draft); return r.ok ? "已记入训练日志" : `日志未同步：${r.reason}`
}
export function QuickLog({ today, onSaved, onFile }: { today: string; onSaved: () => void; onFile: () => void }) {
  const [open, setOpen] = useState(false), [text, setText] = useState(""), [msg, setMsg] = useState(""), [stamp, setStamp] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const p = text.trim() ? parseQuickLog(text) : null
  const save = () => { if (!p) return; const m = saveParsed(p, today); setMsg(m); if (m.startsWith("已")) { setText(""); setStamp(Date.now()); onSaved() } }
  return <>
    <button type="button" aria-label="记一笔" onClick={() => setOpen(true)} className="fixed bottom-24 right-4 z-30 flex min-h-12 items-center gap-1 rounded-full bg-accent px-4 font-bold text-accent-fg shadow-lg md:right-[calc(50%-23rem)]"><Plus className="size-5" />记一笔</button>
    {open ? <div className="fixed inset-0 z-40 flex items-end bg-black/30 md:items-center" onClick={() => setOpen(false)}>
      <section role="dialog" aria-label="记一笔" onClick={(e) => e.stopPropagation()} className="mx-auto w-full max-w-xl rounded-t-3xl bg-bg p-4 md:rounded-3xl">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">记一笔</h2><SavedBadge stamp={stamp} /><button type="button" aria-label="关闭" onClick={() => setOpen(false)} className="grid size-10 place-items-center"><X className="size-5" /></button></div>
        <input autoFocus aria-label="一句话" value={text} onChange={(e) => { setText(e.target.value.slice(0, 80)); setMsg("") }} placeholder="如：深蹲 3×8 60kg / 轻松跑 5公里 32分 / 体重 65" className="fk-cell mt-2 w-full min-h-12" />
        <div className="mt-2 flex gap-2"><button type="button" className="fk-chip" onClick={() => fileRef.current?.click()}><Camera className="size-4" />截图</button><button type="button" className="fk-chip" onClick={() => { setOpen(false); onFile() }}><FileUp className="size-4" />文件（FIT/GPX…）</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setMsg("识别中…"); const t = await ocr(file, setMsg).catch(() => ""); setText(t.split("\n").find((l) => parseQuickLog(l).kind !== "unknown") ?? t.slice(0, 80)); setMsg("已识别，请核对") }} /></div>
        {p ? <div className="mt-3 rounded-2xl border border-line bg-surface p-3 text-sm" aria-label="识别结果">
          {p.kind === "run" ? <p><b className="text-[#2182bd]">跑步</b> · {p.title} · 距离 {p.km ?? "—"} 公里 · 用时 {p.minutes ?? "—"} 分{p.pace ? ` · 配速 ${p.pace}` : ""}{p.when ? ` · ${p.when === "pm" ? "今晚" : "上午"}` : ""}</p>
            : p.kind === "strength" ? <p><b className="text-[#d07a2b]">力量</b> · {p.name} · {p.sets} 组 × {p.reps} 次 · {p.kg ?? "自重"}{p.kg ? " kg" : ""}</p>
            : p.kind === "weight" ? <p><b>体重</b> · {p.kg} kg</p> : <p className="text-muted">没认出来。试试“深蹲 3×8 60kg”或“轻松跑 5公里 32分”。</p>}
          {p.kind !== "unknown" ? <button type="button" className="fk-primary mt-2 min-h-11 w-full" onClick={save}>确认保存</button> : null}
        </div> : null}
        {msg ? <p className="mt-2 text-xs text-muted" role="status">{msg}</p> : null}
      </section></div> : null}
  </>
}

/* ---------------- 训练日志：按版本显示的指标 ---------------- */
export function LogMetricsPanel({ today }: { today: string }) {
  const [m, setM] = useState<ReturnType<typeof logMetrics> | null>(null), [tier, setTier] = useState<Tier>("basic")
  useEffect(() => { if (!today) return; const t = loadTier(); setTier(t); setM(logMetrics(t, loadSchedule().entries, today)) }, [today])
  if (!m || (!m.trend && !m.load)) return null
  const max = Math.max(1, ...(m.trend ?? []).map((x) => x.minutes))
  return <section className="home-card mx-3 mb-3 p-4 text-sm" aria-label="训练趋势">
    <div className="flex items-center justify-between"><h2 className="text-base font-bold">训练趋势</h2><span className="text-[11px] text-muted">{TIER_LABEL[tier]}</span></div>
    {m.trend ? <div className="mt-2 flex h-16 items-end gap-2">{m.trend.map((x) => <div key={x.week} className="flex flex-1 flex-col items-center gap-1"><div className="w-full rounded-t bg-[#2182bd]" style={{ height: `${(x.minutes / max) * 44 + 2}px` }} /><span className="text-[10px] text-muted">{x.week.slice(5)} · {x.minutes}′</span></div>)}</div> : null}
    {m.load ? <p className="mt-2">训练负荷：近 7 天 {m.load.acute} · 前 4 周周均 {m.load.chronicWeekly}{m.load.ratio != null ? ` · 比值 ${m.load.ratio}` : ""} <span className="text-[10px] text-muted">【经验规则】时长×强度系数；比值明显 &gt;1.5 时留意（Gabbett 2016，仅作参考）</span></p> : null}
    {m.dynamics ? <p className="mt-1 text-xs text-muted">跑步动态（步频/触地/垂直振幅）与配速/心率区间：导入 FIT 后在每条记录里显示。</p> : null}
  </section>
}

/* ---------------- 5) 设置：8 组 ---------------- */
function Row({ title, sub, children, open, onToggle }: { title: string; sub: string; children: React.ReactNode; open: boolean; onToggle: () => void }) {
  return <div className="border-b border-line last:border-b-0"><button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-14 w-full items-center gap-2 py-2 text-left"><span className="flex-1"><b className="block">{title}</b><span className="text-xs text-muted">{sub}</span></span><ChevronRight className={"size-4 text-muted transition " + (open ? "rotate-90" : "")} /></button>{open ? <div className="pb-3 text-sm">{children}</div> : null}</div>
}
function Toggle({ label, on, onChange, disabled, small }: { label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; small?: boolean }) {
  return <label className={"flex min-h-11 items-center justify-between gap-2 " + (disabled ? "opacity-40" : "") + (small ? " pl-4 text-xs" : "")}><span>{label}</span><input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className={small ? "size-4" : "size-5"} /></label>
}
export function SettingsHub({ onProfile, onDiet, onBackup }: { onProfile: () => void; onDiet: () => void; onBackup: () => void }) {
  const [s, setS] = useState<AppSettings | null>(null), [open, setOpen] = useState<string | null>(null), [stamp, setStamp] = useState(0)
  const [w, setW] = useState<WatchId | null>(null), [tier, setT] = useState<Tier>("basic"), [ans, setAns] = useState<ReturnType<typeof loadAnswers>>(null), [sync, setSync] = useState<string | null>(null), [confirmDel, setConfirmDel] = useState(false)
  useEffect(() => { setS(loadSettings()); setW(loadWatch()); setT(loadTier()); setAns(loadAnswers()); setSync(lastDeviceSync()) }, [])
  if (!s) return null
  const up = (p: Partial<AppSettings>) => { const n = { ...s, ...p }; setS(n); saveSettings(n); setStamp(Date.now()) }
  const r = s.reminders, tg = (k: string) => setOpen(open === k ? null : k)
  const unset = "未设置，点击补充"
  const stale = sync ? (Date.now() - Date.parse(sync)) / 3600e3 > 24 : true
  const exportAll = () => { const data: Record<string, unknown> = {}; for (const c of COLLECTED) data[c.key] = read(c.key, null); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const el = document.createElement("a"); el.href = url; el.download = "fangkun-data.json"; el.click(); URL.revokeObjectURL(url) }
  return <section className="home-card mt-3 px-4" aria-label="设置">
    <div className="flex items-center justify-between pt-3"><h3 className="text-sm font-bold text-muted">设置 · 改动当场生效</h3><SavedBadge stamp={stamp} /></div>
    <Row title="个人档案" sub={ans ? `${ans.goals.map(goalLabel).join("、")} · ${EXPERIENCE.find((x) => x[0] === ans.experience)?.[1]} · ${VENUES.find((x) => x[0] === ans.venue)?.[1]} · 每周 ${ans.days.length} 天×${ans.minutes} 分` : unset} open={open === "p"} onToggle={() => tg("p")}><button type="button" className="fk-link" onClick={onProfile}>编辑基本信息 ›</button><button type="button" className="fk-link ml-4" onClick={() => { localStorage.removeItem(ONBOARD_KEY); location.reload() }}>重新回答 5 个问题 ›</button></Row>
    <Row title="数据来源" sub={`${w ? WATCHES.find((x) => x[0] === w)?.[1] : unset} · ${TIER_LABEL[tier]}${w && w !== "none" ? (stale ? " · 超过 24 小时未同步" : ` · 上次同步 ${new Date(sync!).toTimeString().slice(0, 5)}`) : ""}`} open={open === "d"} onToggle={() => tg("d")}>
      <div className="flex flex-wrap gap-1.5">{WATCHES.map(([id, l]) => <button key={id} type="button" className="fk-chip" aria-pressed={w === id} onClick={() => { saveWatch(id, undefined, loadBrand()); setW(id); setT(loadTier()); setStamp(Date.now()) }}>{l}</button>)}</div>
      <p className="mt-2 text-xs font-bold">版本（可手动升降）</p><div className="mt-1 flex flex-wrap gap-1.5" aria-label="版本">{(Object.keys(TIERS) as Tier[]).map((id) => <button key={id} type="button" className="fk-chip" aria-pressed={tier === id} onClick={() => { saveTier(id); setT(id); setStamp(Date.now()) }}>{TIER_LABEL[id]}</button>)}</div><p className="mt-1 text-xs text-muted">{TIERS[tier].desc}</p>
      <p className="mt-1 text-xs text-muted">佳明账号直连需要合作方审批，尚未开通；凭据不会保存在本应用里。</p></Row>
    <Row title="健康与安全" sub={`伤病：用到时再问 · 安全提醒 ${s.safetyLevel === "strict" ? "严格" : "标准"}`} open={open === "h"} onToggle={() => tg("h")}><div className="flex gap-1.5">{(["standard", "strict"] as const).map((k) => <button key={k} type="button" className="fk-chip" aria-pressed={s.safetyLevel === k} onClick={() => up({ safetyLevel: k })}>{k === "strict" ? "严格" : "标准"}</button>)}</div><p className="mt-1 text-xs text-muted">胸痛、晕厥等红框提醒不受任何设置影响。</p></Row>
    <Row title="饮食" sub={`目标：${({ gain: "增肌", cut: "减脂", keep: "保持", run: "跑步表现" } as Record<string, string>)[read<{ goal?: string }>("fk-diet-goal-v1", {}).goal ?? ""] ?? unset} · 忌口：${s.dietAvoid || "无"}`} open={open === "n"} onToggle={() => tg("n")}><button type="button" className="fk-link" onClick={onDiet}>改饮食目标 ›</button><input aria-label="忌口/过敏/素食" placeholder="忌口 / 过敏 / 素食（可选）" value={s.dietAvoid} onChange={(e) => up({ dietAvoid: e.target.value.slice(0, 40) })} className="fk-cell mt-2 w-full" /></Row>
    <Row title="方坤教练" sub={`${s.coachStyle === "brief" ? "简短" : "详细"} · 数据依据${s.showEvidence ? "显示" : "收起"} · 每周评估`} open={open === "c"} onToggle={() => tg("c")}>
      <div className="flex gap-1.5">{(["brief", "detailed"] as const).map((k) => <button key={k} type="button" className="fk-chip" aria-pressed={s.coachStyle === k} onClick={() => up({ coachStyle: k })}>{k === "brief" ? "简短（结论 + 最多 3 条）" : "详细"}</button>)}</div>
      <Toggle label="显示数据依据：每条建议下展开阈值和来源" on={s.showEvidence} onChange={(v) => up({ showEvidence: v })} /><p className="text-xs text-muted">安全类提醒（红框）不受风格影响，始终完整显示。</p></Row>
    <Row title="提醒" sub={r.master ? `已开 · 每天最多 2 条` : "已关"} open={open === "r"} onToggle={() => tg("r")}>
      <Toggle label="开启提醒" on={r.master} onChange={(v) => up({ reminders: { ...r, master: v } })} />
      <Toggle small label="训练提醒：上次训练约 24 小时后" on={r.training} disabled={!r.master} onChange={(v) => up({ reminders: { ...r, training: v } })} />
      <Toggle small label="晚上还没记录：21:00 提醒一次" on={r.evening} disabled={!r.master} onChange={(v) => up({ reminders: { ...r, evening: v } })} />
      <Toggle small label="待确认计划提醒" on={r.pending} disabled={!r.master} onChange={(v) => up({ reminders: { ...r, pending: v } })} />
      <Toggle small label="数据超过 24 小时未同步提醒" on={r.stale} disabled={!r.master} onChange={(v) => up({ reminders: { ...r, stale: v } })} />
      <p className="text-[11px] text-muted">生效：{(["training", "evening", "pending", "stale"] as const).filter((k) => effective(r, k)).length} 项</p></Row>
    <Row title="显示" sub={`${s.units === "metric" ? "公里/公斤" : "英里/磅"} · 完成度色带${s.band ? `开（按${s.bandBasis === "time" ? "时长" : "距离"}）` : "关"}`} open={open === "v"} onToggle={() => tg("v")}>
      <div className="flex gap-1.5">{(["metric", "imperial"] as const).map((k) => <button key={k} type="button" className="fk-chip" aria-pressed={s.units === k} onClick={() => up({ units: k })}>{k === "metric" ? "公里/公斤" : "英里/磅"}</button>)}</div>
      <Toggle label="显示计划 vs 实际色带" on={s.band} onChange={(v) => up({ band: v })} />
      <div className={"flex gap-1.5 pl-4 " + (s.band ? "" : "pointer-events-none opacity-40")}>{(["time", "distance"] as const).map((k) => <button key={k} type="button" className="fk-chip" aria-pressed={s.bandBasis === k} onClick={() => up({ bandBasis: k })}>按{k === "time" ? "时长" : "距离（跑步）"}</button>)}</div></Row>
    <Row title="隐私与数据" sub={`个性化建议${s.personalize ? "开" : "关"} · 数据只存本机`} open={open === "x"} onToggle={() => tg("x")}>
      <p className="text-xs font-bold">方坤收集了什么</p>
      <div className="mt-1 overflow-x-auto"><table className="fk-table text-xs"><thead><tr><th>数据</th><th>来源</th><th>用途</th></tr></thead><tbody>{COLLECTED.map((c) => <tr key={c.key}><td>{c.item}</td><td>{c.source}</td><td>{c.use}</td></tr>)}</tbody></table></div>
      <p className="mt-1 text-[11px] text-muted">都能删除。全部只存在这台设备的浏览器里。</p>
      <Toggle label="个性化建议：按你的反馈和记录调整方坤的提议" on={s.personalize} onChange={(v) => up({ personalize: v })} />
      <div className="mt-1 flex flex-wrap gap-2"><button type="button" className="fk-chip" onClick={exportAll}>导出全部（JSON）</button><button type="button" className="fk-chip" onClick={onBackup}>备份与恢复 ›</button>
        {!confirmDel ? <button type="button" className="fk-chip text-[var(--color-risk)]" onClick={() => setConfirmDel(true)}>删除全部数据</button> : <button type="button" className="fk-chip border-[var(--color-risk)] text-[var(--color-risk)]" onClick={() => { for (const c of COLLECTED) localStorage.removeItem(c.key); location.reload() }}>确认删除（不可恢复）</button>}</div></Row>
  </section>
}
