import {calendarDate} from '../health/load-evidence'
import {readCurrentImportConflicts} from './current-import-conflicts'
import { calendarDay } from './coach-calendar.ts'
import { coachImports } from './coach-import-evidence.ts'
import { loadImportRatings, type ImportRating } from './coach-import-rating.ts'
import { currentAthleteId, loadCommittedEventRecords } from './events.ts'
import { projectOccurrenceEvidence } from './evidence.ts'
import { listTrainingOccurrences, type TrainingOccurrence } from './occurrence.ts'
import { readJournal, appendJournal } from './storage-journal.ts'
import { listCorrections, type TrainingCorrection } from './training-correction.ts'
import type { ConfirmedTrainingImport } from './training-import.ts'
import type { AppEvent } from './types.ts'
import { calculateLoadTrend, loadDayFingerprint, shiftLoadDay, validLoadDay, type LoadDayConfirmation, type SavedSessionLoad } from './coach-load-metrics.ts'

export const LOAD_COVERAGE_PREFIX = 'fr255-load-day-coverage-v1:'
type CoverageAssertion = { id: string; athleteId: string; recordedAt: string; startDay: string; endDay: string; days: LoadDayConfirmation[] }
type Sources = { athleteId: string; events: AppEvent[]; occurrences: TrainingOccurrence[]; imports: ConfirmedTrainingImport[]; corrections: TrainingCorrection[]; ratings: ImportRating[]; asOf: string;timeZone?:string }

/** Saved evidence adapter. Session elapsed milliseconds and imported seconds have distinct conversions. */
export function projectSavedSessionLoads(input: Sources): SavedSessionLoad[] {
  const { athleteId, occurrences, imports, asOf } = input
  const unknownTimeCorrections = input.corrections.filter(c => !c.recordedAt || !Number.isFinite(Date.parse(c.recordedAt)))
  const unknownTimeIds = new Set(unknownTimeCorrections.map(c => c.trainingOccurrenceId))
  const corrections = input.corrections
    .filter(c => c.recordedAt && Number.isFinite(Date.parse(c.recordedAt)) && Date.parse(c.recordedAt) <= Date.parse(asOf))
    .sort((a, b) => Date.parse(a.recordedAt!) - Date.parse(b.recordedAt!))
  const changesFor = (id: string) => [...corrections, ...unknownTimeCorrections].filter(c => c.trainingOccurrenceId === id)
  const events = input.events.filter(e => e.athlete_id === athleteId && Number.isFinite(Date.parse(e.timestamp)) && Date.parse(e.timestamp) <= Date.parse(asOf))
  const voided = (id: string) => corrections.filter(c => c.trainingOccurrenceId === id && (c.kind === 'VOID' || c.kind === 'RESTORE')).at(-1)?.kind === 'VOID'
  const result: SavedSessionLoad[] = []
  for (const occurrence of occurrences) {
    const id = occurrence.trainingOccurrenceId
    const starts = events.filter(e => e.event_id === occurrence.startEventId && e.event_type === 'TRAINING_STARTED')
    if (!starts.length || (voided(id) && !unknownTimeIds.has(id))) continue
    const day = occurrence.startedAt ? calendarDate(occurrence.startedAt,input.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone) : null
    if (!day) continue
    const close = events.filter(e => e.event_id === occurrence.closeEventId)
    const rpeEvents = events.filter(e => e.payload.trainingOccurrenceId === id && e.event_type === 'RPE_RECORDED' && e.payload.evidenceType === 'SESSION_RPE')
    const evidence = projectOccurrenceEvidence(id, [...starts, ...rpeEvents])
    const changes = changesFor(id)
    const start = Date.parse(occurrence.startedAt!), end = Date.parse(occurrence.endedAt ?? '')
    const validClose = close.length === 1 && starts.length === 1 && starts[0].timestamp === occurrence.startedAt && close[0].timestamp === occurrence.endedAt && ['COMPLETED', 'INTERRUPTED'].includes(occurrence.lifecycle) && Number.isFinite(end) && end <= Date.parse(asOf) && end > start
    result.push({ id, athleteId, day, measurement:{origin:'NATIVE',completed:validClose,durationBasis:'ELAPSED',ratingScope:'SESSION',ratingCollectedAt:rpeEvents.length===1&&typeof rpeEvents[0].payload.ratingCollectedAt==='string'?rpeEvents[0].payload.ratingCollectedAt:null,ratingRecordedAt:rpeEvents.length===1?rpeEvents[0].timestamp:null,ratingScale:'0-10_SESSION_RPE',sourceIds:[...starts,...close,...rpeEvents].map(e=>e.event_id)},
      sessionRpe: unknownTimeIds.has(id) || changes.some(c => c.kind === 'FIELD' && c.field === 'feedback') ? null : evidence.sessionRpe.status === 'RECORDED' ? evidence.sessionRpe.value : null,
      minutes: validClose && !unknownTimeIds.has(id) && !changes.some(c => c.kind === 'FIELD' && c.field === 'duration') ? (end - start) / 60_000 : null,
      sourceIds: [...new Set([...starts, ...close, ...rpeEvents].map(e => e.event_id))],
      revision: JSON.stringify({ occurrence, starts, close, rpeEvents, changes }),
    })
  }
  for (const record of imports) {
    if ((record.athleteId ?? 'local') !== athleteId || (voided(record.confirmedImportId) && !unknownTimeIds.has(record.confirmedImportId)) || !record.occurredAt.value || !Number.isFinite(Date.parse(record.confirmedAt)) || Date.parse(record.confirmedAt) > Date.parse(asOf) || !Number.isFinite(Date.parse(record.occurredAt.value)) || Date.parse(record.occurredAt.value) > Date.parse(asOf)) continue
    const day = calendarDate(record.occurredAt.value,input.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone)
    if (!day) continue
    const changes = changesFor(record.confirmedImportId)
    // More than one saved rating remains ambiguous, even if the numeric values agree.
    const ratings = input.ratings.filter(r => r.athleteId === athleteId && r.occurrenceId === record.confirmedImportId && Number.isFinite(Date.parse(r.recordedAt)) && Date.parse(r.recordedAt) <= Date.parse(asOf) && Date.parse(r.recordedAt) >= Date.parse(record.confirmedAt))
    const captureRatings=events.filter(e=>e.payload.trainingOccurrenceId===record.confirmedImportId&&e.event_type==='RPE_RECORDED'&&e.payload.evidenceType==='SESSION_RPE'&&typeof e.payload.value==='number')
    const values = [record.sessionRpe.status === 'RECORDED' ? record.sessionRpe.value : null, ...ratings.map(r => r.value),...captureRatings.map(e=>Number(e.payload.value))].filter((v): v is number => v !== null)
    const rpe = unknownTimeIds.has(record.confirmedImportId) || changes.some(c => c.kind === 'FIELD' && c.field === 'feedback') || values.length !== 1 ? null : values[0]
    result.push({ id: record.confirmedImportId, athleteId, day, sessionRpe: rpe, measurement:{origin:'CONFIRMED_IMPORT',completed:true,durationBasis:'UNKNOWN',ratingScope:'SESSION',ratingCollectedAt:captureRatings.length===1&&typeof captureRatings[0].payload.ratingCollectedAt==='string'?captureRatings[0].payload.ratingCollectedAt:null,ratingRecordedAt:captureRatings.length===1?captureRatings[0].timestamp:ratings.length===1?ratings[0].recordedAt:record.confirmedAt,ratingScale:'0-10_SESSION_RPE',sourceIds:[record.confirmedImportId,...ratings.map(r=>r.id),...captureRatings.map(e=>e.event_id)]},
      minutes: record.durationSeconds.status === 'RECORDED' && record.durationSeconds.value !== null && !unknownTimeIds.has(record.confirmedImportId) && !changes.some(c => c.kind === 'FIELD' && c.field === 'duration') ? record.durationSeconds.value / 60 : null,
      sourceIds: [...new Set([record.confirmedImportId, ...record.sourceIds, ...ratings.map(r => r.id),...captureRatings.map(e=>e.event_id)])],
      revision: JSON.stringify({ record, changes, ratings, captureRatings }),
    })
  }
  return result
}

