import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { Activity, Dumbbell, Footprints } from "lucide-react"
import { onAppEvent } from "@/lib/core/events"
import { planTag, planPrefix } from "@/lib/plan/active-plan"
import { listTrainingOccurrences } from "@/lib/core/occurrence"
import { loadConfirmedTrainingImports } from "@/lib/core/training-import"
import { calendarDayShanghai } from "@/lib/ui/training-log-view"
import { loadTrainingActivities, lastRunMatch, type ActivityRow } from "@/lib/ui/training-read-model"
import { summarize, outsideHint, rangeOf, kindOf, sourceLabels, type LogKind, type LogRange } from "@/lib/ui/log-range"
import { activityLocalTime, fmtDistance, fmtDuration, fmtHr, fmtPace } from "@/lib/ui/activity-format"
import { PhoneRecordDetail } from "@/components/phone-record-detail"
import { UnmarkedPlans, unmarkedEntries } from "@/components/unmarked-plans"
import { partLine } from "@/lib/ui/plan400-components-store"
import { PendingFeedbackList } from "@/components/plan400-parts"
import { allRunLinks, saveRunLink, planVsActual, type RunLink } from "@/lib/ui/run-link"
import { loadSchedule } from "@/lib/ui/day-schedule"
import { OccurrenceCard, ImportRow } from "@/components/training-log-panel"
import { GarminActivityRow, GarminLog, garminById } from "@/components/garmin-log"
import { ReviewPanel } from "@/components/review-card"
import { AbilityRadarCard } from "@/components/ability-radar-card"
import { TrainingEvidencePanel } from "@/components/training-evidence-panel"
import { LogMetricsPanel } from "@/components/r8"
import { AssessmentPanel } from "@/components/assessment-panel"
import { AthleteGrowthCard } from "@/components/athlete-growth-card"
import type { Plan } from "@/lib/strength/model"
import { garminActivities } from "@/lib/coach/online-coach"

