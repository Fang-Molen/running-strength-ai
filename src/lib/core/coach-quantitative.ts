import { calculateSessionLoad } from './coach-session-load.ts'
import { calculateEwmaSeries, shiftLoadDay, validLoadDay } from './coach-load-metrics.ts'
import { daysBetweenCalendarDates } from './coach-cognition-tools.ts'
import { fitDistanceTime, median, relativeChange, sampleStatistics, splitArithmetic } from './coach-quantitative-math.ts'

export const QUANTITATIVE_VERSION = 'FK-R173-ARITHMETIC-1' as const
export type QuantDatum = {
  id: string
  athleteId: string
  value: number | null
  unit: string
  sourceIds: readonly string[]
  revision: string | null
  kind: 'ACTUAL' | 'SELF_REPORT' | 'PLAN' | 'ESTIMATE'
  at: string
  recordedAt: string
  /** Includes device, method, task and relevant environmental/scale conditions. */
  protocol: string | null
  distanceMeters?: number | null
  speedMetersPerSecond?: number | null
  tags?: readonly string[]
  structure?: { sessionId: string; componentId: string; blockId: string; stepId: string; round: number; ordinal: number }
}
export type QuantWindow = { startDay: string; endDay: string; complete: boolean; sourceIds: readonly string[] }
export type QuantInput = {
  athleteId: string
  asOf: string
  values?: Readonly<Record<string, QuantDatum | null | undefined>>
  series?: readonly QuantDatum[]
  window?: QuantWindow
  referenceWindow?: QuantWindow
  /** Explicit attestations supplied by the fact adapter, not inferred from numbers. */
  conditions?: readonly string[]
  conditionSourceIds?: readonly string[]
  metricUnit?: string
  requiredFields?: readonly string[]
  fieldAvailability?: Readonly<Record<string, boolean | null>>
}
export type QuantResult = {
  ruleId: string
  version: typeof QUANTITATIVE_VERSION
  status: 'AVAILABLE' | 'UNAVAILABLE'
  value: number | null
  unit: string
  metrics: Record<string, number | null>
  series: readonly { id: string; value: number | null; unit: string; structure?: QuantDatum['structure'] }[]
  sourceRefs: { id: string; revision: string | null; kind: string }[]
  validSamples: number
  missing: string[]
  formula: string
  limitations: string[]
  estimate: boolean
  decisionAuthorized: false
  planWrite: false
  medicalClearance: false
}
type Definition = { operation: string; formula: string; unit: string; fields?: readonly string[]; needs?: readonly string[]; estimate?: boolean }
const define = (operation: string, formula: string, unit: string, fields: readonly string[] = [], needs: readonly string[] = [], estimate = false): Definition => ({ operation, formula, unit, fields, needs, estimate })
const percent = (needs: readonly string[] = []) => define('percent', '100*(current-reference)/reference', '%', ['current', 'reference'], needs)
const difference = (unit: string, needs: readonly string[] = []) => define('difference', 'current-reference', unit, ['current', 'reference'], needs)
const interval = (unit: string, needs: readonly string[] = []) => define('interval', unit === 's' ? '(end-start)/1000' : unit === 'min' ? '(end-start)/60000' : unit === 'h' ? '(end-start)/3600000' : unit === 'week' ? 'calendar_days(end-start)/7' : 'calendar_days(end-start)', unit, ['start', 'end'], needs)

