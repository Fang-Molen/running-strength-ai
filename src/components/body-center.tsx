import { onAppEvent } from "@/lib/core/events"
import { useEffect, useState } from "react"
import { BodyPanel } from "@/components/body-panel"
import { DeviceCenter } from "@/components/device-center"
import { DeviceImport } from "@/components/device-import"
import { HealthTiles } from "@/components/health-tiles"
import { FuelPanel } from "@/components/fuel-panel"
import { VitalsPanel, type ImportHint } from "@/components/vitals-panel"
import { loadChecks, todayDate, type BodyCheck } from "@/lib/nutrition/body"
import { latestOnDay, loadVitals, type VitalKind, type VitalRecord } from "@/lib/nutrition/vitals"
import { computePlan } from "@/lib/nutrition/calc"
import { todayEntries } from "@/lib/nutrition/log"
import { loadConfirmedTrainingImports } from "@/lib/core/training-import"
import type { Profile } from "@/lib/strength/profile"

function recordedNumber(field: { status?: string; value?: number | null } | undefined): number | null {
  if (!field || field.status !== "RECORDED" || typeof field.value !== "number") return null
  return field.value
}

function recordedDay(field: { status?: string; value?: string | null } | undefined): string | null {
  if (!field || field.status !== "RECORDED" || typeof field.value !== "string") return null
  const day = field.value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

function shiftIso(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number)
  const next = new Date(Date.UTC(year, month - 1, date + delta))
  return next.toISOString().slice(0, 10)
}

