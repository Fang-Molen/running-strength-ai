import { sameActivity, type ActSig } from "./device-parse"
import { confirmTrainingImport, createTrainingImportDraft, loadConfirmedTrainingImports } from "@/lib/core/training-import"
import { loadVitals, saveVital, type HrvMethod, type VitalKind } from "@/lib/nutrition/vitals"
import { loadChecks, upsertCheck } from "@/lib/nutrition/body"
import type { DeviceActivity, DeviceHealthRow, HealthMetric } from "./device-parse"

export const DEVICE_EXTRA_KEY = "fk-device-extra-v1"
export type ExtraRow = { metric: HealthMetric; day: string; value: number; source: string }

export function loadExtras(): ExtraRow[] {
  try { const v = JSON.parse(localStorage.getItem(DEVICE_EXTRA_KEY) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] }
}
const VITAL: Partial<Record<HealthMetric, VitalKind>> = { RHR: "RHR", HRV: "HRV", SLEEP: "SLEEP" }
export function hrvMethodOf(source: string): HrvMethod {
  if (/Apple/.test(source)) return "SDNN"
  if (/Garmin|FIT/.test(source)) return "RMSSD"
  return "UNSPECIFIED"
}
export function activityDraftId(a: DeviceActivity): string {
  return ("dev-" + a.key.replace(/[^0-9A-Za-z|-]/g, "")).slice(0, 55)
}
/** Which rows are already saved, so the confirm table can pre-untick them. */
const SIG_KEY = "fk-device-acts-v1"
function loadSigs(): ActSig[] { try { const v = JSON.parse(localStorage.getItem(SIG_KEY) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
export function isDuplicate(a: ActSig, have: { sigs: ActSig[] }): boolean { return have.sigs.some((x) => sameActivity(a, x)) }
export function existingKeys(): { health: Set<string>; activities: Set<string>; sigs: ActSig[] } {
  const health = new Set<string>()
  for (const r of loadVitals().records) health.add(`${r.kind}:${r.observedOn}`)
  for (const c of loadChecks()) health.add(`WEIGHT:${c.date}`)
  for (const e of loadExtras()) health.add(`${e.metric}:${e.day}`)
  const activities = new Set(loadConfirmedTrainingImports().map((x) => x.draftId))
  return { health, activities, sigs: loadSigs() }
}

const field = <T,>(value: T | null) => value == null ? { value: null, status: "ABSENT", sourceIds: [] } : { value, status: "RECORDED", sourceIds: ["user-confirmed"] }

export function saveDeviceRows(health: DeviceHealthRow[], activities: DeviceActivity[]): { saved: number; skipped: number; errors: string[] } {
  let saved = 0, skipped = 0
  const errors: string[] = []
  const have = existingKeys()
  const extras = loadExtras()
  for (const row of health) {
    if (have.health.has(row.key)) { skipped++; continue }
    const kind = VITAL[row.metric]
    if (kind) {
      const res = saveVital({ kind, value: row.value, observedOn: row.day, source: "DEVICE_CONFIRMED", note: row.source.slice(0, 80), hrvMethod: kind === "HRV" ? hrvMethodOf(row.source) : null })
      if (res.ok) saved++; else errors.push(`${row.day} ${row.metric}：${res.reason}`)
    } else if (row.metric === "WEIGHT") {
      if (upsertCheck({ date: row.day, weight: row.value } as Parameters<typeof upsertCheck>[0])) saved++; else errors.push(`${row.day} 体重保存失败`)
    } else { extras.push({ metric: row.metric, day: row.day, value: row.value, source: row.source }); saved++ }
    have.health.add(row.key)
  }
  try { localStorage.setItem(DEVICE_EXTRA_KEY, JSON.stringify(extras.slice(-1000))) } catch { errors.push("身体电量等扩展指标保存失败") }
  for (const a of activities) {
    const draftId = activityDraftId(a)
    if (have.activities.has(draftId) || isDuplicate(a, have)) { skipped++; continue }
    have.sigs.push({ startIso: a.startIso, distanceM: a.distanceM }); try { localStorage.setItem(SIG_KEY, JSON.stringify(have.sigs.slice(-500))) } catch { /* ignore */ }
    const sport = a.sport === "UNKNOWN" ? (a.distanceM ? "RUNNING" : "UNKNOWN") : a.sport
    const strengthSets = a.sets.filter((s) => s.reps != null || s.durationSec != null).slice(0, 80).map((s, i) => ({ id: `s${i + 1}`, exerciseName: field(s.name), setOrdinal: field(i + 1), weightKg: field(s.weightKg), repetitions: field(s.reps), durationSeconds: field(s.durationSec), recoverySeconds: field(null), completion: "COMPLETED" }))
    const draft = createTrainingImportDraft({
      sport: sport === "STRENGTH" && !strengthSets.length ? "UNKNOWN" : sport,
      occurredAt: field(a.startIso ? a.startIso.replace(/\.\d+Z$/, "Z") : null), title: field(`${a.sportLabel} · ${a.source}`.slice(0, 120)),
      durationSeconds: field(a.durationSec), totalDistanceMeters: field(a.distanceM), runningStructure: "CONTINUOUS", runningSegments: [], strengthSets,
      sessionRpe: field(null), subjectiveRecovery: field(null), sleepHours: field(null), pain: field(null), soreness: field(null), uncertainFields: [], conflicts: [],
      warnings: [a.avgHr ? `平均心率 ${a.avgHr}` : "", a.verticalOscMm ? `垂直振幅 ${a.verticalOscMm}mm` : "", a.groundContactMs ? `触地 ${a.groundContactMs}ms` : ""].filter(Boolean),
    }, "TEXT", ["user-confirmed"])
    draft.draftId = draftId
    const res = confirmTrainingImport(draft)
    if (res.ok && !res.duplicate) saved++
    else if (res.ok) skipped++
    else errors.push(`${a.startIso?.slice(0, 10) ?? ""} ${a.sportLabel}：${res.reason}`)
  }
  window.dispatchEvent(new StorageEvent("storage"))
  return { saved, skipped, errors }
}
