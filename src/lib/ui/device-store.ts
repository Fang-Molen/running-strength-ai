import {currentAthleteId} from '@/lib/core/events'
import {coachImports} from '@/lib/core/coach-import-evidence'
import { currentStore } from "@/lib/core/storage"
import { healthChanged, revisedObservation, shortHash, validDay, validObservation, type Observation } from "@/lib/health/observation"
import { sameActivity, type ActSig } from "./device-parse"
import { confirmTrainingImport, createTrainingImportDraft, loadConfirmedTrainingImports } from "@/lib/core/training-import"
import { loadVitals, saveVital, type HrvMethod, type VitalKind } from "@/lib/nutrition/vitals"
import { loadChecks, upsertCheck } from "@/lib/nutrition/body"
import type { DeviceActivity, DeviceHealthRow, HealthMetric } from "./device-parse"

export {DEVICE_EXTRA_KEY, extrasUnreadable, loadExtras, hrvMethodOf, observationFor} from '@/lib/health/device-store';
import {loadExtras, observationFor, saveDeviceRows as saveConfirmedHealth} from '@/lib/health/device-store';
export type {ExtraRow} from '@/lib/health/device-store';
export function healthSavedKey(row: DeviceHealthRow): string { return `${observationFor(row).key}|${row.value}` }
export function activityDraftId(a: DeviceActivity): string {
  if(a.sourceIdentity) return 'dev-stable-'+shortHash(JSON.stringify([currentAthleteId(),a.sourceIdentity]))
  return "dev-" + shortHash(JSON.stringify([currentAthleteId(),a.source,a.key,a.startIso,a.sport,a.durationSec,a.distanceM]))
}
/** Which rows are already saved, so the confirm table can pre-untick them. */
const SIG_KEY = "fk-device-acts-v1"
function loadSigs(): ActSig[] { try { const v = JSON.parse(currentStore()?.getItem(SIG_KEY) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
export function isDuplicate(a: ActSig, have: { sigs: ActSig[] }): boolean { return false /* Similar time/distance alone does not prove the same person or activity. Stable source-bound draft IDs handle repeat imports. */ }
export function existingKeys(): { health: Set<string>; activities: Set<string>; sigs: ActSig[] } {
  const health = new Set<string>()
  for (const r of loadVitals().records) r.observation && health.add(`${r.observation.key}|${r.value}`)
  for (const c of loadChecks()) health.add(`WEIGHT:${c.date}`)
  for (const e of loadExtras()) e.observation && health.add(`${e.observation.key}|${e.value}`)
  const activities = new Set(coachImports().map((x) => x.draftId))
  return { health, activities, sigs: loadSigs() }
}

const field = <T,>(value: T | null) => value == null ? { value: null, status: "ABSENT", sourceIds: [] } : { value, status: "RECORDED", sourceIds: ["user-confirmed"] }

export function saveDeviceRows(health: DeviceHealthRow[], activities: DeviceActivity[]): { saved: number; skipped: number; errors: string[] } {
  let saved = 0, skipped = 0
  const errors: string[] = []
  const have = existingKeys()

  const result = saveConfirmedHealth(health);
  saved += result.saved; skipped += result.skipped; errors.push(...result.errors);
  for (const a of activities) {
    const draftId = activityDraftId(a)
    if (have.activities.has(draftId) || isDuplicate(a, have)) {
      const previous=a.sourceIdentity?coachImports().find(x=>x.draftId===draftId):null
      if(previous&&(previous.sourceRecordIdentity!==a.sourceIdentity||previous.durationSeconds.value!==a.durationSec||previous.totalDistanceMeters.value!==a.distanceM))
        errors.push('同一来源活动数值已变化，需核对原记录与更正；未重复计入或覆盖手填更正。')
      else skipped++
      continue
    }
    const sport = a.sport
    const realSets = a.sets
    const strengthSets = realSets.filter((s) => s.reps != null || s.durationSec != null).slice(0, 80).map((s, i) => ({ id: `s${i + 1}`, exerciseName: field(s.name), setOrdinal: field(i + 1), weightKg: field(s.weightKg), repetitions: field(s.reps), durationSeconds: field(s.durationSec), recoverySeconds: field(null), completion: "COMPLETED" }))
    const draft = createTrainingImportDraft({
      sport,
      occurredAt: field(a.startIso ? a.startIso.replace(/\.\d+Z$/, "Z") : null), title: field(`${a.sportLabel} · ${a.source}`.slice(0, 120)),
      durationSeconds: field(a.durationSec), totalDistanceMeters: field(a.distanceM), runningStructure: "UNAVAILABLE", runningSegments: [], strengthSets,
      sessionRpe: field(null), subjectiveRecovery: field(null), sleepHours: field(null), pain: field(null), soreness: field(null), uncertainFields: [], conflicts: [],
      warnings: [a.avgHr ? `平均心率 ${a.avgHr}` : "", a.verticalOscMm ? `垂直振幅 ${a.verticalOscMm}mm` : "", a.groundContactMs ? `触地 ${a.groundContactMs}ms` : ""].filter(Boolean),
    }, "TEXT", ["user-confirmed"])
    draft.draftId = draftId
    if(a.sourceIdentity) draft.sourceRecordIdentity=a.sourceIdentity
    const res = confirmTrainingImport(draft)
    if (res.ok) { have.sigs.push({ startIso: a.startIso, distanceM: a.distanceM }); try { currentStore()?.setItem(SIG_KEY, JSON.stringify(have.sigs.slice(-500))) } catch { /* ignore */ } }
    if (res.ok && !res.duplicate) saved++
    else if (res.ok) skipped++
    else errors.push(`${a.startIso?.slice(0, 10) ?? ""} ${a.sportLabel}：${res.reason}`)
  }
  healthChanged()
  if(typeof window!=="undefined") window.dispatchEvent(new Event("storage"))
  return { saved, skipped, errors }
}