function latestInSpan(records: VitalRecord[], kind: VitalKind, today: string, span: number): VitalRecord | null {
  if (!today) return null
  if (span <= 1) return latestOnDay(records, kind, today)
  const start = shiftIso(today, -(span - 1))
  return records
    .filter((item) => item.kind === kind && item.observedOn >= start && item.observedOn <= today)
    .sort((a, b) => b.observedOn.localeCompare(a.observedOn) || b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

function spark(records: VitalRecord[], kind: VitalKind, today: string, span: number): number[] {
  if (!today || span <= 1) return []
  const start = shiftIso(today, -(span - 1))
  return records
    .filter((item) => item.kind === kind && item.observedOn >= start && item.observedOn <= today)
    .sort((a, b) => a.observedOn.localeCompare(b.observedOn))
    .slice(-7)
    .map((item) => item.value)
}

function vitalParts(record: VitalRecord | null, kind: VitalKind): { value: string; unit: string; empty: boolean } {
  if (!record) return { value: "未记录", unit: "", empty: true }
  if (kind === "SLEEP") return { value: String(record.value), unit: "小时", empty: false }
  if (kind === "HRV") return { value: String(record.value), unit: record.hrvMethod === "RMSSD" ? "ms · RMSSD" : record.hrvMethod === "SDNN" ? "ms · SDNN" : "ms · 未说明口径", empty: false }
  if (kind === "RECOVERY") return { value: String(record.value), unit: "/ 10", empty: false }
  return { value: String(record.value), unit: "次/分", empty: false }
}

export type BodyPane = "recovery" | "nutrition" | "trend" | "device";
export function BodyCenter({ profile, onProfile, onEdit, initialPane = "recovery", active = true }: { profile: Profile; onProfile: (next: Profile) => void; onEdit: () => void; initialPane?: BodyPane; active?: boolean }) {
  const [pane, setPane] = useState<BodyPane>(initialPane)
  useEffect(() => { setPane(initialPane) }, [initialPane])
  useEffect(() => { if (active) setRevision(value => value + 1) }, [active])
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    const unsubscribe = onAppEvent(refresh)
    window.addEventListener("storage", refresh)
    return () => { unsubscribe(); window.removeEventListener("storage", refresh) }
  }, [])
  const [revision, setRevision] = useState(0)
  const [checks, setChecks] = useState<BodyCheck[]>([])
  const [vitals, setVitals] = useState<VitalRecord[]>([])
  const [today, setToday] = useState("")
  const [hints, setHints] = useState<ImportHint[]>([])
  const span = 1 as 1 | 7 | 30
  const [eaten, setEaten] = useState<number | null>(null)
  const [protein, setProtein] = useState<number | null>(null)
  useEffect(() => {
    const day = todayDate()
    const imports = loadConfirmedTrainingImports()
    setToday(day)
    setChecks(loadChecks())
    setVitals(loadVitals().records)
    const next: ImportHint[] = []
    for (const kind of ["SLEEP", "RECOVERY"] as const) {
      const found = [...imports].reverse().map((item) => ({ value: recordedNumber(kind === "SLEEP" ? item.sleepHours : item.subjectiveRecovery), observedOn: recordedDay(item.occurredAt) })).find((item) => item.value != null)
      if (found?.value != null) next.push({ kind, value: found.value, observedOn: found.observedOn })
    }
    setHints(next)
    const rows = todayEntries()
    setEaten(rows.length ? rows.reduce((sum, item) => sum + item.kcal, 0) : null)
    setProtein(rows.some((item) => typeof item.protein === "number") ? Math.round(rows.reduce((sum, item) => sum + (item.protein ?? 0), 0) * 10) / 10 : null)
  }, [revision])
  const weightHits = checks.filter((item) => today && (span <= 1 ? item.date === today : item.date >= shiftIso(today, -(span - 1)) && item.date <= today)).sort((a, b) => a.date.localeCompare(b.date))
  const weight = weightHits.at(-1)
  const latest = [...checks].sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  const todayWeight = checks.find((item) => item.date === today) ?? null
  const shownWeight = span <= 1 ? (todayWeight ?? latest ?? null) : (weight ?? null)
  const weightStale = span <= 1 && !todayWeight && Boolean(shownWeight)
  const metrics: { name: string; value: string; unit: string; empty: boolean; bars: number[]; target: string }[] = [
    { name: "睡眠", ...vitalParts(latestInSpan(vitals, "SLEEP", today, span), "SLEEP"), bars: spark(vitals, "SLEEP", today, span), target: "body-vitals" },
    { name: "静息心率", ...vitalParts(latestInSpan(vitals, "RHR", today, span), "RHR"), bars: spark(vitals, "RHR", today, span), target: "body-vitals" },
    { name: "HRV", ...vitalParts(latestInSpan(vitals, "HRV", today, span), "HRV"), bars: spark(vitals, "HRV", today, span), target: "body-vitals" },
    { name: "体重", value: shownWeight ? String(shownWeight.weight) : "未记录", unit: shownWeight ? (weightStale ? `kg · ${shownWeight.date.slice(5)}` : "kg") : "", empty: !shownWeight, bars: (span <= 1 ? checks : weightHits).length > 1 ? (span <= 1 ? [...checks].sort((a, b) => a.date.localeCompare(b.date)) : weightHits).slice(-7).map((item) => item.weight) : [], target: "body-measurements" },
    { name: "主观恢复", ...vitalParts(latestInSpan(vitals, "RECOVERY", today, span), "RECOVERY"), bars: spark(vitals, "RECOVERY", today, span), target: "body-vitals" },
    { name: "酸痛", value: "未记录", unit: "", empty: true, bars: [], target: "body-records" },
  ]
  const nutrition = computePlan(profile)
  const todayVitalsCount = (["HRV", "RHR", "NIGHT_HR", "SLEEP", "RECOVERY"] as VitalKind[]).filter((kind) => today && latestOnDay(vitals, kind, today)).length
  const bodyRecordedToday = latest?.date === today


  return <div className="mx-auto max-w-3xl px-3 pt-2 pb-nav">
    <nav className="product-segments mb-3" aria-label="身体工作区">
      {([["recovery", "恢复"], ["nutrition", "饮食"], ["trend", "变化"], ["device", "设备"]] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={pane === id} onClick={() => setPane(id)}>{label}</button>)}
    </nav>
    <div hidden={pane !== "recovery"}>
      <HealthTiles vitals={vitals} checks={checks} today={today} revision={revision} onJump={(target) => { if (target === "body-vitals") { const d = document.querySelector("#body-vitals details"); if (d instanceof HTMLDetailsElement) d.open = true } if (target === "body-devices") setPane("device"); else if (target === "body-measurements") setPane("trend"); window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: "start" }), 40) }} />
    <section className="px-1" data-legacy-span={span} data-legacy-metrics={metrics.length}>
      <details className="mt-1 px-1 text-xs text-muted">
        <summary className="min-h-11 cursor-pointer font-bold text-fg">口径与未记录说明</summary>
        <p className="mt-1">未记录不代表正常，也不补成 0。HRV、静息心率、夜间心率和睡眠分开，不合并口径。酸痛只认绑定某次训练的记录，这里没有另造分数。今日监测 {todayVitalsCount} / 5 项。今日体重 {bodyRecordedToday ? `${latest?.weight} kg` : "待记录"}，历史体重保留。柱状只来自已保存数值。</p>
      </details>
    </section>
    </div>
    <section hidden={pane !== "nutrition"} className="home-card px-4 py-4" aria-label="营养概览">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-base font-bold">饮食与营养</h2>
        <p className="text-sm font-bold">{eaten == null ? "热量未记录" : `${eaten} kcal`}{nutrition ? <span className="font-normal text-muted"> / {nutrition.kcal}</span> : null}</p>
      </div>
      {eaten != null && nutrition ? <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-[#269775]" style={{ width: `${Math.min(100, Math.round((eaten / nutrition.kcal) * 100))}%` }} /></div> : null}
      <p className="mt-2 text-sm"><span className="tone-lift font-bold">蛋白质 {protein == null ? "未记录" : `${protein} g`}</span>{nutrition ? <span className="text-muted"> · 目标 {nutrition.protein} g</span> : <span className="text-muted"> · 热量目标未设置</span>}</p>
      <a href="#body-fuel" onClick={() => setPane("nutrition")} className="mt-2 flex min-h-11 items-center text-sm font-bold text-accent">食物记录 · 热量 · 蛋白质</a>
    </section>
    <section id="body-records" className="mt-3">
      <div hidden={pane !== "device"}><DeviceImport today={today} onSaved={() => setRevision((value) => value + 1)} /></div>
      <div hidden={pane !== "recovery"} id="body-vitals" className="scroll-mt-6"><details className="home-card p-3" onToggle={() => undefined}><summary className="min-h-11 cursor-pointer text-sm font-bold">手动补记 · 历史记录</summary><VitalsPanel revision={revision} importHints={hints} onSaved={() => setRevision((value) => value + 1)} /></details></div>
      <div hidden={pane !== "trend"} id="body-measurements" className="scroll-mt-6"><div className="home-card p-4 mb-3"><p className="product-eyebrow">身体变化</p><h2 className="font-bold mt-1">体重与体测记录</h2><p className="mt-2 text-sm text-muted">最近体重 {latest ? `${latest.weight} kg · ${latest.date}` : "未记录"}。历史日期与今天分开查看。</p></div><BodyPanel profile={profile} onProfile={onProfile} onSaved={() => setRevision((value) => value + 1)} /></div>
      <div hidden={pane !== "nutrition"} id="body-fuel" className="mt-3 scroll-mt-6">
        <h2 className="text-base font-bold">营养与热量</h2>
        <FuelPanel profile={profile} onEdit={onEdit} revision={revision} onSaved={() => setRevision(value => value + 1)} />
      </div>
      <div hidden={pane !== "device"} id="body-devices" className="scroll-mt-6"><details className="home-card mt-3 p-3"><summary className="min-h-10 cursor-pointer text-sm font-bold">其他品牌导出步骤（华为 / 小米 / COROS / Apple）</summary><DeviceCenter /></details></div>
    </section>
  </div>
}