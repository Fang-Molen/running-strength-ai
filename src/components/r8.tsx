import { stampCN } from "@/lib/ui/activity-format";
import { isSyncPlatform, openDeviceSync } from "@/lib/ui/device-sync-navigation"
import { ImageIntake } from "./image-intake";
import { loadTrainingActivities, activityWeeks } from "@/lib/ui/training-read-model";
import { currentAthleteId, onAppEvent } from "@/lib/core/events";
import { clearOnboardingSyncDraft, readOnboardingSyncDraft, saveOnboardingSyncDraft } from "@/lib/ui/onboarding-sync-draft";
import { useEffect, useMemo, useRef, useState } from "react"
import { niceTicks } from "@/components/trend-chart"
import { Bell, Camera, ChevronRight, FileUp, Flame, Info, Plus, X } from "lucide-react"
import { DEFAULTS, EQUIPMENT, EXPERIENCE, GOALS, ONBOARD_KEY, ONBOARD_SKIPPED_KEY, PRESET, QUESTIONS, VENUES, WHEN, goalLabel, previewWeek, tierFor, toggleGoal, type Answers } from "@/lib/ui/first-run"
import { BRANDS, GROUP_HINT, TIERS, TIER_LABEL, WATCHES, gateRecovery, loadBrand, loadTier, loadWatch, saveTier, saveWatch, type Tier, type WatchId } from "@/lib/ui/watch-mode"
import { loadSchedule, updateSchedule } from "@/lib/ui/day-schedule"
import { addDays, weekOf, weekSummary, type ScheduleEntry } from "@/lib/ui/day-schedule-rules"
import { parseQuickLog, type Parsed } from "@/lib/ui/quick-log"
import { computeStreak } from "@/lib/ui/streak"
import { OVERRIDE_KEY, type Override } from "@/lib/ui/day-override"
import { COLLECTED, effective, loadSettings, saveSettings, type AppSettings } from "@/lib/ui/app-settings"
import { logMetrics } from "@/lib/ui/log-metrics"
import { recoveryVerdict } from "@/lib/ui/recovery-verdict"
import { readRecoveryInput, lastDeviceSync } from "@/components/health-extras"
import { loadVitals } from "@/lib/nutrition/vitals"
import { upsertCheck } from "@/lib/nutrition/body"
import { saveQuickTraining, withdrawQuickRecords, QL_PENDING, type QuickRecordRef } from "@/lib/ui/quick-log-save"
import { loadConfirmedTrainingImports } from "@/lib/core/training-import"
import { occurrenceVoided } from "@/lib/core/training-correction"
import { activityLocalDay } from "@/lib/ui/activity-format"
import { ocr } from "@/components/device-import"
import { SavedBadge } from "@/components/saved-badge"
import { EnergyGauge } from "@/components/energy-gauge"
import { HOME_CARDS, QUICK_OPTIONS, move, saveLayout, setQuick, toggleCard, type CardId, type Layout, type QuickId } from "@/lib/ui/home-layout"
import { parseHealthParam } from "@/lib/ui/shortcut-link"
import { saveDeviceRows } from "@/lib/ui/device-store"
import { Sheet, Toast, useToast } from "@/components/sheet"
import { pendingLocal, sentToday, support, SENT_KEY } from "@/lib/ui/notify"
import { loadInjury } from "@/lib/ui/injury"
import { IntradayTodayLine } from "@/components/intraday-panel"
import { AboutStep, EMPTY_ME, goalsForEvent, saveAboutMe, type AboutMe } from "@/components/onboarding-about"

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } }
export const loadAnswers = (): (Answers & { done?: boolean }) | null => read(ONBOARD_KEY, null)

