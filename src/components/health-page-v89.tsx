import { retainEvidenceDecision } from '@/lib/health/evidence-history'
import { readEvidenceDecision } from '@/lib/health/evidence-decision-host'
import { evidenceDecisionText } from '@/lib/health/evidence-decision'
/** R2: two health workspaces, one in-page metric explorer; original health sources and records remain authoritative. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { classifyFreshness } from "@/lib/health/recovery-freshness-u12"
import { ChevronLeft, ChevronRight, CalendarDays, Moon, Footprints, Dumbbell, BedDouble, Activity, HeartPulse, BatteryMedium, Gauge } from "lucide-react"
import { Sheet } from "./sheet"
import { useIntraday } from "./intraday-panel"
import { HealthSourceDetails } from "./health-source-details"
import { CheckinCard, PainLog } from "./health-extras"
import { loadWatch } from "@/lib/ui/watch-mode"
import { MuscleRecoveryV89 } from "./muscle-recovery-v89"
import { CorosHealthPanel } from "./coros-health-panel"
import { shiftDay, valueText } from "@/lib/health/observation"
import { loadHealthSnapshot, type HealthMetricView } from "@/lib/health/snapshot"
import { reviewFatigue, dailyCheckin } from "@/lib/health/analysis"
import { currentAthleteId } from "@/lib/core/events"
import { clock, minuteOfDay, type IntradayDay, type Sample } from "@/lib/health/garmin-intraday"
import { intradayRecoveryFromStore, typicalDay, type TypicalHour } from "@/lib/health/intraday-recovery-bridge-v89"
import type { View as U10View, Metric as U10Metric } from "@/lib/health/intraday-recovery-u10"
import { readRestHistory, REST_LABELS } from "@/lib/health/rest-store"
import { eventReadout, restOnDay, restReadout } from "@/lib/health/event-presentation"
import { garminStorageKey } from "@/lib/health/garmin-sync-runner"
import { loadIntraday } from "@/lib/health/intraday-store"
import { resolveBodyBattery, type CurrentHealthReading } from "@/lib/health/health-current"
import { subscribeHealthUpdates } from "@/lib/health/health-subscription"
import { reconcileHealthDay, intradayMatchesSource } from "@/lib/health/health-view-state"
import { todayDate } from "@/lib/nutrition/body"
import "./health-v89.css"

/** v89.3（合入 U12 新鲜度）：今天的读数按测量时刻标注新旧，不把几小时前的值写成“最新”。界面标签，不是生理阈值。 */
function freshSub(ms: number, hhmm: string) {
  const f = classifyFreshness({ metric: "BODY_BATTERY", asOf: new Date().toISOString(), measuredAt: new Date(ms).toISOString(), sourceId: "garmin", value: 0 })
  if (f.state === "CURRENT") return `最新 ${hhmm}`
  if (f.state === "RECENT") return `${hhmm} · ${f.ageMinutes}分钟前`
  if (f.state === "STALE") return `${hhmm} · 已${Math.round((f.ageMinutes ?? 0) / 60)}小时未更新`
  return hhmm
}
export type HealthTab = "recovery" | "body"
const TABS: [HealthTab, string][] = [["recovery", "恢复与趋势"], ["body", "身体与记录"]]
type ExplorerMetric = "bb" | "hr" | "st" | "hrv" | "sleep"
type Span = 1 | 7 | 30 | 90
const EXPLORER: [ExplorerMetric, string, string][] = [["bb", "身体电量", "BODY_BATTERY"], ["hr", "心率", "RHR"], ["st", "压力", "STRESS"], ["hrv", "HRV", "HRV"], ["sleep", "睡眠", "SLEEP"]]
function jumpTo(id: string) {
  requestAnimationFrame(() => { const node = document.getElementById(id); const disclosure = node?.closest("details"); if (disclosure) disclosure.open = true; node?.focus({ preventScroll: true }); node?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }) })
}
const mdCN = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`
const hm = (hours: number) => { const m = Math.round(hours * 60); return `${Math.floor(m / 60)}小时${m % 60}分` }
const hmDelta = (h: number) => { const m = Math.round(Math.abs(h) * 60); return m >= 60 ? `${Math.floor(m / 60)}小时${m % 60}分` : `${m}分` }

function useHealthRev() {
  const [rev, setRev] = useState(0)
  useEffect(() => subscribeHealthUpdates(() => setRev(x => x + 1), { batch: true, reconcile: true }), [])
  return rev
}

export function HealthPageV89({ body, slot, grid, stats, rest, trend, onCoach }: { body: ReactNode; slot?: ReactNode; grid: ReactNode; stats: ReactNode; rest: (day: string) => ReactNode; trend: (only?: string, endDay?: string, days?: number) => ReactNode; onCoach?: () => void }) {
  const today = todayDate()
  const [tab, setTab] = useState<HealthTab>("recovery")
  // v89.10.6：今天还没同步到手表逐时样本（如刚过零点）时，默认打开最近 3 天内有样本的那天；可随时点“今天”回来。
  const [day, setSelectedDay] = useState(() => { try { const all = loadIntraday(), has = (x: string) => !!(all[x]?.bb.length || all[x]?.hr.length); if (has(today)) return today; for (let i = 1; i <= 3; i++) { const x = shiftDay(today, -i); if (has(x)) return x } } catch { /* ignore */ } return today })
  const [muscle, setMuscle] = useState(false)
  const rev = useHealthRev()
  const historyPinned = useRef(false), previousToday = useRef(today)
  const setDay = (next: string) => { historyPinned.current = next !== today; setSelectedDay(next) }
  useEffect(() => {
    const current = loadIntraday()[today]
    const hasTodayData = !!(current?.bb.length || current?.hr.length || current?.st?.length)
      || loadHealthSnapshot(today).metrics.some(m => m.current?.day === today || m.candidates.some(p => p.day === today))
    const next = reconcileHealthDay({ day, today, previousToday: previousToday.current, historyPinned: historyPinned.current, hasTodayData })
    previousToday.current = today
    if (next !== day) setSelectedDay(next)
  }, [day, today, rev])
  useEffect(() => {
    const showTrend = () => { setTab("recovery"); jumpTo("fk-intraday") }
    const showRecords = () => { setTab("body"); requestAnimationFrame(() => { const d = document.getElementById("body-device-records"); if (d instanceof HTMLDetailsElement) d.open = true; jumpTo("body-device-records") }) }
    for (const name of ["fk-open-intraday", "fk-open-intraday-detail", "fk-h89-detail"]) window.addEventListener(name, showTrend)
    window.addEventListener("fk-open-health-records", showRecords)
    return () => { for (const name of ["fk-open-intraday", "fk-open-intraday-detail", "fk-h89-detail"]) window.removeEventListener(name, showTrend); window.removeEventListener("fk-open-health-records", showRecords) }
  }, [])
  return <div className="fk-health-v89 space-y-3" data-testid="health-v89">
    <nav className="fk-h89-tabs" aria-label="健康分区">{TABS.map(([id, l]) => <button key={id} type="button" aria-pressed={tab === id} aria-controls={`health-${id}`} onClick={() => setTab(id)}>{l}</button>)}</nav>
    <div id="health-recovery" hidden={tab !== "recovery"} className="space-y-3">
      <DaySwitch day={day} today={today} onDay={setDay} />
      <CorosHealthPanel day={day} />
      <RecoveryTab day={day} today={today} rev={rev} onDay={setDay} rest={rest} trend={trend} onCoach={onCoach} onMuscle={() => setMuscle(true)} />
    </div>
    <div id="health-body" hidden={tab !== "body"} className="space-y-3">{body}{slot}{grid}{stats}</div>
    {muscle ? <Sheet title="肌肉恢复" label="肌肉恢复" footer={null} full onClose={() => setMuscle(false)}><MuscleRecoveryV89 day={day} trend={trend(undefined, day)} onCoach={onCoach} /></Sheet> : null}
  </div>
}

function DaySwitch({ day, today, onDay }: { day: string; today: string; onDay: (d: string) => void }) {
  const min = shiftDay(today, -89)
  return <div className="fk-h89-date" aria-label="切换日期">
    <button type="button" aria-label="前一天" disabled={day <= min} onClick={() => onDay(shiftDay(day, -1))}><ChevronLeft className="size-4" /></button>
    <label className="relative flex items-center gap-1.5"><b>{mdCN(day)}{day === today ? " · 今天" : ""}</b><CalendarDays className="size-4 text-muted" />
      <input aria-label="选择日期" type="date" min={min} max={today} value={day} onChange={e => e.target.value && onDay(e.target.value > today ? today : e.target.value < min ? min : e.target.value)} className="absolute inset-0 opacity-0" /></label>
    <button type="button" aria-label="后一天" disabled={day >= today} onClick={() => onDay(shiftDay(day, 1))}><ChevronRight className="size-4" /></button>
    {day !== today ? <button type="button" className="fk-h89-return" onClick={() => onDay(today)}>今天</button> : null}
  </div>
}

/** 日指标：只取该日期的同一来源读数；没有就“暂无”，不拿最近一天顶替。 */
function onDay(view: HealthMetricView | undefined, day: string) { return view?.series.find(p => p.day === day) ?? (view?.current?.day === day ? view.current : null) }
function nearest(rows: Sample[], t: number, within = 30 * 60e3) { let best: Sample | null = null; for (const p of rows) if (Math.abs(p[0] - t) <= within && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p; return best }

function batteryCaption(reading: CurrentHealthReading, day: string, offset?: number | null): string {
  if (reading.value == null) return reading.statistic
  if (reading.basis === "DAILY_SUMMARY") return reading.statistic
  if (reading.measuredAt) {
    const t = Date.parse(reading.measuredAt), hhmm = clock(t, offset ?? null)
    return day === todayDate() ? freshSub(t, hhmm) : `测量于 ${hhmm}`
  }
  return `${reading.syncedAt ? clock(Date.parse(reading.syncedAt), offset ?? null) + "同步 · " : ""}测量时间未提供`
}
const decimalText = (value: number) => String(Number(value.toFixed(2)))
type Tile = { key: string; label: string; value: string | null; unit: string; sub: string; delta: string | null; tone: "up" | "down" | "flat" | null; note?: string; stale?: string }
function useTiles(day: string, rev: number, all: Record<string, IntradayDay>): Tile[] {
  return useMemo(() => {
    void rev
    const snap = loadHealthSnapshot(day), yday = shiftDay(day, -1)
    const v = (m: string) => snap.metrics.find(x => x.metric === m)
    const d = all[day], y = all[yday]
    const tiles: Tile[] = []
    // Tiles, trend headings and coach facts resolve the same source and timestamps.
    const bb = resolveBodyBattery(v("BODY_BATTERY"), d, day)
    const bbSub = batteryCaption(bb, day, d?.offsetMin)
    const sameSource = !!d?.sourceId && d.sourceId === y?.sourceId
    const prev = bb.basis === "INTRADAY" && bb.measuredAt && y && sameSource
      ? nearest(y.bb, Date.parse(bb.measuredAt) - 864e5) : null
    const dv = prev && bb.value != null ? bb.value - prev[1] : null
    tiles.push({ key: "BB", label: "身体电量", value: bb.value == null ? null : decimalText(bb.value), unit: "/100", sub: bbSub,
      stale: bb.measuredAt && day === todayDate() && !bbSub.startsWith("最新") ? bbSub : undefined,
      delta: dv == null ? null : `较昨日同时刻 ${dv > 0 ? "↑" : dv < 0 ? "↓" : ""}${decimalText(Math.abs(dv))}`,
      tone: dv == null ? null : dv > 0 ? "up" : dv < 0 ? "down" : "flat" })
    const daily = (key: string, metric: string, label: string, unit: string, fmt: (x: number) => string, dfmt: (x: number) => string, fallback?: number | null) => {
      const metricView = v(metric), p = onDay(metricView, day), q = onDay(metricView, yday)
      const canFallback = metricView?.state !== "CONFLICT" && !metricView?.selectedSource && !metricView?.availableSources.length
      const val = p?.value ?? (canFallback ? fallback : null) ?? null
      const dv = p && q && p.stream === q.stream ? p.value - q.value : null
      tiles.push({ key, label, value: val == null ? null : fmt(val), unit, sub: p ? p.source : metricView?.state === "CONFLICT" ? "来源待核对" : canFallback && fallback != null ? "佳明日内" : "暂无", delta: dv == null ? null : `较昨日 ${dv > 0 ? "↑" : dv < 0 ? "↓" : ""}${dfmt(Math.abs(dv))}`, tone: dv == null ? null : dv > 0 ? "up" : dv < 0 ? "down" : "flat" })
    }
    daily("RHR", "RHR", "静息心率", "bpm", x => String(Math.round(x)), x => String(Math.round(x)), d?.restingHr ?? null)
    // v89.1：佳明的睡眠/HRV 记在“醒来那天”。今天还没睡醒前（如凌晨）没有今天的值，显示最近一晚（昨天日期）并注明。
    const night = (key: string, metric: string, label: string, unit: string, fmt: (x: number) => string, dfmt: (x: number) => string) => {
      if (onDay(v(metric), day) || day !== todayDate()) return daily(key, metric, label, unit, fmt, dfmt)
      const p = onDay(v(metric), yday), q = onDay(v(metric), shiftDay(day, -2)), dv = p && q && p.stream === q.stream ? p.value - q.value : null
      tiles.push({ key, label, value: p ? fmt(p.value) : null, unit, sub: p ? `最近一晚 ${yday.slice(5)}` : "暂无", delta: p ? `最近一晚 ${yday.slice(5)}${dv == null ? "" : ` ${dv > 0 ? "↑" : dv < 0 ? "↓" : ""}${dfmt(Math.abs(dv))}`}` : null, tone: dv == null ? null : dv > 0 ? "up" : dv < 0 ? "down" : "flat" })
    }
    night("SLEEP", "SLEEP", "睡眠时长", "", hm, hmDelta)
    night("HRV", "HRV", "HRV", "ms", decimalText, x => `${decimalText(x)} ms`)
    return tiles
  }, [day, rev, all])
}

function RecoveryTab({ day, today, rev, onCoach, onMuscle, rest, trend, onDay: setPageDay }: { day: string; today: string; rev: number; onDay: (d: string) => void; onCoach?: () => void; onMuscle: () => void; rest: (day: string) => ReactNode; trend: (only?: string, endDay?: string, days?: number) => ReactNode }) {
  const [metric, setMetric] = useState<ExplorerMetric>("bb"), [span, setSpan] = useState<Span>(1)
  const [checkin, setCheckin] = useState(false), [pain, setPain] = useState(false)
  const [subjective, setSubjective] = useState<"fatigue" | "pain">("fatigue")
  const [portraitError, setPortraitError] = useState(false)
  const select = (next: ExplorerMetric, jump = false) => { setMetric(next); setSpan(next === "sleep" || next === "hrv" ? 7 : 1); if (jump) jumpTo("fk-intraday") }
  useEffect(() => { const h = (e: Event) => { const k = (e as CustomEvent).detail; if (k === "bb" || k === "hr" || k === "st") { setMetric(k); setSpan(1) } }; window.addEventListener("fk-h89-detail", h); window.addEventListener("fk-open-intraday-detail", h); return () => { window.removeEventListener("fk-h89-detail", h); window.removeEventListener("fk-open-intraday-detail", h) } }, [])
  const all = useIntraday()
  const tiles = useTiles(day, rev, all)
  const decision = useMemo(() => {void rev;try{return readEvidenceDecision(day)}catch{return null}}, [day,rev])
  const [historyIssue,setHistoryIssue]=useState('')
  useEffect(()=>{if(decision){const r=retainEvidenceDecision(decision);setHistoryIssue(r.ok?'':'本轮历史判断未保存：'+r.reason)}},[decision?.revision])
  const review = useMemo(() => { void rev; try { return reviewFatigue(loadHealthSnapshot(day), dailyCheckin(day)) } catch { return null } }, [day, rev])
  const emptyMetrics = useMemo(() => {
    void rev
    try {
      const snapshot = loadHealthSnapshot(day)
      // Conflicts, historical records and read failures remain visible in the full workspace.
      const hasRecords = snapshot.metrics.some(m => m.current || m.candidates.length || m.series.length || m.availableSources.length)
        || Object.values(all).some(d => d.bb.length || d.hr.length || d.st?.length || d.restingHr != null || d.sleep || d.training.length)
      return !snapshot.unreadable && !hasRecords
    } catch { return false }
  }, [day, rev, all])
  // History is viewed using records known now, including later syncs of that day.
  const view = useMemo(() => { void rev; return intradayRecoveryFromStore(all, currentAthleteId(), day, new Date().toISOString()) }, [all, day, rev])
  const explorer = <AllDayTrend day={day} today={today} onDay={setPageDay} rev={rev} d={all[day] ?? null} view={view} metric={metric} onMetric={select} span={span} onSpan={setSpan} trend={trend} rest={rest} showSyncNote={!emptyMetrics} />
  return <div className="space-y-3">
    <section className="fk-h89-card fk-h89-today" aria-label="今日恢复状态">
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-surface-2">{portraitError ? <HeartPulse aria-hidden="true" className="size-6 text-accent" /> : <img src="/fangshen/care-bust.png" alt="" onError={() => setPortraitError(true)} className="size-full object-cover" />}</span>
        <div className="min-w-0 flex-1">
          <p className="keep text-xs text-muted">方坤 · {day === today ? "今日" : mdCN(day)}恢复状态</p>
          <h2 className="mt-0.5 text-xl font-black leading-tight">{review?.title ?? "暂无恢复判断"}</h2>
          <p className="keep mt-1 text-sm text-muted">{review ? (review.signals.length ? review.signals.map(s => s.detail).join("；") : review.action) : "读取健康记录失败，未当作正常。"}</p>
        </div>
      </div>
      {review && review.signals.length ? <p className="keep mt-2 text-sm">{review.action}</p> : null}
      {decision ? <details className="fk-h89-disclosure" data-testid="batch99-evidence"><summary>负荷、依据与下一步观察</summary>{historyIssue?<p role="status">{historyIssue}；现有历史保留。</p>:null}<div className="keep whitespace-pre-wrap text-sm" data-testid="batch99-decision">{evidenceDecisionText(decision)}</div></details> : null}
      {emptyMetrics ? <SyncNote rev={rev} /> : null}
      <div className="fk-h89-actions">{emptyMetrics ? <button type="button" className="fk-h89-pill" aria-label="导入健康数据" onClick={() => window.dispatchEvent(new Event("fk-open-health-records"))}>导入数据</button> : null}<button type="button" className="fk-h89-pill" aria-label="记录疲劳与疼痛" aria-expanded={checkin} aria-controls="health-checkin" onClick={() => setCheckin(!checkin)}>{checkin ? "收起记录" : "疲劳与疼痛"}</button>{onCoach ? <button type="button" className="fk-h89-pill" onClick={onCoach}>问方坤</button> : null}</div>
    </section>
    {checkin ? <div id="health-checkin"><CheckinCard key={day} today={day} watch={loadWatch() ?? "none"} onSaved={() => undefined} onPain={() => setPain(true)} />{pain ? <PainLog key={day} today={day} /> : null}<details className="fk-h89-disclosure"><summary>疲劳与疼痛历史</summary><div className="fk-h89-metrics" role="group" aria-label="主观记录指标">{([["fatigue","疲劳"],["pain","疼痛"]] as const).map(([id,label]) => <button key={id} type="button" aria-pressed={subjective === id} onClick={() => setSubjective(id)}>{label}</button>)}</div>{trend(subjective, day)}</details></div> : null}
    {!emptyMetrics ? <div className="fk-h89-tiles" data-testid="h89-tiles">{tiles.map(t => <button type="button" key={t.key} className="fk-h89-tile text-left" data-testid={`h89-tile-${t.key}`} onClick={() => select(t.key === "SLEEP" ? "sleep" : t.key === "HRV" ? "hrv" : t.key === "BB" ? "bb" : "hr", true)}>
      <p className="keep text-xs text-muted">{t.label}</p>
      <p className="mt-0.5 whitespace-nowrap"><b className={(t.value && t.value.length > 4 ? "text-[15px]" : "text-lg") + " font-black " + (t.key === "BB" ? "text-[#4cc3e0]" : t.key === "RHR" ? "text-[#ff7a6a]" : "")}>{t.value ?? (t.sub === "来源待核对" ? "待核对" : "暂无")}</b>{t.value && t.unit ? <span className="ml-0.5 text-[10px] text-muted">{t.unit}</span> : null}</p>
      {t.value && t.key === "BB" && !t.stale ? <p className="keep text-[11px] text-muted">{t.sub}</p> : null}
      {t.delta ? <p className="keep text-[10px] text-muted">{t.delta}</p> : null}{t.stale ? <p className="keep text-[10px] text-[#e8b04a]" data-testid="h89-stale">{t.stale}</p> : null}
    </button>)}</div> : null}
    {emptyMetrics ? <details className="fk-h89-disclosure" data-testid="h89-empty-trend"><summary>查看健康趋势</summary>{explorer}</details> : explorer}
    <details className="fk-h89-disclosure"><summary>睡眠与训练时段</summary><EventCards day={day} d={all[day] ?? null} view={view} rev={rev} /></details>
    <button type="button" className="fk-h89-card flex w-full items-center gap-3 text-left" onClick={onMuscle} data-testid="h89-muscle-entry">
      <Dumbbell className="size-6 shrink-0 text-accent" />
      <span className="min-w-0 flex-1"><b className="block">肌肉恢复</b><span className="keep block text-xs text-muted">查看各部位的训练负荷</span></span>
      <ChevronRight className="size-5 text-muted" />
    </button>
  </div>
}

const META: Record<"bb" | "hr" | "st", { label: string; unit: string; color: string; metric: U10Metric; Icon: typeof HeartPulse }> = {
  bb: { label: "身体电量", unit: "/100", color: "#4cc38a", metric: "BODY_BATTERY", Icon: BatteryMedium },
  hr: { label: "心率", unit: "次/分", color: "#ff4d5e", metric: "HEART_RATE", Icon: HeartPulse },
  st: { label: "压力", unit: "/100", color: "#f5a524", metric: "STRESS", Icon: Gauge },
}
type K = keyof typeof META
function AllDayTrend({ day, today, onDay: setDay, rev, d, view, metric, onMetric, span, onSpan, trend, rest, showSyncNote = true }: { day: string; today: string; onDay: (d: string) => void; rev: number; d: IntradayDay | null; view: U10View | null; metric: ExplorerMetric; onMetric: (m: ExplorerMetric) => void; span: Span; onSpan: (s: Span) => void; trend: (only?: string, endDay?: string, days?: number) => ReactNode; rest: (day: string) => ReactNode; showSyncNote?: boolean }) {
  const all = useIntraday()
  const dailyMetric = EXPLORER.find(([id]) => id === metric)![2]
  const kind: K | null = metric === "bb" || metric === "hr" || metric === "st" ? metric : null
  const metricView = useMemo(() => { void rev; return loadHealthSnapshot(day).metrics.find(m => m.metric === dailyMetric) }, [day, rev, dailyMetric])
  const battery = useMemo(() => { void rev; return resolveBodyBattery(metricView, d, day) }, [metricView, d, day, rev])
  const hideBatteryCurve = !!kind && (!intradayMatchesSource(metricView, d) ||
    kind === "bb" && (battery.basis === "CONFLICT" || !!metricView?.selectedSource && battery.value == null))
  const samples = d && kind && !hideBatteryCurve ? (kind === "bb" ? d.bb : kind === "hr" ? d.hr : d.st ?? []) : []
  const typ = useMemo(() => kind ? typicalDay(all, day, kind, 7, 28, new Date().toISOString()) : null, [all, day, kind])
  const latest = samples.at(-1)
  const hours = useMemo(() => { const map = new Map<number, number[]>(); if (d) for (const [time, value] of samples) { const hour = Math.floor(minuteOfDay(time, d.day, d.offsetMin) / 60); if (hour >= 0 && hour < 24) map.set(hour, [...(map.get(hour) ?? []), value]) }; return [...map].sort((a,b) => a[0]-b[0]) }, [samples, d])
  const unit = kind ? META[kind].unit : metric === "hrv" ? "ms" : "小时"
  return <section id="fk-intraday" tabIndex={-1} className="fk-h89-card fk-h89-explorer" aria-label="健康趋势" data-testid="h89-trend">
    <div className="fk-h89-section-title"><h2>健康趋势</h2></div>
    <div className="fk-h89-metrics" role="group" aria-label="趋势指标">{EXPLORER.map(([id, label]) => <button key={id} type="button" aria-pressed={metric === id} onClick={() => onMetric(id)}>{label}</button>)}</div>
    <div className="fk-h89-period" role="group" aria-label="趋势时间范围">{([1,7,30] as const).map(n => <button key={n} type="button" aria-pressed={span === n} onClick={() => onSpan(n)}>{n === 1 ? "当天" : `${n}天`}</button>)}</div>
    {span === 1 ? <div className="mt-2 flex items-center justify-between gap-2 text-sm" role="group" aria-label="当天日期" data-testid="h89-trend-day">
      <button type="button" className="grid size-11 place-items-center rounded-full border border-line disabled:opacity-30" aria-label="前一天" disabled={day <= shiftDay(today, -89)} onClick={() => setDay(shiftDay(day, -1))}><ChevronLeft className="size-4" /></button>
      <b>{mdCN(day)}{day === today ? " · 今天" : ""}</b>
      <span className="flex items-center gap-1">{day !== today ? <button type="button" className="min-h-11 px-2 text-accent" onClick={() => setDay(today)}>今天</button> : null}<button type="button" className="grid size-11 place-items-center rounded-full border border-line disabled:opacity-30" aria-label="后一天" disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))}><ChevronRight className="size-4" /></button></span>
    </div> : null}
    {span === 1 && kind ? <>
      {latest && d ? <>
        <div className="fk-h89-reading"><div><span>{META[kind].label} · {kind === "bb" ? batteryCaption(battery, day, d.offsetMin) : clock(latest[0], d.offsetMin)}</span><p><strong>{kind === "bb" ? battery.value ?? "待核对" : latest[1]}</strong> <small>{unit}</small></p></div><div><span>采样范围</span><p>{Math.min(...samples.map(p => p[1]))}–{Math.max(...samples.map(p => p[1]))}</p></div></div>
        {kind === "bb" && battery.basis !== "INTRADAY" ? <p className="keep text-xs text-muted" data-testid="h89-curve-last">曲线最后采样：{clock(latest[0], d.offsetMin)} · {latest[1]}/100；与上方同步摘要分别保留。</p> : null}
        <DayChart key={`chart:${day}-${kind}`} d={d} view={view} k={kind} height={190} bandLabels typ={typ ?? undefined} />
        {typ ? <Legend k={kind} typ={typ} /> : null}
        <details className="fk-h89-disclosure" key={`samples:${day}-${kind}`}><summary>逐小时读数与来源 · {samples.length}个样本</summary>
          <p className="keep mb-2 text-xs text-muted">个人常态由近28天同钟点样本计算；每个钟点至少7天才显示中位数虚线，阴影为四分位范围。不是恢复目标。</p><div className="fk-h89-hours">{hours.map(([hour, values]) => <span key={hour}>{String(hour).padStart(2,"0")}时 <b>{Math.min(...values)}–{Math.max(...values)}</b></span>)}</div>
          <p className="keep text-xs text-muted">佳明手表样本 · 同步于 {new Date(d.fetchedAt).toLocaleString("zh-CN", {hour12:false})}{d.offsetMin != null ? ` · 手表时区 UTC${d.offsetMin >= 0 ? "+" : ""}${d.offsetMin / 60}` : ""}</p>
        </details>
      </> : <><MetricSummary day={day} rev={rev} metric={dailyMetric} /><div className="fk-h89-empty" data-testid="intraday-empty"><p>{hideBatteryCurve ? "当前来源暂无可用逐时曲线，未混用其他设备或账号数据。" : `${mdCN(day)}没有${META[kind].label}逐时样本，日汇总与逐时采样分别展示。`}</p>{(() => { const prev = Object.keys(all).filter(x => x < day && (kind === "bb" ? all[x].bb : kind === "hr" ? all[x].hr : all[x].st ?? []).length).sort().at(-1); return prev ? <button type="button" className="mt-1 min-h-11 font-bold text-accent" onClick={() => setDay(prev)}>看最近有数据的 {mdCN(prev)} ›</button> : null })()}</div></>}
      {view?.warnings.filter(w => /冲突/.test(w)).map(w => <p key={w} className="keep text-xs text-amber-400">{w}</p>)}
      {showSyncNote ? <SyncNote rev={rev} /> : null}
      <p className="keep mt-2 text-xs text-muted">{kind === "st" ? "压力是设备估算读数，不是心理诊断。" : kind === "bb" ? "身体电量是设备估算，不代表肌肉已恢复或可以加量。" : "全天心率来自手表样本，和每日静息心率分别展示。"}</p>
    </> : <>
      <MetricSummary day={day} rev={rev} metric={dailyMetric} />
      {span > 1 ? trend(dailyMetric, day, span) : <p className="keep mt-2 text-xs text-muted">选择7天或30天，查看同一来源的变化。</p>}
      {metric === "hrv" ? <p className="keep mt-2 text-xs text-muted">仅比较同一设备与算法；单日HRV波动不能单独判定恢复。</p> : metric === "hr" ? <p className="keep mt-2 text-xs text-muted">多日趋势显示每天的静息心率；“当天”显示全天心率样本。</p> : metric === "st" ? <p className="keep mt-2 text-xs text-muted">压力为设备读数，不是心理诊断。</p> : null}
    </>}
    {metric === "sleep" ? rest(day) : null}
  </section>
}

/** v89.1：日内补取失败不再静默——显示上次同步的日内结果。 */
function SyncNote({ rev }: { rev: number }) {
  const r = useMemo(() => { try { return JSON.parse(localStorage.getItem(garminStorageKey("fk-garmin-sync-report", currentAthleteId())) ?? "null")?.intraday as { requested: number; saved: number; failed: string[]; throttled: boolean } | undefined } catch { return undefined } }, [rev])
  if (!r || (!r.failed.length && !r.throttled)) return null
  return <p className="keep mt-1 text-xs text-amber-400" data-testid="h89-sync-note">上次同步日内：取 {r.requested} 天，存 {r.saved} 天{r.throttled ? "；佳明限流，剩下的下次同步再补" : ""}{r.failed.length ? `；${r.failed.slice(0, 2).join("；")}` : ""}</p>
}
function DayChart({ d, view, k, height, bandLabels = false, typ }: { d: IntradayDay; view: U10View | null; k: K; height: number; bandLabels?: boolean; typ?: { hours: TypicalHour[] } }) {
  const m = META[k], pts = (k === "bb" ? d.bb : k === "hr" ? d.hr : d.st) ?? []
  const ref = useRef<SVGSVGElement>(null), [pick, setPick] = useState<Sample | null>(null)
  const [W, setWidth] = useState(360)
  useEffect(() => { const node = ref.current; if (!node) return; const resize = () => { const width = Math.round(node.getBoundingClientRect().width); if (width > 0) setWidth(width) }; resize(); const observer = new ResizeObserver(resize); observer.observe(node); return () => observer.disconnect() }, [pts.length > 0])
  useEffect(() => setPick(null), [d, k])
  const top = bandLabels ? 26 : 8, bottom = 16, left = 24, ph = height - top - bottom, pw = W - left - 4
  // v89.1：图上画“方坤估算·个人常态”（全天 24 小时，近 28 天同钟点），U10 的同情境参考区间仍给方坤做事实。
  const refRows = typ?.hours ?? []
  const vals = [...pts.map(p => p[1]), ...refRows.flatMap(r => [r.p25, r.p75])]
  const lo = k === "hr" ? Math.max(30, Math.floor((Math.min(...vals) - 5) / 20) * 20) : 0, hi = k === "hr" ? Math.ceil((Math.max(...vals) + 5) / 20) * 20 : 100
  const x = (t: number) => left + Math.max(0, Math.min(pw, minuteOfDay(t, d.day, d.offsetMin) / 1440 * pw)), xh = (h: number) => left + h / 24 * pw
  const y = (v: number) => top + ph - (v - lo) / Math.max(1, hi - lo) * ph
  const gap = k === "hr" ? 20 : 40
  const path = useMemo(() => { let s = "", prev: number | null = null; for (const [t, v] of pts) { s += `${prev == null || t - prev > gap * 60e3 ? "M" : "L"}${x(t).toFixed(1)},${y(v).toFixed(1)}`; prev = t } return s }, [pts, lo, hi, W, height]) // eslint-disable-line react-hooks/exhaustive-deps
  const area = k === "bb" && pts.length ? `${path} L${x(pts[pts.length - 1][0]).toFixed(1)},${(top + ph).toFixed(1)} L${x(pts[0][0]).toFixed(1)},${(top + ph).toFixed(1)} Z` : null
  const choose = (cx: number) => { const r = ref.current?.getBoundingClientRect(); if (!r || !pts.length) return; const px = (cx - r.left) / r.width * W; let best = pts[0]; for (const p of pts) if (Math.abs(x(p[0]) - px) < Math.abs(x(best[0]) - px)) best = p; setPick(best) }
  const ticks = k === "hr" ? [lo, Math.round((lo + hi) / 2), hi] : [0, 25, 50, 75, 100]
  const sleepEv = (view?.events ?? []).filter(e => e.kind === "MAIN" || e.kind === "NAP")
  const trainEv = (view?.events ?? []).filter(e => e.kind === "RUN" || e.kind === "STRENGTH" || e.kind === "OTHER")
  const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}`
  if (!pts.length) return <p className="keep py-3 text-center text-xs text-muted">这天没有{m.label}样本。</p>
  return <div className="relative mt-1">
    <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="block w-full touch-pan-y select-none" style={{ height }} role="img" aria-label={`${mdCN(d.day)}${m.label}全天曲线`} data-testid={`h89-chart-${k}`}
      onPointerDown={e => { e.stopPropagation(); choose(e.clientX) }} onPointerMove={e => { if (e.buttons || e.pointerType !== "mouse") choose(e.clientX) }}>
      {sleepEv.map(e => <g key={e.eventId}><rect x={xh(e.startHour)} y={top} width={Math.max(1, xh(e.endHour) - xh(e.startHour))} height={ph} fill="#4a5cff" opacity={e.kind === "NAP" ? .22 : .2} data-testid="shade-sleep" />{bandLabels ? <text x={(xh(e.startHour) + xh(e.endHour)) / 2} y={10} fontSize="10" textAnchor="middle" fill="#9fb0ff">{e.kind === "NAP" ? "午睡" : "主睡眠"}</text> : null}{bandLabels ? <text x={(xh(e.startHour) + xh(e.endHour)) / 2} y={20} fontSize="10" textAnchor="middle" fill="#9fb0ff">{hhmm(e.startHour)}–{hhmm(e.endHour)}</text> : null}</g>)}
      {trainEv.map(e => <g key={e.eventId}><rect x={xh(e.startHour)} y={top} width={Math.max(2, xh(e.endHour) - xh(e.startHour))} height={ph} fill="#ff6a1a" opacity=".28" data-testid="shade-training" />{bandLabels ? <text x={(xh(e.startHour) + xh(e.endHour)) / 2} y={10} fontSize="10" textAnchor="middle" fill="#ff9a5a">{e.kind === "RUN" ? "跑步" : e.kind === "STRENGTH" ? "力量" : "训练"}</text> : null}</g>)}
      {ticks.map(v => <g key={v}><line x1={left} x2={W - 4} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth=".5" /><text x={left - 3} y={y(v) + 3} fontSize="10" textAnchor="end" fill="var(--color-muted)">{v}</text></g>)}
      {[0, 6, 12, 18, 24].map(h => <text key={h} x={xh(h)} y={height - 4} fontSize="10" textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"} fill="var(--color-muted)">{String(h).padStart(2, "0")}:00</text>)}
      {refRows.length ? <g data-testid="h89-reference">{refRows.map(r => <rect key={r.hour} x={xh(r.hour)} y={y(r.p75)} width={pw / 24} height={Math.max(1, y(r.p25) - y(r.p75))} fill="#b49cff" opacity=".16" />)}
        <path data-testid="h89-estimate" d={refRows.slice().sort((a, b) => a.hour - b.hour).map((r, i, a) => `${i && a[i - 1].hour === r.hour - 1 ? "L" : "M"}${(xh(r.hour) + pw / 48).toFixed(1)},${y(r.median).toFixed(1)}`).join("")} fill="none" stroke="var(--fk-reference-color, #c4b2ff)" strokeWidth="1.4" strokeDasharray="4 3" /></g> : null}
      {area ? <path d={area} fill={m.color} opacity=".16" /> : null}
      <path d={path} fill="none" stroke={m.color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts[pts.length - 1][0])} cy={y(pts[pts.length - 1][1])} r="2.8" fill={m.color} data-testid="latest-dot" />
      {pick ? <g data-testid="pick"><line x1={x(pick[0])} x2={x(pick[0])} y1={top} y2={top + ph} stroke="var(--color-fg)" strokeWidth=".8" /><circle cx={x(pick[0])} cy={y(pick[1])} r="3.2" fill="var(--color-fg)" /></g> : null}
    </svg>
    {pick ? <div className="pointer-events-none absolute whitespace-nowrap rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-bold" style={{ top: top - 4, left: `clamp(0px, calc(${x(pick[0]) / W * 100}% - 40px), calc(100% - 92px))` }} data-testid="pick-label">{clock(pick[0], d.offsetMin)} · {pick[1]} {m.unit}</div> : null}
  </div>
}

