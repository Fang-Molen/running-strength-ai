import { useEffect, useMemo, useState } from "react"
import { Activity, BatteryMedium, Gauge, HeartPulse, Moon, Scale, Settings2, Smile, Waves } from "lucide-react"
import type { VitalRecord } from "@/lib/nutrition/vitals"
import type { BodyCheck } from "@/lib/nutrition/body"
import { loadExtras, type ExtraRow } from "@/lib/ui/device-store"
import { SavedBadge } from "@/components/saved-badge"

type TileId = "RHR" | "HRV" | "SLEEP" | "WEIGHT" | "BODY_BATTERY" | "READINESS" | "RECOVERY" | "STRESS"
type Point = { day: string; value: number; source: string }
const TILES: { id: TileId; name: string; unit: string; icon: typeof Moon; better: "up" | "down" | "none" }[] = [
  { id: "READINESS", name: "训练准备度", unit: "/100", icon: Gauge, better: "up" },
  { id: "SLEEP", name: "睡眠", unit: "小时", icon: Moon, better: "up" },
  { id: "RHR", name: "静息心率", unit: "次/分", icon: HeartPulse, better: "down" },
  { id: "HRV", name: "HRV", unit: "ms", icon: Activity, better: "up" },
  { id: "BODY_BATTERY", name: "身体电量", unit: "/100", icon: BatteryMedium, better: "up" },
  { id: "RECOVERY", name: "主观恢复", unit: "/10", icon: Smile, better: "up" },
  { id: "WEIGHT", name: "体重", unit: "kg", icon: Scale, better: "none" },
  { id: "STRESS", name: "压力", unit: "/100", icon: Waves, better: "down" },
]
export const HEALTH_TILE_PREF_KEY = "fk-health-tiles-v1"
const DEFAULT_SHOWN: TileId[] = ["READINESS", "SLEEP", "RHR", "HRV", "BODY_BATTERY", "WEIGHT"]
function loadPref(): TileId[] {
  try { const v = JSON.parse(localStorage.getItem(HEALTH_TILE_PREF_KEY) ?? "null"); return Array.isArray(v) ? v : DEFAULT_SHOWN } catch { return DEFAULT_SHOWN }
}
const SRC: Record<string, string> = { MANUAL: "手工", IMAGE_CONFIRMED: "对照截图", DEVICE_CONFIRMED: "设备导入" }