/** Explicitly coded adapters. Workbook text is never evaluated as code or a training threshold. */
export const quantitativeDefinitions = {
  LOAD_SRPE: define('srpe', 'actual_total_minutes*actual_session_rpe', 'AU', ['minutes', 'rpe'], ['WHOLE_SESSION']),
  LOAD_WEEK_CHANGE: percent(['COMPLETE_WEEK_WINDOWS']),
  LOAD_RAMP_NOVICE: percent(['COMPLETE_WEEK_WINDOWS']),
  LOAD_RAMP_EXP: percent(['COMPLETE_WEEK_WINDOWS']),
  AGE_YOUTH: percent(['COMPLETE_WEEK_WINDOWS']),
  TISSUE_HSR: percent(['COMPLETE_WEEK_WINDOWS', 'HSR_DEFINITION_CONFIRMED']),
  RTR_VOLUME: percent(['COMPLETE_WEEK_WINDOWS', 'CLINICAL_PERMISSION']),
  TA_PROGRESS: percent(['COMPLETE_YEAR_WINDOWS']),
  PER_TAPER_VOL: percent(['COMPARABLE_REFERENCE_PERIODS', 'DECLARED_TAPER']),
  FAT_PERF_DROP: percent(['COMPARABLE_HISTORY', 'DIRECTION_DEFINED']),
  ABIL_PROFILE_UPDATE: percent(['SAME_METRIC_MODEL_VERSION']),
  FORM_CADENCE: percent(['MATCHED_SPEED_GRADE_DEVICE']),
  FORM_CADENCE_CHANGE: percent(['MATCHED_SPEED_GRADE_DEVICE', 'COMPARABLE_REFERENCE_PERIODS']),
  FORM_VO: percent(['MATCHED_SPEED_GRADE_DEVICE']),
  STR_PROGRESS: percent(['SAME_EXERCISE_ROM_EQUIPMENT']),
  SPR_BLOCK_30: percent(['SAME_30M_TIMING_PROTOCOL', 'CONFIRMED_PB']),
  LOAD_MONOTONY: define('monotony', 'mean(7 daily AU)/sample_sd(7 daily AU)', 'ratio'),
  LOAD_STRAIN: define('strain', 'sum(7 daily AU)*monotony', 'AU'),
  LOAD_ACWR: define('ewma28', 'EWMA7/EWMA28; alpha=2/(N+1); seed=first known day; coupled', 'ratio'),
  LOAD_ATL_CTL: define('ewma42', 'ATL=EWMA7; CTL=EWMA42; TSB=CTL_previous-ATL_previous', 'AU'),
  LOAD_TSB: define('tsb', '100*(CTL_previous-ATL_previous)/CTL_previous', '%'),
  LOAD_TSB_RACE: define('tsb', '100*(CTL_previous-ATL_previous)/CTL_previous', '%', [], ['RACE_DAY']),
  LOAD_SPIKE_SESSION: define('spike', 'current_distance/max(prior_30_calendar_days_distances)', 'ratio', ['current']),
  LOAD_RECOVERY_WEEK: define('increasingWeeks', 'count trailing consecutive complete weekly increases', 'week'),
  SESS_CV: define('splitCv', '100*sample_sd(equal_distance_seconds)/mean(seconds)', '%', [], ['UNIFORM_TASK', 'ALL_SEGMENTS_COMPLETED']),
  SESS_FADE: define('splitFade', '100*(last_time-first_time)/first_time', '%', [], ['ALL_SEGMENTS_COMPLETED']),
  SESS_TARGET_HIT: define('target', '100*(actual_seconds-planned_seconds)/planned_seconds', '%', ['current', 'reference']),
  SESS_HR_RECOVERY: define('hrRecovery', 'HR_finish-HR_60seconds', 'bpm', ['finish', 'after60']),
  SESS_RPE_CHECK: define('plannedDifference', 'actual_session_RPE-planned_session_RPE', '/10', ['current', 'reference'], ['WHOLE_SESSION']),
  LOAD_RPE_MISMATCH: define('plannedDifference', 'actual_session_RPE-planned_session_RPE', '/10', ['current', 'reference'], ['WHOLE_SESSION']),
  STR_RIR: define('plannedDifference', 'actual_RIR-planned_RIR', 'reps', ['current', 'reference'], ['SAME_EXERCISE_ROM_EQUIPMENT']),
  TEST_TIMING: difference('s', ['SAME_START_TRIGGER_DEVICE_DISTANCE']),
  SPR_200_SPLIT: define('raceSplit', 'second200-first200', 's', ['current', 'reference'], ['SAME_400M_RACE']),
  SPR_400_FIRST200: difference('s', ['FIRST200_OF_400_VS_CONFIRMED_PB200']),
  STR_VL: define('velocityLoss', '100*(first_valid_velocity-last_valid_velocity)/first_valid_velocity', '%', ['current', 'reference'], ['SAME_SET_EXERCISE_DEVICE']),
  SPR_DROP_STOP: define('bestInSession', '100*(current_equal_distance_time-best_valid_time)/best_valid_time', '%', ['current']),
  FAT_RHR: define('baselineMedian', 'today_rhr-median(valid personal baseline)', 'bpm', ['current'], ['BASELINE_VALID']),
  FAT_HR_AT_PACE: define('baselineMedian', 'HR_today-median(HR_at_matched_pace_baseline)', 'bpm', ['current'], ['MATCHED_SPEED_GRADE_DEVICE', 'BASELINE_VALID']),
  FAT_HRV: define('hrv', 'ln(today_RMSSD)-mean(ln(baseline_RMSSD))', 'ln(ms)', ['current'], ['BASELINE_VALID']),
  FAT_HRV_GUIDED: define('hrv', 'ln(today_RMSSD)-mean(ln(baseline_RMSSD))', 'ln(ms)', ['current'], ['BASELINE_VALID']),
  FAT_HRV_CV: define('hrvCv', '100*sample_sd(lnRMSSD_7d)/mean(lnRMSSD_7d)', '%'),
  FAT_MOOD_DROP: define('zscore', '(current-mean(baseline))/sample_sd(baseline)', 'z', ['current'], ['SAME_SCALE', 'BASELINE_VALID']),
  FAT_HOOPER: define('hooper', 'sum(named valid Hooper items); per-item current-baseline', 'score', ['scaleMin', 'scaleMax'], ['SAME_SCALE', 'COMPLETE_ITEM_SET']),
  FAT_DECOUPLING: define('decoupling', '100*((HR_late/speed_late)/(HR_early/speed_early)-1)', '%', ['hrEarly', 'hrLate', 'speedEarly', 'speedLate'], ['MATCHED_EARLY_LATE_WINDOWS']),
  ABIL_HRMAX: define('hrmax', '208-0.7*age_years', 'bpm', ['age'], [], true),
  AGE_HRMAX_40: define('hrmax', '208-0.7*age_years', 'bpm', ['age'], [], true),
  ABIL_CS: define('cs', 'distance=CS*time+Dprime; ordinary least squares', 'm/s', [], ['MAXIMAL_TESTS', 'SAME_TEST_PROTOCOL'], true),
  ABIL_ASR: define('asr', 'measured_MSS-measured_vVO2max', 'm/s', ['mss', 'vvo2max'], ['MEASURED_MSS', 'MEASURED_VVO2MAX'], true),
  ABIL_HR_ZONES: define('heartZone', 'HR<measured_LT1:Z1; LT1<=HR<=LT2:Z2; HR>LT2:Z3', 'zone', ['current', 'lt1', 'lt2'], ['MEASURED_LT1_LT2_SAME_PROTOCOL']),
  STR_E1RM: define('epley', 'load_kg*(1+reps/30)', 'kg', ['kg', 'reps'], ['SAME_EXERCISE_ROM_EQUIPMENT', 'DYNAMIC_EXERCISE'], true),
  FORM_GCT_ASYM: define('asymmetry', '100*abs(left-right)/((left+right)/2)', '%', ['left', 'right'], ['SAME_SENSOR_SPEED_GRADE']),
  REC_SLEEP: define('sleep', 'actual_sleep_minutes/60', 'h', ['minutes']),
  REC_TRAVEL_SLEEP: define('sleep', 'actual_sleep_minutes/60', 'h', ['minutes']),
  REC_SLEEP_DEBT: define('sleepDebt', 'sum(max(0,individual_need_hours-sleep_hours_day)) over 7 days', 'h', ['needHours'], ['INDIVIDUAL_SLEEP_NEED_KNOWN']),
  REC_LIFE_STRESS: difference('score', ['SAME_SCALE']),
  REC_HARD_GAP: interval('h', ['CONFIRMED_HARD_SESSION_END_AND_START']),
  REC_HARD_GAP_SPRINT: interval('h', ['CONFIRMED_SPEED_SESSION_END_AND_START']),
  AGE_MASTERS: interval('h', ['CONFIRMED_HARD_SESSION_END_AND_START']),
  STR_CONCURRENT_GAP: interval('h', ['CONFIRMED_RUN_STRENGTH_END_AND_START']),
  SPR_LACTATE_REST: interval('min', ['SAME_SESSION_REPETITION_END_AND_START']),
  SPR_REST_ACCEL: interval('s', ['SAME_SESSION_REPETITION_END_AND_START']),
  PER_TAPER_LEN: interval('day', ['DECLARED_TAPER_START_AND_RACE']),
  PER_TAPER_SPRINT: interval('day', ['DECLARED_TAPER_START_AND_RACE']),
  PER_TRANSITION: interval('week', ['DECLARED_TRANSITION']),
  PER_COMPETE_SPACE: interval('day', ['CONFIRMED_RACE_DATES']),
  TEST_RETEST: interval('week', ['SAME_TEST_PROTOCOL']),
  SEX_MC_IRREG: interval('day', ['REPORTED_MENSTRUAL_ONSETS']),
  STR_PEAK_REST: interval('day', ['CONFIRMED_HEAVY_SESSION_AND_RACE']),
  REC_JETLAG: define('offset', 'abs(destination_UTC_offset-origin_UTC_offset)', 'h', ['origin', 'destination']),
  REC_TRAVEL: define('offset', 'abs(destination_UTC_offset-origin_UTC_offset)', 'h', ['origin', 'destination']),
  PER_DIST_BASE: define('zoneShare', '100*verified_Z1_minutes/total_classified_minutes', '%', ['part', 'total'], ['MEASURED_ZONE_DEFINITION', 'COMPLETE_CLASSIFIED_WINDOW']),
  PER_DIST_SPEC: define('zoneShare', '100*verified_high_zone_minutes/total_classified_minutes', '%', ['part', 'total'], ['MEASURED_ZONE_DEFINITION', 'COMPLETE_CLASSIFIED_WINDOW']),
  REC_HARD_PER_WEEK: define('countHard', 'count distinct verified hard sessions in complete 7 days', 'session', [], ['SESSION_CLASSIFICATION_CONFIRMED']),
  STR_FREQ_PERIOD: define('countStrength', 'count distinct strength sessions in complete 7 days', 'session', [], ['SESSION_CLASSIFICATION_CONFIRMED']),
  TA_NOVICE: define('countRun', 'count distinct running sessions and hard sessions in complete 7 days', 'session', [], ['SESSION_CLASSIFICATION_CONFIRMED']),
  REC_REST_DAY: define('restDays', 'count explicit qualifying rest days in complete 14 days', 'day', [], ['REST_DEFINITION_KNOWN']),
  PER_DETRAIN: define('noExposureDays', 'count trailing complete days without explicitly defined relevant exposure', 'day', [], ['RELEVANT_EXPOSURE_DEFINITION']),
  STR_HARD_SAME_DAY: define('sameDay', 'same declared local calendar day(hard_run,heavy_strength)', 'boolean', ['current', 'reference'], ['HARD_RUN_AND_HEAVY_STRENGTH', 'LOCAL_DAY_CONFIRMED']),
  STR_PLYO_CONTACTS: define('sumContacts', 'sum(actual landing contacts)', 'contacts', [], ['ACTUAL_CONTACTS_COUNTED']),
  FORM_ONE_CHANGE: define('countCues', 'count distinct simultaneously selected technical cues', 'count', [], ['SIMULTANEOUS_CUES']),
  FORM_SELFCHECK: define('countFeatures', 'count explicitly observed features; not a diagnosis', 'count', [], ['DEFINED_FEATURE_SET']),
  SPR_MAXV_FREQ: define('speedFrequency', 'count distinct sessions containing reps in explicit measured speed band', 'session', ['lowerFraction', 'mss'], ['EXPLICIT_SPEED_BAND', 'VERIFIED_REP_SPEEDS']),
  SPR_MAXV_VOL: define('speedDistance', 'sum verified rep distance in explicit measured speed band', 'm', ['lowerFraction', 'mss'], ['EXPLICIT_SPEED_BAND', 'VERIFIED_REP_SPEEDS']),
  SPR_SPEEDEND_VOL: define('speedDistance', 'sum verified rep distance in explicit measured speed band', 'm', ['lowerFraction', 'upperFraction', 'mss'], ['EXPLICIT_SPEED_BAND', 'VERIFIED_REP_SPEEDS']),
  SPR_WARMUP: define('warmup', 'actual warmup minutes; count distinct progressive sprint records', 'min', ['minutes'], ['WARMUP_SCOPE']),
  READY_MISSING: define('coverage', 'count(valid required fields)/count(required fields)', 'ratio', [], ['QUESTION_REQUIRED_FIELDS']),
  REC_ALCOHOL: define('reported', 'reported standard drinks (standard grams explicitly recorded)', 'standard_drink', ['current', 'gramsPerDrink']),
  SEX_MC_FEEL: define('reported', 'reported NRS with function; not a training clearance', '/10', ['current'], ['FUNCTION_RECORDED']),
  SPR_BLOCK_RT: define('reported', 'official measured reaction time', 's', ['current'], ['OFFICIAL_REACTION_TIME']),
  SEX_EA: define('energyAvailability', '(same_day_intake-same_day_exercise_energy)/FFM', 'kcal/kg FFM/day', ['intake', 'exerciseEnergy', 'ffm'], ['SAME_ENERGY_DAY', 'PROFESSIONAL_REVIEW'], true),
  RTR_SPEED: define('exposure', '100*actual_speed/reference_speed; not clearance', '%', ['current', 'reference'], ['CLINICAL_PERMISSION', 'SYMPTOMS_AND_NEXT_DAY_REVIEW']),
  TEST_SWC: define('measurementChange', 'observed change; MDC95=1.96*sqrt(2)*SEM only with justified error model; SWC separate', 'input', ['current', 'reference', 'pairedCount'], ['SAME_TEST_PROTOCOL', 'PAIRED_MEASUREMENTS']),
} as const satisfies Record<string, Definition>
export type QuantRuleId = keyof typeof quantitativeDefinitions