function Legend({ k, typ }: { k: K; typ: { hours: TypicalHour[]; historyDays: number } }) {
  return <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted" data-testid="h89-legend">
    <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3" style={{ background: META[k].color }} />手表{META[k].label}</span>
    {typ.hours.length ? <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3 border-t border-dashed" style={{ borderColor: "var(--fk-reference-color, #c4b2ff)" }} />方坤常态 · 近{typ.historyDays}天</span>
      : <span>个人常态：历史不足7天</span>}
    <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-[#4a5cff]/50" />睡眠</span>
    <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-[#ff6a1a]/50" />训练</span>
  </div>
}

function EventCards({ day, d, view, rev }: { day: string; d: IntradayDay | null; view: U10View | null; rev: number }) {
  const offset = view?.utcOffsetMinutes ?? d?.offsetMin ?? -new Date(day + 'T12:00:00').getTimezoneOffset()
  const history = useMemo(() => { void rev; return readRestHistory() }, [rev])
  const rest = restOnDay(history.selection?.records ?? [], day, offset)
  const cards: { id: string; Icon: typeof Moon; title: string; time: string; duration: string; tone: string; source: string; order: number }[] = []
  for (const e of view?.events ?? []) {
    const isSleep = e.kind === "MAIN" || e.kind === "NAP"
    cards.push({ id: e.eventId, Icon: isSleep ? (e.kind === "NAP" ? BedDouble : Moon) : e.kind === "RUN" ? Footprints : e.kind === "STRENGTH" ? Dumbbell : Activity, title: isSleep ? (e.kind === "NAP" ? "午睡" : "主睡眠") : e.label ?? (e.kind === "RUN" ? "跑步" : e.kind === "STRENGTH" ? "力量训练" : "训练"), ...eventReadout(e, day, offset), tone: isSleep ? "sleep" : "train", source: e.status === 'CONFLICT' ? '手表记录有重叠差异，需核对' : e.endEstimated ? '手表记录 · 结束时刻按活动时长估算' : '手表记录', order: Date.parse(e.startAt) })
  }
  for (const r of rest) cards.push({ id: `${r.sourceNamespace}:${r.originEventId ?? r.transportRecordId}`, Icon: BedDouble, title: REST_LABELS[r.kind], ...restReadout(r, day, offset), tone: "sleep", source: '自己补记 · 与手表记录分开保留', order: r.occurredStart ?? Infinity })
  cards.sort((a,b) => a.order-b.order)
  const zone = `UTC${offset >= 0 ? '+' : '−'}${String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')}:${String(Math.abs(offset)%60).padStart(2,'0')}`
  return <section data-testid="h89-events" aria-label={`${mdCN(day)}的时段事件`}>
    <b>{mdCN(day)} · 已记录 {cards.length} 项</b>
    <p className="keep mt-1 text-xs text-muted">{d?.offsetMin != null ? `手表时区 ${zone}` : `设备时区未提供，按手机时区 ${zone}`}{d?.fetchedAt ? ` · 同步于 ${eventReadoutTime(d.fetchedAt, offset)}` : ''}</p>
    <div className="fk-h89-event-list mt-3">{cards.map(c => <div key={c.id} className={"fk-h89-event " + c.tone}><c.Icon className="size-4 shrink-0" /><div className="min-w-0"><p className="text-sm font-bold">{c.title}</p><p className="mt-1 text-sm">{c.time}</p><p className="text-sm">{c.duration}</p><p className="keep mt-1 text-xs text-muted">{c.source}</p></div></div>)}</div>
    {!cards.length ? <p className="mt-2 text-sm text-muted">当天暂无已记录时段，不代表没有睡眠或训练。</p> : null}
    {history.state !== 'AVAILABLE' ? <p className="keep mt-2 text-xs text-muted">补记记录暂时无法读取，请稍后重试。</p> : null}
    <p className="keep mt-3 text-xs leading-relaxed text-muted">只显示已同步或补记的睡眠、训练与休息。时段长度不等于净睡眠时长，也不会凭心率下降猜测午睡。</p>
  </section>
}

function eventReadoutTime(value: string, offset: number) {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return '时间未知'
  return `${new Date(ms + offset*60000).toISOString().slice(5,10).replace('-', '/')} ${clock(ms, offset)}`
}

function MetricSummary({ day, rev, metric }: { day: string; rev: number; metric: string }) {
  const view = useMemo(() => { void rev; return loadHealthSnapshot(day).metrics.find(m => m.metric === metric) }, [day, rev, metric])
  const all = useIntraday()
  const battery = metric === "BODY_BATTERY" ? resolveBodyBattery(view, all[day], day) : null
  const p = onDay(view, day) ?? ((metric === "HRV" || metric === "SLEEP") && day === todayDate() ? onDay(view, shiftDay(day, -1)) : null)
  const value = battery ? battery.value : p?.value
  const conflict = battery?.basis === "CONFLICT" || view?.state === "CONFLICT"
  const description = battery ? batteryCaption(battery, day, all[day]?.offsetMin) : p ? `${p.source} · ${p.statistic}${p.method && p.method !== "UNSPECIFIED" ? ` · ${p.method}` : ""}` : conflict ? "来源存在冲突，请在身体与记录中核对。" : "所选日期没有记录"
  return <><div className="fk-h89-reading" data-testid="health-metric-summary"><div><span>{view?.label ?? metric}{!battery && p && p.day !== day ? ` · 最近一晚 ${p.day.slice(5)}` : ` · ${mdCN(day)}`}</span><p><strong>{value != null ? valueText(metric, value) : conflict ? "待核对" : "暂无"}</strong></p></div><p className="keep text-xs text-muted">{description}</p></div>{view ? <details className="fk-h89-disclosure" key={`${day}-${metric}`}><summary>来源与比较依据</summary><HealthSourceDetails view={view} /></details> : null}</>
}
