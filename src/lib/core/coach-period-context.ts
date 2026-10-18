import { loadVitals, isVitalRecord, type VitalRecord } from '../nutrition/vitals.ts'
import { strictIso } from './coach-v4-c11-adapter.ts'
import { calendarDay } from './coach-calendar.ts'
import { readSavedSessionLoads } from './coach-load-metrics-store.ts'
import { coachImports } from './coach-import-evidence.ts'
import { validReading, type DeviceConfirmed } from './device-image-evidence.ts'

export type PeriodContext = {
  clues: { athleteId: string; kind: 'RHR' | 'SLEEP'; day: string; value: number; unit: 'bpm' | 'h'; sourceId: string; knownAt: string; method: string }[]
  durations: { athleteId: string; occurrenceId: string; day: string; minutes: number; sourceIds: string[]; knownAt: string; sport: 'STRENGTH' }[]
  unknowns: string[]
}
/** The legacy body/device vaults are the local profile only; do not assign their data to another athlete. */
export function projectPeriodVitals(athleteId: string, asOf: string, vitals: readonly VitalRecord[], devices: readonly DeviceConfirmed[] = []): PeriodContext['clues'] {
  if (athleteId !== 'local' || !strictIso(asOf)) return []
  const clues: PeriodContext['clues'] = []
  for (const r of vitals) if (isVitalRecord(r) && ['RHR', 'SLEEP'].includes(r.kind) && strictIso(r.createdAt) && Date.parse(r.createdAt) <= Date.parse(asOf)) {
    const measured = r.observedAt ? `${r.observedOn}T${r.observedAt}:00+08:00` : null
    if (measured && (!strictIso(measured) || Date.parse(measured) > Date.parse(asOf))) continue
    clues.push({ athleteId, kind: r.kind === 'RHR' ? 'RHR' : 'SLEEP', day: r.observedOn, value: r.value, unit: r.kind === 'RHR' ? 'bpm' : 'h', sourceId: `vital:${r.id}`, knownAt: r.createdAt, method: `${r.deviceLabel ?? '设备未知'} / ${r.measurementMethod ?? '方法未知'} / ${r.observedAt ?? '时刻未知'}` })
  }
  for (const record of devices) {
    if (record.consent !== 'USER_CONFIRMED' || !strictIso(record.confirmedAt) || !strictIso(record.recordedAt) || Date.parse(record.confirmedAt) > Date.parse(asOf) || Date.parse(record.recordedAt) > Date.parse(record.confirmedAt)) continue
    for (const r of record.readings) if (validReading(r) && ['RESTING_HR_BPM', 'SLEEP_HOURS'].includes(r.metric)) clues.push({ athleteId, kind: r.metric === 'RESTING_HR_BPM' ? 'RHR' : 'SLEEP', day: calendarDay(record.recordedAt)!, value: r.value, unit: r.metric === 'RESTING_HR_BPM' ? 'bpm' : 'h', sourceId: `device:${record.id}:${r.id}`, knownAt: record.confirmedAt, method: `${record.deviceLabel || '设备未知'} / 本人确认设备读数` })
  }
  return clues
}
export function readPeriodContext(athleteId: string, asOf: string, devices: readonly DeviceConfirmed[] = [], deviceReadFailed = false): PeriodContext {
  const vitals = loadVitals(), imports = coachImports(athleteId, asOf)
  const durations = readSavedSessionLoads(athleteId, asOf).flatMap(s => {
    const record = imports.find(r => r.confirmedImportId === s.id && r.sport === 'STRENGTH')
    return record && s.minutes !== null ? [{ athleteId, occurrenceId: s.id, day: s.day, minutes: s.minutes, sourceIds: s.sourceIds, knownAt: record.confirmedAt, sport: 'STRENGTH' as const }] : []
  })
  return { clues: projectPeriodVitals(athleteId, asOf, vitals.unreadable ? [] : vitals.records, devices), durations,
    unknowns: [...(vitals.unreadable ? ['身体指标库读取失败，不能把静息心率或睡眠当作没有记录。'] : []), ...(deviceReadFailed ? ['设备指标库读取失败，相关线索可能不完整。'] : []), ...(athleteId !== 'local' ? ['旧版身体与设备指标没有运动员归属，不自动分配给当前运动员。'] : [])] }
}
