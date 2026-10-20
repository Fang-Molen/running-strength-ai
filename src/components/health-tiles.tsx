import { loadCheckins } from '@/lib/ui/watch-mode'
import { buildHealthSnapshot, loadHealthSources } from "@/lib/health/snapshot"
import { HealthSourceDetails } from "./health-source-details"
import { valueText } from "@/lib/health/observation"
import { useEffect, useMemo, useState } from "react"
import { Activity, BatteryMedium, Gauge, HeartPulse, Moon, Scale, Settings2, Smile, Waves } from "lucide-react"
import type { VitalRecord } from "@/lib/nutrition/vitals"
import type { BodyCheck } from "@/lib/nutrition/body"
import { loadExtras, type ExtraRow } from "@/lib/ui/device-store"
import { SavedBadge } from "@/components/saved-badge"

type TileId = "RHR" | "HRV" | "SLEEP" | "WEIGHT" | "BODY_BATTERY" | "READINESS" | "RECOVERY" | "STRESS"
type Point = { day: string; value: number; source: string }
const ALL_TILES: { id: TileId; name: string; unit: string; icon: typeof Moon; better: "up" | "down" | "none" }[] = [
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
const DEFAULT_SHOWN: TileId[] = ["READINESS", "SLEEP", "HRV", "RHR", "BODY_BATTERY", "STRESS", "RECOVERY"]
function loadPref(): TileId[] {
  try { const v = JSON.parse(localStorage.getItem(HEALTH_TILE_PREF_KEY) ?? "null"); return Array.isArray(v) ? v : DEFAULT_SHOWN } catch { return DEFAULT_SHOWN }
}
const SRC: Record<string, string> = { MANUAL: "手工", IMAGE_CONFIRMED: "对照截图", DEVICE_CONFIRMED: "设备导入" }

export function HealthTiles({ vitals, checks, today, revision, onJump, allowed, excluded=[] }: { vitals: VitalRecord[]; checks: BodyCheck[]; today: string; revision: number; onJump: (target: string) => void; allowed?: string[]; excluded?: string[] }) {
  const TILES = ALL_TILES.filter(t=>(!allowed||allowed.includes(t.id))&&!excluded.includes(t.id))
  const [shown, setShown] = useState<TileId[]>(DEFAULT_SHOWN)
  const [open, setOpen] = useState<TileId | null>(null)
  const [editing, setEditing] = useState(false)
  const [stamp, setStamp] = useState(0)
  const [extras, setExtras] = useState<ExtraRow[]>([])
  useEffect(() => { setShown(loadPref()) }, [])
  useEffect(() => { setExtras(loadExtras()) }, [revision])
  const snapshot=useMemo(()=>buildHealthSnapshot(vitals,extras,today,loadHealthSources(),loadCheckins()),[vitals,extras,today,revision])
  const series = useMemo(() => {
    const s: Record<TileId, Point[]> = { RHR: [], HRV: [], SLEEP: [], WEIGHT: [], BODY_BATTERY: [], READINESS: [], RECOVERY: [], STRESS: [] }
    for(const view of snapshot.metrics)if(view.metric in s)for(const p of view.series)s[view.metric as TileId].push({day:p.day,value:p.value,source:p.source})
    for (const c of checks) s.WEIGHT.push({ day: c.date, value: c.weight, source: "体测" })

    for (const k of Object.keys(s) as TileId[]) {
      const byDay = new Map<string, Point>(); for (const p of s[k].sort((a, b) => a.day.localeCompare(b.day))) byDay.set(p.day, p)
      s[k] = [...byDay.values()]
    }
    return s
  }, [vitals, checks, extras, snapshot])
  const save = (next: TileId[]) => { setShown(next); try { localStorage.setItem(HEALTH_TILE_PREF_KEY, JSON.stringify(next)); setStamp(Date.now()) } catch { /* ignore */ } }
  const tiles = TILES.filter((t) => shown.includes(t.id))
  return <section className="home-card px-3 py-3" aria-label="身体指标">
    <div className="flex items-center justify-between gap-2 px-1">
      <h2 className="text-base font-bold">身体指标</h2>
      <div className="flex items-center gap-2"><SavedBadge stamp={stamp} /><button type="button" className="fk-chip" aria-pressed={editing} onClick={() => setEditing(!editing)}><Settings2 className="size-3.5" />{editing ? "完成" : "显示哪些"}</button></div>
    </div>
    {editing ? <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="选择显示的指标">
      {TILES.map((t) => <button key={t.id} type="button" className="fk-chip" aria-pressed={shown.includes(t.id)} onClick={() => save(shown.includes(t.id) ? shown.filter((x) => x !== t.id) : [...shown, t.id])}>{shown.includes(t.id) ? "✓ " : "+ "}{t.name}</button>)}
      
    </div> : null}
    <div className="fk-tile-grid mt-3">
      {tiles.map((t) => {
        const view=snapshot.metrics.find(m=>m.metric===t.id)
        const pts = series[t.id]; const last = pts.at(-1)
        const delta = view?.baseline ? Math.round(view.baseline.delta*10)/10 : null
        const good = null
        const isOpen = open === t.id
        const Icon = t.icon
        const stale = last && today && last.day !== today
        return <div key={t.id} className={"fk-tile " + (isOpen ? "fk-tile-open" : "")}>
          <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.id)} className="w-full text-left">
            <p className="flex items-center gap-1 text-xs text-muted"><Icon className="size-3.5" />{t.name}<span className="ml-auto">{isOpen ? "收起" : "›"}</span></p>
            <p className={last ? "mt-1.5 text-[1.6rem] font-bold leading-none" : "mt-1.5 text-base font-bold text-muted"}>{view?.state==='CONFLICT'?"来源待核对":last?valueText(t.id,last.value):"— 未记录"}</p>
            <p className="mt-1 text-xs text-muted">{last ? <>{stale ? `${last.day.slice(5)} · ` : "今天 · "}{delta != null ? <span className={good == null ? "" : good ? "text-[#269775]" : "text-[#c0612b]"}>较前7天可比均值 {delta > 0 ? "+" : ""}{delta}</span> : "点开核对来源"}</> : "导入或手填后显示"}</p>
          </button>
          {isOpen ? <>{view?<HealthSourceDetails view={view}/>:null}<TileDetail points={pts} unit={t.unit} onRecord={() => onJump(t.id === "WEIGHT" ? "body-measurements" : t.id === "BODY_BATTERY" || t.id === "READINESS" || t.id === "STRESS" ? "body-devices" : "body-vitals")} /></> : null}
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
    
    <button type="button" className="fk-link mt-1" onClick={onRecord}>补记 / 导入 ›</button>
  </div>
}
