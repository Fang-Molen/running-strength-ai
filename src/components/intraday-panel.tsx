/** v88.3 手表日内：全天心率 + 身体电量曲线（健康页「健康记录」内），点开看详情。只展示设备样本；身体电量不是训练许可。 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, HeartPulse, BatteryMedium } from "lucide-react";
import { Sheet } from "./sheet";
import { HEALTH_CHANGED } from "@/lib/health/observation";
import { loadIntraday } from "@/lib/health/intraday-store";
import { clock, minuteOfDay, summarizeDay, type IntradayDay, type Sample } from "@/lib/health/garmin-intraday";

type Kind = "hr" | "bb";
const META: Record<Kind, { label: string; unit: string; color: string; gap: number; Icon: typeof HeartPulse }> = {
  hr: { label: "全天心率", unit: "次/分", color: "#ff6a1a", gap: 20, Icon: HeartPulse },
  bb: { label: "身体电量", unit: "/100", color: "#4cc38a", gap: 40, Icon: BatteryMedium },
};
const mdCN = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const W = 360;

export function useIntraday(): Record<string, IntradayDay> {
  const [rev, setRev] = useState(0);
  useEffect(() => { const f = () => setRev(x => x + 1); window.addEventListener(HEALTH_CHANGED, f); window.addEventListener("storage", f); window.addEventListener("fk-garmin-synced", f); return () => { window.removeEventListener(HEALTH_CHANGED, f); window.removeEventListener("storage", f); window.removeEventListener("fk-garmin-synced", f); }; }, []);
  return useMemo(() => loadIntraday(), [rev]);
}

export function IntradayChart({ d, kind, height = 96, interactive = true, axis = true }: { d: IntradayDay; kind: Kind; height?: number; interactive?: boolean; axis?: boolean }) {
  const m = META[kind], pts = kind === "hr" ? d.hr : d.bb;
  const [pick, setPick] = useState<Sample | null>(null);
  useEffect(() => setPick(null), [d.day, kind]);
  const ref = useRef<SVGSVGElement>(null);
  const top = 14, bottom = axis ? 16 : 4, H = height, ph = H - top - bottom;
  const vals = pts.map(p => p[1]);
  const lo = kind === "bb" ? 0 : Math.max(30, Math.floor((Math.min(...vals) - 5) / 10) * 10), hi = kind === "bb" ? 100 : Math.ceil((Math.max(...vals) + 5) / 10) * 10;
  const x = (t: number) => Math.max(0, Math.min(W, minuteOfDay(t, d.day, d.offsetMin) / 1440 * W));
  const y = (v: number) => top + ph - (v - lo) / Math.max(1, hi - lo) * ph;
  const path = useMemo(() => { let s = "", prev: number | null = null; for (const [t, v] of pts) { s += `${prev == null || t - prev > m.gap * 60e3 ? "M" : "L"}${x(t).toFixed(1)},${y(v).toFixed(1)}`; prev = t; } return s; }, [pts, lo, hi]); // eslint-disable-line react-hooks/exhaustive-deps
  const minP = pts.reduce((a, b) => (b[1] < a[1] ? b : a), pts[0]), maxP = pts.reduce((a, b) => (b[1] > a[1] ? b : a), pts[0]), last = pts[pts.length - 1];
  const choose = (clientX: number) => { const r = ref.current?.getBoundingClientRect(); if (!r || !pts.length) return; const px = (clientX - r.left) / r.width * W; let best = pts[0]; for (const p of pts) if (Math.abs(x(p[0]) - px) < Math.abs(x(best[0]) - px)) best = p; setPick(best); };
  const label = (p: Sample, txt: string, below = false) => { const px = x(p[0]), anchor = px < 30 ? "start" : px > W - 30 ? "end" : "middle"; return <text x={px} y={below ? y(p[1]) + 11 : y(p[1]) - 4} textAnchor={anchor} fontSize="9" fill="var(--color-muted)">{txt}</text>; };
  if (!pts.length) return <p className="keep py-3 text-center text-xs text-muted">这天没有{m.label}样本。</p>;
  return <div className="relative">
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="block w-full touch-none select-none" style={{ height }} role="img" aria-label={`${mdCN(d.day)}${m.label}曲线`}
      onPointerDown={interactive ? e => { e.stopPropagation(); choose(e.clientX); } : undefined} onPointerMove={interactive ? e => { if (e.buttons || e.pointerType !== "mouse") choose(e.clientX); } : undefined} onClick={interactive ? e => e.stopPropagation() : undefined}>
      {d.sleep ? <rect x={x(d.sleep[0])} y={top} width={Math.max(1, x(d.sleep[1]) - x(d.sleep[0]))} height={ph} fill="#6b7cff" opacity="0.14" data-testid="shade-sleep" /> : null}
      {d.training.map((t, i) => <rect key={i} x={x(t.start)} y={top} width={Math.max(2, x(t.end) - x(t.start))} height={ph} fill="#ff6a1a" opacity="0.16" data-testid="shade-training" />)}
      {[0, 6, 12, 18, 24].map(h => <g key={h}><line x1={h / 24 * W} x2={h / 24 * W} y1={top} y2={top + ph} stroke="var(--color-line)" strokeWidth="0.6" strokeDasharray="2 3" />{axis ? <text x={Math.min(W - 2, Math.max(2, h / 24 * W))} y={H - 4} fontSize="9" textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"} fill="var(--color-muted)">{String(h).padStart(2, "0")}:00</text> : null}</g>)}
      <path d={path} fill="none" stroke={m.color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {axis ? <>{label(maxP, `最高 ${maxP[1]}`)}{minP !== maxP ? label(minP, `最低 ${minP[1]}`, true) : null}</> : null}
      <circle cx={x(last[0])} cy={y(last[1])} r="5" fill={m.color} opacity="0.25" /><circle cx={x(last[0])} cy={y(last[1])} r="2.6" fill={m.color} data-testid="latest-dot" />
      {pick ? <g data-testid="pick"><line x1={x(pick[0])} x2={x(pick[0])} y1={top} y2={top + ph} stroke="var(--color-fg)" strokeWidth="0.8" /><circle cx={x(pick[0])} cy={y(pick[1])} r="3.4" fill="var(--color-fg)" /></g> : null}
    </svg>
    {pick ? <div className="pointer-events-none absolute top-0 whitespace-nowrap rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-bold" style={{ left: `clamp(0px, calc(${x(pick[0]) / W * 100}% - 40px), calc(100% - 84px))` }} data-testid="pick-label">{clock(pick[0], d.offsetMin)} · {pick[1]}{m.unit === "/100" ? "" : " "}{m.unit}</div> : null}
  </div>;
}

function Legend({ d }: { d: IntradayDay }) {
  if (!d.sleep && !d.training.length) return null;
  return <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted">
    {d.sleep ? <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm" style={{ background: "#6b7cff", opacity: 0.5 }} />睡眠 {clock(d.sleep[0], d.offsetMin)}–{clock(d.sleep[1], d.offsetMin)}</span> : null}
    {d.training.length ? <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm" style={{ background: "#ff6a1a", opacity: 0.5 }} />训练 {d.training.map(t => `${t.label} ${clock(t.start, d.offsetMin)}`).join("、")}</span> : null}
  </div>;
}

function MetricCard({ d, kind, onOpen }: { d: IntradayDay; kind: Kind; onOpen: () => void }) {
  const m = META[kind], s = summarizeDay(d), st = kind === "hr" ? s?.hr : s?.bb;
  return <div className="rounded-xl bg-surface-2 p-2" data-testid={`intraday-${kind}`}>
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-1.5 text-left" aria-label={`查看${m.label}详情`}>
      <m.Icon className="size-4" style={{ color: m.color }} /><b className="text-sm">{m.label}</b>
      {st ? <span className="ml-auto text-xs text-muted">最新 <b className="text-base text-fg" style={{ color: m.color }}>{st.latest[1]}</b>{kind === "bb" ? "/100" : " 次/分"} · {clock(st.latest[0], d.offsetMin)}</span> : <span className="ml-auto text-xs text-muted">无样本</span>}
      <ChevronRight className="size-4 shrink-0 text-muted" />
    </button>
    {st ? <p className="keep mt-0.5 text-[11px] text-muted">最低 {st.min} · 最高 {st.max}{kind === "hr" && d.restingHr != null ? ` · 静息 ${d.restingHr}` : ""}</p> : null}
    <IntradayChart d={d} kind={kind} height={92} />
  </div>;
}

function Detail({ d, kind, onClose, onDay, days }: { d: IntradayDay; kind: Kind; onClose: () => void; onDay: (day: string) => void; days: string[] }) {
  const m = META[kind], pts = kind === "hr" ? d.hr : d.bb, s = summarizeDay(d), st = kind === "hr" ? s?.hr : s?.bb;
  const hours = useMemo(() => { const out: { h: number; lo: number; hi: number; n: number }[] = []; for (const [t, v] of pts) { const h = Math.floor(minuteOfDay(t, d.day, d.offsetMin) / 60); if (h < 0 || h > 23) continue; const r = out.find(o => o.h === h); if (r) { r.lo = Math.min(r.lo, v); r.hi = Math.max(r.hi, v); r.n++; } else out.push({ h, lo: v, hi: v, n: 1 }); } return out.sort((a, b) => a.h - b.h); }, [pts, d]);
  const i = days.indexOf(d.day);
  return <Sheet title={m.label} sub={`${mdCN(d.day)} · 佳明手表样本 · 按住或拖动曲线看具体时间`} label={`${m.label}详情`} footer={null} onClose={onClose} full>
    <DaySwitch day={d.day} days={days} onDay={onDay} prev={i > 0 ? days[i - 1] : null} next={i >= 0 && i < days.length - 1 ? days[i + 1] : null} />
    <div className="mt-2 rounded-2xl bg-surface-2 p-2"><IntradayChart d={d} kind={kind} height={210} /><Legend d={d} /></div>
    {st ? <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
      {([["最新", `${st.latest[1]}`, clock(st.latest[0], d.offsetMin)], ["最低", `${st.min}`, ""], ["最高", `${st.max}`, ""], kind === "hr" ? ["静息", d.restingHr != null ? `${d.restingHr}` : "—", "佳明当天"] : ["变化", `${st.latest[1] - pts[0][1] >= 0 ? "+" : ""}${st.latest[1] - pts[0][1]}`, "较当天首个"]] as const).map(([k, v, sub]) => <div key={k} className="rounded-xl bg-surface-2 p-2"><p className="keep text-[11px] text-muted">{k}</p><p className="text-lg font-black" style={k === "最新" ? { color: m.color } : undefined}>{v}</p><p className="keep text-[10px] text-muted">{sub || m.unit}</p></div>)}
    </div> : <p className="mt-2 text-sm text-muted">这天没有{m.label}样本。</p>}
    {hours.length ? <details className="mt-2 rounded-xl border border-line p-2 text-xs"><summary className="cursor-pointer font-bold">逐小时范围（{pts.length} 个样本）</summary>
      <div className="mt-1 grid grid-cols-3 gap-1">{hours.map(h => <span key={h.h} className="rounded bg-surface-2 px-1.5 py-1">{String(h.h).padStart(2, "0")}时 {h.lo === h.hi ? h.lo : `${h.lo}–${h.hi}`}</span>)}</div></details> : null}
    {kind === "bb" ? <p className="keep mt-2 text-xs text-muted">身体电量是佳明根据心率变异等估算的设备读数，仅供参考，不是训练许可；是否训练仍看疼痛、疲劳和热身感受。</p> : <p className="mt-2 text-xs text-muted">全天心率来自手表光学心率，佩戴松紧、运动和环境都会影响读数；不是诊断依据。</p>}
    <p className="keep mt-1 text-[11px] text-muted">同步于 {new Date(d.fetchedAt).toLocaleString("zh-CN", { hour12: false })}{d.offsetMin != null ? ` · 时间按手表当地时区（UTC${d.offsetMin >= 0 ? "+" : "-"}${Math.abs(d.offsetMin / 60)}）` : ""}</p>
  </Sheet>;
}

function DaySwitch({ day, days, onDay, prev, next }: { day: string; days: string[]; onDay: (d: string) => void; prev: string | null; next: string | null }) {
  return <div className="flex items-center gap-1" aria-label="切换日期">
    <button type="button" className="grid size-9 place-items-center rounded-full border border-line disabled:opacity-30" disabled={!prev} onClick={() => prev && onDay(prev)} aria-label="前一天"><ChevronLeft className="size-4" /></button>
    <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">{days.map(x => <button key={x} type="button" className="fk-chip shrink-0" aria-pressed={x === day} onClick={() => onDay(x)}>{mdCN(x)}</button>)}</div>
    <button type="button" className="grid size-9 place-items-center rounded-full border border-line disabled:opacity-30" disabled={!next} onClick={() => next && onDay(next)} aria-label="后一天"><ChevronRight className="size-4" /></button>
  </div>;
}

export function IntradayPanel({ today }: { today: string }) {
  const all = useIntraday(), days = Object.keys(all).sort();
  const [day, setDay] = useState<string | null>(null), [open, setOpen] = useState<Kind | null>(null);
  useEffect(() => { const f = (e: Event) => { const k = (e as CustomEvent<Kind | undefined>).detail; if (k === "hr" || k === "bb") setOpen(k); }; window.addEventListener("fk-open-intraday-detail", f); return () => window.removeEventListener("fk-open-intraday-detail", f); }, []);
  const cur = day && all[day] ? day : all[today] ? today : days[days.length - 1] ?? null, d = cur ? all[cur] : null;
  const i = cur ? days.indexOf(cur) : -1;
  return <section id="fk-intraday" className="mt-2 rounded-xl border border-line p-2" data-testid="intraday-panel">
    <div className="flex items-center"><b className="text-sm">手表日内</b><span className="ml-2 text-[11px] text-muted">{d ? `${mdCN(d.day)}${d.day === today ? "（今天）" : ""}` : ""}</span></div>
    {!d ? <p className="keep mt-1 text-xs text-muted" data-testid="intraday-empty">还没有带时间戳的手表样本。连上佳明后同步一次，这里会显示全天心率和身体电量曲线；没有样本就不画曲线。</p> : <>
      {days.length > 1 ? <div className="mt-1"><DaySwitch day={d.day} days={days} onDay={setDay} prev={i > 0 ? days[i - 1] : null} next={i < days.length - 1 ? days[i + 1] : null} /></div> : null}
      <div className="mt-1.5 grid gap-1.5"><MetricCard d={d} kind="hr" onOpen={() => setOpen("hr")} /><MetricCard d={d} kind="bb" onOpen={() => setOpen("bb")} /></div>
      <Legend d={d} />
      {d.day !== today ? <p className="keep mt-1 text-[11px] text-muted">今天还没有日内样本，显示的是最近一天。</p> : null}
      <p className="keep mt-1 text-[11px] text-muted">身体电量只是设备读数，不是训练许可。</p>
    </>}
    {d && open ? <Detail d={d} kind={open} days={days} onDay={setDay} onClose={() => setOpen(null)} /> : null}
  </section>;
}

/** 今日页一行摘要：最新身体电量 + 静息心率，点了去健康页。没有样本不显示。 */
export function IntradayTodayLine({ today, onOpen }: { today: string; onOpen: () => void }) {
  const all = useIntraday(), d = all[today];
  const s = summarizeDay(d);
  if (!s || (!s.bb && s.restingHr == null)) return null;
  return <button type="button" onClick={onOpen} className="mb-2 flex w-full items-center gap-2 px-1 text-left text-xs text-muted" aria-label="手表日内摘要" data-testid="intraday-today-line">
    <BatteryMedium className="size-4 shrink-0" style={{ color: META.bb.color }} />
    {s.bb ? <span>身体电量 <b className="text-fg">{s.bb.latest[1]}</b>（{clock(s.bb.latest[0], d!.offsetMin)}）</span> : null}
    {s.restingHr != null ? <span>· 静息心率 <b className="text-fg">{s.restingHr}</b></span> : null}
    <span className="ml-auto shrink-0">日内曲线 ›</span>
  </button>;
}
