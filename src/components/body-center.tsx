import { SymptomPanel } from '@/components/symptom-panel'
import { loadExtras } from "@/lib/ui/device-store"
import { HealthModeNote } from "@/components/health-mode-note"
import { subscribeHealthUpdates } from "@/lib/health/health-subscription"
import { useEffect, useState } from "react"
import { BodyPanel } from "@/components/body-panel"
import { openDeviceSync } from "@/lib/ui/device-sync-navigation"
import { HealthTiles } from "@/components/health-tiles"
import { UnifiedRecoveryHostU11 } from "@/components/unified-recovery-host-u11"
import { SourceGuide, CheckinCard, WatchQuestion, PainLog, RecoveryVerdictCard } from "@/components/health-extras"
import { FuelPanel } from "@/components/fuel-panel"
import { VitalsPanel, type ImportHint } from "@/components/vitals-panel"
import { loadChecks, todayDate, type BodyCheck } from "@/lib/nutrition/body"
import { latestOnDay, loadVitals, type VitalKind, type VitalRecord } from "@/lib/nutrition/vitals"
import { computePlan } from "@/lib/nutrition/calc"
import { effectiveNutritionProfile } from "@/lib/coach/loop/effective-host"
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

import { loadWatch, saveWatch, loadTier, TIERS, type Tier, type WatchId } from "@/lib/ui/watch-mode"
export type BodyPane = "recovery" | "nutrition" | "trend" | "device";
export function BodyCenter({ profile, onProfile, onEdit, initialPane = "recovery", active = true , compact }: { profile: Profile; onProfile: (next: Profile) => void; onEdit: () => void; initialPane?: BodyPane; active?: boolean ; compact?: boolean }) {
  const [pane, setPane] = useState<BodyPane>(initialPane)
  const [watch, setWatch] = useState<WatchId | null | undefined>(undefined)
  const [tier, setTier] = useState<Tier | null>(null)
  useEffect(() => { setWatch(loadWatch()); setTier(loadTier()) }, [active])
  useEffect(() => { setPane(initialPane) }, [initialPane])
  useEffect(() => { if (active) setRevision(value => value + 1) }, [active])
  useEffect(() => {
    const refresh = () => {setRevision(value => value + 1);setWatch(loadWatch());setTier(loadTier())}
    return subscribeHealthUpdates(refresh, { batch: true, reconcile: true })
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
    setEaten(rows.length ? rows.reduce((sum, item) => sum + (item.kcal ?? 0), 0) : null)
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
  const nutrition = computePlan(effectiveNutritionProfile(profile))
  const todayVitalsCount = (["HRV", "RHR", "NIGHT_HR", "SLEEP", "RECOVERY"] as VitalKind[]).filter((kind) => today && latestOnDay(vitals, kind, today)).length
  const bodyRecordedToday = latest?.date === today


  const openVitals = () => {
    const details=document.querySelector<HTMLDetailsElement>("#body-vitals details")
    if(details)details.open=true
    document.getElementById("body-vitals")?.scrollIntoView({block:"start"})
  }
  // R2: the compact host is a record drawer, not a second hidden health workspace.
  if (compact) return <section id="body-records" className="space-y-3" aria-label="健康记录与设备">
    <details id="body-vitals" className="fk-h89-records"><summary>健康数据补录与历史</summary><VitalsPanel revision={revision} importHints={hints} onSaved={() => setRevision(v => v + 1)} /></details>
    <details id="body-device-records" className="fk-h89-records" tabIndex={-1}><summary>设备导入与说明</summary>
      {watch === null ? <WatchQuestion onPick={w => { saveWatch(w); setWatch(w); setTier(loadTier()); setRevision(v => v + 1) }} /> : watch ? <SourceGuide watch={watch} /> : null}
      <DeviceConnectionEntry />
    </details>
  </section>
  if (watch === null) return <div className={compact ? "min-w-0" : "mx-auto max-w-3xl px-3 pt-2 pb-nav"}><SymptomPanel /><WatchQuestion onPick={(w) => { saveWatch(w); setWatch(w); setTier(loadTier()); setRevision((v) => v + 1) }} />{compact ? null : <UnifiedRecoveryHostU11 day={today} onRecord={openVitals}/>}<div id="body-vitals"><details className="home-card p-3"><summary className="min-h-11 cursor-pointer text-sm font-bold">更多手动记录 · 历史</summary><VitalsPanel revision={revision} importHints={hints} onSaved={()=>setRevision(v=>v+1)}/></details></div></div>
  const hasWatch = watch != null && watch !== "none"
  return <div className={compact ? "" : "mx-auto max-w-3xl px-3 pt-2 pb-nav"}>
    {compact ? null : <nav className="product-segments mb-3" aria-label="身体工作区">
      {([["recovery", "今日恢复"], ["trend", "身体指标"]] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={pane === id} onClick={() => setPane(id)}>{label}</button>)}
    </nav>}
    <div hidden={pane !== "recovery"}>
      <SymptomPanel />
      {!compact?<HealthModeNote day={today}/>:null}
      {compact ? null : <RecoveryVerdictCard today={today} revision={revision} watch={watch} onImport={() => setPane("device")} />}
      {watch && !compact ? <CheckinCard today={today} watch={watch} onSaved={() => setRevision((v) => v + 1)} onPain={() => { setPane("trend"); window.setTimeout(() => document.getElementById("pain-log")?.scrollIntoView({ block: "start" }), 40) }} /> : null}
      {/* v89：健康页（compact）里的全身/肌肉恢复已由「恢复」分区和「肌肉恢复」视图承担，这里不再重复 */}
      {compact ? null : <UnifiedRecoveryHostU11 day={today} onRecord={openVitals}/>}
      {watch === "none" || compact ? null : 
      <HealthTiles excluded={["RHR","BODY_BATTERY"]} allowed={tier ? [...new Set([...TIERS[tier].tiles,...vitals.map(v=>v.kind),...loadExtras().map(v=>v.metric)])] : undefined} vitals={vitals} checks={checks} today={today} revision={revision} onJump={(target) => { if (target === "body-vitals") { const d = document.querySelector("#body-vitals details"); if (d instanceof HTMLDetailsElement) d.open = true } if (target === "body-devices") setPane("device"); else if (target === "body-measurements") setPane("trend"); window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: "start" }), 40) }} />}
    <section className="px-1" data-legacy-span={span} data-legacy-metrics={metrics.length}>
    </section>
    </div>
    <section id="body-records" className="mt-3">
      <div hidden={pane !== "device"}>{watch ? <SourceGuide watch={watch} /> : null}<DeviceConnectionEntry /></div>
      <div hidden={pane !== "recovery"} id="body-vitals" className="scroll-mt-6"><details className="home-card p-3" onToggle={() => undefined}><summary className="min-h-11 cursor-pointer text-sm font-bold">更多手动记录 · 历史</summary><VitalsPanel revision={revision} importHints={hints} onSaved={() => setRevision((value) => value + 1)} /></details></div>
      <div hidden={compact || pane !== "trend"} id="body-measurements" className="scroll-mt-6"><div className="home-card p-4 mb-3"><h2 className="font-bold">体重与体成分</h2><p className="mt-1 text-sm text-muted">{latest ? `${latest.weight} kg · ${latest.date}` : "未记录"}</p></div><BodyPanel profile={profile} onProfile={onProfile} onSaved={() => setRevision((value) => value + 1)} /><div id="pain-log"><PainLog today={today} /></div></div>
    </section>
  </div>
}

function DeviceConnectionEntry() {
  return <div id="body-devices" className="mt-3 grid gap-2 sm:grid-cols-2">
    <button type="button" className="min-h-12 rounded-xl bg-accent px-3 font-semibold text-accent-fg" onClick={() => openDeviceSync()}>连接手表或运动软件</button>
    <button type="button" className="min-h-12 rounded-xl border border-line px-3 font-semibold" onClick={() => openDeviceSync({ mode: 'files' })}>导入文件或截图</button>
  </div>
}
