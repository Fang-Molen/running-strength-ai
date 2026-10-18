import { calendarDay } from './coach-calendar.ts'
import { coachImports } from './coach-import-evidence.ts'
import { loadImportRatings, type ImportRating } from './coach-import-rating.ts'
import { currentAthleteId, loadEvents } from './events.ts'
import { projectOccurrenceEvidence } from './evidence.ts'
import { listTrainingOccurrences, type TrainingOccurrence } from './occurrence.ts'
import { readJournal, appendJournal } from './storage-journal.ts'
import { listCorrections, type TrainingCorrection } from './training-correction.ts'
import type { ConfirmedTrainingImport } from './training-import.ts'
import type { AppEvent } from './types.ts'
import { calculateLoadTrend, loadDayFingerprint, shiftLoadDay, validLoadDay, type LoadDayConfirmation, type SavedSessionLoad } from './coach-load-metrics.ts'

export const LOAD_COVERAGE_PREFIX = 'fr255-load-day-coverage-v1:'
type CoverageAssertion = { id: string; athleteId: string; recordedAt: string; startDay: string; endDay: string; days: LoadDayConfirmation[] }
type Sources = { athleteId: string; events: AppEvent[]; occurrences: TrainingOccurrence[]; imports: ConfirmedTrainingImport[]; corrections: TrainingCorrection[]; ratings: ImportRating[]; asOf: string }

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
    const day = occurrence.startedAt ? calendarDay(occurrence.startedAt) : null
    if (!day) continue
    const close = events.filter(e => e.event_id === occurrence.closeEventId)
    const rpeEvents = events.filter(e => e.payload.trainingOccurrenceId === id && e.event_type === 'RPE_RECORDED' && e.payload.evidenceType === 'SESSION_RPE')
    const evidence = projectOccurrenceEvidence(id, [...starts, ...rpeEvents])
    const changes = changesFor(id)
    const start = Date.parse(occurrence.startedAt!), end = Date.parse(occurrence.endedAt ?? '')
    const validClose = close.length === 1 && starts.length === 1 && starts[0].timestamp === occurrence.startedAt && close[0].timestamp === occurrence.endedAt && ['COMPLETED', 'INTERRUPTED'].includes(occurrence.lifecycle) && Number.isFinite(end) && end <= Date.parse(asOf) && end > start
    result.push({ id, athleteId, day,
      sessionRpe: unknownTimeIds.has(id) || changes.some(c => c.kind === 'FIELD' && c.field === 'feedback') ? null : evidence.sessionRpe.status === 'RECORDED' ? evidence.sessionRpe.value : null,
      minutes: validClose && !unknownTimeIds.has(id) && !changes.some(c => c.kind === 'FIELD' && c.field === 'duration') ? (end - start) / 60_000 : null,
      sourceIds: [...new Set([...starts, ...close, ...rpeEvents].map(e => e.event_id))],
      revision: JSON.stringify({ occurrence, starts, close, rpeEvents, changes }),
    })
  }
  for (const record of imports) {
    if ((record.athleteId ?? 'local') !== athleteId || (voided(record.confirmedImportId) && !unknownTimeIds.has(record.confirmedImportId)) || !record.occurredAt.value || Date.parse(record.confirmedAt) > Date.parse(asOf)) continue
    const day = calendarDay(record.occurredAt.value)
    if (!day) continue
    const changes = changesFor(record.confirmedImportId)
    // More than one saved rating remains ambiguous, even if the numeric values agree.
    const ratings = input.ratings.filter(r => r.athleteId === athleteId && r.occurrenceId === record.confirmedImportId && Number.isFinite(Date.parse(r.recordedAt)) && Date.parse(r.recordedAt) <= Date.parse(asOf) && Date.parse(r.recordedAt) >= Date.parse(record.confirmedAt))
    const values = [record.sessionRpe.status === 'RECORDED' ? record.sessionRpe.value : null, ...ratings.map(r => r.value)].filter((v): v is number => v !== null)
    const rpe = unknownTimeIds.has(record.confirmedImportId) || changes.some(c => c.kind === 'FIELD' && c.field === 'feedback') || values.length !== 1 ? null : values[0]
    result.push({ id: record.confirmedImportId, athleteId, day, sessionRpe: rpe,
      minutes: record.durationSeconds.status === 'RECORDED' && record.durationSeconds.value !== null && !unknownTimeIds.has(record.confirmedImportId) && !changes.some(c => c.kind === 'FIELD' && c.field === 'duration') ? record.durationSeconds.value / 60 : null,
      sourceIds: [...new Set([record.confirmedImportId, ...record.sourceIds, ...ratings.map(r => r.id)])],
      revision: JSON.stringify({ record, changes, ratings }),
    })
  }
  return result
}

export function readSavedSessionLoads(athleteId = currentAthleteId(), asOf = new Date().toISOString()): SavedSessionLoad[] {
  return projectSavedSessionLoads({ athleteId, asOf, events: loadEvents(), occurrences: listTrainingOccurrences(), imports: coachImports(athleteId, asOf), corrections: listCorrections(), ratings: loadImportRatings() })
}

export function readLoadCoverage(athleteId = currentAthleteId()): LoadDayConfirmation[] {
  return readJournal<CoverageAssertion>(LOAD_COVERAGE_PREFIX).flatMap(({ data }) => data && data.athleteId === athleteId && Array.isArray(data.days)
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
