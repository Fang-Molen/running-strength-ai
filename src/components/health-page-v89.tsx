/** v89 健康页（参考效果图结构）：顶部 恢复/身体指标/睡眠/HRV/压力 + 日期切换。
 *  恢复：方坤今日恢复卡 → 四项指标（较昨日）→ 全天趋势（身体电量/心率/压力，睡眠·训练时段带，个人参考区间）→ 时间段事件 → 肌肉恢复入口。
 *  只显示真实同步/记录的数据；没有就写“暂无”。图表数据只有一套：v88.3 手表日内存储 + U10 投影。 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, CalendarDays, Moon, Footprints, Dumbbell, BedDouble, Activity, HeartPulse, BatteryMedium, Gauge } from "lucide-react"
import { Sheet } from "./sheet"
import { useIntraday, IntradayDetail } from "./intraday-panel"
import { MuscleRecoveryV89 } from "./muscle-recovery-v89"
import { HEALTH_CHANGED, shiftDay, valueText } from "@/lib/health/observation"
import { loadHealthSnapshot, type HealthMetricView } from "@/lib/health/snapshot"
import { reviewFatigue, dailyCheckin } from "@/lib/health/analysis"
import { onAppEvent, currentAthleteId } from "@/lib/core/events"
import { clock, minuteOfDay, type IntradayDay, type Sample } from "@/lib/health/garmin-intraday"
import { intradayRecoveryFromStore, typicalDay, type TypicalHour } from "@/lib/health/intraday-recovery-bridge-v89"
import type { View as U10View, Metric as U10Metric } from "@/lib/health/intraday-recovery-u10"
import { readRestHistory, REST_LABELS } from "@/lib/health/rest-store"
import { garminStorageKey } from "@/lib/health/garmin-sync-runner"
import { todayDate } from "@/lib/nutrition/body"
import "./health-v89.css"

export type HealthTab = "recovery" | "body" | "sleep" | "hrv" | "stress"
const TABS: [HealthTab, string][] = [["recovery", "恢复"], ["body", "身体指标"], ["sleep", "睡眠"], ["hrv", "HRV"], ["stress", "压力"]]
const mdCN = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`
const hm = (hours: number) => { const m = Math.round(hours * 60); return `${Math.floor(m / 60)}小时${m % 60}分` }
const hmDelta = (h: number) => { const m = Math.round(Math.abs(h) * 60); return m >= 60 ? `${Math.floor(m / 60)}小时${m % 60}分` : `${m}分` }

function useHealthRev() {
  const [rev, setRev] = useState(0)
  useEffect(() => { const f = () => setRev(x => x + 1); const off = onAppEvent(f); window.addEventListener(HEALTH_CHANGED, f); window.addEventListener("storage", f); window.addEventListener("fk-garmin-synced", f); return () => { off(); window.removeEventListener(HEALTH_CHANGED, f); window.removeEventListener("storage", f); window.removeEventListener("fk-garmin-synced", f) } }, [])
  return rev
}

export function HealthPageV89({ body, slot, grid, stats, rest, trend, onCoach }: { body: ReactNode; slot?: ReactNode; grid: ReactNode; stats: ReactNode; rest: (day: string) => ReactNode; trend: (only?: string) => ReactNode; onCoach?: () => void }) {
  const today = todayDate()
  const [tab, setTab] = useState<HealthTab>("recovery")
  const [day, setDay] = useState(today)
  const [muscle, setMuscle] = useState(false)
  const rev = useHealthRev()
  useEffect(() => { const h = () => { setTab("recovery"); setTimeout(() => document.getElementById("fk-intraday")?.scrollIntoView({ block: "start", behavior: "smooth" }), 80) }; window.addEventListener("fk-open-intraday", h); return () => window.removeEventListener("fk-open-intraday", h) }, [])
  return <div className="fk-health-v89 space-y-3" data-testid="health-v89">
    <nav className="fk-h89-tabs" aria-label="健康分区">{TABS.map(([id, l]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{l}</button>)}</nav>
    {tab !== "body" ? <DaySwitch day={day} today={today} onDay={setDay} /> : null}
    <div hidden={tab !== "recovery"}><RecoveryTab day={day} today={today} rev={rev} onCoach={onCoach} onMuscle={() => setMuscle(true)} onTab={t => { setTab(t); window.scrollTo(0, 0) }} /></div>
    <div hidden={tab !== "body"} className="space-y-3">{body}{grid}{slot}{stats}</div>
    {tab === "sleep" ? <SleepTab day={day} rev={rev} rest={rest(day)} trend={trend("SLEEP")} /> : null}
    {tab === "hrv" ? <MetricTab day={day} rev={rev} metric="HRV" trend={trend("HRV")} note="HRV 只比较同一设备、同一算法口径（如 RMSSD）的记录；单日波动不能说明恢复好坏。" /> : null}
    {tab === "stress" ? <StressTab day={day} rev={rev} trend={trend("STRESS")} /> : null}
    {muscle ? <Sheet title="肌肉恢复" label="肌肉恢复" footer={null} full onClose={() => setMuscle(false)}><MuscleRecoveryV89 day={day} trend={trend()} onCoach={onCoach} /></Sheet> : null}
  </div>
}

function DaySwitch({ day, today, onDay }: { day: string; today: string; onDay: (d: string) => void }) {
  const min = shiftDay(today, -29)
  return <div className="fk-h89-date" aria-label="切换日期">
    <button type="button" aria-label="前一天" disabled={day <= min} onClick={() => onDay(shiftDay(day, -1))}><ChevronLeft className="size-4" /></button>
    <label className="relative flex items-center gap-1.5"><b>{mdCN(day)}{day === today ? "（今天）" : ""}</b><CalendarDays className="size-4 text-muted" />
      <input aria-label="选择日期" type="date" min={min} max={today} value={day} onChange={e => e.target.value && onDay(e.target.value > today ? today : e.target.value)} className="absolute inset-0 opacity-0" /></label>
    <button type="button" aria-label="后一天" disabled={day >= today} onClick={() => onDay(shiftDay(day, 1))}><ChevronRight className="size-4" /></button>
  </div>
}

/** 日指标：只取该日期的同一来源读数；没有就“暂无”，不拿最近一天顶替。 */
function onDay(view: HealthMetricView | undefined, day: string) { return view?.series.find(p => p.day === day) ?? (view?.current?.day === day ? view.current : null) }
function nearest(rows: Sample[], t: number, within = 30 * 60e3) { let best: Sample | null = null; for (const p of rows) if (Math.abs(p[0] - t) <= within && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p; return best }

type Tile = { key: string; label: string; value: string | null; unit: string; sub: string; delta: string | null; tone: "up" | "down" | "flat" | null; note?: string }
function useTiles(day: string, rev: number, all: Record<string, IntradayDay>): Tile[] {
  return useMemo(() => {
    void rev
    const snap = loadHealthSnapshot(day), yday = shiftDay(day, -1)
    const v = (m: string) => snap.metrics.find(x => x.metric === m)
    const d = all[day], y = all[yday]
    const tiles: Tile[] = []
    // 身体电量：有日内样本用当天最后一个读数（今天=最新），否则用日记录（注明统计口径）。
    const bbLast = d?.bb.at(-1)
    if (bbLast) {
      const prev = y ? nearest(y.bb, bbLast[0] - 864e5) : null, dv = prev ? bbLast[1] - prev[1] : null
      tiles.push({ key: "BB", label: "身体电量", value: String(bbLast[1]), unit: "/100", sub: `${day === todayDate() ? "最新" : "当天最后"} ${clock(bbLast[0], d.offsetMin)}`, delta: dv == null ? null : `较昨日同时刻 ${dv > 0 ? "↑" : dv < 0 ? "↓" : ""}${Math.abs(dv)}`, tone: dv == null ? null : dv > 0 ? "up" : dv < 0 ? "down" : "flat" })
    } else {
      const p = onDay(v("BODY_BATTERY"), day), q = onDay(v("BODY_BATTERY"), yday), dv = p && q && p.stream === q.stream ? p.value - q.value : null
      tiles.push({ key: "BB", label: "身体电量", value: p ? String(Math.round(p.value)) : null, unit: "/100", sub: p ? p.statistic : "暂无当日读数", delta: dv == null ? null : `较昨日 ${dv > 0 ? "↑" : dv < 0 ? "↓" : ""}${Math.abs(Math.round(dv))}`, tone: dv == null ? null : dv > 0 ? "up" : dv < 0 ? "down" : "flat" })
    }
    const daily = (key: string, metric: string, label: string, unit: string, fmt: (x: number) => string, dfmt: (x: number) => string, fallback?: number | null) => {
      const p = onDay(v(metric), day), q = onDay(v(metric), yday), val = p?.value ?? fallback ?? null
      const dv = p && q && p.stream === q.stream ? p.value - q.value : null
      tiles.push({ key, label, value: val == null ? null : fmt(val), unit, sub: p ? p.source : fallback != null ? "佳明日内" : "暂无", delta: dv == null ? null : `较昨日 ${dv > 0 ? "↑" : dv < 0 ? "↓" : ""}${dfmt(Math.abs(dv))}`, tone: dv == null ? null : dv > 0 ? "up" : dv < 0 ? "down" : "flat" })
    }
    daily("RHR", "RHR", "静息心率", "bpm", x => String(Math.round(x)), x => String(Math.round(x)), d?.restingHr ?? null)
    // v89.1：佳明的睡眠/HRV 记在“醒来那天”。今天还没睡醒前（如凌晨）没有今天的值，显示最近一晚（昨天日期）并注明。
    const night = (key: string, metric: string, label: string, unit: string, fmt: (x: number) => string, dfmt: (x: number) => string) => {
      if (onDay(v(metric), day) || day !== todayDate()) return daily(key, metric, label, unit, fmt, dfmt)
      const p = onDay(v(metric), yday), q = onDay(v(metric), shiftDay(day, -2)), dv = p && q && p.stream === q.stream ? p.value - q.value : null
      tiles.push({ key, label, value: p ? fmt(p.value) : null, unit, sub: p ? `最近一晚 ${yday.slice(5)}` : "暂无", delta: p ? `最近一晚 ${yday.slice(5)}${dv == null ? "" : ` ${dv > 0 ? "↑" : dv < 0 ? "↓" : ""}${dfmt(Math.abs(dv))}`}` : null, tone: dv == null ? null : dv > 0 ? "up" : dv < 0 ? "down" : "flat" })
    }
    night("SLEEP", "SLEEP", "睡眠时长", "", hm, hmDelta)
    night("HRV", "HRV", "HRV", "ms", x => String(Math.round(x)), x => `${Math.round(x)} ms`)
    return tiles
  }, [day, rev, all])
}

function RecoveryTab({ day, today, rev, onCoach, onMuscle, onTab }: { day: string; today: string; rev: number; onCoach?: () => void; onMuscle: () => void; onTab: (t: HealthTab) => void }) {
  const all = useIntraday()
  const tiles = useTiles(day, rev, all)
  const review = useMemo(() => { void rev; try { return reviewFatigue(loadHealthSnapshot(day), dailyCheckin(day)) } catch { return null } }, [day, rev])
  const view = useMemo(() => intradayRecoveryFromStore(all, currentAthleteId(), day, day === today ? new Date().toISOString() : `${day}T23:59:59.999Z`), [all, day, today])
  const now = new Date()
  return <div className="space-y-3">
    <section className="fk-h89-card fk-h89-today" aria-label="今日恢复状态">
      <div className="flex items-start gap-3">
        <img src="/fangshen/care-bust.png" alt="" className="size-12 shrink-0 rounded-full border border-line object-cover" />
        <div className="min-w-0 flex-1">
          <p className="keep flex items-center gap-2 text-xs text-muted"><span>方坤 · {day === today ? "今日" : mdCN(day)}恢复状态</span>{day === today ? <span className="ml-auto">{String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")} 更新</span> : null}</p>
          <h2 className="mt-0.5 text-xl font-black leading-tight">{review?.title ?? "暂无恢复判断"}</h2>
          <p className="keep mt-1 text-sm text-muted">{review ? (review.signals.length ? review.signals.map(s => s.detail).join("；") : review.action) : "读取健康记录失败，未当作正常。"}</p>
        </div>
      </div>
      {review && review.signals.length ? <p className="keep mt-2 text-sm">{review.action}</p> : null}
      {onCoach ? <button type="button" className="fk-h89-pill mt-2" onClick={onCoach}>问方坤建议 ›</button> : null}
    </section>
    <div className="grid grid-cols-4 gap-1.5" data-testid="h89-tiles">{tiles.map(t => <button type="button" key={t.key} className="fk-h89-tile text-left" data-testid={`h89-tile-${t.key}`} onClick={() => t.key === "SLEEP" ? onTab("sleep") : t.key === "HRV" ? onTab("hrv") : window.dispatchEvent(new CustomEvent("fk-h89-detail", { detail: t.key === "BB" ? "bb" : "hr" }))}>
      <p className="keep truncate text-[11px] text-muted">{t.label}</p>
      <p className="mt-0.5 whitespace-nowrap"><b className={(t.value && t.value.length > 4 ? "text-[15px]" : "text-lg") + " font-black " + (t.key === "BB" ? "text-[#4cc3e0]" : t.key === "RHR" ? "text-[#ff7a6a]" : "")}>{t.value ?? "暂无"}</b>{t.value && t.unit ? <span className="ml-0.5 text-[10px] text-muted">{t.unit}</span> : null}</p>
      <p className={"keep text-[10px] " + (t.tone === "down" ? "text-[#ff7a6a]" : t.tone === "up" ? "text-[#4cc38a]" : "text-muted")}>{t.delta ?? "较昨日 暂无"}</p>
    </button>)}</div>
    <AllDayTrend day={day} d={all[day] ?? null} view={view} />
    <EventCards day={day} d={all[day] ?? null} view={view} rev={rev} />
    <button type="button" className="fk-h89-card flex w-full items-center gap-3 text-left" onClick={onMuscle} data-testid="h89-muscle-entry">
      <Dumbbell className="size-6 shrink-0 text-accent" />
      <span className="min-w-0 flex-1"><b className="block">肌肉恢复</b><span className="keep block text-xs text-muted">正背面训练反应着色、重点肌群、力量负荷与跑步影响</span></span>
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
function AllDayTrend({ day, d, view }: { day: string; d: IntradayDay | null; view: U10View | null }) {
  const kinds: K[] = d ? (["bb", "hr", ...(d.st?.length ? ["st" as const] : [])] as K[]).filter(k => (k === "bb" ? d.bb : k === "hr" ? d.hr : d.st ?? []).length) : []
  const [main, setMain] = useState<K>("bb"), [detail, setDetail] = useState<"hr" | "bb" | null>(null), [detailDay, setDetailDay] = useState<string | null>(null)
  const all = useIntraday(), days = Object.keys(all).sort()
  useEffect(() => { const f = (e: Event) => { const k = (e as CustomEvent).detail; if (d && (k === "hr" || k === "bb")) setDetail(k) }; window.addEventListener("fk-h89-detail", f); window.addEventListener("fk-open-intraday-detail", f); return () => { window.removeEventListener("fk-h89-detail", f); window.removeEventListener("fk-open-intraday-detail", f) } }, [d])
  const typs = useMemo(() => ({ bb: typicalDay(all, day, "bb"), hr: typicalDay(all, day, "hr"), st: typicalDay(all, day, "st") }), [all, day])
  const typ = (k: K) => typs[k]
  const cur: K = kinds.includes(main) ? main : kinds[0] ?? "bb"
  const second: K | null = cur === "hr" ? (kinds.includes("bb") ? "bb" : null) : kinds.includes("hr") ? "hr" : null
  return <section id="fk-intraday" className="fk-h89-card" data-testid="h89-trend">
    <div className="flex items-center gap-2"><b>全天趋势</b>
      {kinds.length ? <div className="fk-h89-seg ml-auto" role="group" aria-label="趋势指标">{kinds.map(k => <button key={k} type="button" aria-pressed={cur === k} onClick={() => setMain(k)}>{META[k].label}</button>)}</div> : null}
    </div>
    {!d ? <p className="keep mt-2 text-sm text-muted" data-testid="intraday-empty">{mdCN(day)}暂无手表逐时样本。连上佳明同步后，这里显示全天身体电量和心率；没有样本就不画曲线，也不拿日汇总拼曲线。</p> : <>
      <DayChart d={d} view={view} k={cur} height={150} bandLabels typ={typ(cur)} />
      {second ? <><p className="mt-2 text-sm font-bold">{META[second].label}<span className="ml-1 text-[11px] font-normal text-muted">（{META[second].unit}）</span></p><DayChart d={d} view={view} k={second} height={104} typ={typ(second)} /></> : null}
      <Legend k={cur} typ={typ(cur)} />
      <div className="mt-1 flex gap-3 text-xs">{(["bb", "hr"] as const).filter(k => kinds.includes(k)).map(k => <button key={k} type="button" className="fk-link" onClick={() => setDetail(k)}>{META[k].label}详情 ›</button>)}</div>
      {view?.warnings.filter(w => /冲突/.test(w)).map(w => <p key={w} className="keep text-xs text-amber-400">{w}</p>)}
      <SyncNote />
      <p className="keep mt-1 text-[11px] text-muted">设备读数，仅供参考，不是训练许可；身体电量回升不能证明午睡或肌肉已恢复。</p>
    </>}
    {/* v89.1：详情里切日期要真的换数据（v89 这里是空函数，点 10月20日 仍显示当天，看起来像“前几天没数据”） */}
    {d && detail ? <IntradayDetail d={all[detailDay ?? d.day] ?? d} kind={detail} days={days} onDay={setDetailDay} onClose={() => { setDetail(null); setDetailDay(null) }} /> : null}
  </section>
}

/** v89.1：日内补取失败不再静默——显示上次同步的日内结果。 */
function SyncNote() {
  const r = useMemo(() => { try { return JSON.parse(localStorage.getItem(garminStorageKey("fk-garmin-sync-report", currentAthleteId())) ?? "null")?.intraday as { requested: number; saved: number; failed: string[]; throttled: boolean } | undefined } catch { return undefined } }, [])
  if (!r || (!r.failed.length && !r.throttled)) return null
  return <p className="keep mt-1 text-xs text-amber-400" data-testid="h89-sync-note">上次同步日内：取 {r.requested} 天，存 {r.saved} 天{r.throttled ? "；佳明限流，剩下的下次同步再补" : ""}{r.failed.length ? `；${r.failed.slice(0, 2).join("；")}` : ""}</p>
}
const W = 360
function DayChart({ d, view, k, height, bandLabels = false, typ }: { d: IntradayDay; view: U10View | null; k: K; height: number; bandLabels?: boolean; typ?: { hours: TypicalHour[] } }) {
  const m = META[k], pts = (k === "bb" ? d.bb : k === "hr" ? d.hr : d.st) ?? []
  const ref = useRef<SVGSVGElement>(null), [pick, setPick] = useState<Sample | null>(null)
  useEffect(() => setPick(null), [d.day, k])
  const top = bandLabels ? 26 : 8, bottom = 16, left = 24, ph = height - top - bottom, pw = W - left - 4
  // v89.1：图上画“方坤估算·个人常态”（全天 24 小时，近 28 天同钟点），U10 的同情境参考区间仍给方坤做事实。
  const refRows = typ?.hours ?? []
  const vals = [...pts.map(p => p[1]), ...refRows.flatMap(r => [r.p25, r.p75])]
  const lo = k === "hr" ? Math.max(30, Math.floor((Math.min(...vals) - 5) / 20) * 20) : 0, hi = k === "hr" ? Math.ceil((Math.max(...vals) + 5) / 20) * 20 : 100
  const x = (t: number) => left + Math.max(0, Math.min(pw, minuteOfDay(t, d.day, d.offsetMin) / 1440 * pw)), xh = (h: number) => left + h / 24 * pw
  const y = (v: number) => top + ph - (v - lo) / Math.max(1, hi - lo) * ph
  const gap = k === "hr" ? 20 : 40
  const path = useMemo(() => { let s = "", prev: number | null = null; for (const [t, v] of pts) { s += `${prev == null || t - prev > gap * 60e3 ? "M" : "L"}${x(t).toFixed(1)},${y(v).toFixed(1)}`; prev = t } return s }, [pts, lo, hi]) // eslint-disable-line react-hooks/exhaustive-deps
  const area = k === "bb" && pts.length ? `${path} L${x(pts[pts.length - 1][0]).toFixed(1)},${(top + ph).toFixed(1)} L${x(pts[0][0]).toFixed(1)},${(top + ph).toFixed(1)} Z` : null
  const choose = (cx: number) => { const r = ref.current?.getBoundingClientRect(); if (!r || !pts.length) return; const px = (cx - r.left) / r.width * W; let best = pts[0]; for (const p of pts) if (Math.abs(x(p[0]) - px) < Math.abs(x(best[0]) - px)) best = p; setPick(best) }
  const ticks = k === "hr" ? [lo, Math.round((lo + hi) / 2), hi] : [0, 25, 50, 75, 100]
  const sleepEv = (view?.events ?? []).filter(e => e.kind === "MAIN" || e.kind === "NAP")
  const trainEv = (view?.events ?? []).filter(e => e.kind === "RUN" || e.kind === "STRENGTH" || e.kind === "OTHER")
  const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}`
  if (!pts.length) return <p className="py-3 text-center text-xs text-muted">这天没有{m.label}样本。</p>
  return <div className="relative mt-1">
    <svg ref={ref} viewBox={`0 0 ${W} ${height}`} className="block w-full touch-none select-none" style={{ height }} role="img" aria-label={`${mdCN(d.day)}${m.label}全天曲线`} data-testid={`h89-chart-${k}`}
      onPointerDown={e => { e.stopPropagation(); choose(e.clientX) }} onPointerMove={e => { if (e.buttons || e.pointerType !== "mouse") choose(e.clientX) }}>
      {sleepEv.map(e => <g key={e.eventId}><rect x={xh(e.startHour)} y={top} width={Math.max(1, xh(e.endHour) - xh(e.startHour))} height={ph} fill="#4a5cff" opacity={e.kind === "NAP" ? .22 : .2} data-testid="shade-sleep" />{bandLabels ? <text x={(xh(e.startHour) + xh(e.endHour)) / 2} y={10} fontSize="8.5" textAnchor="middle" fill="#9fb0ff">{e.kind === "NAP" ? "午睡" : "主睡眠"}</text> : null}{bandLabels ? <text x={(xh(e.startHour) + xh(e.endHour)) / 2} y={20} fontSize="8" textAnchor="middle" fill="#9fb0ff">{hhmm(e.startHour)}–{hhmm(e.endHour)}</text> : null}</g>)}
      {trainEv.map(e => <g key={e.eventId}><rect x={xh(e.startHour)} y={top} width={Math.max(2, xh(e.endHour) - xh(e.startHour))} height={ph} fill="#ff6a1a" opacity=".28" data-testid="shade-training" />{bandLabels ? <text x={(xh(e.startHour) + xh(e.endHour)) / 2} y={10} fontSize="8.5" textAnchor="middle" fill="#ff9a5a">{e.kind === "RUN" ? "跑步" : e.kind === "STRENGTH" ? "力量" : "训练"}</text> : null}</g>)}
      {ticks.map(v => <g key={v}><line x1={left} x2={W - 4} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth=".5" /><text x={left - 3} y={y(v) + 3} fontSize="8" textAnchor="end" fill="var(--color-muted)">{v}</text></g>)}
      {[0, 6, 12, 18, 24].map(h => <text key={h} x={xh(h)} y={height - 4} fontSize="8.5" textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"} fill="var(--color-muted)">{String(h).padStart(2, "0")}:00</text>)}
      {refRows.length ? <g data-testid="h89-reference">{refRows.map(r => <rect key={r.hour} x={xh(r.hour)} y={y(r.p75)} width={pw / 24} height={Math.max(1, y(r.p25) - y(r.p75))} fill="#b49cff" opacity=".16" />)}
        <path data-testid="h89-estimate" d={refRows.slice().sort((a, b) => a.hour - b.hour).map((r, i, a) => `${i && a[i - 1].hour === r.hour - 1 ? "L" : "M"}${(xh(r.hour) + pw / 48).toFixed(1)},${y(r.median).toFixed(1)}`).join("")} fill="none" stroke="#c4b2ff" strokeWidth="1.4" strokeDasharray="4 3" /></g> : null}
      {area ? <path d={area} fill={m.color} opacity=".16" /> : null}
      <path d={path} fill="none" stroke={m.color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts[pts.length - 1][0])} cy={y(pts[pts.length - 1][1])} r="2.8" fill={m.color} data-testid="latest-dot" />
      {pick ? <g data-testid="pick"><line x1={x(pick[0])} x2={x(pick[0])} y1={top} y2={top + ph} stroke="var(--color-fg)" strokeWidth=".8" /><circle cx={x(pick[0])} cy={y(pick[1])} r="3.2" fill="var(--color-fg)" /></g> : null}
    </svg>
    {pick ? <div className="pointer-events-none absolute whitespace-nowrap rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-bold" style={{ top: top - 4, left: `clamp(0px, calc(${x(pick[0]) / W * 100}% - 40px), calc(100% - 92px))` }} data-testid="pick-label">{clock(pick[0], d.offsetMin)} · {pick[1]} {m.unit}</div> : null}
  </div>
}

function Legend({ k, typ }: { k: K; typ: { hours: TypicalHour[]; historyDays: number } }) {
  const n = typ.hours.length ? Math.min(...typ.hours.map(r => r.days)) : 0
  return <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted" data-testid="h89-legend">
    <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3" style={{ background: META[k].color }} />手表{META[k].label}</span>
    {typ.hours.length ? <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3 border-t border-dashed border-[#c4b2ff]" />方坤估算·个人常态（近{typ.historyDays}天同钟点中位，≥{n}天；阴影为四分位）</span>
      : <span>方坤估算：需≥7天历史，现有{typ.historyDays}天；下次同步自动补到28天</span>}
    <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-[#4a5cff]/50" />睡眠</span>
    <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm bg-[#ff6a1a]/50" />训练</span>
  </div>
}

function EventCards({ day, d, view, rev }: { day: string; d: IntradayDay | null; view: U10View | null; rev: number }) {
  const rest = useMemo(() => { void rev; try { return readRestHistory().selection?.records.filter(r => r.contextDay === day && r.duration) ?? [] } catch { return [] } }, [day, rev])
  const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}`
  const dur = (h: number) => { const m = Math.round(h * 60); return m >= 60 ? `${Math.floor(m / 60)}小时${m % 60}分` : `${m}分钟` }
  const cards: { id: string; Icon: typeof Moon; title: string; time: string; len: string; tone: string }[] = []
  for (const e of view?.events ?? []) {
    const isSleep = e.kind === "MAIN" || e.kind === "NAP"
    const lab = d?.training.find(t => Math.abs(minuteOfDay(t.start, d.day, d.offsetMin) / 60 - e.startHour) < 0.02)?.label
    cards.push({ id: e.eventId, Icon: isSleep ? (e.kind === "NAP" ? BedDouble : Moon) : e.kind === "RUN" ? Footprints : e.kind === "STRENGTH" ? Dumbbell : Activity, title: isSleep ? (e.kind === "NAP" ? "午睡" : "主睡眠") : lab ?? (e.kind === "RUN" ? "跑步" : e.kind === "STRENGTH" ? "力量训练" : "训练"), time: `${hhmm(e.startHour)}–${hhmm(e.endHour)}`, len: dur(e.endHour - e.startHour), tone: isSleep ? "sleep" : "train" })
  }
  for (const r of rest) cards.push({ id: r.originEventId ?? String(r.revision), Icon: BedDouble, title: `${REST_LABELS[r.kind]}（自报）`, time: "时段未知", len: `约${r.duration!.low}${r.duration!.high != null && r.duration!.high !== r.duration!.low ? `–${r.duration!.high}` : ""}分钟`, tone: "sleep" })
  if (!cards.length) return <section className="fk-h89-card"><b>时间段事件</b><p className="mt-1 text-sm text-muted">暂无。手表同步的睡眠、训练时段和你自报的午睡会显示在这里。</p></section>
  return <section className="fk-h89-card" data-testid="h89-events"><b>时间段事件</b>
    <div className="mt-2 grid grid-cols-2 gap-1.5">{cards.map(c => <div key={c.id} className={"fk-h89-event " + c.tone}><c.Icon className="size-4 shrink-0" /><div className="min-w-0"><p className="truncate text-sm font-bold">{c.title}</p><p className="keep text-[11px] text-muted">{c.time}</p><p className="text-sm">{c.len}</p></div></div>)}</div>
  </section>
}

function SleepTab({ day, rev, rest, trend }: { day: string; rev: number; rest: ReactNode; trend: ReactNode }) {
  const all = useIntraday(), d = all[day]
  const p = useMemo(() => { void rev; const v = loadHealthSnapshot(day).metrics.find(m => m.metric === "SLEEP"); return onDay(v, day) ?? (day === todayDate() ? onDay(v, shiftDay(day, -1)) : null) }, [day, rev])
  return <div className="space-y-3">
    <section className="fk-h89-card"><p className="keep text-xs text-muted">{mdCN(day)} 睡眠时长</p><p className="text-2xl font-black">{p ? hm(p.value) : "暂无"}</p>
      <p className="keep text-xs text-muted">{p ? `${p.day !== day ? `最近一晚 ${p.day.slice(5)} · ` : ""}${p.source} · ${p.statistic}` : "这天没有睡眠记录"}{d?.sleep ? ` · 手表睡眠时段 ${clock(d.sleep[0], d.offsetMin)}–${clock(d.sleep[1], d.offsetMin)}` : ""}</p>
      {rest}</section>
    {trend}
  </div>
}
function MetricTab({ day, rev, metric, trend, note }: { day: string; rev: number; metric: string; trend: ReactNode; note: string }) {
  const view = useMemo(() => { void rev; return loadHealthSnapshot(day).metrics.find(m => m.metric === metric) }, [day, rev, metric])
  const p = onDay(view, day) ?? (metric === "HRV" && day === todayDate() ? onDay(view, shiftDay(day, -1)) : null)
  return <div className="space-y-3">
    <section className="fk-h89-card"><p className="keep text-xs text-muted">{mdCN(day)} {view?.label ?? metric}{p && p.day !== day ? `（最近一晚 ${p.day.slice(5)}）` : ""}</p><p className="text-2xl font-black">{p ? valueText(metric, p.value) : "暂无"}</p>
      <p className="keep text-xs text-muted">{p ? `${p.source} · ${p.statistic}${p.method ? ` · ${p.method}` : ""}` : "这天没有记录"}{view?.baseline && p?.day === view.current?.day ? ` · 较前7天可比均值 ${view.baseline.delta >= 0 ? "+" : ""}${Math.round(view.baseline.delta)}` : ""}</p>
      <p className="keep mt-1 text-xs text-muted">{note}</p></section>
    {trend}
  </div>
}
function StressTab({ day, rev, trend }: { day: string; rev: number; trend: ReactNode }) {
  const all = useIntraday(), d = all[day]
  const view = useMemo(() => intradayRecoveryFromStore(all, currentAthleteId(), day, new Date().toISOString()), [all, day])
  return <div className="space-y-3">
    <MetricTab day={day} rev={rev} metric="STRESS" trend={null} note="压力是佳明按心率变异估算的设备读数，不是心理诊断。" />
    <section className="fk-h89-card"><b>全天压力</b>{d?.st?.length ? <DayChart d={d} view={view} k="st" height={130} bandLabels typ={typicalDay(all, day, "st")} /> : <p className="keep mt-1 text-sm text-muted">暂无逐时压力样本（同步后才有；字段待核真实账号）。</p>}</section>
    {trend}
  </div>
}
