import { useMemo, useState } from "react"
import { abilityComparison, type AbilityScore } from "@/lib/ui/ability-radar"
import { loadSchedule } from "@/lib/ui/day-schedule"
import { loadVitals } from "@/lib/nutrition/vitals"
import { loadExtras } from "@/lib/ui/device-store"
import { loadCheckins, loadTier, TIER_LABEL } from "@/lib/ui/watch-mode"

const SIZE = 260, C = SIZE / 2, R = 92
const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (i * Math.PI) / 3; return [C + Math.cos(a) * R * v, C + Math.sin(a) * R * v] as const }
/** 待评估（null）的顶点直接跳过，不当 0 分画。 */
const poly = (vals: (number | null)[]) => vals.flatMap((v, i) => (v == null ? [] : [pt(i, v / 100).join(",")])).join(" ")

/** 纯 SVG 六方图：实线=现在，虚线=30 天前；待评估维度灰色虚线轴 + 空心点，不画分数。 */
export function AbilityRadar({ now, before, active, onPick }: { now: AbilityScore[]; before: AbilityScore[]; active: number | null; onPick: (i: number) => void }) {
  const anyNow = now.filter((d) => d.status === "scored").length >= 3, anyBefore = before.filter((d) => d.status === "scored").length >= 3
  return <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto block w-full max-w-[300px]" role="img" aria-label="能力六方图">
    {[0.25, 0.5, 0.75, 1].map((k) => <polygon key={k} points={poly(Array(6).fill(k * 100))} fill="none" stroke="currentColor" className="text-line" strokeWidth={1} />)}
    {now.map((d, i) => { const [x, y] = pt(i, 1); return <line key={d.key} x1={C} y1={C} x2={x} y2={y} stroke="currentColor" className="text-line" strokeDasharray={d.status === "pending" ? "3 3" : undefined} /> })}
    {anyBefore ? <polygon points={poly(before.map((d) => d.score))} fill="none" stroke="currentColor" className="text-muted" strokeWidth={1.5} strokeDasharray="5 4" /> : null}
    {anyNow ? <polygon points={poly(now.map((d) => d.score))} fill="currentColor" fillOpacity={0.18} stroke="currentColor" className="text-accent" strokeWidth={2} strokeLinejoin="round" /> : null}
    {now.map((d, i) => {
      const [x, y] = d.status === "scored" ? pt(i, (d.score ?? 0) / 100) : pt(i, 1)
      const [lx, ly] = pt(i, 1.22)
      const on = active === i
      return <g key={d.key} role="button" tabIndex={0} aria-label={`${d.label} ${d.status === "scored" ? d.score + " 分" : "待评估"}`} aria-pressed={on} onClick={() => onPick(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(i) } }} className="cursor-pointer outline-none">
        <circle cx={lx} cy={ly} r={22} fill="transparent" />
        {d.status === "scored" ? <circle cx={x} cy={y} r={on ? 5.5 : 4} fill="currentColor" className="text-accent" /> : <circle cx={x} cy={y} r={4.5} fill="none" stroke="currentColor" strokeDasharray="2 2" className="text-muted" />}
        <text x={lx} y={ly - 2} textAnchor="middle" fontSize={12} fontWeight={on ? 700 : 600} fill="currentColor" className={d.status === "scored" ? (on ? "text-accent" : "text-fg") : "text-muted"}>{d.label}</text>
        <text x={lx} y={ly + 12} textAnchor="middle" fontSize={11} fill="currentColor" className="text-muted">{d.status === "scored" ? d.score : "待评估"}</text>
      </g>
    })}
  </svg>
}

export function AbilityRadarCard({ asOf }: { asOf: string }) {
  const data = useMemo(() => abilityComparison({ entries: loadSchedule().entries, vitals: loadVitals().records, extras: loadExtras(), checkins: loadCheckins(), tier: loadTier(), asOf }), [asOf])
  const tier = loadTier()
  const firstScored = data.now.findIndex((d) => d.status === "scored")
  const [active, setActive] = useState<number | null>(firstScored >= 0 ? firstScored : 0)
  const d = active != null ? data.now[active] : null
  const prev = active != null ? data.before[active] : null
  const delta = d?.score != null && prev?.score != null ? d.score - prev.score : null
  const pendingCount = data.now.filter((x) => x.status === "pending").length
  return <section className="home-card px-4 py-3" aria-label="我的能力六方图">
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-base font-bold">我的能力</h2>
      <span className="text-xs text-muted">近 28 天 · {TIER_LABEL[tier]}</span>
    </div>
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-accent" />现在</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-dashed border-current opacity-70" />30 天前</span>
      {pendingCount ? <span className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-full border border-dashed border-current" />待评估 {pendingCount}</span> : null}
    </div>
    <div className="md:grid md:grid-cols-[300px_1fr] md:items-center md:gap-4">
      <AbilityRadar now={data.now} before={data.before} active={active} onPick={setActive} />
      {d ? <div className="mt-1 rounded-card bg-surface-2 p-3 text-sm" aria-live="polite" aria-label="维度详情">
        <div className="flex items-baseline justify-between gap-2">
          <strong className="text-base">{d.label}</strong>
          {d.status === "scored" ? <span><strong className="text-lg">{d.score}</strong><span className="ml-1 text-xs text-muted">置信度 {d.confidence}{delta != null ? ` · 比 30 天前 ${delta >= 0 ? "+" : ""}${delta}` : " · 30 天前待评估"}</span></span> : <span className="text-xs text-muted">待评估</span>}
        </div>
        <ul className="mt-2 space-y-1 text-xs text-muted">{d.drivers.map((x) => <li key={x}>· {x}</li>)}</ul>
        <p className="mt-2 text-sm"><span className="font-bold text-accent">方坤：</span>{d.tip}</p>
      </div> : null}
    </div>
    <p className="mt-2 text-[11px] text-muted">【经验规则】分数只和你自己比，单次训练不下结论；数据不够的维度不打分。</p>
  </section>
}