export function HealthTiles({ vitals, checks, today, revision, onJump }: { vitals: VitalRecord[]; checks: BodyCheck[]; today: string; revision: number; onJump: (target: string) => void }) {
  const [shown, setShown] = useState<TileId[]>(DEFAULT_SHOWN)
  const [open, setOpen] = useState<TileId | null>(null)
  const [editing, setEditing] = useState(false)
  const [stamp, setStamp] = useState(0)
  const [extras, setExtras] = useState<ExtraRow[]>([])
  useEffect(() => { setShown(loadPref()) }, [])
  useEffect(() => { setExtras(loadExtras()) }, [revision])
  const series = useMemo(() => {
    const s: Record<TileId, Point[]> = { RHR: [], HRV: [], SLEEP: [], WEIGHT: [], BODY_BATTERY: [], READINESS: [], RECOVERY: [], STRESS: [] }
    for (const v of vitals) if (v.kind !== "NIGHT_HR") s[v.kind as TileId].push({ day: v.observedOn, value: v.value, source: SRC[v.source] ?? v.source })
    for (const c of checks) s.WEIGHT.push({ day: c.date, value: c.weight, source: "体测" })
    for (const e of extras) if (e.metric in s) s[e.metric as TileId].push({ day: e.day, value: e.value, source: e.source })
    for (const k of Object.keys(s) as TileId[]) {
      const byDay = new Map<string, Point>(); for (const p of s[k].sort((a, b) => a.day.localeCompare(b.day))) byDay.set(p.day, p)
      s[k] = [...byDay.values()]
    }
    return s
  }, [vitals, checks, extras])
  const save = (next: TileId[]) => { setShown(next); try { localStorage.setItem(HEALTH_TILE_PREF_KEY, JSON.stringify(next)); setStamp(Date.now()) } catch { /* ignore */ } }
  const tiles = TILES.filter((t) => shown.includes(t.id))
  return <section className="home-card px-3 py-3" aria-label="身体指标">
    <div className="flex items-center justify-between gap-2 px-1">
      <h2 className="text-base font-bold">身体指标</h2>
      <div className="flex items-center gap-2"><SavedBadge stamp={stamp} /><button type="button" className="fk-chip" aria-pressed={editing} onClick={() => setEditing(!editing)}><Settings2 className="size-3.5" />{editing ? "完成" : "显示哪些"}</button></div>
    </div>
    {editing ? <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="选择显示的指标">
      {TILES.map((t) => <button key={t.id} type="button" className="fk-chip" aria-pressed={shown.includes(t.id)} onClick={() => save(shown.includes(t.id) ? shown.filter((x) => x !== t.id) : [...shown, t.id])}>{shown.includes(t.id) ? "✓ " : "+ "}{t.name}</button>)}
      <p className="w-full text-xs text-muted">点一下切换显示，自动保存。隐藏的指标仍照常记录。</p>
    </div> : null}
    <div className="fk-tile-grid mt-3">
      {tiles.map((t) => {
        const pts = series[t.id]; const last = pts.at(-1)
        const recent = pts.filter((p) => p.day < (last?.day ?? "") ).slice(-7)
        const avg = recent.length ? recent.reduce((s, p) => s + p.value, 0) / recent.length : null
        const delta = last && avg != null ? Math.round((last.value - avg) * 10) / 10 : null
        const good = delta == null || t.better === "none" ? null : (t.better === "up" ? delta >= 0 : delta <= 0)
        const isOpen = open === t.id
        const Icon = t.icon
        const stale = last && today && last.day !== today
        return <div key={t.id} className={"fk-tile " + (isOpen ? "fk-tile-open" : "")}>
          <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.id)} className="w-full text-left">
            <p className="flex items-center gap-1 text-xs text-muted"><Icon className="size-3.5" />{t.name}<span className="ml-auto">{isOpen ? "收起" : "›"}</span></p>
            <p className={last ? "mt-1.5 text-[1.6rem] font-bold leading-none" : "mt-1.5 text-base font-bold text-muted"}>{last ? last.value : "— 未记录"}{last ? <span className="ml-1 text-xs font-semibold text-muted">{t.unit}</span> : null}</p>
            <p className="mt-1 text-[11px] text-muted">{last ? <>{stale ? `${last.day.slice(5)} · ` : "今天 · "}{delta != null ? <span className={good == null ? "" : good ? "text-[#269775]" : "text-[#c0612b]"}>较前 7 次 {delta > 0 ? "+" : ""}{delta}</span> : "首条记录"}</> : "导入或手填后显示"}</p>
          </button>
          {isOpen ? <TileDetail points={pts} unit={t.unit} onRecord={() => onJump(t.id === "WEIGHT" ? "body-measurements" : t.id === "BODY_BATTERY" || t.id === "READINESS" || t.id === "STRESS" ? "body-devices" : "body-vitals")} /> : null}
        </div>
      })}
    </div>
    {!tiles.length ? <p className="mt-3 text-sm text-muted">所有指标都隐藏了，点“显示哪些”选几个。</p> : null}
  </section>
}

function TileDetail({ points, unit, onRecord }: { points: Point[]; unit: string; onRecord: () => void }) {
  const last14 = points.slice(-14)
  const vals = last14.map((p) => p.value)
  const max = Math.max(...vals, 0), min = Math.min(...vals, Infinity)
  const avg = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null
  return <div className="mt-2 border-t border-line pt-2 text-xs">
    {last14.length > 1 ? <div className="flex h-14 items-end gap-1" aria-label="最近 14 次趋势">
      {last14.map((p) => <span key={p.day} title={`${p.day} ${p.value}`} className="flex-1 rounded-sm bg-[#2182bd]/70" style={{ height: `${Math.max(6, Math.round(((p.value - min * 0.9) / ((max - min * 0.9) || 1)) * 56))}px` }} />)}
    </div> : <p className="text-muted">记录 2 次以上才画趋势。</p>}
    {avg != null ? <p className="mt-1 text-muted">近 {last14.length} 次：均值 {avg} · 最低 {min} · 最高 {max} {unit}</p> : null}
    {points.at(-1) ? <p className="text-muted">最近来源：{points.at(-1)!.source}</p> : null}
    <p className="mt-1 text-muted">一次波动不代表状态变差，结合连续几天和主观感受看。</p>
    <button type="button" className="fk-link mt-1" onClick={onRecord}>补记 / 导入 ›</button>
  </div>
}
