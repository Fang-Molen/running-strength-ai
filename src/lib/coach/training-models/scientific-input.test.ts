import test from 'node:test'
import assert from 'node:assert/strict'
import { projectAnalysisEvidence } from '../../health/analysis-evidence'
import type { AnalysisFact, MetricFact, TrainingFact } from '../../health/analysis-contract'
import { emptyProfile } from '../../strength/profile'
import { resolveEffectiveProfile } from '../loop/effective-profile'
import { adaptScientificTrainingInput, type ScientificSources } from './scientific-input'

const asOf = '2026-10-26T12:00:00.000Z', day = '2026-10-26'
const context = { athleteId: 'a', asOf, timeZone: 'UTC', planVersion: null, consentVersion: '1', analysisVersion: '1' }
const meta = (id: string) => ({ id, revision: 1, athleteId: 'a', provider: 'MANUAL' as const, accountRef: null, deviceId: null, protocolKey: 'FIELD:TRACK', sourceRecordId: id, occurredAt: '2026-10-25T08:00:00.000Z', knownAt: '2026-10-25T09:00:00.000Z', receivedAt: '2026-10-25T09:00:00.000Z', sourceTimeZone: 'UTC', status: 'CONFIRMED' as const, quality: 'AVAILABLE' as const, ownershipReceiptId: null })
const metric = (id: string, patch: Partial<MetricFact> = {}): MetricFact => ({ ...meta(id), kind: 'METRIC', metric: 'HRV_RMSSD', value: 45, unit: 'ms', statistic: 'SAMPLE', windowStart: null, windowEnd: null, providerDate: '2026-10-25', isFinal: true, energyKind: null, ...patch })
const run = (id: string, patch: Partial<TrainingFact> = {}): TrainingFact => ({ ...meta(id), kind: 'TRAINING', canonicalActivityId: id, occurrenceId: id, componentId: 'run', modality: 'RUN', startedAt: '2026-10-25T08:00:00.000Z', endedAt: '2026-10-25T08:05:00.000Z', plannedPurpose: null, observedType: 'TIME_TRIAL_MAXIMAL', observedTypeBasis: [{ id, revision: 1 }], sessionRpe: 8, sessionRpeScale: 'CR10', actualDurationSeconds: 300, runSegments: [{ id: id + ':split', blockId: 'b', roundIndex: null, stepIndex: 0, distanceM: 1500, durationSeconds: 300, restAfterSeconds: 0, rawResolutionSeconds: 1, gradePercent: null, surface: 'TRACK', completion: 'COMPLETED' }], strengthSets: [], jumpContacts: null, ...patch })
function sources(patch: Partial<ScientificSources> = {}): ScientificSources {
 const profile = emptyProfile()
 return { athleteId: 'a', goal: null, acceptedPhase: null, profile, profileSavedAt: null, profileFieldTimes: {}, effective: resolveEffectiveProfile({ profile, checks: [], personal: null }), training: { days: null, daysPerWeek: null, minutes: null, equipment: null, restrictions: [], notes: null, conflicts: [], version: 'empty', sourceRule: '' }, foods: [], entries: [], version: 'sources:1', ...patch }
}
const build = (facts: AnalysisFact[] = [], input = sources()) => adaptScientificTrainingInput(projectAnalysisEvidence({ context, facts }), null, input, {}, day)

test('saved cycle goal and accepted phase auto-fill while profile PB remains self report', () => {
 const profile = { ...emptyProfile(), marks: [{ meters: 1500, recent: '4:30', goal: '4:20', deadline: '2026-11-07' }] }
 const input = sources({ profile, profileSavedAt: '2026-10-20T08:00:00.000Z', goal: { schema: 1, athleteId: 'a', revision: 2, savedAt: '2026-10-24T08:00:00.000Z', eventMeters: 1500, raceDate: '2026-11-07', targetSeconds: 260, experience: 'TRAINED', priority: 'SPEED', horizonWeeks: 4, taperDays: 7, proposeExtraMinutes: null, source: 'USER_CONFIRMED_GOAL' }, acceptedPhase: { id: 'cycle:1', revision: 2, version: 'phase:1', athleteId: 'a', goalRevision: 2, phase: 'SPECIFIC', start: day, end: '2026-11-01', at: '2026-10-25T08:00:00.000Z' } })
 const result = build([], input)
 assert.equal(result.profile.eventMeters, 1500)
 assert.equal(result.profile.raceDate, '2026-11-07')
 assert.equal(result.profile.targetSeconds, 260)
 assert.equal(result.profile.phase, 'SPECIFIC')
 assert.equal(result.profile.experience, 'TRAINED')
 assert.equal(result.performances.length, 0)
 assert.equal(result.scientificInput.running.selfReportedPBs[0].seconds.value, 270)
 assert.equal(result.scientificInput.running.selfReportedPBs[0].maximalVerified, false)
 assert.equal(result.scientificInput.goals.eventMeters.provenance[0].athleteId, 'a')
 assert.equal(result.scientificInput.goals.eventMeters.provenance[0].revision, 2)
 assert.equal(result.scientificInput.followups.length <= 2, true)
 const overridden = adaptScientificTrainingInput(result.snapshot, null, input, { eventMeters: 800, phase: 'BUILD' }, day)
 assert.equal(overridden.profile.eventMeters, 800)
 assert.equal(overridden.profile.targetSeconds, null, 'a 1500 target cannot silently become an 800 target')
 assert.equal(overridden.profile.phase, 'BUILD')
 assert.equal(input.goal!.eventMeters, 1500, 'read does not mutate saved records')
})