const FILTER_KEY = "fk-log-filter-v2", OLD_FILTER_KEY = "fk-log-filter-v1"
const FEEL: Record<string, string> = { easy: "轻松", ok: "正好", hard: "吃力", pain: "有不适", skip: "这周没练" }
// v78：v76/v77 存的“力量”筛选会一直留着、用户看不出来 → 升级后类型回到“全部”，只保留日期范围。
const loadFilter = (): { range: LogRange; kind: LogKind } => { try { const cur = localStorage.getItem(FILTER_KEY), v = JSON.parse(cur ?? localStorage.getItem(OLD_FILTER_KEY) ?? "{}"); if (!cur) v.kind = "all"; return { range: v.range === "week" ? "week" : "4w", kind: ["run", "lift"].includes(v.kind) ? v.kind : "all" } } catch { return { range: "4w", kind: "all" } } }
const dur = (s: number | null) => s == null ? "时长—" : fmtDuration(s)
const durTotal = (s: number) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}小时${m % 60}分` : `${m}分钟` }
const km = (m: number | null) => fmtDistance(m)
const pace = (m: number | null, s: number | null) => fmtPace(m, s)
const hm = (iso: string) => activityLocalTime(iso)
const sourcesOf = (r: ActivityRow) => sourceLabels(r)
const seg = (on: boolean) => "min-h-10 rounded-full text-sm font-bold " + (on ? "bg-accent text-accent-fg shadow-sm" : "text-muted")

function Entry({ title, summary, children, id, open, onToggle }: { title: string; summary: string; children: React.ReactNode; id: string; open?: boolean; onToggle?: (o: boolean) => void }) {
  return <details id={id} open={open} onToggle={e => onToggle?.((e.target as HTMLDetailsElement).open)} className="fk-log-entry home-card mt-3 scroll-mt-24 px-3 py-0 text-sm">
    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2"><span className="font-bold">{title}</span><span className="keep min-w-0 flex-1 truncate text-xs text-muted">{summary}</span><span className="fk-log-arrow text-muted" aria-hidden="true">›</span></summary>
    <div className="pb-3">{children}</div>
  </details>
}

/** v79：计划跑步课 ↔ 这条佳明跑步（同一条记录，计划不另算一条）。 */
function RunLinkNote({ link }: { link: RunLink }) {
  const c = planVsActual(link.entry, link.run)
  return <div className="rounded-lg border border-line px-2 py-1 text-xs" data-testid="run-link">
    <p className="keep"><b>已关联佳明跑步</b> · 计划「{link.entry.title}」{link.by === "auto" ? "（旧版本自动关联的，不对可取消）" : "（你确认的）"}</p>
    <p className="keep text-muted">计划 {c.plan} → 实际 {c.actual}</p>
    <p className="keep">{c.note}</p>
    <button type="button" className="mt-1 min-h-9 text-xs font-bold text-accent underline" onClick={() => { const cur = allRunLinks()[link.entry.id]; saveRunLink(link.entry.id, { rejected: [...(cur?.rejected ?? []), link.run.id] }) }}>取消关联</button>
  </div>
}
function RecordRow({ r, plan, onAsk, open, onOpen, link }: { r: ActivityRow; plan: Plan; onAsk: (id: string | null) => void; open: boolean; onOpen: (v: boolean) => void; link?: RunLink }) {
  const k = kindOf(r), Icon = k === "run" ? Footprints : k === "lift" ? Dumbbell : Activity
  const g = r.garminId != null ? garminById(r.garminId) : null
  const occ = r.occurrenceId ? listTrainingOccurrences().find(o => o.trainingOccurrenceId === r.occurrenceId) ?? null : null
  const imp = r.importId && !g ? loadConfirmedTrainingImports().find(i => i.confirmedImportId === r.importId) ?? null : null
  const name = r.title && !/佳明账号同步/.test(r.title) ? r.title : k === "run" ? "跑步" : k === "lift" ? "力量训练" : "训练"
  // 方坤里记录的训练：直接用原来的记录卡（含分段、更正、作废），只加来源标签，不另造一行。
  if (imp && !occ) return <li id={`log-rec-${encodeURIComponent(r.id)}`} className="scroll-mt-24 border-b border-line py-1 last:border-b-0"><span className="keep block text-[11px] text-muted">{r.date.slice(5)} {hm(r.startedAt)} · {sourcesOf(r).join(" + ")}{r.quickLog ? " · 记一笔（计划外）" : ""}</span>{r.note ? <span className="keep block text-[11px] font-bold text-warn" data-testid="row-note">{r.note}：下面原记录里的分钟数不计入统计</span> : null}<ImportRow item={imp} onAsk={onAsk} onDeleted={() => window.dispatchEvent(new Event("fk-training-activities-changed"))} /></li>
  if (occ && !g) return <li id={`log-rec-${encodeURIComponent(r.id)}`} className="scroll-mt-24 border-b border-line py-1 last:border-b-0"><span className="keep block text-[11px] text-muted">{r.date.slice(5)} {hm(r.startedAt)} · {sourcesOf(r).join(" + ")}{r.status === "incomplete" ? ` · ${r.rpe != null ? "未完成" : "未完成·未反馈"}（不计入）` : ""}</span><OccurrenceCard item={occ} plan={plan} onAsk={onAsk} /></li>
  return <li id={`log-rec-${encodeURIComponent(r.id)}`} className="scroll-mt-24 border-b border-line last:border-b-0">
    <button type="button" aria-expanded={open} onClick={() => onOpen(!open)} className="flex min-h-14 w-full items-center gap-3 py-2 text-left">
      <span className={(k === "run" ? "chip-run" : "chip-lift") + " grid size-9 shrink-0 place-items-center rounded-full"}><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{name}{link ? <span className="ml-1 text-xs font-normal text-muted">· 计划「{link.entry.title}」</span> : null}</span>
        <span className="keep block truncate text-xs text-muted">{r.date.slice(5)}{r.timeUnknown ? "" : ` ${hm(r.startedAt)}`} · {sourcesOf(r).join(" + ")}{r.status === "incomplete" ? <b className="ml-1 rounded bg-amber-100 px-1 text-amber-800">{r.rpe != null ? "未完成" : "未完成·未反馈"}（不计入）</b> : null}</span>
        <span className="keep block truncate text-xs">{k === "lift" ? [dur(r.durationSec) + (r.durationPartial ? "（部分）" : ""), r.sets ? `${r.sets} 组` : null].filter(Boolean).join(" · ") : `${km(r.distanceM) ?? "距离—"} · ${dur(r.durationSec)}${r.durationPartial ? "（部分）" : ""}`}<span className="text-muted">{k !== "lift" ? ` · 配速 ${pace(r.distanceM, r.durationSec) ?? "—"}` : ""}{r.avgHr ? ` · 心率 ${fmtHr(r.avgHr)} 次/分` : ""}</span></span>
      </span>
      <span className="text-muted" aria-hidden="true">{open ? "▾" : "›"}</span>
    </button>
    {open ? <div className="mb-3 space-y-2">
      {link ? <RunLinkNote link={link} /> : null}
      {r.v4 ? <div className="rounded-lg border border-line px-2 py-1 text-xs" data-testid="v4-fact-note"><p className="keep font-bold">{planPrefix()}这节课</p>{r.v4.running ? <p className="keep">跑步：{r.v4.running.label}{r.v4.running.detail ? ` · ${r.v4.running.detail}` : ""}</p> : null}{r.v4.strength ? <p className="keep">力量：{r.v4.strength.label}</p> : null}{r.v4.legacyOverall ? <p className="keep text-muted">历史整课记录（旧口径，只读；整课 RPE 不拆给跑步或力量）</p> : null}</div> : null}
      {r.v4parts ? <div className="rounded-lg border border-line px-2 py-1 text-xs" data-testid="v4-parts-note"><p className="keep font-bold">{planPrefix()}分项评价</p>{[partLine("跑步", r.v4parts.running), partLine("力量", r.v4parts.strength)].map((x, i) => x ? <p key={i} className="keep">{x}</p> : null)}{!partLine("跑步", r.v4parts.running) && !partLine("力量", r.v4parts.strength) ? <p className="keep text-muted">还没有分项评价</p> : null}</div> : null}
      {g ? <GarminActivityRow g={g} detailOnly /> : null}
      {occ ? <OccurrenceCard item={occ} plan={plan} onAsk={onAsk} /> : null}
      {imp ? <ImportRow item={imp} onAsk={onAsk} onDeleted={() => window.dispatchEvent(new Event("fk-training-activities-changed"))} /> : null}
      {!g && !occ && !imp ? <PhoneRecordDetail row={r} /> : null}
      <button type="button" className="min-h-11 rounded-full border border-line px-3 text-sm font-bold" onClick={() => onAsk(r.importId ?? r.occurrenceId ?? null)}>让方坤复盘这次</button>
    </div> : null}
  </li>
}

/** 训练日志 v76：筛选 → 当前范围摘要 → 按日期分组的记录（佳明 + 方坤记录合并，标来源）→ 方坤复盘 → 可展开入口。 */
export function TrainingLogPage({ today, plan, onAsk, onNavigate }: { today: string; plan: Plan; onAsk: (id: string | null) => void; onNavigate?: (tab: string) => void }) {
  const [f, setF] = useState(loadFilter)
  const [rev, setRev] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [focusDay, setFocusDay] = useState<string | null>(null)
  const [entry, setEntry] = useState<Record<string, boolean>>({})
  useEffect(() => { const up = () => setRev(n => n + 1), off = onAppEvent(up); const names = ["fk-training-activities-changed", "fk-run-links", "fk-plan400-components", "storage", "fk-garmin-synced", "fk-schedule-changed", "fk-plan400-changed", "focus", "pageshow"]; for (const n of names) window.addEventListener(n, up); return () => { off(); for (const n of names) window.removeEventListener(n, up) } }, [])
  const setFilter = (next: Partial<typeof f>) => { const v = { ...f, ...next }; setF(v); setFocusDay(null); try { localStorage.setItem(FILTER_KEY, JSON.stringify(v)) } catch { /* session only */ } }
  const rows = useMemo(() => { try { return loadTrainingActivities() } catch { return [] } }, [rev])
  const s = useMemo(() => summarize(rows, f.range, f.kind, today), [rows, f, today])
  const list = focusDay ? rows.filter(r => r.date === focusDay) : s.list
  const hint = !focusDay && s.count === 0 ? outsideHint(rows, f.range, f.kind, today) : null
  const otherCount = f.kind === "all" ? 0 : summarize(rows, f.range, "all", today).count - s.count
  const runMatch = useMemo(() => { void rows; return lastRunMatch() }, [rows])
  const linkByRow = useMemo(() => new Map(rows.flatMap(r => { const l = r.runLink && runMatch.links.find(x => x.entry.id === r.runLink!.entryId); return l ? [[r.id, l] as const] : [] })), [rows, runMatch])
  const unmarked = useMemo(() => { if (focusDay) return []; try { const ids = new Set([...rows.flatMap(r => r.originIds), ...runMatch.links.map(l => `sched:${l.entry.id}`)]); return unmarkedEntries(loadSchedule().entries, s.start, s.end < today ? s.end : today, today, f.kind, ids) } catch { return [] } }, [rows, s.start, s.end, today, f.kind, runMatch, focusDay])
  // 周一为一周开始：周一打开“本周”看不到昨天（周日）。明确告诉上周有几条，一键切近4周。
  const prevWeek = (() => { if (focusDay || f.range !== "week") return null; const st = rangeOf("week", today).start, d = new Date(st + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 7); const ps = d.toISOString().slice(0, 10), pw = summarize(rows, "week", f.kind, ps); return pw.count || pw.incomplete ? { start: pw.start, end: pw.end, count: pw.count, incomplete: pw.incomplete } : null })()
  useEffect(() => {
    const onFocus = (e: Event) => {
      const { date, ids } = (e as CustomEvent<{ date: string; ids: string[] }>).detail ?? {}
      if (!date) return
      const w = rangeOf("week", today), m = rangeOf("4w", today)
      if (date >= w.start && date <= w.end) { setF(v => ({ ...v, range: "week", kind: "all" })); setFocusDay(null) } else if (date >= m.start && date <= m.end) { setF(v => ({ ...v, range: "4w", kind: "all" })); setFocusDay(null) } else setFocusDay(date)
      const id = ids?.[0] ?? null; setOpenId(id)
      setTimeout(() => document.getElementById(id ? `log-rec-${encodeURIComponent(id)}` : `log-day-${date}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 80)
    }
    window.addEventListener("fk-log-focus", onFocus); return () => window.removeEventListener("fk-log-focus", onFocus)
  }, [today])
  const days = useMemo(() => { const m = new Map<string, ActivityRow[]>(); for (const r of list) m.set(r.date, [...(m.get(r.date) ?? []), r]); return [...m] }, [list])
  const max = Math.max(1, ...s.bars.map(b => b.minutes))
  const feelLogs = plan.cycle?.logs ?? []
  const undatedImports = loadConfirmedTrainingImports().filter(i => !calendarDayShanghai(i.occurredAt.value) && !String(i.title.value ?? "").includes("佳明账号同步"))
  const undatedOcc = listTrainingOccurrences().filter(o => !calendarDayShanghai(o.startedAt))
  const garminCount = garminActivities().length
  const hasHistory = rows.length > 0 || undatedImports.length > 0 || undatedOcc.length > 0 || garminCount > 0
  return <div className="fk-log-v76 mx-auto max-w-3xl px-3 pt-2 pb-nav" data-testid="training-log-v76">
    {/* v83（P1-04）：先看“待补什么、最近练了什么”；五维能力图下移到记录之后 */}
    <PendingFeedbackList today={today} />
    <section className="home-card px-3 py-3" aria-label="日期与类型筛选">
      <h2 className="px-1 text-base font-bold">训练记录</h2>
      <div className="mt-2 grid grid-cols-3 gap-1 rounded-full bg-surface-2 p-1" role="group" aria-label="训练类型筛选">
        {([["all", "全部"], ["run", "跑步"], ["lift", "力量"]] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={f.kind === id} onClick={() => setFilter({ kind: id })} className={seg(f.kind === id)}>{label}</button>)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1" role="group" aria-label="日期范围">
        {([["week", "本周"], ["4w", "近4周"]] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={!focusDay && f.range === id} onClick={() => setFilter({ range: id })} className={seg(!focusDay && f.range === id)}>{label}</button>)}
      </div>
      {!focusDay && f.kind !== "all" ? <p className="keep mt-2 flex items-center justify-between rounded-lg bg-accent/15 px-2 py-1 text-xs font-bold text-accent" data-testid="active-filter">只看{f.kind === "run" ? "跑步" : "力量"}{otherCount ? ` · 另有 ${otherCount} 条${f.kind === "run" ? "力量" : "跑步"}没显示` : ""}<button type="button" className="min-h-9 underline" onClick={() => setFilter({ kind: "all" })}>看全部</button></p> : null}
    </section>
    {focusDay || s.count > 0 ? <section className="home-card mt-3 px-3 py-3" aria-label="当前周期摘要">
      {focusDay ? <p className="keep text-sm font-bold">{focusDay} 的记录（从复盘打开）<button type="button" className="fk-link ml-2 text-xs" onClick={() => setFocusDay(null)}>回到{f.range === "week" ? "本周" : "近4周"}</button></p> : <>
        <p className="keep text-sm"><b>{s.start.slice(5)} – {s.end.slice(5)}</b> · {f.kind === "all" ? "全部" : f.kind === "run" ? "跑步" : "力量"} {s.count} 条记录{f.kind === "all" ? `（跑步 ${s.run} · 力量 ${s.lift}${s.run + s.lift > s.count ? `，其中 ${s.run + s.lift - s.count} 条是跑+力量同一课` : ""}）` : ""}{s.incomplete ? ` · 另有 ${s.incomplete} 条未完成（不计入）` : ""}</p>
        <p className="keep mt-1 text-xs text-muted">{f.kind !== "lift" ? `跑步 ${(s.distanceM / 1000).toFixed(2)} km${s.missingDistance ? `（${s.missingDistance} 条缺距离，未计入）` : ""} · ` : ""}时长 {s.durationSec ? durTotal(s.durationSec) : s.missingDuration ? "—" : "0分钟"}{s.missingDuration ? `（${s.missingDuration} 条缺时长，未计入）` : ""} · 来源 手机记录 {s.bySource.app} · 佳明 {s.bySource.garmin}{s.bySource.upload ? ` · 聊天/上传 ${s.bySource.upload}` : ""}</p>
        <div className="mt-2 flex items-end gap-1.5" aria-label={f.range === "week" ? "本周每天训练分钟" : "近4周每周训练分钟"}>
          {s.bars.map(b => <div key={b.start} className="flex flex-1 flex-col items-center gap-0.5">
            <span className="keep text-xs text-muted">{b.future ? "" : b.count ? `${b.minutes}′${b.unknown ? "+?" : ""}` : "—"}</span>
            <div className={"w-full rounded-t " + (b.future ? "bg-line/40" : "bg-[#ff6a1a]")} style={{ height: `${Math.max(b.count ? 4 : 1, (b.minutes / max) * 56)}px` }} title={`${b.start}${b.end !== b.start ? `–${b.end}` : ""}：${b.count} 条，${b.minutes} 分钟${b.unknown ? `，${b.unknown} 条缺时长` : ""}`} />
            <span className={"keep text-[10px] " + (today >= b.start && today <= b.end ? "font-bold text-fg" : "text-muted")}>{b.label}</span>
          </div>)}
        </div>
      </>}
    </section> : null}
    <section className="home-card mt-3 px-3 py-2" aria-label="训练记录列表">
      {days.length ? days.map(([d, rs]) => <div key={d} id={`log-day-${d}`} className="scroll-mt-24">
        <h3 className="keep pt-2 text-xs font-bold text-muted">{d.slice(5)} 周{"日一二三四五六"[new Date(d + "T00:00:00Z").getUTCDay()]} · {rs.length} 条</h3>
        <ul>{rs.map(r => <RecordRow key={r.id} r={r} plan={plan} link={linkByRow.get(r.id)} onAsk={onAsk} open={openId === r.id} onOpen={v => setOpenId(v ? r.id : null)} />)}</ul>
      </div>) : hasHistory || focusDay ? <p className="keep py-2 text-sm text-muted">{focusDay ? `${focusDay} 没有训练记录。` : hint ?? `${s.start.slice(5)}–${s.end.slice(5)} 还没有${f.kind === "run" ? "跑步" : f.kind === "lift" ? "力量" : "训练"}记录。`}</p> : <div className="py-5 text-center">
        <p className="text-base font-bold">还没有训练记录</p>
        {onNavigate ? <button type="button" className="fk-primary mt-3 min-h-11 px-5" onClick={() => onNavigate("plan")}>去安排训练</button> : null}
      </div>}
      {prevWeek ? <p className="keep pt-1 text-xs text-muted">上周（{prevWeek.start.slice(5)}–{prevWeek.end.slice(5)}）有 {prevWeek.count} 条{f.kind === "run" ? "跑步" : f.kind === "lift" ? "力量" : ""}记录{prevWeek.incomplete ? `（另有 ${prevWeek.incomplete} 条未完成，不计入）` : ""}。<button type="button" className="ml-1 font-bold text-accent underline" onClick={() => setFilter({ range: "4w" })}>看近4周</button></p> : null}
    </section>
    <UnmarkedPlans items={unmarked} plan={plan} suggestions={runMatch.suggestions} onChanged={() => setRev(n => n + 1)} />
    {hasHistory ? <>
    <div className="mt-3"><ReviewPanel today={today} title="方坤复盘" /></div>
    <Entry id="log-trend" title="详细趋势" summary="训练负荷" open={entry.trend} onToggle={o => setEntry(e => ({ ...e, trend: o }))}>{entry.trend ? <><LogMetricsPanel today={today} loadOnly /><TrainingEvidencePanel today={today} /></> : null}</Entry>
    <details className="home-card mt-3 px-3 py-2" aria-label="我的能力（五维）" data-testid="log-radar"><summary className="min-h-12 cursor-pointer text-base font-bold">我的能力</summary><AbilityRadarCard asOf={today} mode="chart" /></details>
    </> : null}
    {hasHistory || feelLogs.length > 0 ? <Entry id="log-week-review" title="本周复盘与感受" summary={feelLogs.length ? `感受 ${feelLogs.length} 条 · 查看建议与反馈` : "查看本周建议，按需补充感受"} open={entry.history || entry.feel} onToggle={o => setEntry(e => ({ ...e, history: o, feel: o }))}>
      {entry.history || entry.feel ? <>
        <AssessmentPanel />
        <div className="mt-3 border-t border-line pt-3 text-sm">
          <h3 className="font-bold">本周感受与成长</h3>
          {feelLogs.length ? <ul className="mt-2 space-y-1">{feelLogs.map(log => <li key={log.sessionId}>{plan.sessions.find(x => x.id === log.sessionId)?.name ?? "未命名课"} · {FEEL[log.feel] ?? log.feel}{log.note ? ` · ${log.note}` : ""}</li>)}</ul> : <div className="mt-2 text-sm"><p>本周还没有训练感受。</p><button type="button" className="mt-2 min-h-11 rounded-full border border-line px-3 font-bold" onClick={() => onNavigate?.("today")}>前往今日反馈</button></div>}
          <AthleteGrowthCard plan={plan} />
        </div>
      </> : null}
    </Entry> : null}
    {garminCount > 0 ? <Entry id="log-garmin" title="佳明活动" summary={`共 ${garminCount} 条 · 原始列表`} open={entry.garmin} onToggle={o => setEntry(e => ({ ...e, garmin: o }))}>{entry.garmin ? <GarminLog range={{ start: s.start, end: s.end }} /> : null}</Entry> : null}
    {undatedImports.length || undatedOcc.length ? <Entry id="log-undated" title="没有可用日期的记录" summary={`${undatedImports.length + undatedOcc.length} 条`}>
      {undatedImports.map(item => <ImportRow key={item.confirmedImportId} item={item} onAsk={onAsk} onDeleted={() => setRev(n => n + 1)} />)}
      {undatedOcc.map(item => <OccurrenceCard key={item.trainingOccurrenceId} item={item} plan={plan} onAsk={onAsk} />)}
    </Entry> : null}
  </div>
}