/* ---------------- 1) 首次引导 ---------------- */
export function Onboarding({ today, onDone, suspended = false }: { today: string; onDone: () => void; suspended?: boolean }) {
  const [resume] = useState(() => { try { return typeof window === 'undefined' ? null : readOnboardingSyncDraft(sessionStorage, currentAthleteId()) } catch { return null } })
  const [step, setStep] = useState(resume?.step ?? 0)
  const q = step - 1 // v89.6：第 0 步“关于你”，原 5 题顺延
  const [me, setMe] = useState<AboutMe>(resume?.me ?? EMPTY_ME)
  const [added, setAdded] = useState<string[]>([])
  const [a, setA] = useState<Answers>(resume?.answers ?? DEFAULTS)
  const [brand, setBrand] = useState<string | null>(resume?.brand ?? null)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState("")
  const week = weekOf(today)
  const preview = useMemo(() => previewWeek(a, week, today), [a, week, today])
  const set = (p: Partial<Answers>) => setA({ ...a, ...p })
  const next = () => { setError(""); if (step === 0) setA({ ...a, goals: goalsForEvent(me.event, a.goals) }); setStep(step + 1) }
  const browse = () => {
    setError("")
    try {
      localStorage.setItem(ONBOARD_SKIPPED_KEY, "1")
      if (localStorage.getItem(ONBOARD_SKIPPED_KEY) !== "1") throw new Error("skip-not-saved")
    } catch { setError("未能保存进入状态，请重试。"); return }
    try { clearOnboardingSyncDraft(sessionStorage, currentAthleteId()) } catch { /* unavailable session storage */ }
    onDone()
  }
  const finish = async (accept: boolean) => {
    setError("")
    try {
      saveWatch(a.source, undefined, brand)
      const s = loadSchedule(); const ids = new Set(s.entries.map((e) => e.id))
      const add = preview.filter((e) => !ids.has(e.id)).map(({ why, ...e }) => ({ ...e, status: accept ? "planned" : "proposed", swapReason: why } as ScheduleEntry))
      if (!await updateSchedule(()=>({ ...s, entries: [...s.entries, ...add] }), 'onboarding-r8',s)) { setError("训练建议未能保存，请重试。"); return }
      saveAboutMe(me, a.days.length); setAdded(current => [...new Set([...current, ...add.map((e) => e.id)])])
      const answers = JSON.stringify({ ...a, done: true, at: new Date().toISOString() })
      localStorage.setItem(ONBOARD_KEY, answers)
      if (localStorage.getItem(ONBOARD_KEY) !== answers) throw new Error("answers-not-saved")
      localStorage.removeItem(ONBOARD_SKIPPED_KEY)
      if (localStorage.getItem(ONBOARD_SKIPPED_KEY) !== null) throw new Error("skip-not-cleared")
      try { clearOnboardingSyncDraft(sessionStorage, currentAthleteId()) } catch { /* unavailable session storage */ }
      setAccepted(true)
    } catch { setError("引导资料未能完整保存，请重试。"); }
  }
  const askNotify = async () => {
    let ok = false
    try { if (typeof Notification !== "undefined") ok = (await Notification.requestPermission()) === "granted" } catch { /* unsupported */ }
    const s = loadSettings(); saveSettings({ ...s, reminders: { ...s.reminders, master: ok } }); onDone()
  }
  const Opt = ({ on, onClick, label, sub }: { on: boolean; onClick: () => void; label: string; sub?: string }) => <button type="button" aria-pressed={on} onClick={onClick} className={"w-full rounded-2xl border p-3 text-left " + (on ? "border-accent bg-accent/10" : "border-line bg-surface")}><b>{label}</b>{sub ? <span className="block text-xs text-muted">{sub}</span> : null}</button>
  const body = step === 0 ? <AboutStep me={me} onChange={setMe} /> : q === 0 ? <div className="space-y-2">{WATCHES.map(([id, l]) => <Opt key={id} on={a.source === id} onClick={() => { set({ source: id }); setBrand(null) }} label={l} sub={`${GROUP_HINT[id]} · ${TIER_LABEL[TIERS[tierFor({ ...a, source: id })] ? tierFor({ ...a, source: id }) : "basic"]}`} />)}
      {BRANDS[a.source].length ? <select aria-label="品牌" className="fk-cell w-full" value={brand ?? ""} onChange={(e) => setBrand(e.target.value || null)}><option value="">品牌（只决定显示哪份说明）</option>{BRANDS[a.source].map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select> : null}
      <button type="button" className="min-h-12 w-full rounded-xl border border-line px-3 font-semibold text-accent" onClick={() => { try { saveOnboardingSyncDraft(sessionStorage, currentAthleteId(), { step, me, answers: a, brand }) } catch { /* setup remains usable */ }; openDeviceSync({ provider: isSyncPlatform(brand) ? brand : brand === "apple" ? "apple_health" : undefined }) }}>连接手表或运动软件</button></div>
    : q === 1 ? <div className="space-y-2"><p className="text-xs text-muted">最多选 2 个，第一个算主目标。</p>{GOALS.map(([id, l]) => <Opt key={id} on={a.goals.includes(id)} onClick={() => set({ goals: toggleGoal(a.goals, id) })} label={l} sub={a.goals[0] === id ? "主目标" : undefined} />)}</div>
    : q === 2 ? <div className="space-y-2"><p className="text-xs text-muted">按时间选，不用自我评价。</p>{EXPERIENCE.map(([id, l]) => <Opt key={id} on={a.experience === id} onClick={() => set({ experience: id })} label={`规律训练：${l}`} />)}</div>
    : q === 3 ? <div className="space-y-2">{VENUES.map(([id, l]) => <Opt key={id} on={a.venue === id} onClick={() => set({ venue: id, equipment: PRESET[id] })} label={l} />)}
      <p className="pt-1 text-xs text-muted">已按场地预勾，删改即可：</p><div className="flex flex-wrap gap-1.5">{EQUIPMENT.map((q) => <button key={q} type="button" className="fk-chip" aria-pressed={a.equipment.includes(q)} onClick={() => set({ equipment: a.equipment.includes(q) ? a.equipment.filter((x) => x !== q) : [...a.equipment, q] })}>{q}</button>)}</div></div>
    : q === 4 ? <div className="space-y-3"><p className="text-sm font-bold">每周哪几天</p><div className="grid grid-cols-7 gap-1">{["一", "二", "三", "四", "五", "六", "日"].map((d, i) => <button key={d} type="button" aria-pressed={a.days.includes(i)} onClick={() => set({ days: a.days.includes(i) ? a.days.filter((x) => x !== i) : [...a.days, i] })} className={"grid aspect-square place-items-center rounded-full border text-sm font-bold " + (a.days.includes(i) ? "border-accent bg-accent text-accent-fg" : "border-line")}>{d}</button>)}</div>
      <p className="text-sm font-bold">每次多长</p><div className="grid grid-cols-4 gap-1.5">{([20, 30, 45, 60] as const).map((m) => <button key={m} type="button" className="fk-chip justify-center" aria-pressed={a.minutes === m} onClick={() => set({ minutes: m })}>{m === 60 ? "60+" : m} 分</button>)}</div>
      <p className="text-sm font-bold">通常什么时候练 <span className="text-xs font-normal text-muted">（可选，提醒按这个来）</span></p><div className="grid grid-cols-3 gap-1.5">{WHEN.map(([id, l]) => <button key={id} type="button" className="fk-chip justify-center" aria-pressed={a.when === id} onClick={() => set({ when: a.when === id ? null : id })}>{l}</button>)}</div></div>
    : null
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-bg" style={suspended ? { display: "none" } : undefined} role="dialog" aria-label="首次引导">
    <div className="fk-onboard-safe mx-auto max-w-xl px-4 pb-10 pt-5">
      {error ? <p role="alert" className="mb-3 rounded-xl border border-risk p-3 text-sm text-risk">{error}</p> : null}
      {step < 6 ? <>
        <div className="flex items-center gap-3"><span className="text-sm font-bold">{step + 1}/6</span><div className="h-1.5 flex-1 rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${(step + 1) * 100 / 6}%` }} /></div>{step === 0 ? <button type="button" className="min-h-11 shrink-0 px-2 text-sm font-bold" onClick={browse}>先逛逛</button> : null}</div>
        <h1 className="mt-4 text-2xl font-bold">{["先认识一下你", "你的数据从哪来？", "你想练成什么？", "你规律训练多久了？", "在哪练？有什么器械？", "每周能练多少？"][step]}</h1>
        <p className="mt-1 text-xs text-muted">{step === 0 ? "资料只存在这台设备上" : QUESTIONS[q]} · 伤病和饮食等用到时再问</p>
        <div className="mt-4">{body}</div>
        <div className="mt-6 flex gap-2">{step ? <button type="button" className="fk-chip min-h-12 px-4" onClick={() => setStep(step - 1)}>上一步</button> : null}<button type="button" className="fk-primary min-h-12 flex-1" onClick={next}>下一步</button></div>
        <button type="button" className="fk-link mt-3 w-full text-center text-sm" onClick={() => { if (step === 0) setMe(EMPTY_ME); else setA({ ...a, ...pickDefault(q) }); next() }}>跳过，用默认</button>
      </> : !accepted ? <>
        <h1 className="text-2xl font-bold">本周训练建议</h1>
        <p className="mt-1 text-sm text-muted">为了「{goalLabel(a.goals[0] ?? "fitness")}」· {TIER_LABEL[tierFor(a)]} · 每节都是方坤的建议，可以逐个改。</p>
        <div className="mt-3 space-y-2">{preview.length ? preview.map((e) => <div key={e.id} className={"rounded-2xl border-l-4 bg-surface p-3 " + (e.modality === "run" ? "border-l-[#2182bd]" : "border-l-[#d07a2b]")}><p className="font-bold">周{"一二三四五六日"[week.indexOf(e.date)]} · {e.title} · {e.minutes} 分钟{e.slot ? (e.slot === "pm" ? " · 今晚" : " · 上午") : ""}</p><p className="text-xs text-muted">{e.why}</p></div>) : <p className="text-sm text-muted">本周剩下的日子没有你选的训练日，下周一开始。</p>}</div>
        <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" className="fk-primary min-h-12" onClick={() => finish(true)}>接受</button><button type="button" className="fk-chip min-h-12 justify-center" onClick={() => finish(false)}>逐个调整</button></div>
        <p className="mt-2 text-xs text-muted">“逐个调整”会放到首页的待确认卡上：接受 / 自己改 / 换一个 / 不要。</p>
      </> : <>
        {added.length ? <button type="button" data-testid="onboard-undo" className="mb-3 min-h-11 w-full rounded-xl border border-line text-sm" onClick={async () => { const ids = new Set(added); if(await updateSchedule(s=>({ ...s, entries: s.entries.filter((e) => !ids.has(e.id)) }), "onboarding-r8"))setAdded([]) }}>撤销刚加入的 {added.length} 节（回到没有计划）</button> : null}<Bell className="size-10 text-accent" /><h1 className="mt-3 text-2xl font-bold">要不要到点提醒你？</h1>
        <p className="mt-1 text-sm text-muted">到点提醒你今天的课；晚上还没记录再提醒一次。每天最多 2 条，随时可在设置里关。</p>
        <button type="button" className="fk-primary mt-5 min-h-12 w-full" onClick={askNotify}>打开提醒</button>
        <button type="button" className="fk-link mt-3 w-full text-center text-sm" onClick={onDone}>暂不需要</button>
      </>}
    </div>
  </div>
}
const pickDefault = (step: number): Partial<Answers> => [{ source: DEFAULTS.source }, { goals: DEFAULTS.goals }, { experience: DEFAULTS.experience }, { venue: DEFAULTS.venue, equipment: DEFAULTS.equipment }, { days: DEFAULTS.days, minutes: DEFAULTS.minutes, when: null }][step] ?? {}

/** v83：记一笔的训练事实（不在日程里）同样算打卡 */
function quickDays(): Set<string> { try { return new Set(loadConfirmedTrainingImports().filter(x => /^act-q-n-/.test(x.draftId) && !occurrenceVoided(x.confirmedImportId) && x.occurredAt.value).map(x => activityLocalDay(x.occurredAt.value!)).filter((d): d is string => !!d)) } catch { return new Set() } }
/* ---------------- 2) 首页摘要：目标回响 + 连续打卡 + 基线 + 恢复一句话 + 今天临时改 ---------------- */
export function HomeHeader({ today, revision, onRecovery, onOverride, layout, onQuick, onEdit, trainingStarted = true }: { today: string; revision: number; onRecovery: () => void; onOverride: (o: Override | null) => void; layout: Layout; onQuick: (id: QuickId | "more") => void; onEdit: () => void; trainingStarted?: boolean }) {
  const [st, setSt] = useState<{ goal: string | null; done: number; planned: number; streak: ReturnType<typeof computeStreak>; baseline: number; verdict: string; reason: string; hasRecoveryRecord: boolean; ov: Override | null } | null>(null)
  useEffect(() => {
    if (!today) return
    const s = loadSchedule(), wk = weekOf(today), ans = loadAnswers(), sum = weekSummary(s.entries, wk, today)
    const tier = loadTier(), recovery = readRecoveryInput(today), v = recoveryVerdict(gateRecovery(tier, recovery))
    const hasRecoveryRecord = recovery.pain != null || [recovery.readiness, recovery.bodyBattery, recovery.sleepH, recovery.hrv, recovery.rhr, recovery.subjective, recovery.stress].some(value => value != null && Number.isFinite(value))
    const days = new Set(loadVitals().records.map((r) => r.observedOn)); for (const c of read<{ date: string }[]>("fk-checkin-v1", [])) days.add(c.date)
    const ov = read<Override | null>(OVERRIDE_KEY, null)
    setSt({ goal: ans?.goals?.[0] ? goalLabel(ans.goals[0]) : null, done: sum.asPlanned + sum.different, planned: sum.planned, streak: computeStreak(s.entries, today, quickDays()), baseline: Math.max(0, 7 - days.size), verdict: v.title, reason: v.reasons[0] ?? "", hasRecoveryRecord, ov: ov?.date === today ? ov : null })
  }, [today, revision])
  if (!st) return null
  const setOv = (p: Partial<Override>) => { const n = { ...(st.ov ?? { date: today }), ...p, date: today }; const val = n.short || n.home ? n : null; localStorage.setItem(OVERRIDE_KEY, JSON.stringify(val)); setSt({ ...st, ov: val }); onOverride(val) }
  const ord = (id: CardId) => ({ order: layout.order.indexOf(id) })
  const vis = (id: CardId) => !layout.hidden.includes(id)
  return <>
    {trainingStarted && vis("summary") && (st.goal || st.streak.days > 0) ? <div style={ord("summary")} className="mb-2 flex items-center gap-2 px-1 text-sm" aria-label="目标与连续打卡">
      {st.goal ? <span className="rounded-full bg-[#7a5cc7]/12 px-2.5 py-1 font-bold text-[#6a4cb7]">为了{st.goal}：本周 {st.done}/{st.planned}</span> : null}
      <span className="ml-auto flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 font-bold" title="完成一节或登记实际不同都算；每周 2 次休息不断签"><Flame className={"size-4 " + (st.streak.todayDone ? "text-[#e07b2b]" : "text-muted")} />连续 {st.streak.days} 天{st.streak.frozen.length ? <span className="text-[10px] font-normal text-muted">（含休息 {st.streak.frozen.length}）</span> : null}</span>
    </div> : null}
    {vis("recovery") && (trainingStarted || st.hasRecoveryRecord) ? <button type="button" style={ord("recovery")} onClick={onRecovery} className="mb-2 flex w-full items-center gap-2 rounded-2xl border-l-4 border-l-[#269775] bg-surface px-3 py-2 text-left text-sm" aria-label="今日恢复">
      <b className="shrink-0 text-fg">恢复</b><span className="min-w-0 flex-1">{st.verdict}</span>
      <ChevronRight className="size-4 shrink-0 text-muted" />
    </button> : null}
    {vis("recovery") ? <div style={ord("recovery")}><IntradayTodayLine today={today} onOpen={() => window.dispatchEvent(new CustomEvent("fk-open-intraday"))} /></div> : null}
    {trainingStarted && vis("override") ? <details style={ord("override")} className="mb-2 border-b border-line px-1" aria-label="今天临时改"><summary className="min-h-11 cursor-pointer text-sm"><span>调整今天</span><span className="ml-auto text-muted">{[st.ov?.short ? "20分钟" : null, st.ov?.home ? "在家" : null].filter(Boolean).join(" · ") || "时间与场地"} ›</span></summary>
      <div className="flex flex-wrap gap-2 pb-3"><button type="button" className="fk-chip" aria-pressed={!!st.ov?.short} onClick={() => setOv({ short: !st.ov?.short })}>只有 20 分钟</button>
      <button type="button" className="fk-chip" aria-pressed={!!st.ov?.home} onClick={() => setOv({ home: !st.ov?.home })}>今天在家</button></div></details> : null}
    {trainingStarted && vis("quick") ? <details style={ord("quick")} className="mb-3 border-b border-line px-1" aria-label="快捷入口"><summary className="min-h-11 cursor-pointer text-sm">快捷工具<span className="ml-auto text-muted">›</span></summary><div className="grid grid-cols-5 gap-1.5 pb-3">
      {layout.quick.map((q) => <button key={q} type="button" onClick={() => onQuick(q)} className="flex min-h-14 flex-col items-center justify-center rounded-xl bg-surface text-xs font-bold">{QUICK_LABEL[q]}</button>)}
      <button type="button" onClick={() => onQuick("more")} className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-line text-xs text-muted">自定义</button>
    </div></details> : null}
    {trainingStarted ? <button type="button" style={{ order: 99 }} onClick={onEdit} className="fk-link mx-auto mb-2 text-xs">编辑首页卡片</button> : null}
  </>
}
const QUICK_LABEL = Object.fromEntries(QUICK_OPTIONS) as Record<QuickId, string>

/** 首页编辑：增删、排序、4 格快捷入口（“更多”固定）。 */
export function HomeEditor({ layout, onChange, onClose }: { layout: Layout; onChange: (l: Layout) => void; onClose: () => void }) {
  const [stamp, setStamp] = useState(0)
  const up = (l: Layout) => { saveLayout(l); onChange(l); setStamp(Date.now()) }
  const name = Object.fromEntries(HOME_CARDS) as Record<CardId, string>
  return <div className="fixed inset-0 z-40 flex items-end bg-black/30 md:items-center" onClick={onClose}>
    <section role="dialog" aria-label="编辑首页" onClick={(e) => e.stopPropagation()} className="mx-auto max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-bg p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:rounded-3xl">
      <div className="flex items-center justify-between"><h2 className="text-lg font-bold">编辑首页</h2><SavedBadge stamp={stamp} /><button type="button" aria-label="关闭" onClick={onClose} className="grid size-10 place-items-center"><X className="size-5" /></button></div>
      <p className="text-xs text-muted">改动当场生效。“本周训练”是首页主体，不能隐藏。</p>
      <ul className="mt-2 divide-y divide-line rounded-2xl bg-surface px-3">{layout.order.map((id, i) => <li key={id} className="flex min-h-12 items-center gap-2">
        <input type="checkbox" aria-label={`显示${name[id]}`} checked={!layout.hidden.includes(id)} disabled={id === "week"} onChange={() => up(toggleCard(layout, id))} className="size-5" />
        <span className={"flex-1 text-sm " + (layout.hidden.includes(id) ? "text-muted line-through" : "")}>{name[id]}</span>
        <button type="button" aria-label={`上移${name[id]}`} disabled={i === 0} onClick={() => up(move(layout, id, -1))} className="grid size-10 place-items-center disabled:opacity-30">↑</button>
        <button type="button" aria-label={`下移${name[id]}`} disabled={i === layout.order.length - 1} onClick={() => up(move(layout, id, 1))} className="grid size-10 place-items-center disabled:opacity-30">↓</button></li>)}</ul>
      <p className="mt-3 text-sm font-bold">快捷入口（4 格 + 固定“更多”）</p>
      <div className="mt-1 grid grid-cols-2 gap-2">{layout.quick.map((q, i) => <label key={i} className="text-xs text-muted">第 {i + 1} 格<select aria-label={`快捷入口${i + 1}`} value={q} onChange={(e) => up(setQuick(layout, i, e.target.value as QuickId))} className="fk-cell mt-1 w-full">{QUICK_OPTIONS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>)}</div>
    </section></div>
}

/* ---------------- 3) 全局“+记一笔” ---------------- */
// v83（P0-03）：记一笔只写一条“计划外”训练事实；不造“按计划完成”的日程条目、不补默认 30 分钟、不按组数估用时。
function saveParsed(p: Parsed, today: string, rpe: number | null, noteId: string, at: string): { msg: string; ok: boolean; soft?: boolean; ref?: QuickRecordRef } {
  if (p.kind === "weight") return upsertCheck({ date: p.date ?? today, weight: p.kg } as never) ? { ok: true, msg: `已记体重 ${p.kg} kg` } : { ok: false, msg: "保存失败" }
  if (p.kind === "unknown") return { ok: false, msg: "没认出来" }
  const r = saveQuickTraining(p, noteId, at, rpe)
  return r.ok ? { ok: true, msg: r.msg, ref: r.ref } : { ok: false, soft: r.soft, msg: r.msg }
}
type Att = { id: string; name: string; url: string };
type Note = { id: string; date: string; at: string; text: string; atts: Att[]; parsed?: string; /** v83：这条笔记生成的训练事实（稳定关联；删除时可一起撤回） */ records?: QuickRecordRef[] };
const QL_DRAFT = "fk-quicklog-draft-v1", NOTES = "fk-notes-v1";
const loadNotes = (): Note[] => { try { const v = JSON.parse(localStorage.getItem(NOTES) || "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
async function toThumb(file: File): Promise<string> {
  const { shrink } = await import("@/lib/nutrition/food-photo"); const blob = await shrink(file, 640)
  return await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(blob) })
}
export function QuickLog({ today, onSaved, onFile, openWith }: { today: string; onSaved: () => void; onFile: () => void; openWith?: { text: string; n: number } | null; hideFab?: boolean }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(""), [atts, setAtts] = useState<Att[]>([])
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [rpe, setRpe] = useState<number | null>(null), [ocrMsg, setOcrMsg] = useState("")
  const [notes, setNotes] = useState<Note[]>([]), [toast, setToast] = useToast()
  const loaded = useRef(false), saving = useRef(false)
  useEffect(() => { try { const d = JSON.parse(localStorage.getItem(QL_DRAFT) || "null"); if (d) { setText(d.text || ""); setAtts(d.atts || []) } } catch { /* none */ } loaded.current = true }, [])
  useEffect(() => { if (!loaded.current) return; try { if (text || atts.length) localStorage.setItem(QL_DRAFT, JSON.stringify({ text, atts })); else localStorage.removeItem(QL_DRAFT) } catch { /* draft best-effort */ } }, [text, atts])
  useEffect(() => { if (openWith) { setText(openWith.text); setOpen(true) } }, [openWith])
  useEffect(() => { const h = () => setOpen(true); window.addEventListener("fk-open-quicklog", h); return () => window.removeEventListener("fk-open-quicklog", h) }, [])
  useEffect(() => { if (open) setNotes(loadNotes()) }, [open])
  const taRef = useRef<HTMLTextAreaElement>(null), fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const t = taRef.current; if (t) { t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight, 260)}px` } }, [text, open])
  const parsedLines = useMemo(() => text.split(/\n|；|;/).filter(l=>l.trim()).map(l => parseQuickLog(l.trim(), today)), [text, today]);
  const multipleRecords = parsedLines.length > 1;
  const p: Parsed | null = parsedLines.length === 1 && parsedLines[0].kind !== "unknown" ? parsedLines[0] : null;
  const unrecorded=parsedLines.flatMap(p=>p.unrecorded??[]);
  const save = () => {
    if (saving.current) return
    if (!text.trim() && !atts.length) { setErr("先写点什么或加一张截图"); return }
    saving.current = true; setBusy(true); setErr("")
    try {
      // 幂等：上次训练已入库但笔记没存上 → 重试沿用同一个 id，不会记两条
      const body = text.trim(), pend = (() => { try { return JSON.parse(localStorage.getItem(QL_PENDING) || "null") as { id: string; at: string; text: string } | null } catch { return null } })()
      const id = pend?.text === body ? pend.id : `n-${Date.now()}`, at = pend?.text === body ? pend.at : new Date().toISOString()
      let parsedMsg = "", ref: QuickRecordRef | undefined, soft = false
      if (p) {
        try { localStorage.setItem(QL_PENDING, JSON.stringify({ id, at, text: body })) } catch { /* 最多重试时重复检查失效 */ }
        const r = saveParsed(p, today, rpe, id, at); parsedMsg = r.msg; ref = r.ref; soft = !!r.soft
        if (!r.ok && !soft) throw new Error(r.msg)
      }
      const note: Note = { id, date: today, at, text: body, atts, parsed: p ? parsedMsg : undefined, ...(ref ? { records: [ref] } : {}) }
      const next = [note, ...loadNotes().filter(n => n.id !== id)]
      try { localStorage.setItem(NOTES, JSON.stringify(next)) } catch { throw new Error(ref ? "训练已记入日志，但笔记原文没存上（本机存储已满？），再点一次保存只补存笔记，不会重复记训练" : "本机存储已满或被禁用（截图较大时可先移除截图）") }
      localStorage.removeItem(QL_PENDING)
      setNotes(next); setText(""); setAtts([]); setRpe(null); localStorage.removeItem(QL_DRAFT); onSaved()
      if (ref) window.dispatchEvent(new Event("fk-training-activities-changed"))
      setToast(ref ? `已保存：${parsedMsg}` : p && !soft ? "已保存，并记入身体数据" : soft ? `已保存为笔记：${parsedMsg}` : "已保存为笔记")
    } catch (e) { saving.current = false; setErr(`保存失败：${(e as Error)?.message || "未知原因"}。输入已保留。`); setBusy(false); return }
    finally { setBusy(false); if (saving.current) setTimeout(() => { saving.current = false }, 600) }
  }
  // v83（P0-04）：删除笔记 ≠ 删除训练。有关联训练时让用户选；撤回 = 作废更正（日志/统计/方坤都不再算），5 秒内可撤销。
  const [askDel, setAskDel] = useState<Note | null>(null), [undo, setUndo] = useState<{ note: Note; withdrawn: number } | null>(null)
  const delNote = (n: Note, withdraw: boolean) => {
    const next = loadNotes().filter((x) => x.id !== n.id)
    try { localStorage.setItem(NOTES, JSON.stringify(next)) } catch { setErr("删除失败，请重试"); return }
    setNotes(next); setAskDel(null)
    const linked = n.records?.length ?? 0
    let withdrawn = 0
    if (withdraw && linked) { withdrawn = withdrawQuickRecords(n.records); window.dispatchEvent(new Event("fk-training-activities-changed")) }
    setToast(!linked ? (/^已记入训练日志/.test(n.parsed ?? "") ? "已删除笔记；这是旧版本笔记，没存关联，它记的训练仍在训练日志（要撤回请在日志里点这条→作废）" : "已删除笔记（没有关联训练记录，不影响训练日志）") : withdraw ? (withdrawn === linked ? "已删除笔记，并撤回它记的训练（日志/统计不再计入）" : `笔记已删除；训练撤回 ${withdrawn}/${linked} 条，其余请到训练日志里处理`) : "已删除笔记；它记的训练仍保留在训练日志")
    setUndo({ note: n, withdrawn }); setTimeout(() => setUndo(u => u?.note.id === n.id ? null : u), 5000)
  }
  const undoDel = () => {
    if (!undo) return
    const next = [undo.note, ...loadNotes().filter(x => x.id !== undo.note.id)].sort((a, b) => b.at.localeCompare(a.at))
    try { localStorage.setItem(NOTES, JSON.stringify(next)) } catch { setErr("撤销失败，请重试"); return }
    if (undo.withdrawn) { withdrawQuickRecords(undo.note.records, true); window.dispatchEvent(new Event("fk-training-activities-changed")) }
    setNotes(next); setUndo(null); setToast("已撤销删除")
  }
  return <>
    <Toast msg={toast} />
    {open ? <Sheet label="记一笔" title="记一笔" sub={`${Number(today.slice(5, 7))}月${Number(today.slice(8, 10))}日 · 关闭会保留草稿`} onClose={() => setOpen(false)}
      footer={<>{err ? <p role="alert" className="keep mb-2 text-sm text-[var(--color-risk)]">{err}</p> : null}<div className="flex gap-2">
        <button type="button" className="min-h-12 rounded-xl border border-line px-4" onClick={() => setOpen(false)}>取消</button>
        <button type="button" disabled={busy} className="fk-orange-btn min-h-12 flex-1 rounded-xl text-base font-bold disabled:opacity-50" onClick={save}>{busy ? "保存中…" : "保存记录"}</button></div></>}>
      <textarea ref={taRef} aria-label="记录内容" rows={3} value={text} onChange={(e) => { setText(e.target.value.slice(0, 20000)); setErr("") }} placeholder="记录训练、体重或身体感受……" className="fk-cell w-full resize-none whitespace-pre-wrap break-words py-2 text-base leading-relaxed" />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="fk-chip" onClick={() => { setOpen(false); onFile() }}><FileUp className="size-4" />导入文件（FIT/GPX）</button>
      </div>
      <ImageIntake title="截图完整识别" onText={(raw, file) => { setText(x => (x ? x + "\n" : "") + raw); setErr(""); if (file && atts.length < 3) void toThumb(file).then(url => setAtts(a => [...a, {id:crypto.randomUUID(),name:file.name,url}])).catch(() => setErr("文字已保留，图片附件保存失败，请重新选择。")); }} />
      {atts.length ? <div className="mt-2 flex flex-wrap gap-2" aria-label="附件">{atts.map(a => <div key={a.id}><img src={a.url} alt={a.name} className="size-20 rounded-lg object-contain" /><button type="button" className="min-h-11 text-xs text-accent" onClick={() => setAtts(v => v.filter(x => x.id !== a.id))}>移除图片</button></div>)}</div> : null}
      {unrecorded.length>0?<p role="status" className="mt-2 text-sm text-amber-400">识别范围：{unrecorded.join("；")}</p>:null}
      {multipleRecords ? <p className="mt-2 text-sm text-amber-400">检测到多条数据，快速记录将完整保存为笔记。请到“详细记录”逐项核对后入库，不会只记录第一条。</p> : null}
      {text.trim() ? <div className="mt-3 rounded-2xl border border-line bg-surface p-3 text-sm" aria-label="识别结果">
        {p ? <>{p.kind === "run" ? <p><b className="text-[#2182bd]">识别为跑步</b> · {p.title} · 距离 {p.km ?? "—"} 公里 · 用时 {p.minutes ?? "—"} 分{p.pace ? ` · 配速 ${p.pace}` : ""}</p>
          : p.kind === "strength" ? <p><b className="text-[#d07a2b]">识别为力量</b> · {p.name} · {p.sets} 组 × {p.reps} 次 · {p.kg ?? (p.weightBasis === '自重' ? '自重' : '重量未知')}{p.kg ? ` kg（${p.weightBasis ?? '口径未确认'}）` : ""}</p>
          : p.kind === "weight" ? <p><b>识别为体重</b> · {p.kg} kg</p> : null}
          <p className="keep mt-1 text-xs text-muted">记录日期：{p.date ?? today}。保存后会记入数据，原文也会作为笔记保留。</p>
          {p.kind === "run" || p.kind === "strength" ? <div className="mt-2"><EnergyGauge compact mode={p.kind === "run" ? "run" : "strength"} label="用力（可不填）" value={rpe} onChange={setRpe} /></div> : null}</>
          : <p className="text-muted">没有识别出训练或体重数据，将作为笔记保存，不会丢失。</p>}
      </div> : null}
      {notes.length ? <div className="mt-4"><p className="text-sm font-bold">已保存的记录</p><ul className="mt-1 divide-y divide-line">{notes.slice(0, 5).map((n) => <li key={n.id} className="flex items-start gap-2 py-2 text-sm"><div className="min-w-0 flex-1"><p className="whitespace-pre-wrap break-words">{n.text || "（截图）"}</p><p className="keep text-[11px] text-muted">{stampCN(n.at)}{n.atts.length ? ` · ${n.atts.length} 张截图` : ""}{n.parsed ? ` · ${n.parsed}` : ""}</p></div><button type="button" className="min-h-9 shrink-0 rounded-lg border border-[var(--color-risk)] px-2 text-xs text-[var(--color-risk)]" onClick={() => n.records?.length ? setAskDel(n) : delNote(n, false)}>删除已保存记录</button></li>)}</ul></div> : null}
      {askDel ? <div role="dialog" aria-label="删除这条记录" className="mt-3 rounded-2xl border border-[var(--color-risk)] p-3 text-sm">
        <p className="font-bold">这条笔记记过一条训练（{askDel.parsed ?? "已记入训练日志"}）</p>
        <p className="keep mt-1 text-xs text-muted">只删笔记：训练日志里那条训练保留。删除并撤回：训练也不再计入日志、统计和方坤（可在 5 秒内撤销，之后也能在训练日志里恢复）。</p>
        <div className="mt-2 grid gap-2">
          <button type="button" className="min-h-11 rounded-xl border border-line" onClick={() => delNote(askDel, false)}>仅删除笔记（训练保留）</button>
          <button type="button" className="min-h-11 rounded-xl border border-[var(--color-risk)] text-[var(--color-risk)]" onClick={() => delNote(askDel, true)}>删除并撤回这条训练</button>
          <button type="button" className="min-h-11 text-xs text-muted" onClick={() => setAskDel(null)}>取消</button></div></div> : null}
      {undo ? <div role="status" className="mt-2 flex items-center justify-between rounded-xl bg-surface p-2 text-sm"><span>已删除</span><button type="button" className="min-h-11 px-3 font-bold text-accent" onClick={undoDel}>撤销</button></div> : null}
    </Sheet> : null}
  </>
}

/* ---------------- 训练日志：按版本显示的指标 ---------------- */
export function LogMetricsPanel({ today, loadOnly = false }: { today: string; loadOnly?: boolean }) {
  const [m, setM] = useState<ReturnType<typeof logMetrics> | null>(null), [tier, setTier] = useState<Tier>("basic"), [info, setInfo] = useState(false), [count, setCount] = useState(0)
  const [missingIntensity, setMissingIntensity] = useState(false);
  useEffect(() => {
    if (!today) return;
    const refresh = () => { const t = loadTier(), es = loadSchedule().entries, rows = loadTrainingActivities(); setTier(t); const metrics = logMetrics(t, es, today); setM({ ...metrics, trend: metrics.trend ? activityWeeks(rows, today) : null }); const since = new Date(new Date(today + 'T12:00:00').getTime() - 6 * 864e5).toISOString().slice(0, 10); setCount(rows.filter(r => r.date >= since && r.date <= today).length); setMissingIntensity(rows.some(r => r.date >= since && r.date <= today && r.rpe == null)); };
    refresh(); const unsubscribe = onAppEvent(refresh); window.addEventListener('fk-schedule-changed', refresh); window.addEventListener('fk-training-activities-changed', refresh); window.addEventListener('storage', refresh); return () => { unsubscribe(); window.removeEventListener('fk-schedule-changed', refresh); window.removeEventListener('fk-training-activities-changed', refresh); window.removeEventListener('storage', refresh); };
  }, [today]);
  if (loadOnly && m && !m.load) return <p className="keep text-xs text-muted">负荷比需要“进阶”及以上版本，或近 7 天活动都有主观强度（RPE）。</p>
  if (!m || (!m.trend && !m.load)) return null
  const max = Math.max(1, ...(m.trend ?? []).map((x) => x.minutes))
  return <section className="fk-dash-card mx-3 mb-3 p-3 text-sm" aria-label="本周概览">
    <div className="flex items-center justify-between gap-2"><h2 className="fk-dash-title text-base">{loadOnly ? "训练负荷" : "本周概览"}</h2><span className="keep ml-auto text-xs text-muted">{loadOnly ? `近 7 天（${new Date(Date.parse(today + "T12:00:00Z") - 6 * 864e5).toISOString().slice(5, 10)}–${today.slice(5)}）${count} 条` : `近 7 天 ${count} 条活动记录`} · {TIER_LABEL[tier]}</span><button type="button" aria-label="依据" aria-expanded={info} className="grid size-8 place-items-center" onClick={() => setInfo(!info)}><Info className="size-4 text-muted" /></button></div>
    {m.trend && !loadOnly ? (() => { const tk = niceTicks(0, max, 3); const top = tk[tk.length - 1] || 1; return <div className="mt-2 flex gap-1"><div className="relative h-20 w-8 text-[10px] text-muted">{tk.map((v) => <span key={v} className="absolute right-1 translate-y-1/2" style={{ bottom: `${(v / top) * 100}%` }}>{v}</span>)}<span className="absolute -top-3 left-0">分钟</span></div><div className="flex-1"><div className="relative flex h-20 items-end gap-2">{tk.map((v) => <i key={v} className="absolute inset-x-0 border-t border-line" style={{ bottom: `${(v / top) * 100}%` }} />)}{m.trend.map((x) => <div key={x.week} className="relative z-10 flex-1 rounded-t bg-[#ff6a1a]" style={{ height: `${(x.minutes / top) * 100}%` }} title={`${x.minutes} 分钟`} />)}</div><div className="flex gap-2 text-[10px] text-muted">{m.trend.map((x) => <span key={x.week} className="flex-1 text-center">{x.week.slice(5)}</span>)}</div></div></div>; })() : null}
    {m.load && !missingIntensity ? <p className="keep mt-2">已登记部分负荷：近 7 天 {m.load.acute} · 前 4 周周均 {m.load.chronicWeekly}{m.load.ratio != null ? ` · 比值 ${m.load.ratio}` : ""} </p> : null}
    {missingIntensity && m.load ? <p className="keep mt-2 text-xs text-muted">最近 7 天有活动没记主观强度（RPE），合并负荷比先不算。跑完在佳明手表上给训练打“自评强度”，或在方坤日志里补填 1–10 分，同步后就会显示。</p> : null}
    {info ? <p className="keep mt-1 text-[11px] text-muted">统计包含不同来源的活动记录；只按稳定来源身份去重，时间或距离相似不能证明同一课。活动记录数不是训练课次数；缺失时长未补零。负荷与比值仅是已登记部分的描述，不用于自动加量、减量或停训。</p> : null}
    {m.dynamics && info ? <p className="mt-1 text-xs text-muted">跑步动态（步频/触地/垂直振幅）与配速/心率区间：导入 FIT 后在每条记录里显示。</p> : null}
  </section>
}

/* ---------------- 5) 设置：8 组 ---------------- */
function Row({ title, sub, children, open, onToggle }: { title: string; sub: string; children: React.ReactNode; open: boolean; onToggle: () => void }) {
  return <div className="border-b border-line last:border-b-0"><button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-14 w-full items-center gap-2 py-2 text-left"><span className="flex-1"><b className="block">{title}</b><span className="text-xs text-muted">{sub}</span></span><ChevronRight className={"size-4 text-muted transition " + (open ? "rotate-90" : "")} /></button>{open ? <div className="pb-3 text-sm">{children}</div> : null}</div>
}
function Toggle({ label, on, onChange, disabled, small }: { label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; small?: boolean }) {
  return <label className={"flex min-h-11 items-center justify-between gap-2 " + (disabled ? "opacity-40" : "") + (small ? " pl-4 text-xs" : "")}><span>{label}</span><input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className={small ? "size-4" : "size-5"} /></label>
}
export type HubRow = "p" | "d" | "h" | "n" | "c" | "r" | "v" | "x"
/** only：R1 起各二级页只渲染对应行（存储与行为不变）；不传则与旧版一致全部渲染。 */
export function SettingsHub({ onProfile, onDiet, onBackup, only, initialOpen = null }: { onProfile: () => void; onDiet: () => void; onBackup: () => void; only?: HubRow[]; initialOpen?: HubRow | null }) {
  const [s, setS] = useState<AppSettings | null>(null), [open, setOpen] = useState<string | null>(initialOpen), [stamp, setStamp] = useState(0)
  const [w, setW] = useState<WatchId | null>(null), [tier, setT] = useState<Tier>("basic"), [ans, setAns] = useState<ReturnType<typeof loadAnswers>>(null), [sync, setSync] = useState<string | null>(null), [confirmDel, setConfirmDel] = useState(false)
  const [onboardingError, setOnboardingError] = useState("")
  useEffect(() => { setS(loadSettings()); setW(loadWatch()); setT(loadTier()); setAns(loadAnswers()); setSync(lastDeviceSync()) }, [])
  const restartOnboarding = () => {
    if (!window.confirm("重新开始引导？已有训练、健康记录不会删除。")) return
    setOnboardingError("")
    try {
      localStorage.removeItem(ONBOARD_SKIPPED_KEY)
      localStorage.removeItem(ONBOARD_KEY)
      if (localStorage.getItem(ONBOARD_SKIPPED_KEY) !== null || localStorage.getItem(ONBOARD_KEY) !== null) throw new Error("onboarding-not-reset")
      location.reload()
    } catch { setOnboardingError("未能重新打开引导，请重试。") }
  }
  if (!s) return null
  const up = (p: Partial<AppSettings>) => { const n = { ...s, ...p }; setS(n); saveSettings(n); setStamp(Date.now()) }
  const r = s.reminders, tg = (k: string) => setOpen(open === k ? null : k)
  const unset = "未设置，点击补充"
  const stale = sync ? (Date.now() - Date.parse(sync)) / 3600e3 > 24 : true
  const exportAll = () => { const data: Record<string, unknown> = {}; for (const c of COLLECTED) data[c.key] = read(c.key, null); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const el = document.createElement("a"); el.href = url; el.download = "fangkun-data.json"; el.click(); URL.revokeObjectURL(url) }
  const has = (k: HubRow) => !only || only.includes(k)
  const inj = loadInjury()
  const injText = inj.items.length ? `已记录 ${inj.items.length} 处需要留意（${inj.items.map((x) => x.part + (x.kind === "current" ? "·当前疼" : "·旧伤")).join("、")}）` : inj.asked ? "未记录不适（旧版“都没有”与“以后再说”存成同一状态）" : "尚未填写"
  return <section className="home-card mt-3 px-4" aria-label="设置">
    <div className="flex items-center justify-between pt-3"><h3 className="text-sm font-bold text-muted">修改后立即保存到本机</h3><SavedBadge stamp={stamp} /></div>
    {has("p") ? <Row title="训练条件（引导问卷）" sub={ans ? `${ans.goals.map(goalLabel).join("、")} · ${EXPERIENCE.find((x) => x[0] === ans.experience)?.[1]} · ${VENUES.find((x) => x[0] === ans.venue)?.[1]} · 每周可安排 ${ans.days.length} 天 × 约 ${ans.minutes} 分钟` : unset} open={open === "p"} onToggle={() => tg("p")}><p className="text-xs text-muted">「每周可安排」是你填写的可用时间，不是方坤开的训练处方，也不代表每天都练高强度。</p><button type="button" className="fk-link" onClick={onProfile}>编辑基本信息 ›</button><button type="button" className="fk-link ml-4" onClick={restartOnboarding}>重新填写引导 ›</button>{onboardingError ? <p role="alert" className="mt-2 text-sm text-risk">{onboardingError}</p> : null}</Row> : null}
    {has("d") ? <Row title="手表类型与显示版本" sub={`${w ? WATCHES.find((x) => x[0] === w)?.[1] : unset} · ${TIER_LABEL[tier]}${w && w !== "none" ? (sync ? ` · 最近收到设备数据 ${new Date(sync).toTimeString().slice(0, 5)}${stale ? "（超过 24 小时）" : ""}` : " · 暂无设备数据") : ""}`} open={open === "d"} onToggle={() => tg("d")}>
      <div className="flex flex-wrap gap-1.5">{WATCHES.map(([id, l]) => <button key={id} type="button" className="fk-chip" aria-pressed={w === id} onClick={() => { saveWatch(id, undefined, loadBrand()); setW(id); setT(loadTier()); setStamp(Date.now()) }}>{l}</button>)}</div>
      <p className="mt-2 text-xs font-bold">版本（可手动升降）</p><div className="mt-1 flex flex-wrap gap-1.5" aria-label="版本">{(Object.keys(TIERS) as Tier[]).map((id) => <button key={id} type="button" className="fk-chip" aria-pressed={tier === id} onClick={() => { saveTier(id); setT(id); setStamp(Date.now()) }}>{TIER_LABEL[id]}</button>)}</div><p className="mt-1 text-xs text-muted">{TIERS[tier].desc}</p>
      <p className="mt-1 text-sm text-muted">手表类型用于调整指标显示。账号连接和文件导入统一在「设备与数据同步」管理。</p><ShortcutGuide /></Row> : null}
    {has("h") ? <Row title="健康与安全" sub={`伤病：${injText} · 安全提醒 ${s.safetyLevel === "strict" ? "严格" : "标准"}`} open={open === "h"} onToggle={() => tg("h")}><div className="flex gap-1.5">{(["standard", "strict"] as const).map((k) => <button key={k} type="button" className="fk-chip" aria-pressed={s.safetyLevel === k} onClick={() => up({ safetyLevel: k })}>{k === "strict" ? "严格" : "标准"}</button>)}</div><p className="mt-1 text-xs text-muted">胸痛、晕厥等红框提醒不受任何设置影响。</p></Row> : null}
    {has("n") ? <Row title="饮食" sub={`目标：${({ gain: "增肌", cut: "减脂", keep: "保持", run: "跑步表现" } as Record<string, string>)[read<{ goal?: string }>("fk-diet-goal-v1", {}).goal ?? ""] ?? unset} · 忌口：${s.dietAvoid || "无"}`} open={open === "n"} onToggle={() => tg("n")}><button type="button" className="fk-link" onClick={onDiet}>改饮食目标 ›</button><input aria-label="忌口/过敏/素食" placeholder="忌口 / 过敏 / 素食（可选）" value={s.dietAvoid} onChange={(e) => up({ dietAvoid: e.target.value.slice(0, 40) })} className="fk-cell mt-2 w-full" /></Row> : null}
    {has("c") ? <Row title="方坤教练" sub={`${s.coachStyle === "brief" ? "简短" : "详细"} · 数据依据${s.showEvidence ? "显示" : "收起"} · 每周评估`} open={open === "c"} onToggle={() => tg("c")}>
      <div className="flex gap-1.5">{(["brief", "detailed"] as const).map((k) => <button key={k} type="button" className="fk-chip" aria-pressed={s.coachStyle === k} onClick={() => up({ coachStyle: k })}>{k === "brief" ? "简短（结论 + 最多 3 条）" : "详细"}</button>)}</div>
      <Toggle label="显示数据依据：每条建议下展开阈值和来源" on={s.showEvidence} onChange={(v) => up({ showEvidence: v })} /><p className="text-xs text-muted">安全类提醒（红框）不受风格影响，始终完整显示。</p></Row> : null}
    {has("r") ? <Row title="提醒" sub={r.master ? `已开 · 每天最多 2 条` : "已关"} open={open === "r"} onToggle={() => tg("r")}>
      <Toggle label="开启提醒" on={r.master} onChange={(v) => up({ reminders: { ...r, master: v } })} />
      <Toggle small label="训练提醒：上次训练约 24 小时后" on={r.training} disabled={!r.master} onChange={(v) => up({ reminders: { ...r, training: v } })} />
      <Toggle small label="晚上还没记录：21:00 提醒一次" on={r.evening} disabled={!r.master} onChange={(v) => up({ reminders: { ...r, evening: v } })} />
      <Toggle small label="待确认计划提醒" on={r.pending} disabled={!r.master} onChange={(v) => up({ reminders: { ...r, pending: v } })} />
      <Toggle small label="数据超过 24 小时未同步提醒" on={r.stale} disabled={!r.master} onChange={(v) => up({ reminders: { ...r, stale: v } })} />
      <NotifyStatus today={new Date().toISOString().slice(0, 10)} />
      <p className="text-[11px] text-muted">生效：{(["training", "evening", "pending", "stale"] as const).filter((k) => effective(r, k)).length} 项</p><p className="text-[11px] text-muted">红框安全提醒不受提醒开关影响。</p></Row> : null}
    {has("v") ? <Row title="单位与完成度色带" sub={`${s.units === "metric" ? "公里/公斤" : "英里/磅"} · 完成度色带${s.band ? `开（按${s.bandBasis === "time" ? "时长" : "距离"}）` : "关"}`} open={open === "v"} onToggle={() => tg("v")}>
      <div className="flex gap-1.5">{(["metric", "imperial"] as const).map((k) => <button key={k} type="button" className="fk-chip" aria-pressed={s.units === k} onClick={() => up({ units: k })}>{k === "metric" ? "公里/公斤" : "英里/磅"}</button>)}</div>
      <Toggle label="显示计划 vs 实际色带" on={s.band} onChange={(v) => up({ band: v })} />
      <div className={"flex gap-1.5 pl-4 " + (s.band ? "" : "pointer-events-none opacity-40")}>{(["time", "distance"] as const).map((k) => <button key={k} type="button" className="fk-chip" aria-pressed={s.bandBasis === k} onClick={() => up({ bandBasis: k })}>按{k === "time" ? "时长" : "距离（跑步）"}</button>)}</div></Row> : null}
    {has("x") ? <Row title="个性化与本机数据" sub={`个性化建议${s.personalize ? "开" : "关"} · 主要数据类别与删除`} open={open === "x"} onToggle={() => tg("x")}>
      <p className="text-xs font-bold">主要数据类别（存在本机浏览器）</p>
      <div className="mt-1 overflow-x-auto"><table className="fk-table text-xs"><thead><tr><th>数据</th><th>来源</th><th>用途</th></tr></thead><tbody>{COLLECTED.map((c) => <tr key={c.key}><td>{c.item}</td><td>{c.source}</td><td>{c.use}</td></tr>)}</tbody></table></div>
      <p className="mt-1 text-[11px] text-muted">上表是主要类别，不是完整清单（另有训练正式记录、饮食记录、计划与教练记录等）。这些记录保存在当前浏览器；使用佳明同步、拍照识别、联网对话时会有数据经服务端传输，见「隐私与数据流向」。</p>
      <Toggle label="个性化建议：按你的反馈和记录调整方坤的提议" on={s.personalize} onChange={(v) => up({ personalize: v })} />
      <div className="mt-1 flex flex-wrap gap-2"><button type="button" className="fk-chip" onClick={exportAll}>导出上表 8 类（JSON）</button><button type="button" className="fk-chip" onClick={onBackup}>备份与恢复 ›</button>
        {!confirmDel ? <button type="button" className="fk-chip text-[var(--color-risk)]" onClick={() => setConfirmDel(true)}>删除上表 8 类数据</button> : <button type="button" className="fk-chip border-[var(--color-risk)] text-[var(--color-risk)]" onClick={() => { for (const c of COLLECTED) localStorage.removeItem(c.key); location.reload() }}>确认删除这 8 类（不可恢复，建议先备份）</button>}</div></Row> : null}
  </section>
}

/* ---------------- 快捷指令带进来的健康数据：核对一次再存 ---------------- */
export function HealthLinkSheet({ text, onClose }: { text: string; onClose: (saved: boolean) => void }) {
  const r = useMemo(() => parseHealthParam(text), [text])
  const [msg, setMsg] = useState("")
  return <div className="fixed inset-0 z-40 flex items-end bg-black/30 md:items-center"><section role="dialog" aria-label="来自快捷指令的健康数据" className="mx-auto max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-bg p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:rounded-3xl">
    <h2 className="text-lg font-bold">来自快捷指令的健康数据</h2><p className="text-xs text-muted">核对后保存；同一天同一指标已存在的会跳过。</p>
    <div className="mt-2 overflow-x-auto"><table className="fk-table text-xs"><thead><tr><th>指标</th><th>日期</th><th>数值</th></tr></thead><tbody>{r.rows.slice(0, 60).map((x) => <tr key={x.key}><td>{x.metric}</td><td>{x.day}</td><td>{x.value}</td></tr>)}</tbody></table></div>
    {r.errors.length ? <p className="mt-1 text-xs text-[var(--color-risk)]">{r.errors.length} 行无法识别，已忽略。</p> : null}
    <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" className="fk-primary min-h-11" disabled={!r.rows.length} onClick={() => { const s = saveDeviceRows(r.rows, []); setMsg(`已保存 ${s.saved} 条，跳过 ${s.skipped} 条`); window.setTimeout(() => onClose(true), 900) }}>保存 {r.rows.length} 条</button><button type="button" className="fk-chip justify-center" onClick={() => onClose(false)}>取消</button></div>
    {msg ? <p className="mt-2 text-xs" role="status">{msg}</p> : null}
  </section></div>
}

/* ---------------- 本地提醒：App 打开期间按时弹（没有推送服务器） ---------------- */
export function useLocalReminders(today: string) {
  useEffect(() => {
    if (!today || typeof Notification === "undefined" || Notification.permission !== "granted") return
    const st = loadSettings(); if (!st.reminders.master) return
    const s = loadSchedule(), logged = s.entries.some((e) => e.date === today && e.actual)
    const last = s.entries.filter((e) => e.actual).map((e) => e.actual!.at).sort().at(-1) ?? null
    const timers = pendingLocal(last, new Date(), logged, { ...st.reminders, training: st.reminders.training, evening: st.reminders.evening }, sentToday(localStorage.getItem(SENT_KEY), today)).map((r) => window.setTimeout(() => void showLocal(r.text, today), Math.min(r.delayMs, 2 ** 31 - 1)))
    return () => timers.forEach(clearTimeout)
  }, [today])
}
export async function showLocal(text: string, today: string) {
  const n = sentToday(localStorage.getItem(SENT_KEY), today); if (n >= 2) return false
  localStorage.setItem(SENT_KEY, JSON.stringify({ date: today, count: n + 1 }))
  try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) { await reg.showNotification("方坤", { body: text, tag: "fk-reminder", data: { url: "/" } }); return true } } catch { /* fall back */ }
  try { new Notification("方坤", { body: text }); return true } catch { return false }
}
export function NotifyStatus({ today }: { today: string }) {
  const [info, setInfo] = useState<ReturnType<typeof support> | null>(null), [perm, setPerm] = useState("default"), [msg, setMsg] = useState("")
  useEffect(() => { setInfo(support(window as never)); setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission) }, [])
  if (!info) return null
  return <div className="mt-2 rounded-xl bg-surface-2 p-2 text-xs"><p>通知权限：{({ granted: "已允许", denied: "已拒绝（需在系统设置里打开）", default: "未询问", unsupported: "不支持" } as Record<string, string>)[perm]}</p><p className="text-muted">{info.note}</p>
    <div className="mt-1 flex gap-2">{perm === "default" ? <button type="button" className="fk-chip" onClick={async () => setPerm(await Notification.requestPermission())}>允许通知</button> : null}{perm === "granted" ? <button type="button" className="fk-chip" onClick={async () => setMsg((await showLocal("测试提醒：到点提醒你今天的课", today)) ? "已发送" : "今天已达 2 条上限或发送失败")}>发一条试试</button> : null}</div>{msg ? <p role="status">{msg}</p> : null}</div>
}

/* ---------------- iOS 快捷指令步骤 ---------------- */
export function ShortcutGuide() {
  const origin = typeof location === "undefined" ? "https://你的域名" : location.origin
  return <details className="mt-2 text-xs"><summary className="min-h-10 cursor-pointer font-bold">iOS 快捷指令设置步骤</summary>
    <p className="mt-1 font-bold">A. 记一笔（不打开表单，说一句就行）</p>
    <ol className="list-decimal space-y-0.5 pl-5"><li>快捷指令 App → 新建 → 添加“要求输入”（文本，提示“记什么？”）</li><li>添加“URL 编码”（输入：上一步的文本）</li><li>添加“打开 URL”：<code className="break-all">{origin}/?log=</code> 后接“URL 编码结果”</li><li>命名“方坤记一笔”，可加到主屏幕或对 Siri 说</li></ol>
    <p className="mt-2 font-bold">B. 苹果健康 → 方坤（睡眠 / 静息心率 / HRV / 体重）</p>
    <ol className="list-decimal space-y-0.5 pl-5"><li>添加“查找健康样本”：类型“静息心率”，开始日期“过去 7 天”，按日分组；同样再加 HRV、睡眠分析、体重</li><li>每类用“重复每一项”拼成一行：<code>RHR,日期(yyyy-MM-dd),数值</code>（睡眠写 SLEEP 小时，HRV 写 HRV 毫秒，体重 WEIGHT 公斤）</li><li>“合并文本”（换行）→“URL 编码”→“打开 URL”：<code className="break-all">{origin}/?health=</code> 后接编码结果</li><li>打开后 App 会列出数据让你核对一次再保存；数据只存在本机</li></ol>
    <p className="mt-1 text-muted">我们没有提供现成的 .shortcut 文件（无法在这里生成并签名），请按以上步骤自建；完整说明见 docs/ios-shortcut.md。</p></details>
}
