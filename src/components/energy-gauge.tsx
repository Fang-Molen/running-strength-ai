import { useRef, useState } from "react"
import { RPE_SOURCE, rpeColor, rpeKey, rpeLabel, snapRpe, type RpeMode } from "@/lib/ui/rpe"

/** 气力槽：可拖动的 0–10 RPE。大触控区、吸附整数（可选 0.5）、每格轻震、键盘可用（role=slider）。value=null 表示未填。 */
export function EnergyGauge({ value, onChange, mode = "strength", half = false, label = "主观用力（气力槽）", compact = false }: { value: number | null; onChange: (v: number | null) => void; mode?: RpeMode; half?: boolean; label?: string; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), last = useRef<number | null>(value), [drag, setDrag] = useState(false)
  const set = (v: number) => { if (v !== last.current) { last.current = v; try { navigator.vibrate?.(8) } catch { /* no haptics */ } onChange(v) } }
  const fromX = (x: number) => { const r = ref.current!.getBoundingClientRect(); return snapRpe(((x - r.left) / r.width) * 10, half) }
  const v = value ?? 0
  return <div className="select-none" aria-label={label}>
    <div className="flex items-baseline justify-between gap-2"><span className="text-xs font-bold">{label}</span>
      {value == null ? <span className="text-xs text-muted">拖动或点一下</span> : <span className="text-sm"><b className="text-xl tabular-nums" style={{ color: rpeColor(v) }}>{v}</b><span className="ml-1 text-xs">{rpeLabel(v, mode)}</span></span>}</div>
    <div ref={ref} role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={10} aria-valuenow={value ?? undefined} aria-valuetext={value == null ? "未填" : `${v}，${rpeLabel(v, mode)}`}
      onKeyDown={(e) => { const n = rpeKey(v, e.key, half); if (n != null) { e.preventDefault(); set(n) } }}
      onPointerDown={(e) => { ref.current!.setPointerCapture(e.pointerId); setDrag(true); set(fromX(e.clientX)) }}
      onPointerMove={(e) => { if (drag) set(fromX(e.clientX)) }} onPointerUp={() => setDrag(false)} onPointerCancel={() => setDrag(false)}
      className={"relative mt-1.5 w-full cursor-pointer touch-none rounded-full border border-line bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-accent " + (compact ? "h-9" : "h-12")}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v * 10}%`, backgroundColor: rpeColor(v), backgroundImage: `linear-gradient(90deg, ${rpeColor(0)}, ${rpeColor(v)})`, opacity: value == null ? 0 : 0.9 }} />
      <div className="pointer-events-none absolute inset-0 flex">{Array.from({ length: 10 }, (_, i) => <i key={i} className="flex-1 border-r border-white/50 last:border-0" />)}</div>
      {value != null ? <div className="pointer-events-none absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${v * 10}%`, background: rpeColor(v) }} /> : null}
    </div>
    <div className="mt-0.5 flex justify-between text-[10px] text-muted"><span>0 轻松</span><span>{RPE_SOURCE[mode]}</span><span>10 极限</span></div>
    {value != null ? <button type="button" className="fk-link text-[11px]" onClick={() => { last.current = null; onChange(null) }}>清除</button> : null}
  </div>
}