test('foreign, stale, future and conflicting sources never become current measurements', () => {
 const facts = [metric('foreign', { athleteId: 'other' }), metric('stale', { quality: 'STALE' }), metric('future', { knownAt: '2026-10-27T09:00:00.000Z' }), metric('conflict-a', { sourceRecordId: 'same', value: 10 }), metric('conflict-b', { sourceRecordId: 'same', value: 100 })]
 const result = build(facts)
 assert.deepEqual(result.scientificInput.health.hrv, [])
 assert.equal(result.scientificInput.fields.hrv.state, 'UNKNOWN')
 assert.ok(result.scientificInput.conflicts.some(x => x.includes('SAME_SOURCE_REVISION_CONFLICT')))
 assert.equal(result.performances.length, 0)
 const foreign = sources({ athleteId: 'other' })
 assert.throws(() => build([], foreign), /SUBJECT/)
})

test('canonical source exclusions and gaps preserve the recovery snapshot binding', () => {
 const snapshot = projectAnalysisEvidence({ context, facts: [run('valid'), metric('old', { quality: 'STALE' })], gaps: ['explicit source gap'] })
 const result = adaptScientificTrainingInput(snapshot, null, sources(), {}, day)
 assert.equal(result.snapshot.snapshotId, snapshot.snapshotId)
 assert.equal(result.snapshot.inputDigest, snapshot.inputDigest)
 assert.deepEqual(result.snapshot.excluded, snapshot.excluded)
 const withoutGap = projectAnalysisEvidence({ context, facts: [run('valid')] })
 assert.notEqual(result.scientificInput.version, adaptScientificTrainingInput(withoutGap, null, sources(), {}, day).scientificInput.version)
})

test('different devices and protocols stay separate and cannot form a threshold pair', () => {
 const facts = [metric('watch-a', { provider: 'GARMIN', accountRef: 'acct', deviceId: 'a', protocolKey: 'RMSSD:NIGHT' }), metric('watch-b', { provider: 'GARMIN', accountRef: 'acct', deviceId: 'b', protocolKey: 'RMSSD:NIGHT', value: 65 }), metric('lt1', { metric: 'LT1_SPEED', value: 3, unit: 'm/s', protocolKey: 'LAB:A', sourceRecordId: 'lab', deviceId: 'lab-a' }), metric('lt2', { metric: 'LT2_SPEED', value: 4, unit: 'm/s', protocolKey: 'LAB:B', sourceRecordId: 'lab', deviceId: 'lab-b' })]
 const result = build(facts)
 assert.equal(result.scientificInput.health.groups.filter(g => g.metric === 'HRV_RMSSD').length, 2)
 assert.equal(result.scientificInput.physiology.thresholds.speed, null)
 assert.equal(result.scientificInput.fields.hrv.value, null, 'historical rows do not invent today’s HRV')
 assert.equal(result.scientificInput.health.hrv.length, 2)
})

test('actual splits, incomplete nutrition and strength RPE/RIR remain explicit without inferring tolerance', () => {
 const strength = run('strength', { modality: 'STRENGTH', observedType: null, runSegments: [], strengthSets: [{ id: 'set1', catalogId: 'squat', catalogVersion: '1', side: 'BILATERAL', loadKg: 40, loadBasis: 'TOTAL_EXTERNAL', reps: 5, holdSeconds: null, setRpe: 8, rir: 2, effortScale: 'CR10', eccentricSeconds: null, rangeProtocol: null, completion: 'COMPLETED' }] })
 const input = sources({ foods: [{ id: 'meal', athleteId: 'a', date: day, meal: '午餐', name: 'lunch', kcal: 500, protein: 20, recordedAt: '2026-10-26T11:00:00.000Z', source: 'MANUAL' }] })
 const result = build([run('verified'), strength], input)
 assert.equal(result.performances.length, 1)
 assert.equal(result.scientificInput.running.actuals[0].runSegments[0].distanceM, 1500)
 assert.equal(result.scientificInput.strength.actuals[0].strengthSets[0].rir, 2)
 assert.equal(result.scientificInput.nutrition.loggedKcal, 500)
 assert.equal(result.scientificInput.nutrition.dayComplete, false)
 assert.equal(result.scientificInput.nutrition.energyDeficitKcal, null)
 assert.equal(result.scientificInput.nutrition.nutrients.carb.value, null)
 assert.equal(result.scientificInput.running.tolerance, 'NOT_ESTABLISHED')
 assert.equal(result.window.complete, false)
 assert.equal(result.scientificInput.availability.twoSessionsAvailable.value, null)
})

test('future profile fields and foreign food are unavailable and no facts is not zero volume', () => {
 const input = sources({ effective: { ...sources().effective, weightKg: { value: 66, at: '2026-10-27T08:00:00.000Z', source: 'ATHLETE_PROFILE', version: 'future' } }, foods: [{ id: 'other-food', athleteId: 'other', date: day, meal: '午餐', name: 'foreign', kcal: 900, recordedAt: asOf }] })
 const result = build([], input)
 assert.equal(result.scientificInput.nutrition.weightKg.value, null)
 assert.equal(result.scientificInput.nutrition.loggedKcal, null)
 assert.equal(result.window.totalRunSeconds, null)
 assert.equal(result.scientificInput.running.observedWeeks[0].minutes, null)
 assert.equal(result.scientificInput.running.observedWeeks[0].observedSessions, null)
})