export function readSavedSessionLoads(athleteId = currentAthleteId(), asOf = new Date().toISOString(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone): SavedSessionLoad[] {
  const imports=coachImports(athleteId,asOf),conflicts=readCurrentImportConflicts(imports)
  return projectSavedSessionLoads({ athleteId, asOf,timeZone, events: loadCommittedEventRecords().filter(r=>r.recordedAt&&Number.isFinite(Date.parse(r.recordedAt))&&Date.parse(r.recordedAt)<=Date.parse(asOf)).map(r=>r.event), occurrences: listTrainingOccurrences(), imports, corrections: listCorrections(), ratings: loadImportRatings() }).map(s=>conflicts.has(s.id)?{...s,minutes:conflicts.get(s.id)!.duration?null:s.minutes,revision:JSON.stringify([s.revision,conflicts.get(s.id)!.duration,conflicts.get(s.id)!.distance])}:s)
}

export function readLoadCoverage(athleteId = currentAthleteId(), asOf = new Date().toISOString()): LoadDayConfirmation[] {
  return readJournal<CoverageAssertion>(LOAD_COVERAGE_PREFIX).flatMap(({ data }) => data && data.athleteId === athleteId && Number.isFinite(Date.parse(data.recordedAt)) && Date.parse(data.recordedAt)<=Date.parse(asOf) && Array.isArray(data.days)
    ? data.days.filter(day => day && day.athleteId === athleteId && validLoadDay(day.day) && typeof day.fingerprint === 'string') : [])
}

/** User asserts every session is logged, elapsed/full durations include warm-up and cool-down,
 * and dates with no sessions were genuine no-training days. This never invents missing RPE.
 */
export function confirmLoadCoverage(startDay: string, endDay: string, now = new Date().toISOString()): { ok: boolean; reason: string } {
  const athleteId = currentAthleteId(), today = calendarDay(now)
  if (!today || !validLoadDay(startDay) || !validLoadDay(endDay) || startDay > endDay || endDay >= today) return { ok: false, reason: '只能确认已经结束的日期范围。' }
  const dayCount = (Date.parse(endDay + 'T00:00:00Z') - Date.parse(startDay + 'T00:00:00Z')) / 86_400_000 + 1
  if (dayCount > 366) return { ok: false, reason: '一次最多核对 366 天。' }
  const sessions = readSavedSessionLoads(athleteId, now)
  const days = Array.from({ length: dayCount }, (_, i) => {
    const day = shiftLoadDay(startDay, i)!
    return { athleteId, day, fingerprint: loadDayFingerprint(sessions, athleteId, day) }
  })
  const id = crypto.randomUUID(), assertion: CoverageAssertion = { id, athleteId, recordedAt: now, startDay, endDay, days }
  if (!appendJournal(LOAD_COVERAGE_PREFIX, id, assertion)) return { ok: false, reason: '保存失败，完整性确认未生效。' }
  return { ok: true, reason: '已保存本人对这段日期的完整性确认。缺少整课评分或时长的训练仍不能计算；记录更正后对应日期需重新核对。' }
}

export function readLoadTrend(endDay: string) {
  const athleteId = currentAthleteId()
  return calculateLoadTrend({ athleteId, endDay, sessions: readSavedSessionLoads(athleteId), confirmations: readLoadCoverage(athleteId) })
}
