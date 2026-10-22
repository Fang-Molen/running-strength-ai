import {currentAthleteId} from '@/lib/core/events'
import {coachImports} from '@/lib/core/coach-import-evidence'
import { currentStore } from "@/lib/core/storage"
import { healthChanged, revisedObservation, shortHash, validDay, validObservation, type Observation } from "@/lib/health/observation"
import { sameActivity, type ActSig } from "./device-parse"
import { confirmTrainingImport, createTrainingImportDraft, loadConfirmedTrainingImports } from "@/lib/core/training-import"
import { loadVitals, saveVital, type HrvMethod, type VitalKind } from "@/lib/nutrition/vitals"
import { loadChecks, upsertCheck } from "@/lib/nutrition/body"
import type { DeviceActivity, DeviceHealthRow, HealthMetric } from "./device-parse"
import { normalizedDeviceActivityTotals } from './device-activity-totals'

export {DEVICE_EXTRA_KEY, extrasUnreadable, loadExtras, hrvMethodOf, observationFor} from '@/lib/health/device-store';
import {loadExtras, observationFor, saveDeviceRows as saveConfirmedHealth} from '@/lib/health/device-store';
export type {ExtraRow} from '@/lib/health/device-store';
export function healthSavedKey(row: DeviceHealthRow): string { return `${observationFor(row).key}|${row.value}` }
export function activityDraftId(a: DeviceActivity): string {
  if(a.sourceIdentity) return 'dev-stable-'+shortHash(JSON.stringify([currentAthleteId(),a.sourceIdentity]))
  return "dev-" + shortHash(JSON.stringify([currentAthleteId(),a.source,a.sourceKey??a.key,a.startIso,a.sport,a.durationSec,a.distanceM]))
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
export type DeviceActivitySaveResult = { draftId: string; sourceIdentity?: string; status: 'saved' | 'skipped' | 'conflict' | 'rejected' | 'persistence_failed' | 'persistence_unconfirmed' }
export type DeviceSaveResult = { saved: number; skipped: number; errors: string[]; healthErrors: string[]; activityResults: DeviceActivitySaveResult[] }

export function saveDeviceRows(health: DeviceHealthRow[], activities: DeviceActivity[]): { saved: number; skipped: number; errors: string[] } {
  const { saved, skipped, errors } = saveDeviceRowsWithHealthResult(health, activities)
  return { saved, skipped, errors }
}
/** Same single-batch save, with independent health errors for incremental health receipts. */
export function saveDeviceRowsWithHealthResult(health: DeviceHealthRow[], activities: DeviceActivity[]): DeviceSaveResult {
  let saved = 0, skipped = 0
  const errors: string[] = []
  const activityResults: DeviceActivitySaveResult[] = []
  // One normalized snapshot per save call. Repeat syncs can contain hundreds of
  // existing activities; reparsing the entire history for each one is quadratic.
  const imports = coachImports()
  const importedByDraft = new Map<string, typeof imports[number]>()
  for (const record of imports) if (!importedByDraft.has(record.draftId)) importedByDraft.set(record.draftId, record)
  const have = { activities: new Set(importedByDraft.keys()), sigs: loadSigs() }

  const result = saveConfirmedHealth(health);
  saved += result.saved; skipped += result.skipped; errors.push(...result.errors);
  for (const a of activities) {
    const draftId = activityDraftId(a)
    const recordResult = (status: DeviceActivitySaveResult['status']) => activityResults.push({ draftId, sourceIdentity: a.sourceIdentity, status })
    if(a.sourceIdentity && activities.some(b=>b!==a&&b.sourceIdentity===a.sourceIdentity&&JSON.stringify({...b,key:undefined,sourceKey:undefined})!==JSON.stringify({...a,key:undefined,sourceKey:undefined}))){errors.push('同一来源活动的多个版本存在冲突；先核对更正，未保存任一冲突版本。');recordResult('conflict');continue}
    if (have.activities.has(draftId) || isDuplicate(a, have)) {
      const previous=a.sourceIdentity?importedByDraft.get(draftId):null
      const totals = normalizedDeviceActivityTotals(a.durationSec, a.distanceM)
      if(previous&&(previous.sourceRecordIdentity!==a.sourceIdentity||previous.durationSeconds.value!==totals.durationSec||previous.totalDistanceMeters.value!==totals.distanceM)) {
        errors.push('同一来源活动数值已变化，需核对原记录与更正；未重复计入或覆盖手填更正。')
        recordResult('conflict')
      } else { skipped++; recordResult('skipped') }
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
    if(a.provenance) draft.provenance={...a.provenance}
    const res = confirmTrainingImport(draft)
    if (res.ok) { have.sigs.push({ startIso: a.startIso, distanceM: a.distanceM }); try { currentStore()?.setItem(SIG_KEY, JSON.stringify(have.sigs.slice(-500))) } catch { /* ignore */ } }
    if (res.ok && !res.duplicate) { saved++; recordResult('saved') }
    else if (res.ok) { skipped++; recordResult('skipped') }
    else { errors.push(`${a.startIso?.slice(0, 10) ?? ""} ${a.sportLabel}：${res.reason}`); recordResult(res.code === 'PERSISTENCE_FAILED' ? 'persistence_failed' : res.code === 'PERSISTENCE_UNCONFIRMED' ? 'persistence_unconfirmed' : 'rejected') }
  }
  healthChanged()
  if(typeof window!=="undefined") window.dispatchEvent(new Event("storage"))
  return { saved, skipped, errors, healthErrors: result.errors, activityResults }
}