class Unavailable extends Error {}
function stop(reason: string): never { throw new Unavailable(reason) }
const iso = (value: string) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && validLoadDay(value.slice(0, 10)) && Number.isFinite(Date.parse(value))
const positive = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
const calendarDay = (value: string) => value.slice(0, 10)

/** No storage, network, clock reads, candidate decisions or plan mutations. */
export function calculateQuantitativeRule(ruleId: string, input: QuantInput): QuantResult {
  const definition: Definition | undefined = Object.hasOwn(quantitativeDefinitions, ruleId)
    ? quantitativeDefinitions[ruleId as QuantRuleId] : undefined
  const result: QuantResult = { ruleId, version: QUANTITATIVE_VERSION, status: 'UNAVAILABLE', value: null,
    unit: definition?.unit ?? '', metrics: {}, series: [], sourceRefs: [], validSamples: 0, missing: [],
    formula: definition?.formula ?? '', limitations: ['描述性计算不授权调整训练，不代表病因、医学许可或长期能力改变。'],
    estimate: definition?.estimate ?? false, decisionAuthorized: false, planWrite: false, medicalClearance: false }
  if (!definition) return { ...result, missing: ['RULE_NOT_IMPLEMENTED'] }
  try {
    if (!input || !input.athleteId || !iso(input.asOf)) stop('ATHLETE_AND_ASOF_REQUIRED')
    const receipts = (ids: readonly string[] | undefined, kind = 'CONTEXT', revision: string | null = null) => {
      if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id.trim())) stop('SOURCE_REQUIRED')
      for (const id of ids) if (!result.sourceRefs.some(r => r.id === id && r.revision === revision && r.kind === kind)) result.sourceRefs.push({ id, revision, kind })
    }
    const requireCondition = (condition: string) => {
      if (!input.conditions?.includes(condition)) stop('CONDITION_REQUIRED:' + condition)
      receipts(input.conditionSourceIds)
    }
    for (const condition of definition.needs ?? []) requireCondition(condition)
    for (const field of definition.fields ?? []) if (!input.values?.[field]) stop('FIELD_MISSING:' + field)
    const consumed = new Set<string>()
    const datum = (d: QuantDatum | null | undefined, unit: string, allowPlan = false, minimum = 0, maximum = Infinity): number => {
      if (!d) stop('VALUE_MISSING')
      if (!d.id || d.athleteId !== input.athleteId || !iso(d.at) || !iso(d.recordedAt) || Date.parse(d.recordedAt) > Date.parse(input.asOf)) stop('PROVENANCE_OR_TIME_INVALID')
      if (!['ACTUAL', 'SELF_REPORT', 'PLAN', 'ESTIMATE'].includes(d.kind) || d.kind === 'PLAN' && !allowPlan) stop('PLAN_OR_INVALID_SOURCE_NOT_ACTUAL')
      if (d.kind === 'ESTIMATE' && !['SEX_EA', 'ABIL_PROFILE_UPDATE'].includes(ruleId)) stop('ESTIMATED_INPUT_NOT_MEASURED_FACT')
      if (d.kind !== 'PLAN' && Date.parse(d.at) > Date.parse(input.asOf)) stop('FUTURE_ACTUAL')
      if (d.kind !== 'PLAN' && Date.parse(d.recordedAt) < Date.parse(d.at)) stop('ACTUAL_RECORDED_BEFORE_EVENT')
      receipts(d.sourceIds, d.kind, d.revision)
      if (d.kind === 'ESTIMATE') result.estimate = true
      if (d.unit !== unit || d.value === null || !Number.isFinite(d.value) || d.value < minimum || d.value > maximum) stop(d.value === null ? 'VALUE_UNKNOWN:' + d.id : 'UNIT_OR_RANGE_INVALID:' + d.id)
      consumed.add(d.id)
      return d.value
    }
    const get = (key: string): QuantDatum => input.values?.[key] ?? stop('FIELD_MISSING:' + key)
    const read = (key: string, unit: string, allowPlan = false, minimum = 0, maximum = Infinity) => datum(get(key), unit, allowPlan, minimum, maximum)
    const sameProtocol = (rows: readonly QuantDatum[]) => {
      if (!rows.length || rows.some(d => !d.protocol || d.protocol === 'UNKNOWN') || new Set(rows.map(d => d.protocol)).size !== 1) stop('PROTOCOL_UNAVAILABLE_OR_DIFFERENT')
    }
    const window = (w: QuantWindow | undefined, days?: number) => {
      if (!w || !validLoadDay(w.startDay) || !validLoadDay(w.endDay) || !w.complete) stop('COMPLETE_WINDOW_REQUIRED')
      const length = daysBetweenCalendarDates(w.startDay, w.endDay)!
      if (length < 0 || days !== undefined && length + 1 !== days || w.endDay > calendarDay(input.asOf)) stop('WINDOW_INVALID')
      receipts(w.sourceIds, 'WINDOW_COMPLETENESS')
      return w
    }
    const rows = (unit: string, minimum = 0, maximum = Infinity): QuantDatum[] => {
      if (!Array.isArray(input.series) || !input.series.length) stop('SERIES_REQUIRED')
      if (new Set(input.series.map(d => d.id)).size !== input.series.length) stop('DUPLICATE_OBSERVATION_ID')
      for (const d of input.series) datum(d, unit, false, minimum, maximum)
      result.validSamples = input.series.length
      return [...input.series]
    }
    const daily = (unit: string, count: number, minimum = 0, maximum = Infinity) => {
      const w = window(input.window, count), ds = rows(unit, minimum, maximum).sort((a, b) => a.at.localeCompare(b.at))
      sameProtocol(ds)
      if (ds.length !== count || ds.some((d, i) => calendarDay(d.at) !== shiftLoadDay(w.startDay, i))) stop('DAILY_DATA_INCOMPLETE_OR_DUPLICATED')
      return ds.map(d => d.value!)
    }
    const pair = (unit: string, allowPlan = false, minimum = 0) => {
      const a = read('current', unit, false, minimum), b = read('reference', unit, allowPlan, minimum)
      sameProtocol([get('current'), get('reference')])
      result.validSamples = 2
      return [a, b] as const
    }
    const baseline = (unit: string, minimum: number, minimumSamples: number) => {
      const w = window(input.window), ds = rows(unit, minimum), current = get('current')
      sameProtocol([current, ...ds])
      if (ds.length < minimumSamples || new Set(ds.map(d => calendarDay(d.at))).size < minimumSamples ||
          ds.some(d => d.id === current.id || Date.parse(d.at) >= Date.parse(current.at) || calendarDay(d.at) < w.startDay || calendarDay(d.at) > w.endDay)) stop('BASELINE_INSUFFICIENT_OR_NOT_PRIOR')
      return ds.map(d => d.value!)
    }
    const nonzero = (value: number) => value > 0 ? value : stop('ZERO_OR_NEGATIVE_DENOMINATOR')
    const metricUnit = () => input.metricUnit?.trim() || stop('METRIC_UNIT_REQUIRED')
    const structuredSplits = () => {
      const ds = rows('s', Number.MIN_VALUE).sort((a, b) => (a.structure?.ordinal ?? 0) - (b.structure?.ordinal ?? 0))
      sameProtocol(ds)
      const key = (d: QuantDatum) => d.structure ? JSON.stringify([d.structure.sessionId, d.structure.componentId, d.structure.blockId, d.structure.stepId, d.structure.round]) : null
      if (ds.length < 2 || ds.some(d => !positive(d.distanceMeters) || !d.structure || [d.structure.sessionId, d.structure.componentId, d.structure.blockId, d.structure.stepId].some(id => !id?.trim()) || !Number.isInteger(d.structure.ordinal) || d.structure.ordinal < 1 || !Number.isInteger(d.structure.round) || d.structure.round < 1) ||
          new Set(ds.map(d => d.distanceMeters)).size !== 1 || !key(ds[0]) || new Set(ds.map(key)).size !== 1 ||
          new Set(ds.map(d => d.structure!.ordinal)).size !== ds.length) stop('EQUAL_DISTANCE_SAME_ROUND_STRUCTURE_REQUIRED')
      result.series = ds.map(d => ({ id: d.id, value: d.value, unit: d.unit, structure: { ...d.structure! } }))
      return ds
    }
    let value: number | null = null
    switch (definition.operation) {
      case 'srpe': {
        const minutes = read('minutes', 'min', false, Number.MIN_VALUE, 1440), rpe = read('rpe', '/10', false, 0, 10)
        sameProtocol([get('minutes'), get('rpe')])
        const computed = calculateSessionLoad('', rpe, minutes * 60)
        if (computed.status !== 'CALCULATED') stop('SESSION_LOAD_UNAVAILABLE')
        value = computed.au; result.metrics = { minutes, rpe }
        result.limitations.push('复用现有单课负荷函数，AU结果保留两位小数。'); break
      }
      case 'percent': {
        const [a, b] = pair(metricUnit())
        const expectedUnits: Record<string, readonly string[]> = {
          LOAD_WEEK_CHANGE: ['m', 'km', 'min', 'AU'], LOAD_RAMP_NOVICE: ['m', 'km'], LOAD_RAMP_EXP: ['m', 'km', 'min', 'AU'],
          AGE_YOUTH: ['m', 'km', 'min', 'AU'], TA_PROGRESS: ['m', 'km', 'min', 'AU'], STR_PROGRESS: ['kg'], TISSUE_HSR: ['m', 'km'], RTR_VOLUME: ['m', 'km', 'min', 'AU'],
          SPR_BLOCK_30: ['s'], FORM_CADENCE: ['steps/min'], FORM_CADENCE_CHANGE: ['steps/min'],
        }
        if (expectedUnits[ruleId] && !expectedUnits[ruleId].includes(metricUnit())) stop('METRIC_UNIT_NOT_ALLOWED_FOR_RULE')
        if (definition.needs?.includes('COMPLETE_WEEK_WINDOWS') || definition.needs?.includes('COMPLETE_YEAR_WINDOWS') || definition.needs?.includes('COMPARABLE_REFERENCE_PERIODS')) {
          const days = definition.needs.includes('COMPLETE_WEEK_WINDOWS') ? 7 : undefined
          const current = window(input.window, days), previous = window(input.referenceWindow, days)
          if (previous.endDay >= current.startDay) stop('OVERLAPPING_COMPARISON_WINDOWS')
          const inWindow = (d: QuantDatum, w: QuantWindow) => calendarDay(d.at) >= w.startDay && calendarDay(d.at) <= w.endDay
          if (!inWindow(get('current'), current) || !inWindow(get('reference'), previous)) stop('AGGREGATE_NOT_BOUND_TO_WINDOW')
          if (definition.needs.includes('COMPLETE_YEAR_WINDOWS') && [current, previous].some(w => ![365, 366].includes(daysBetweenCalendarDates(w.startDay, w.endDay)! + 1))) stop('FULL_YEAR_WINDOWS_REQUIRED')
          if (days && shiftLoadDay(previous.endDay, 1) !== current.startDay) stop('ADJACENT_WEEK_WINDOWS_REQUIRED')
        }
        if (ruleId === 'SPR_BLOCK_30' && [get('current'), get('reference')].some(d => d.distanceMeters !== 30)) stop('30M_DISTANCE_REQUIRED')
        value = relativeChange(a, nonzero(b)); result.metrics = { current: a, reference: b, difference: a - b }; break
      }
      case 'difference': {
        const [a, b] = pair(definition.unit)
        if (Date.parse(get('reference').at) > Date.parse(get('current').at)) stop('REFERENCE_NOT_PRIOR')
        if (ruleId === 'TEST_TIMING' && (!positive(get('current').distanceMeters) || get('current').distanceMeters !== get('reference').distanceMeters)) stop('SAME_DISTANCE_REQUIRED')
        if (ruleId === 'SPR_400_FIRST200' && [get('current'), get('reference')].some(d => d.distanceMeters !== 200)) stop('200M_DISTANCE_REQUIRED')
        value = a - b; break
      }
      case 'plannedDifference': {
        const [a, b] = pair(definition.unit, true)
        if (get('reference').kind !== 'PLAN' || definition.unit === '/10' && (a > 10 || b > 10) || definition.unit === 'reps' && (!Number.isInteger(a) || !Number.isInteger(b))) stop('EXPLICIT_PLAN_OR_SCALE_REQUIRED')
        value = a - b; break
      }
      case 'monotony': case 'strain': {
        const numbers = daily('AU', 7), stats = sampleStatistics(numbers)!
        const monotony = stats.mean / nonzero(stats.sampleSd!), total = numbers.reduce((sum, n) => sum + n, 0)
        result.metrics = { mean: stats.mean, sampleSd: stats.sampleSd, weeklyAu: total, monotony }
        value = definition.operation === 'strain' ? total * monotony : monotony; break
      }
      case 'ewma28': case 'ewma42': case 'tsb': {
        const period = definition.operation === 'ewma28' ? 28 : 42, numbers = daily('AU', period)
        const acute = calculateEwmaSeries(numbers, 7)!, chronic = calculateEwmaSeries(numbers, period)!
        const previousAtl = acute[acute.length - 2], previousCtl = chronic[chronic.length - 2], tsb = previousCtl - previousAtl
        result.metrics = { atl: acute.at(-1)!, ctl: chronic.at(-1)!, previousAtl, previousCtl, tsb, acuteAlpha: 2 / 8, chronicAlpha: 2 / (period + 1), seed: numbers[0] }
        result.limitations.push('首个已确认日负荷初始化；不补窗前零；两个EWMA均包含本窗当前日，TSB只用前一日。')
        value = definition.operation === 'ewma28' ? acute.at(-1)! / nonzero(chronic.at(-1)!) : definition.operation === 'tsb' ? 100 * tsb / nonzero(previousCtl) : tsb; break
      }
      case 'splitCv': case 'splitFade': {
        const ds = structuredSplits(), numbers = ds.map(d => d.value!), stats = splitArithmetic(numbers)!
        if (ds.some((d, i) => d.structure!.ordinal !== i + 1)) stop('MISSING_OR_NONCONSECUTIVE_SPLIT')
        result.metrics = { meanSeconds: stats.mean, sampleSdSeconds: stats.sampleSd, cvPercent: stats.cvPercent, firstSeconds: stats.firstSeconds, lastSeconds: stats.lastSeconds, differenceSeconds: stats.differenceSeconds, speedDeclinePercent: stats.speedDeclinePercent }
        value = definition.operation === 'splitCv' ? stats.cvPercent : stats.timeChangePercent; break
      }
      case 'target': {
        const [a, b] = pair('s', true, Number.MIN_VALUE), actual = get('current'), planned = get('reference')
        if (planned.kind !== 'PLAN' || !positive(actual.distanceMeters) || actual.distanceMeters !== planned.distanceMeters || !actual.structure || JSON.stringify(actual.structure) !== JSON.stringify(planned.structure)) stop('SAME_PLANNED_AND_ACTUAL_SEGMENT_REQUIRED')
        value = relativeChange(a, b); result.metrics = { actualSeconds: a, plannedSeconds: b, differenceSeconds: a - b }; break
      }
      case 'raceSplit': {
        const [last, first] = pair('s', false, Number.MIN_VALUE), a = get('current'), b = get('reference')
        if (a.distanceMeters !== 200 || b.distanceMeters !== 200 || !a.structure?.sessionId || a.structure.sessionId !== b.structure?.sessionId || a.structure.ordinal !== 2 || b.structure?.ordinal !== 1) stop('SAME_RACE_ORDERED_200M_SPLITS_REQUIRED')
        value = last - first; break
      }
      case 'velocityLoss': {
        const [last, first] = pair('m/s', false, Number.MIN_VALUE)
        value = 100 * (first - last) / first; break
      }
      case 'bestInSession': {
        const ds = structuredSplits(), current = get('current'), seconds = read('current', 's', false, Number.MIN_VALUE)
        const matched = ds.find(d => d.id === current.id && d.value === current.value)
        if (!matched || matched.distanceMeters !== current.distanceMeters) stop('CURRENT_NOT_IN_SESSION')
        sameProtocol([current, ...ds])
        if (ds.some(d => d.structure!.ordinal > matched.structure!.ordinal || Date.parse(d.at) > Date.parse(current.at))) stop('COMPARISON_CONTAINS_LATER_REPS')
        const best = Math.min(...ds.map(d => d.value!)); value = relativeChange(seconds, best); result.metrics = { bestSeconds: best, currentSeconds: seconds }; break
      }
      case 'baselineMedian': {
        const current = read('current', 'bpm', false, Number.MIN_VALUE), history = baseline('bpm', Number.MIN_VALUE, 5), middle = median(history)!
        value = current - middle; result.metrics = { current, baselineMedian: middle, baselineSamples: history.length }; break
      }
      case 'hrv': {
        const current = read('current', 'ms', false, Number.MIN_VALUE), history = baseline('ms', Number.MIN_VALUE, 5)
        const mean = sampleStatistics(history.map(Math.log))!.mean
        value = Math.log(current) - mean; result.metrics = { currentLnRmssd: Math.log(current), baselineMeanLnRmssd: mean, baselineSamples: history.length }; break
      }
      case 'hrvCv': {
        const stats = sampleStatistics(daily('ms', 7, Number.MIN_VALUE).map(Math.log))!
        // Zero variability is a valid measured result. Only the denominator must be positive.
        value = 100 * stats.sampleSd! / nonzero(stats.mean)
        result.metrics = { meanLnRmssd: stats.mean, sampleSdLnRmssd: stats.sampleSd }; break
      }
      case 'zscore': {
        const current = read('current', metricUnit(), false, -Infinity), history = baseline(metricUnit(), -Infinity, 2), stats = sampleStatistics(history)!
        value = (current - stats.mean) / nonzero(stats.sampleSd!); result.metrics = { mean: stats.mean, sampleSd: stats.sampleSd }; break
      }
      case 'hooper': {
        const ds = rows('score'), names = input.requiredFields
        if (!names?.length || new Set(names).size !== names.length || ds.length !== names.length || names.some(name => !ds.some(d => d.tags?.includes(name))) || ds.some(d => d.tags?.filter(tag => names.includes(tag)).length !== 1)) stop('NAMED_HOOPER_ITEMS_REQUIRED')
        sameProtocol(ds)
        if (new Set(ds.map(d => calendarDay(d.at))).size !== 1) stop('HOOPER_ITEM_DAYS_DIFFER')
        const scaleMin = read('scaleMin', 'score'), scaleMax = read('scaleMax', 'score')
        if (scaleMax <= scaleMin || ds.some(d => d.value! < scaleMin || d.value! > scaleMax)) stop('HOOPER_SCALE_RANGE_INVALID')
        value = ds.reduce((sum, d) => sum + d.value!, 0)
        result.series = ds.map(d => {
          const name = names.find(n => d.tags?.includes(n))!, base = input.values?.[name]
          if (!base) { result.missing.push('HOOPER_BASELINE_UNKNOWN:' + name); return { id: name, value: null, unit: 'score_delta' } }
          sameProtocol([d, base]); if (Date.parse(base.at) >= Date.parse(d.at)) stop('HOOPER_BASELINE_NOT_PRIOR')
          return { id: name, value: d.value! - datum(base, 'score', false, scaleMin, scaleMax), unit: 'score_delta' }
        })
        result.limitations.push('缺少某项个人基线时该项变化为UNKNOWN；合计不是准备度评分。'); break
      }
      case 'decoupling': {
        const he = read('hrEarly', 'bpm', false, Number.MIN_VALUE), hl = read('hrLate', 'bpm', false, Number.MIN_VALUE)
        const se = read('speedEarly', 'm/s', false, Number.MIN_VALUE), sl = read('speedLate', 'm/s', false, Number.MIN_VALUE)
        sameProtocol(['hrEarly', 'hrLate', 'speedEarly', 'speedLate'].map(get))
        value = 100 * ((hl / sl) / (he / se) - 1); result.limitations.push('采用R173的HR/速度前后窗比，不与旧Pw:HR公式混用；不可用于诊断供能缺陷。'); break
      }
      case 'hrRecovery': {
        const finish = read('finish', 'bpm', false, Number.MIN_VALUE), after = read('after60', 'bpm', false, Number.MIN_VALUE)
        sameProtocol([get('finish'), get('after60')])
        if (Date.parse(get('after60').at) - Date.parse(get('finish').at) !== 60000) stop('EXACT_60_SECOND_PROTOCOL_REQUIRED')
        value = finish - after; break
      }
      case 'hrmax': value = 208 - 0.7 * read('age', 'year', false, 1, 110); result.limitations.push('群体估算，不是个人实测最大心率，不用于自动心率区间或急症排除。'); break
      case 'asr': value = read('mss', 'm/s', false, Number.MIN_VALUE) - read('vvo2max', 'm/s', false, Number.MIN_VALUE); if (value < 0 || get('mss').kind === 'ESTIMATE' || get('vvo2max').kind === 'ESTIMATE') stop('VALID_MEASURED_SPEEDS_REQUIRED'); result.limitations.push('不允许以400米均速替代vVO2max。'); break
      case 'heartZone': {
        const hr = read('current', 'bpm', false, Number.MIN_VALUE), lt1 = read('lt1', 'bpm', false, Number.MIN_VALUE), lt2 = read('lt2', 'bpm', false, Number.MIN_VALUE)
        sameProtocol(['current', 'lt1', 'lt2'].map(get))
        if (lt2 <= lt1 || ['lt1', 'lt2'].some(key => get(key).kind === 'ESTIMATE')) stop('ORDERED_MEASURED_THRESHOLDS_REQUIRED')
        value = hr < lt1 ? 1 : hr <= lt2 ? 2 : 3; result.limitations.push('仅将观测心率映射到明确实测分区；不从年龄公式估算LT1/LT2，不生成训练配方。'); break
      }
      case 'epley': {
        const kg = read('kg', 'kg', false, Number.MIN_VALUE), reps = read('reps', 'reps', false, 1, 10)
        if (!Number.isInteger(reps)) stop('INTEGER_REPS_REQUIRED'); sameProtocol([get('kg'), get('reps')]); value = kg * (1 + reps / 30)
        result.limitations.push('1—10次为R171工程适用筛选，非普适生理阈值；不替代实测1RM或预测跑步成绩。'); break
      }
      case 'cs': {
        const ds = rows('s', Number.MIN_VALUE); sameProtocol(ds)
        const fit = fitDistanceTime(ds.map(d => ({ seconds: d.value!, meters: d.distanceMeters ?? NaN })))
        if (!fit || fit.csMetersPerSecond <= 0) stop('VALID_DISTINCT_DURATION_MAXIMAL_TESTS_REQUIRED')
        value = fit.csMetersPerSecond; result.metrics = { dPrimeMeters: fit.dPrimeMeters, rSquared: fit.rSquared }
        result.series = ds.map((d, i) => ({ id: d.id, value: fit.residualsMeters[i], unit: 'm_residual' })); result.limitations.push('必须审阅拟合残差；D′为负提示模型适配问题；CS不是实测生理阈值。'); break
      }
      case 'asymmetry': {
        const left = read('left', 'ms', false, Number.MIN_VALUE), right = read('right', 'ms', false, Number.MIN_VALUE); sameProtocol([get('left'), get('right')]); value = 100 * Math.abs(left - right) / ((left + right) / 2); break
      }
      case 'sleep': value = read('minutes', 'min', false, 0, 1440) / 60; break
      case 'sleepDebt': { const need = read('needHours', 'h', false, Number.MIN_VALUE, 24); value = daily('h', 7, 0, 24).reduce((sum, hours) => sum + Math.max(0, need - hours), 0); result.limitations.push('使用有来源的个人睡眠需要，不默认所有人8小时；不把累积缺口诊断为恢复不足。'); break }
      case 'interval': {
        read('start', 'event', true, 1, 1); read('end', 'event', true, 1, 1)
        const start = get('start'), end = get('end'), millis = Date.parse(end.at) - Date.parse(start.at)
        if (millis < 0) stop('REVERSED_INTERVAL')
        const days = daysBetweenCalendarDates(calendarDay(start.at), calendarDay(end.at))!
        value = definition.unit === 's' ? millis / 1000 : definition.unit === 'min' ? millis / 60000 : definition.unit === 'h' ? millis / 3600000 : definition.unit === 'week' ? days / 7 : days
        result.limitations.push('日期间隔采用输入ISO时间的显式日历日期，不推定恢复充分或给定训练间隔。'); break
      }
      case 'offset': value = Math.abs(read('destination', 'UTC_offset_h', false, -12, 14) - read('origin', 'UTC_offset_h', false, -12, 14)); break
      case 'zoneShare': {
        const part = read('part', 'min'), total = read('total', 'min', false, Number.MIN_VALUE); sameProtocol([get('part'), get('total')]); window(input.window)
        if (part > total) stop('PART_EXCEEDS_CLASSIFIED_TOTAL'); value = 100 * part / total; result.limitations.push('分母只含已按明确实测分区定义分类的分钟，不代替整课时间；不反推训练阶段。'); break
      }
      case 'spike': {
        const current = read('current', 'm'), w = window(input.window, 30), ds = rows('m'); sameProtocol([get('current'), ...ds])
        if (w.endDay !== shiftLoadDay(calendarDay(get('current').at), -1) || ds.some(d => d.id === get('current').id || calendarDay(d.at) < w.startDay || calendarDay(d.at) > w.endDay)) stop('PRIOR_30_DAY_HISTORY_REQUIRED')
        const maximum = Math.max(...ds.map(d => d.value!)); value = current / nonzero(maximum); result.metrics = { currentMeters: current, priorMaximumMeters: maximum }; break
      }
      case 'increasingWeeks': {
        const ds = rows(metricUnit()).sort((a, b) => a.at.localeCompare(b.at)); sameProtocol(ds); const w = window(input.window, ds.length * 7)
        if (ds.length < 2 || ds.some((d, i) => calendarDay(d.at) !== shiftLoadDay(w.startDay, 6 + i * 7))) stop('CONSECUTIVE_COMPLETE_WEEKS_REQUIRED')
        value = 0; for (let i = ds.length - 1; i > 0 && ds[i].value! > ds[i - 1].value!; i--) value++
        result.limitations.push('计数为连续增加的相邻周转换次数，需要多一周参考；不决定何时安排恢复周。'); break
      }
      case 'countHard': case 'countStrength': case 'countRun': {
        if (!Array.isArray(input.series)) stop('EXPLICIT_SESSION_LIST_REQUIRED')
        const w = window(input.window, 7), ds = input.series?.length ? rows('session', 1, 1) : []
        if (ds.some(d => calendarDay(d.at) < w.startDay || calendarDay(d.at) > w.endDay || !d.structure?.sessionId || !d.tags?.length)) stop('BOUND_SESSION_CLASSIFICATION_REQUIRED')
        const count = (tag: string) => new Set(ds.filter(d => d.tags?.includes(tag)).map(d => d.structure!.sessionId)).size
        result.metrics = { running: count('RUNNING'), hard: count('HARD'), strength: count('STRENGTH') }
        value = definition.operation === 'countHard' ? result.metrics.hard : definition.operation === 'countStrength' ? result.metrics.strength : result.metrics.running; break
      }
      case 'restDays': { const days = daily('boolean', 14, 0, 1); if (days.some(n => !Number.isInteger(n))) stop('BOOLEAN_REQUIRED'); value = days.filter(n => n === 1).length; break }
      case 'noExposureDays': {
        const w = window(input.window), count = daysBetweenCalendarDates(w.startDay, w.endDay)! + 1, days = daily('boolean', count, 0, 1)
        if (days.some(n => !Number.isInteger(n))) stop('BOOLEAN_REQUIRED')
        value = 0; for (let i = days.length - 1; i >= 0 && days[i] === 0; i--) value++
        result.limitations.push('只在完整已确认窗口内计数，不向窗前推算；不能从天数自动诊断去训练效应。'); break
      }
      case 'sameDay': { read('current', 'event', false, 1, 1); read('reference', 'event', false, 1, 1); value = calendarDay(get('current').at) === calendarDay(get('reference').at) ? 1 : 0; break }
      case 'sumContacts': { const ds = rows('contacts'); if (ds.some(d => !Number.isInteger(d.value) || !d.structure?.sessionId) || new Set(ds.map(d => d.structure!.sessionId)).size !== 1) stop('INTEGER_CONTACTS_IN_ONE_SESSION_REQUIRED'); value = ds.reduce((sum, d) => sum + d.value!, 0); break }
      case 'countCues': case 'countFeatures': { const ds = rows('boolean', 0, 1); if (ds.some(d => !Number.isInteger(d.value))) stop('BOOLEAN_REQUIRED'); value = ds.filter(d => d.value === 1).length; break }
      case 'speedFrequency': case 'speedDistance': {
        const lower = read('lowerFraction', 'ratio', true, Number.MIN_VALUE, 1), upper = input.values?.upperFraction ? read('upperFraction', 'ratio', true, lower, 1) : Infinity, mss = read('mss', 'm/s', false, Number.MIN_VALUE)
        const ds = rows('m', Number.MIN_VALUE), w = window(input.window)
        if (ds.some(d => !positive(d.speedMetersPerSecond) || !d.structure?.sessionId || calendarDay(d.at) < w.startDay || calendarDay(d.at) > w.endDay)) stop('VERIFIED_REP_SPEED_STRUCTURE_AND_WINDOW_REQUIRED')
        sameProtocol([get('mss'), ...ds]); const selected = ds.filter(d => d.speedMetersPerSecond! / mss >= lower && d.speedMetersPerSecond! / mss <= upper)
        value = definition.operation === 'speedFrequency' ? new Set(selected.map(d => d.structure!.sessionId)).size : selected.reduce((sum, d) => sum + d.value!, 0)
        result.series = selected.map(d => ({ id: d.id, value: d.value, unit: 'm', structure: { ...d.structure! } })); result.limitations.push('速度带边界由已声明、有来源的比较条件提供，无默认90%或95%处方。'); break
      }
      case 'warmup': {
        value = read('minutes', 'min', false, 0, 1440)
        if (!Array.isArray(input.series)) { result.metrics = { progressiveSprints: null }; result.missing.push('PROGRESSIVE_SPRINT_RECORDS_UNKNOWN'); break }
        const ds = input.series.length ? rows('boolean', 0, 1) : []
        if (ds.some(d => !Number.isInteger(d.value))) stop('BOOLEAN_REQUIRED')
        result.metrics = { progressiveSprints: ds.filter(d => d.value === 1).length }; break
      }
      case 'coverage': {
        const fields = input.requiredFields
        if (!fields?.length || fields.some(f => !f.trim()) || new Set(fields).size !== fields.length) stop('DISTINCT_REQUIRED_FIELDS_REQUIRED')
        const known = fields.filter(f => input.fieldAvailability?.[f] === true).length
        value = known / fields.length; result.validSamples = known; result.metrics = { valid: known, required: fields.length }
        result.missing = fields.filter(f => input.fieldAvailability?.[f] !== true).map(f => 'FIELD_UNKNOWN:' + f); result.limitations.push('仅为本问题数据覆盖率，不是医学或训练能力评分。'); break
      }
      case 'reported': {
        value = read('current', definition.unit, false, 0, definition.unit === '/10' ? 10 : Infinity)
        if (ruleId === 'REC_ALCOHOL') result.metrics = { gramsPerStandardDrink: read('gramsPerDrink', 'g', false, Number.MIN_VALUE) }
        break
      }
      case 'energyAvailability': {
        const intake = read('intake', 'kcal/day'), exercise = read('exerciseEnergy', 'kcal/day'), ffm = read('ffm', 'kg', false, Number.MIN_VALUE)
        if (calendarDay(get('intake').at) !== calendarDay(get('exerciseEnergy').at)) stop('ENERGY_DAYS_DIFFER')
        value = (intake - exercise) / ffm; result.limitations.push('能量与FFM误差需专业审核；不按固定截点诊断REDs或开营养处方。'); break
      }
      case 'exposure': { const [actual, reference] = pair('m/s', false, Number.MIN_VALUE); value = 100 * actual / reference; result.limitations.push('只描述已发生暴露；临床许可前提不等于本函数授予训练许可。'); break }
      case 'measurementChange': {
        const unit = metricUnit(), [current, previous] = pair(unit); value = current - previous; result.unit = unit
        const paired = read('pairedCount', 'count', false, 2); if (!Number.isInteger(paired)) stop('PAIRED_MEASUREMENT_COUNT_REQUIRED')
        result.metrics = { change: value, sem: null, te: null, swc: null, mdc95: null }
        for (const key of ['sem', 'te', 'swc'] as const) if (input.values?.[key]) { sameProtocol([get('current'), get(key)]); result.metrics[key] = read(key, unit) }
        if (result.metrics.sem !== null) { requireCondition('VALID_SEM_ERROR_MODEL'); result.metrics.mdc95 = 1.96 * Math.sqrt(2) * result.metrics.sem }
        result.limitations.push('SWC、TE、SEM和MDC分别记录；不因超过SWC就认定真实提高。'); break
      }
      default: stop('OPERATION_NOT_IMPLEMENTED')
    }
    if (value === null || !Number.isFinite(value) || Object.values(result.metrics).some(v => v !== null && !Number.isFinite(v))) stop('NON_FINITE_OR_UNAVAILABLE_RESULT')
    if (definition.operation !== 'coverage') result.validSamples = consumed.size
    if (result.sourceRefs.some(r => r.kind === 'PLAN')) result.limitations.push('含明确的计划目标或日历参考；这些字段不是实际完成事实。')
    if (result.sourceRefs.some(r => r.revision === null)) result.limitations.push('部分来源版本未提供；历史判断修订前需重新核对完整来源。')
    return { ...result, status: 'AVAILABLE', value }
  } catch (error) {
    return { ...result, status: 'UNAVAILABLE', value: null, missing: [...result.missing, error instanceof Unavailable ? error.message : 'INVALID_INPUT_SHAPE'] }
  }
}
