import { useRef, useState } from "react";

export type Pt = { d: string; v: number };
/** v89.10.6：方坤估算·个人常态（中位数 + 四分位），画在第一条线的纵轴上。 */
export type NormPt = { d: string; median: number; p25: number; p75: number };
export type Series = { label: string; color: string; points: Pt[]; fmt?: (v: number) => string; unit?: string };
export function niceTicks(lo: number, hi: number, n = 4): number[] {
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), r = raw / mag;
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
  // Inclusive integer bounds keep the full data range visible without accumulating step rounding.
  const first = Math.floor(lo / step), last = Math.ceil(hi / step);
  const out: number[] = []; for (let i = first; i <= last; i++) out.push(Math.round(i * step * 1e6) / 1e6);
  return out;
}
const t = (d: string) => new Date(d + "T12:00:00").getTime();

/** 轻量 SVG 折线（可多条，各自归一化）：双指缩放、单指横向拖动、点按看数值、双击复原。 */
/** domain：x 轴固定为所选时间段（如近 90 天），不是数据首尾；相隔超过 1 天的点不连线（缺的天不画假线）。 */
export function MultiTrend({ series, height = 96, domain, norm }: { series: Series[]; height?: number; domain?: [string, string]; norm?: NormPt[] }) {
  const [win, setWin] = useState<[number, number]>([0, 1]);
  const [tip, setTip] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const ptrs = useRef(new Map<number, number>());
  const st = useRef<{ win: [number, number]; x: number; dist: number; moved: boolean } | null>(null);
  const live = series.filter((s) => s.points.length >= 1);
  const all = live.flatMap((s) => s.points.map((p) => t(p.d)));
  if (live.length === 0) return null;
  if (all.length < 2 || Math.min(...all) === Math.max(...all)) { const s0 = live[0], p0 = s0.points[s0.points.length - 1]; return <div><svg viewBox="0 0 100 64" preserveAspectRatio="none" className="mt-1 w-full" style={{ height }}>{[16, 32, 48].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="var(--color-line, #2a2b30)" strokeWidth=".4" vectorEffect="non-scaling-stroke" />)}<line x1="50" x2="50" y1="31" y2="33" stroke={s0.color} strokeWidth="8" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg><p className="keep text-center text-[11px] text-muted">{p0.d.slice(5)} {s0.label} <b>{(s0.fmt ?? ((x: number) => String(Math.round(x * 10) / 10)))(p0.v)}</b></p></div>; }
  const t0 = domain ? Math.min(t(domain[0]), ...all) : Math.min(...all), t1 = domain ? Math.max(t(domain[1]), ...all) : Math.max(...all), T = Math.max(1, t1 - t0);
  const [a, b] = win;
  const F = (d: string) => (t(d) - t0) / T;
  const X = (d: string) => ((F(d) - a) / (b - a)) * 100;
  const fx = (cx: number) => { const r = ref.current!.getBoundingClientRect(); return (cx - r.left) / r.width; };
  const clamp = (w: [number, number]): [number, number] => { let [x, y] = w; const span = Math.max(Math.min(y - x, 1), 0.03); if (x < 0) x = 0; if (x + span > 1) x = 1 - span; return [x, x + span]; };
  const down = (e: React.PointerEvent) => { ref.current!.setPointerCapture(e.pointerId); ptrs.current.set(e.pointerId, fx(e.clientX)); const xs = [...ptrs.current.values()]; st.current = { win, x: xs[0], dist: xs.length > 1 ? Math.abs(xs[0] - xs[1]) : 0, moved: false }; };
  const move = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId) || !st.current) return; ptrs.current.set(e.pointerId, fx(e.clientX));
    const xs = [...ptrs.current.values()]; const s = st.current; const span0 = s.win[1] - s.win[0];
    if (xs.length > 1 && s.dist > 0.02) { const k = s.dist / Math.max(0.02, Math.abs(xs[0] - xs[1])); const span = Math.min(1, span0 * k); const mid = s.win[0] + ((xs[0] + xs[1]) / 2) * span0; setWin(clamp([mid - span / 2, mid + span / 2])); s.moved = true; }
    else if (xs.length === 1) { const dx = xs[0] - s.x; if (Math.abs(dx) > 0.02) s.moved = true; if (s.moved) setWin(clamp([s.win[0] - dx * span0, s.win[1] - dx * span0])); }
  };
  const up = (e: React.PointerEvent) => {
    const s = st.current; ptrs.current.delete(e.pointerId);
    if (s && !s.moved && ptrs.current.size === 0) setTip(t0 + (a + fx(e.clientX) * (b - a)) * T);
    if (ptrs.current.size === 0) st.current = null; else { const xs = [...ptrs.current.values()]; st.current = { win, x: xs[0], dist: 0, moved: true }; }
  };
  const lines = live.map((s, i) => {
    const vis = s.points.filter((p) => F(p.d) >= a - 0.02 && F(p.d) <= b + 0.02); const vs = [...(vis.length ? vis : s.points).map((p) => p.v), ...(i === 0 && norm ? norm.filter((n) => F(n.d) >= a - 0.02 && F(n.d) <= b + 0.02).flatMap((n) => [n.p25, n.p75]) : [])];
    const lo = Math.min(...vs), hi = Math.max(...vs); const ticks = niceTicks(lo, hi); const d0 = ticks[0], d1 = ticks[ticks.length - 1];
    const Y = (v: number) => 60 - ((v - d0) / (d1 - d0 || 1)) * 56;
    const segs: Pt[][] = []; for (const p of s.points) { const last = segs.at(-1)?.at(-1); if (last && t(p.d) - t(last.d) <= 1.5 * 864e5) segs.at(-1)!.push(p); else segs.push([p]); }
    const pt = (p: Pt) => `${X(p.d).toFixed(2)},${Y(p.v).toFixed(2)}`;
    return { s, lo, hi, Y, ticks, segs, pt, pts: s.points.map(pt).join(" ") };
  });
  const near = (s: Series) => tip == null ? null : s.points.reduce((m, p) => (Math.abs(t(p.d) - tip) < Math.abs(t(m.d) - tip) ? p : m), s.points[0]);
  const tipX = tip == null ? null : ((((tip - t0) / T) - a) / (b - a)) * 100;
  const day = (ms: number) => new Date(ms).toISOString().slice(5, 10);
  const f = (s: Series, v: number) => (s.fmt ?? ((x: number) => String(Math.round(x * 10) / 10)))(v);
  const L0 = lines[0];
  return <div className="relative pl-8">
    <div className="pointer-events-none absolute left-0 top-1 w-8 text-[10px] text-muted" style={{ height }}>{L0.ticks.map((v) => <span key={v} className="absolute right-1 -translate-y-1/2" style={{ top: `${(L0.Y(v) / 64) * 100}%` }}>{f(L0.s, v)}</span>)}{L0.s.unit ? <span className="absolute -top-3 left-0">{L0.s.unit}</span> : null}</div>
    <svg ref={ref} viewBox="0 0 100 64" preserveAspectRatio="none" className="mt-1 w-full select-none" style={{ height, touchAction: "pan-y" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={() => setWin([0, 1])}>
      {lines[0].ticks.map((v) => <line key={v} x1="0" x2="100" y1={lines[0].Y(v)} y2={lines[0].Y(v)} stroke="var(--color-line, #2a2b30)" strokeWidth=".5" vectorEffect="non-scaling-stroke" />)}
      {norm?.length ? <g data-testid="trend-norm">{(() => { const segs: NormPt[][] = []; for (const n of norm) { const last = segs.at(-1)?.at(-1); if (last && t(n.d) - t(last.d) <= 1.5 * 864e5) segs.at(-1)!.push(n); else segs.push([n]); } const Y = lines[0].Y; return segs.map((g, j) => <g key={j}><polygon points={[...g.map((n) => `${X(n.d).toFixed(2)},${Y(n.p75).toFixed(2)}`), ...[...g].reverse().map((n) => `${X(n.d).toFixed(2)},${Y(n.p25).toFixed(2)}`)].join(" ")} fill="#b49cff" fillOpacity=".16" /><polyline points={g.map((n) => `${X(n.d).toFixed(2)},${Y(n.median).toFixed(2)}`).join(" ")} fill="none" stroke="var(--fk-reference-color, #c4b2ff)" strokeWidth="1.4" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" /></g>); })()}</g> : null}
      {lines.map(({ s, segs, pt }, i) => <g key={s.label} data-segments={segs.length}>{segs.map((g, j) => g.length > 1 ? <g key={j}>{i === 0 && live.length === 1 ? <polyline points={`${X(g[0].d)},64 ${g.map(pt).join(" ")} ${X(g[g.length - 1].d)},64`} fill={s.color} fillOpacity=".15" /> : null}<polyline points={g.map(pt).join(" ")} fill="none" stroke={s.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></g>
        : <line key={j} x1={X(g[0].d)} x2={X(g[0].d)} y1={lines[i].Y(g[0].v)} y2={lines[i].Y(g[0].v)} stroke={s.color} strokeWidth="5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}</g>)}
      {tipX != null ? <line x1={tipX} x2={tipX} y1="0" y2="64" stroke="#9a9ca3" strokeWidth=".6" vectorEffect="non-scaling-stroke" /> : null}
    </svg>
    <div className="fk-trend-axis-labels keep relative h-4 text-[10px] text-muted">{[0, 0.25, 0.5, 0.75, 1].map((q) => <span key={q} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${q * 100}%`, transform: `translateX(${q === 0 ? "0" : q === 1 ? "-100%" : "-50%"})` }}>{day(t0 + (a + q * (b - a)) * T)}</span>)}</div>
    {live.length > 1 ? <p className="keep text-[10px] text-muted">左轴为{live[0].label}，其余指标各自缩放</p> : null}
    {tipX != null ? <div className="pointer-events-none absolute top-0 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] shadow" style={{ left: `clamp(0px, calc(${tipX}% - 40px), calc(100% - 110px))` }}>{live.map((s) => { const p = near(s)!; return <div key={s.label}><span style={{ color: s.color }}>●</span> {p.d.slice(5)} {s.label} <b>{f(s, p.v)}</b></div>; })}</div> : null}
  </div>;
}
export function TrendChart({ points, fmt, height = 96, color = "#ff6a1a", unit, domain, norm }: { points: Pt[]; fmt?: (v: number) => string; height?: number; color?: string; unit?: string; domain?: [string, string]; norm?: NormPt[] }) {
  return <MultiTrend series={[{ label: "", color, points, fmt, unit }]} height={height} domain={domain} norm={norm} />;
}
