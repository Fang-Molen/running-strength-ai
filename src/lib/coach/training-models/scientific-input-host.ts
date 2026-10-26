import { currentAthleteId } from '../../core/events'
import { analysisDigest } from '../../health/analysis-evidence'
import { loadEntries } from '../../nutrition/log'
import { loadProfile, profileFieldTimes, profileSavedAt } from '../../strength/profile'
import type { ScheduleEntry } from '../../ui/day-schedule-rules'
import { readCycleDocuments, readCycleGoal } from '../cycle/host'
import { readEffectiveProfile } from '../loop/effective-host'
import { readEffectiveTrainingProfile } from '../loop/effective-training'
import type { ScientificSources } from './scientific-input'

/** Reuse existing scoped stores. No migration, write, device merge or synthesized measurement. */
export function readScientificInputSources(day: string, asOf: string, entries: readonly ScheduleEntry[]): ScientificSources {
 const athleteId = currentAthleteId(), profile = loadProfile(), goal = readCycleGoal()
 const effective = readEffectiveProfile(profile), training = readEffectiveTrainingProfile()
 const savedAt = profileSavedAt(), fieldTimes = profileFieldTimes(), foods = loadEntries()
 const phaseRows = readCycleDocuments().flatMap(d => {
  if (d.athleteId !== athleteId || d.status !== 'ACCEPTED' || !goal || d.draft.goal.revision !== goal.revision || Date.parse(d.draft.generatedAt) > Date.parse(asOf)) return []
  const accepted = d.history.filter(h => h.action === 'ACCEPTED_FIRST_WEEK' && Date.parse(h.at) <= Date.parse(asOf)).at(-1)
  const week = d.draft.weeks.find(w => w.start <= day && w.end >= day && !w.conditional)
  if (!accepted || !week || week.phase === 'REVIEW') return []
  return [{ id: d.id, revision: d.history.length, version: analysisDigest([d.id, d.draft.basisVersion, week.phase, accepted]), athleteId, goalRevision: goal.revision, phase: week.phase, start: week.start, end: week.end, at: accepted.at }]
 })
 // Two overlapping accepted phases are a conflict, not permission to select whichever was read last.
 const acceptedPhase = phaseRows.length === 1 ? phaseRows[0] : null
 const issues = phaseRows.length > 1 ? ['当前日期对应多个已接受周期阶段，需核对周期来源'] : []
 const version = analysisDigest([athleteId, goal, phaseRows, effective, training, profile, savedAt, fieldTimes, foods, entries])
 return { athleteId, goal, acceptedPhase, profile, profileSavedAt: savedAt, profileFieldTimes: fieldTimes, effective, training, foods, entries, version, issues }
}
