/** Read-only scientific context. Intent, self reports, actuals and estimates retain their source class. */
import type { EvidenceMeta, EvidenceSnapshot, MetricFact, RecoveryAssessment, ResponseFact, TrainingFact } from '../../health/analysis-contract'
import { analysisDigest, projectAnalysisEvidence, refOf, sourceScope } from '../../health/analysis-evidence'
import { addDays, type ScheduleEntry } from '../../ui/day-schedule-rules'
import { aggregate, validFoodEntry, type FoodEntry, type NutrientKey } from '../../nutrition/log'
import { clockSeconds } from '../../strength/agent'
import type { Profile } from '../../strength/profile'
import type { CycleGoal } from '../cycle/types'
import type { EffectiveProfile, Known } from '../loop/effective-profile'
import type { readEffectiveTrainingProfile } from '../loop/effective-training'
import { assessAthleteHistory } from '../assessment/history'
import { adaptTrainingModelInput } from './host'
import { assessPhysiology } from './physiology'
import type { ModelProfile, PlannedModelSession } from './types'

export type ScientificIntent = {
 eventMeters?: number | null; raceDate?: string | null; targetSeconds?: number | null
 phase?: ModelProfile['phase']; experience?: ModelProfile['experience']
 familiarSessionIds?: readonly string[]
}
export type ScientificProvenance = {
 athleteId: string; source: string; version: string; revision: number
 at: string | null; knownAt: string | null; unit: string
 accountRef: string | null; deviceId: string | null; protocolKey: string | null
 ownershipReceiptId: string | null; ref: { id: string; revision: number }
 kind: 'SAVED_INTENT' | 'SELF_REPORT' | 'ACTUAL' | 'DERIVED'
}
export type ScientificField<T = unknown> = {
 value: T | null; state: 'AVAILABLE' | 'UNKNOWN' | 'CONFLICT' | 'STALE'; unit: string
 provenance: ScientificProvenance[]; reason: string | null
}
export type ScientificSources = {
 athleteId: string; goal: CycleGoal | null
 acceptedPhase: { id: string; revision: number; version: string; athleteId: string; goalRevision: number; phase: ModelProfile['phase']; start: string; end: string; at: string } | null
 profile: Profile; profileSavedAt: string | null; profileFieldTimes: Record<string, string | null>
 effective: EffectiveProfile; training: ReturnType<typeof readEffectiveTrainingProfile>
 foods: readonly FoodEntry[]; entries: readonly ScheduleEntry[]; version: string; issues?: readonly string[]
}
const sum = (values: (number | null | undefined)[]): number | null => values.length && values.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0) ? values.reduce<number>((a, b) => a + b!, 0) : null
const dateOf = (at: string, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
const knownAsOf = (at: string | null | undefined, asOf: string) => !!at && Number.isFinite(Date.parse(at)) && Date.parse(at) <= Date.parse(asOf)
const unique = (values: string[]) => [...new Set(values)]
function factProvenance(f: EvidenceMeta, unit: string): ScientificProvenance {
 return { athleteId: f.athleteId, source: f.provider, version: analysisDigest(f), revision: f.revision, at: f.occurredAt, knownAt: f.knownAt, unit, accountRef: f.accountRef, deviceId: f.deviceId, protocolKey: f.protocolKey, ownershipReceiptId: f.ownershipReceiptId, ref: refOf(f), kind: 'ACTUAL' }
}

/** The caller supplies local host sources, never an LLM-produced facts object. Re-project for owner,
 * as-of, correction and canonical-selection safety; do not join independent device protocols. */
export function adaptScientificTrainingInput(snapshot: EvidenceSnapshot, recovery: RecoveryAssessment | null, sources: ScientificSources, options: ScientificIntent = {}, day: string, sessions: readonly PlannedModelSession[] = []) {
 if (sources.athleteId !== snapshot.context.athleteId) throw Error('SUBJECT_OR_SOURCE_CHANGED')
 const { athleteId, asOf, timeZone } = snapshot.context
 const clean = projectAnalysisEvidence({ context: snapshot.context, facts: snapshot.facts, safetyConstraints: snapshot.safetyConstraints, priorHypotheses: snapshot.priorHypotheses, gaps: snapshot.gaps })
 // Rechecking an already canonical host snapshot must preserve its binding to recovery. Its
 // excluded/conflicting source rows are part of that identity even though absent from facts.
 const unchanged = !clean.excluded.length && !clean.conflicts.length && analysisDigest(clean.facts) === analysisDigest(snapshot.facts)
 const projected: EvidenceSnapshot = unchanged ? { ...snapshot, facts: clean.facts } : { ...clean, excluded: [...snapshot.excluded, ...clean.excluded], gaps: unique([...snapshot.gaps, ...clean.gaps]), conflicts: [...snapshot.conflicts, ...clean.conflicts] }
 const fields: Record<string, ScientificField> = {}
 const provenance = (source: string, version: string, at: string | null, unit: string, kind: ScientificProvenance['kind'] = 'SAVED_INTENT', revision = 0): ScientificProvenance => ({ athleteId, source, version, revision, at, knownAt: at, unit, kind, accountRef: null, deviceId: null, protocolKey: null, ownershipReceiptId: null, ref: { id: `${source}:${version}`, revision } })
 const field = <T>(key: string, value: T | null, unit: string, refs: ScientificProvenance[] = [], reason: string | null = null, state: ScientificField<T>['state'] = value === null ? 'UNKNOWN' : 'AVAILABLE'): ScientificField<T> => {
  const item = { value, state, unit, provenance: refs, reason: value === null ? reason ?? '尚无可用记录' : reason }
  fields[key] = item
  return item
 }
 const knownField = <T>(key: string, value: Known<T> | null, unit: string): ScientificField<T> => {
  if (!value) return field<T>(key, null, unit)
  const refs = [provenance(value.source, value.version, value.at, unit, value.source === 'BODY_MEASUREMENT' ? 'ACTUAL' : 'SELF_REPORT')]
  if (value.at && !knownAsOf(value.at, asOf)) return field<T>(key, null, unit, refs, '来源晚于本次读取截止', 'UNKNOWN')
  return field(key, value.value, unit, refs, value.at ? null : '来源时间未记录，不能当作近期测量')
 }
 const rawGoal = sources.goal
 const goal = rawGoal && rawGoal.athleteId === athleteId && knownAsOf(rawGoal.savedAt, asOf) ? rawGoal : null
 const marksAt = sources.profileFieldTimes.marks ?? sources.profileSavedAt
 const usableMarks = (!marksAt || knownAsOf(marksAt, asOf)) ? sources.profile.marks : []
 const markGoals = usableMarks.filter(m => clockSeconds(m.goal) !== null || m.deadline)
 const singleMark = markGoals.length === 1 ? markGoals[0] : null
 const intentSource = (unit: string) => goal ? [provenance('SAVED_CYCLE_GOAL', `cycle:${goal.revision}:${analysisDigest(goal)}`, goal.savedAt, unit, 'SAVED_INTENT', goal.revision)] : singleMark ? [provenance('ATHLETE_PROFILE_GOAL', analysisDigest(singleMark), marksAt, unit)] : []
 const intent = <T>(key: keyof ScientificIntent, value: T | null, unit: string): ScientificField<T> => {
  const overridden = options[key] !== undefined
  return field(key, overridden ? options[key] as T | null : value, unit, overridden ? [provenance('workbench:user-intent', analysisDigest([key, options[key]]), asOf, unit, 'SAVED_INTENT', 1)] : intentSource(unit))
 }
 const eventMeters = intent<number>('eventMeters', goal ? goal.eventMeters : singleMark?.meters ?? null, 'm')
 const baseEvent = goal ? goal.eventMeters : singleMark?.meters ?? null
 const eventChanged = options.eventMeters !== undefined && options.eventMeters !== baseEvent
 const raceDate = intent<string>('raceDate', goal ? goal.raceDate : singleMark?.deadline || null, 'date')
 const targetSeconds = intent<number>('targetSeconds', eventChanged ? null : goal ? goal.targetSeconds : singleMark ? clockSeconds(singleMark.goal) : null, 's')
 if (eventChanged && options.targetSeconds === undefined) { targetSeconds.provenance = []; targetSeconds.reason = '目标项目已覆盖，旧项目目标时间不迁移' }
 const experience = intent<ModelProfile['experience']>('experience', goal?.experience === 'UNKNOWN' ? null : goal?.experience ?? null, 'category')
 const p = sources.acceptedPhase
 const phaseValid = !!(p && p.athleteId === athleteId && goal && p.goalRevision === goal.revision && knownAsOf(p.at, asOf) && p.start <= day && p.end >= day && !eventChanged)
 const phase = field<ModelProfile['phase']>('phase', options.phase ?? (phaseValid ? p!.phase : null), 'category', options.phase !== undefined ? [provenance('workbench:user-intent', analysisDigest(['phase', options.phase]), asOf, 'category', 'SAVED_INTENT', 1)] : phaseValid ? [provenance('ACCEPTED_CYCLE_PHASE', p!.version, p!.at, 'category', 'SAVED_INTENT', p!.revision)] : [], '当前阶段需有已接受周期或明确意图，不从比赛距离猜测')
 if (phase.value === 'UNKNOWN') { phase.value = null; phase.state = 'UNKNOWN' }
 if (experience.value === 'UNKNOWN') { experience.value = null; experience.state = 'UNKNOWN' }
 if (raceDate.value && raceDate.value < day) { raceDate.state = 'STALE'; raceDate.reason = '已保存比赛日期已过去，保留历史目标，当前赛期待复核' }
 const primaryGoal = knownField('primaryGoal', sources.effective.goal, 'category')
 const weightKg = knownField('weightKg', sources.effective.weightKg, 'kg')
 const targetAt = sources.profileFieldTimes.targetKg ?? sources.profileSavedAt
 const targetValue = sources.profile.targetKg.trim() ? Number(sources.profile.targetKg) : null
 const targetKg = field('targetKg', targetValue !== null && targetValue > 0 && Number.isFinite(targetValue) && (!targetAt || knownAsOf(targetAt, asOf)) ? targetValue : null, 'kg', targetValue !== null ? [provenance('ATHLETE_PROFILE_WEIGHT_GOAL', analysisDigest([targetValue, targetAt]), targetAt, 'kg')] : [])
 const days = knownField('availableDays', sources.training.days, 'weekday')
 const daysPerWeek = knownField('availableDaysPerWeek', sources.training.daysPerWeek, 'sessions/week')
 const minutes = knownField('availableMinutes', sources.training.minutes, 'min/session')
 const twoSessionsAvailable = field<boolean>('twoSessionsAvailable', null, 'boolean', [], '每周次数或已有双练不证明当前可以双练')
 const profile: ModelProfile = { eventMeters: eventMeters.value, raceDate: raceDate.state === 'STALE' ? null : raceDate.value, targetSeconds: targetSeconds.value, phase: phase.value ?? 'UNKNOWN', experience: experience.value ?? 'UNKNOWN', doubleThresholdExperience: null, lactateMonitoring: null, coachSupervision: null, twoSessionsAvailable: twoSessionsAvailable.value, sourceRefs: [...new Map([eventMeters, raceDate, targetSeconds, phase, experience].flatMap(f => f.provenance.map(p => [p.ref.id, p.ref] as const))).values()] }
 const actuals = projected.facts.filter((f): f is TrainingFact => f.kind === 'TRAINING')
 const running = actuals.filter(f => f.modality === 'RUN')
 const strength = actuals.filter(f => f.modality === 'STRENGTH')
 const ownerEntries = sources.entries.filter(e => e.athleteId === athleteId && e.actual && knownAsOf(e.actual.at, asOf) && e.date <= day)
 const actualEntries = ownerEntries.filter(e => ownerEntries.filter(p => p.id === e.id).length === 1 && !e.actual!.occurrenceIds?.length)
 const observedWeeks = Array.from({ length: 6 }, (_, index) => {
  const end = addDays(day, -index * 7), start = addDays(end, -6)
  const rows = actuals.filter(f => { const d = dateOf(f.startedAt, timeZone); return d >= start && d <= end })
  const manual = actualEntries.filter(e => e.date >= start && e.date <= end && e.actual!.outcome !== 'missed')
  const runRows = rows.filter(f => f.modality === 'RUN'), manualRun = manual.filter(e => e.modality === 'run' && e.trainingType !== 'mixed')
  const count = new Set(rows.map(f => f.occurrenceId)).size + manual.length
  const seconds = sum([...rows.map(f => f.actualDurationSeconds), ...manual.map(e => e.actual!.minutes === null ? null : e.actual!.minutes * 60)])
  const runSeconds = sum([...runRows.map(f => f.actualDurationSeconds), ...manualRun.map(e => e.actual!.minutes === null ? null : e.actual!.minutes * 60)])
  return { start, end, coverage: 'RECORDED_ONLY' as const, observedSessions: count || null, observedRunSessions: new Set(runRows.map(f => f.occurrenceId)).size + manualRun.length || null, minutes: seconds === null ? null : seconds / 60, runSeconds, runDistanceM: sum([...runRows.map(f => sum(f.runSegments.filter(s => s.completion === 'COMPLETED').map(s => s.distanceM))), ...manualRun.map(e => e.actual!.km == null ? null : e.actual!.km * 1000)]), units: { minutes: 'min', runSeconds: 's', runDistanceM: 'm', observedSessions: 'sessions' }, refs: [...rows.map(f => factProvenance(f, 's')), ...manual.map(e => provenance('SCHEDULE_ACTUAL', analysisDigest(e), e.actual!.at, 'min', 'ACTUAL'))] }
 })
 const windowStart = new Date(Date.parse(asOf) - 7 * 86400000).toISOString()
 const timedWindowRuns = running.filter(f => Date.parse(f.startedAt) >= Date.parse(windowStart) && knownAsOf(f.startedAt, asOf) && (!f.endedAt || knownAsOf(f.endedAt, asOf)))
 const input = adaptTrainingModelInput(projected, recovery, { profile, sessions, window: { startAt: windowStart, endAt: asOf, complete: false, totalRunSeconds: sum(timedWindowRuns.map(f => f.actualDurationSeconds)), totalSessions: new Set(timedWindowRuns.map(f => f.occurrenceId)).size || null, basis: 'TIME_IN_ZONE' } })
 const physiology = assessPhysiology(input)
 const metrics = projected.facts.filter((f): f is MetricFact => f.kind === 'METRIC')
 const responses = projected.facts.filter((f): f is ResponseFact => f.kind === 'RESPONSE')
 const sleep = metrics.filter(f => /SLEEP/i.test(f.metric)), hrv = metrics.filter(f => /HRV|RMSSD|SDNN/i.test(f.metric)), rhr = metrics.filter(f => /RHR|RESTING_HEART_RATE/i.test(f.metric))
 const groupsMap = new Map<string, MetricFact[]>()
 for (const f of [...sleep, ...hrv, ...rhr]) { const key = JSON.stringify([sourceScope(f), f.metric, f.unit, f.statistic]); groupsMap.set(key, [...groupsMap.get(key) ?? [], f]) }
 const groups = [...groupsMap].map(([key, facts]) => ({ key, metric: facts[0].metric, unit: facts[0].unit, provider: facts[0].provider, accountRef: facts[0].accountRef, deviceId: facts[0].deviceId, protocolKey: facts[0].protocolKey, facts, refs: facts.map(f => factProvenance(f, f.unit)) }))
 const currentMetrics = (key: string, rows: MetricFact[], unit: string) => {
  const today = rows.filter(f => (f.providerDate ?? dateOf(f.occurredAt, timeZone)) === day && f.value !== null)
  const scopes = unique(today.map(f => JSON.stringify([sourceScope(f), f.unit, f.metric, f.statistic])))
  const latest = [...today].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]
  return field(key, scopes.length === 1 ? latest!.value : null, scopes.length === 1 ? latest!.unit : unit, today.map(f => factProvenance(f, f.unit)), scopes.length > 1 ? '多个设备、指标或协议，保留独立来源，未选定当前标量' : '当日测量未知；历史值不补作今日值', scopes.length > 1 ? 'CONFLICT' : latest ? 'AVAILABLE' : 'UNKNOWN')
 }
 currentMetrics('sleep', sleep, 'h'); currentMetrics('hrv', hrv, 'ms'); currentMetrics('rhr', rhr, 'bpm')
 for (const measure of ['SUBJECTIVE_FATIGUE', 'PAIN', 'FUNCTION', 'SORENESS', 'RECOVERY_FEELING'] as const) {
  const current = responses.filter(f => f.measure === measure && dateOf(f.occurredAt, timeZone) === day && f.value !== null)
  field(measure, current.length ? current.map(f => ({ value: f.value, scale: f.scale, region: f.region, side: f.side, protocol: f.observationProtocol, ref: refOf(f) })) : null, 'source-specific scale', current.map(f => factProvenance(f, f.scale)))
 }
 const selfReportedPBs = usableMarks.flatMap(m => {
  const seconds = clockSeconds(m.recent)
  if (seconds === null) return []
  return [{ meters: m.meters, seconds: field(`profilePB:${m.meters}`, seconds, 's', [{ ...provenance('ATHLETE_PROFILE_PB', analysisDigest([m, marksAt]), marksAt, 's', 'SELF_REPORT'), at: null }], '档案自报成绩；测试日期、最大努力及协议未核验'), maximalVerified: false as const, testProtocol: null, measuredAt: null }]
 })
 const foods = sources.foods.filter(f => f.athleteId === athleteId && validFoodEntry(f) && f.date === day && knownAsOf(f.recordedAt, asOf) && (!f.eatenAt || knownAsOf(f.eatenAt, asOf)))
 const agg = aggregate(foods)
 const nutrients = Object.fromEntries((['kcal', 'protein', 'carb', 'fat', 'fiber'] as NutrientKey[]).map(k => [k, field(`nutrition:${k}`, agg[k].known ? agg[k].sum : null, k === 'kcal' ? 'kcal' : 'g', foods.map(f => provenance('FOOD_LOG', f.revisionId ?? analysisDigest(f), f.recordedAt!, k === 'kcal' ? 'kcal' : 'g', 'SELF_REPORT')), agg[k].pending ? `${agg[k].pending}条营养素未知，仅合计已知部分` : '仅记录中的合计，全天完整度未确认')])) as Record<NutrientKey, ScientificField<number>>
 const conflicts = unique([...projected.conflicts.map(c => c.reason), ...sources.issues ?? [], ...sources.training.conflicts, ...sources.effective.conflicts.map(c => `${c.field}来源不一致，保留所选来源与冲突`), ...Object.entries(fields).filter(([, f]) => f.state === 'CONFLICT').map(([name]) => `${name}设备或协议待选源`)])
 for (const c of sources.effective.conflicts) { const item = fields[c.field === 'goal' ? 'primaryGoal' : c.field]; if (item) { item.state = 'CONFLICT'; item.reason = '来源值不一致；有效资料所选值保留，需核对' } }
 const history = assessAthleteHistory(projected)
 const missing = unique([
  ...(!eventMeters.value ? ['目标项目尚未明确'] : []), ...(!phase.value ? ['当前训练阶段未知'] : []), ...(!experience.value ? ['训练经历尚未确认'] : []),
  ...(!input.performances.length ? ['缺可核验最大努力比赛或测试；档案PB不作最大能力证据'] : []),
  ...(!physiology.thresholds.speed && !physiology.thresholds.heartRate ? ['缺同次、同设备与同协议LT/VT测试配对'] : []),
  ...(!actuals.length && !actualEntries.length ? ['近期实际训练明细未知'] : []),
  ...(!strength.length ? ['力量实际完成组、RPE/RIR未知'] : []),
  ...(!days.value ? ['具体可训练星期未知'] : []), ...(!minutes.value ? ['单次可用时间未知'] : []),
  '双练可用性与双阈值经验尚未明确', '全天饮食完整度未确认，不计算能量缺口',
  ...projected.gaps, ...conflicts,
 ])
 const followups = unique([
  ...(!fields.PAIN.value || !fields.FUNCTION.value ? ['今天是否有疼痛，相关动作或日常功能是否受限？'] : []),
  ...(!eventMeters.value ? ['当前主要训练项目是什么？'] : []),
  ...(sessions.some(s => s.purpose === 'THRESHOLD') && !physiology.thresholds.speed && !physiology.thresholds.heartRate ? ['是否已有可核验的LT/VT报告，包含测试日期、设备、方法与结果？'] : []),
  ...(!phase.value ? ['当前训练处于哪个阶段？'] : []),
  ...(!days.value || !minutes.value ? ['目前可训练哪些天，每次可用多少分钟？'] : []),
 ]).slice(0, 2)
 const scientificInput = {
  schema: 'FK_SCIENTIFIC_INPUT_1' as const, athleteId, asOf, day,
  version: analysisDigest([snapshot.inputDigest, projected.inputDigest, projected.excluded, projected.conflicts, sources.version, options, fields, observedWeeks, foods]), fields,
  goals: { eventMeters, raceDate, targetSeconds, phase, experience, primaryGoal },
  running: { actuals: running, verifiedMaximal: input.performances, selfReportedPBs, observedWeeks, history, tolerance: 'NOT_ESTABLISHED' as const, intensity: running.map(f => ({ ref: refOf(f), sessionRpe: f.sessionRpe, scale: f.sessionRpeScale, observedType: f.observedType, observedTypeBasis: f.observedTypeBasis })) },
  physiology: { ...physiology, thresholdRecords: input.thresholds },
  strength: { actuals: strength, recordedCompletedSets: strength.length ? strength.reduce((n, f) => n + f.strengthSets.filter(s => s.completion === 'COMPLETED').length, 0) : null },
  health: { sleep, hrv, rhr, responses, groups, restrictions: structuredClone(snapshot.safetyConstraints), profileRestrictions: sources.training.restrictions },
  availability: { days, daysPerWeek, minutes, twoSessionsAvailable },
  nutrition: { entries: foods, recordCount: foods.length, loggedKcal: nutrients.kcal.value, nutrients, dayComplete: false as const, energyDeficitKcal: null, weightKg, targetKg, goal: primaryGoal },
  manualActuals: actualEntries, missing, followups, conflicts,
  provenance: projected.facts.map(f => factProvenance(f, f.kind === 'METRIC' ? f.unit : f.kind === 'RESPONSE' ? f.scale : 'source-specific actual units')),
  excluded: projected.excluded,
 }
 return { ...input, scientificInput }
}
export type ScientificInput = ReturnType<typeof adaptScientificTrainingInput>['scientificInput']
