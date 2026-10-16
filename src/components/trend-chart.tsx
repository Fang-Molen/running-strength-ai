import { useRef, useState } from "react";

export type Pt = { d: string; v: number };
export type Series = { label: string; color: string; points: Pt[]; fmt?: (v: number) => string };
const t = (d: string) => new Date(d + "T12:00:00").getTime();

/** 轻量 SVG 折线（可多条，各自归一化）：双指缩放、单指横向拖动、点按看数值、双击复原。 */
export function MultiTrend({ series, height = 96 }: { series: Series[]; height?: number }) {
  const [win, setWin] = useState<[number, number]>([0, 1]);
  const [tip, setTip] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const ptrs = useRef(new Map<number, number>());
  const st = useRef<{ win: [number, number]; x: number; dist: number; moved: boolean } | null>(null);
  const live = series.filter((s) => s.points.length >= 1);
  const all = live.flatMap((s) => s.points.map((p) => t(p.d)));
  if (live.length === 0 || all.length < 2) return null;
  const t0 = Math.min(...all), t1 = Math.max(...all), T = Math.max(1, t1 - t0);
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
  const lines = live.map((s) => {
    const vis = s.points.filter((p) => F(p.d) >= a - 0.02 && F(p.d) <= b + 0.02); const vs = (vis.length ? vis : s.points).map((p) => p.v);
    const lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.15 || 1;
    const Y = (v: number) => 58 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 52;
    return { s, lo, hi, Y, pts: s.points.map((p) => `${X(p.d).toFixed(2)},${Y(p.v).toFixed(2)}`).join(" ") };
  });
  const near = (s: Series) => tip == null ? null : s.points.reduce((m, p) => (Math.abs(t(p.d) - tip) < Math.abs(t(m.d) - tip) ? p : m), s.points[0]);
  const tipX = tip == null ? null : ((((tip - t0) / T) - a) / (b - a)) * 100;
  const day = (ms: number) => new Date(ms).toISOString().slice(5, 10);
  const f = (s: Series, v: number) => (s.fmt ?? ((x: number) => String(Math.round(x * 10) / 10)))(v);
  return <div className="relative">
    <svg ref={ref} viewBox="0 0 100 64" preserveAspectRatio="none" className="mt-1 w-full select-none" style={{ height, touchAction: "pan-y" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={() => setWin([0, 1])}>
      {[16, 32, 48].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="#2a2b30" strokeWidth=".4" vectorEffect="non-scaling-stroke" />)}
      {lines.map(({ s, pts }, i) => <g key={s.label}>{i === 0 && live.length === 1 ? <polyline points={`${X(s.points[0].d)},64 ${pts} ${X(s.points[s.points.length - 1].d)},64`} fill={s.color} fillOpacity=".15" /> : null}<polyline points={pts} fill="none" stroke={s.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></g>)}
      {tipX != null ? <line x1={tipX} x2={tipX} y1="0" y2="64" stroke="#9a9ca3" strokeWidth=".6" vectorEffect="non-scaling-stroke" /> : null}
    </svg>
    <div className="keep flex justify-between text-[10px] text-muted"><span>{day(t0 + a * T)}</span>{live.length === 1 ? <span>{f(live[0], lines[0].lo)}–{f(live[0], lines[0].hi)}</span> : <span>各指标独立缩放</span>}<span>{day(t0 + b * T)}</span></div>
    {tipX != null ? <div className="pointer-events-none absolute top-0 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] shadow" style={{ left: `clamp(0px, calc(${tipX}% - 40px), calc(100% - 110px))` }}>{live.map((s) => { const p = near(s)!; return <div key={s.label}><span style={{ color: s.color }}>●</span> {p.d.slice(5)} {s.label} <b>{f(s, p.v)}</b></div>; })}</div> : null}
  </div>;
}
export function TrendChart({ points, fmt, height = 96, color = "#ff6a1a" }: { points: Pt[]; fmt?: (v: number) => string; height?: number; color?: string }) {
  return <MultiTrend series={[{ label: "", color, points, fmt }]} height={height} />;
}
