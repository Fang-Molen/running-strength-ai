import type { ImportField, ImportedRunningSegment, ImportSport, TrainingImportCandidate } from './training-import.ts'
import { strictIso } from './coach-v4-c11-adapter.ts'

/** Preparation contract only. A separately authorized FIT decoder must supply these fields.
 * Never reads an archive, creates an occurrence, confirms an import, or writes to storage.
 */
export type DecodedDeviceLap = {
  id: string; ordinal: number; sourceId: string
  kind: 'WORK' | 'RECOVERY' | 'UNKNOWN'
  distance: { value: number; unit: 'm' | 'km' } | null
  timerSeconds: number | null; elapsedSeconds: number | null
  averageHeartRateBpm: number | null; maximumHeartRateBpm: number | null
  timingMethod: string | null; heartRateMethod: string | null
  structure: { componentId: string; blockId: string; stepId: string; round: number; repeat: number; confirmed: true } | null
}
export type ReportedDeviceRest = {
  seconds: number; scope: 'BETWEEN_REPEATS' | 'BETWEEN_ROUNDS' | 'UNLOCATED'
  afterLapId: string | null; sourceId: string; originalText: string | null
}
export type DecodedDeviceActivity = {
  sourceFileHash: string; activityId: string; sourceId: string
  athleteId: string | null; identityConfirmed: boolean; deviceId: string | null
  protocolKey: string | null; sport: ImportSport; startedAt: string; recordedAt: string
  totalDistanceMeters: number | null; timerSeconds: number | null; elapsedSeconds: number | null
  expectedLapOrdinals: number[] | null; laps: DecodedDeviceLap[]; reportedRests: ReportedDeviceRest[]
  occurrenceBinding: { occurrenceId: string; athleteId: string; confirmed: true; sourceId: string } | null
}
export type PreparedDeviceActivity = {
  status: 'NEEDS_REVIEW' | 'BLOCKED'; candidate: TrainingImportCandidate
  raw: DecodedDeviceActivity; reasons: string[]; missingLapOrdinals: number[] | null
  comparisonKey: string | null; verifiedOccurrenceId: string | null
  automaticImport: false; planWrite: false; actualWorkoutCount: null
  qualityIssues?: {status:'IMPLAUSIBLE';sourceId:string;field:string;reason:string}[]
}
const absent = <T>(): ImportField<T> => ({ value: null, status: 'ABSENT', sourceIds: [] })
const observed = <T>(value: T | null, sourceId: string): ImportField<T> => value === null ? absent<T>() : ({ value, status: sourceId ? 'RECORDED' : 'AMBIGUOUS', sourceIds: sourceId ? [sourceId] : [] })
const positive = (value: number | null) => value !== null && Number.isFinite(value) && value > 0 ? value : null
const known = (value: string | null) => !!value?.trim() && !/UNKNOWN|未核验/.test(value ?? '')

export function prepareDeviceActivity(input: DecodedDeviceActivity, asOf: string): PreparedDeviceActivity {
  const raw = structuredClone(input), reasons: string[] = []
  const qualityIssues:NonNullable<PreparedDeviceActivity['qualityIssues']>=[]
  const flag=(sourceId:string,field:string,reason:string)=>qualityIssues.push({status:'IMPLAUSIBLE',sourceId,field,reason})
  for(const [field,n] of [['totalDistanceMeters',raw.totalDistanceMeters],['timerSeconds',raw.timerSeconds],['elapsedSeconds',raw.elapsedSeconds]] as const)
    if(n!==null&&(!Number.isFinite(n)||n<0))flag(raw.sourceId,field,'活动汇总值为负或无效，需核对来源与单位。')
  if(raw.timerSeconds!==null&&raw.elapsedSeconds!==null&&Number.isFinite(raw.timerSeconds)&&Number.isFinite(raw.elapsedSeconds)&&raw.elapsedSeconds<raw.timerSeconds)
    flag(raw.sourceId,'elapsedSeconds','活动经过时间短于计时时间，需核对来源与单位。')
  // Data-review flags only. A high reading can be real; these never diagnose or stop training.
  // Reuse the broad existing offline speed checks, rather than introduce a WR-derived dose rule.
  for(const lap of raw.laps){
    const distance=lap.distance?.value!==null&&lap.distance?.value!==undefined?lap.distance.value*(lap.distance.unit==='km'?1000:1):null
    if(lap.distance&&!['m','km'].includes(lap.distance.unit))flag(lap.sourceId,'distance','距离单位未确认，不能自动换算。')
    if(lap.timerSeconds!==null&&(!Number.isFinite(lap.timerSeconds)||lap.timerSeconds<=0))flag(lap.sourceId,'timerSeconds','计时非有效正数，需核对原文件和单位。')
    if(lap.elapsedSeconds!==null&&(!Number.isFinite(lap.elapsedSeconds)||lap.elapsedSeconds<0||lap.timerSeconds!==null&&lap.elapsedSeconds<lap.timerSeconds))flag(lap.sourceId,'elapsedSeconds','经过时间为负、无效或短于计时时间。')
    if(distance!==null&&(!Number.isFinite(distance)||distance<0))flag(lap.sourceId,'distance','距离为负或不是有限数值。')
    if(lap.kind!=='RECOVERY'&&distance!==null&&distance>0&&lap.timerSeconds!==null&&lap.timerSeconds>0&&(distance/lap.timerSeconds>15||distance>=5000&&distance/lap.timerSeconds>9))flag(lap.sourceId,'timerSeconds','分段速度异常，先核对计时、距离和单位。')
    for(const [field,n] of [['averageHeartRateBpm',lap.averageHeartRateBpm],['maximumHeartRateBpm',lap.maximumHeartRateBpm]] as const)
      if(n!==null&&(!Number.isFinite(n)||n<=0||n>=220))flag(lap.sourceId,field,'心率读数需要核对原文件、传感器和测量条件；不作为诊断阈值。')
    if(lap.averageHeartRateBpm!==null&&lap.maximumHeartRateBpm!==null&&lap.averageHeartRateBpm>lap.maximumHeartRateBpm)flag(lap.sourceId,'averageHeartRateBpm','平均心率高于最高心率，字段可能错位。')
  }
  if(qualityIssues.length)reasons.push('DEVICE_DATA_IMPLAUSIBLE_REQUIRES_REVIEW')
  if (!raw.sourceFileHash || !raw.sourceId || !raw.activityId) reasons.push('SOURCE_IDENTITY_MISSING')
  if (!strictIso(asOf) || !strictIso(raw.startedAt) || !strictIso(raw.recordedAt) || Date.parse(raw.startedAt) > Date.parse(raw.recordedAt) || Date.parse(raw.recordedAt) > Date.parse(asOf)) reasons.push('TIME_OR_VISIBILITY_INVALID')
  if (!raw.identityConfirmed || !raw.athleteId) reasons.push('ATHLETE_IDENTITY_UNCONFIRMED')
  if (!known(raw.deviceId) || !known(raw.protocolKey)) reasons.push('DEVICE_OR_PROTOCOL_UNCONFIRMED')
  if (raw.sport === 'UNKNOWN') reasons.push('SPORT_UNCONFIRMED')
  if (new Set(raw.laps.map(l => l.id)).size !== raw.laps.length || new Set(raw.laps.map(l => l.ordinal)).size !== raw.laps.length || raw.laps.some(l => !l.id || !l.sourceId || !Number.isInteger(l.ordinal) || l.ordinal < 1)) reasons.push('DUPLICATE_OR_INVALID_LAP_IDENTITY')
  const expected = raw.expectedLapOrdinals
  const expectedValid = expected !== null && expected.length > 0 && new Set(expected).size === expected.length && expected.every(n => Number.isInteger(n) && n > 0)
  const missingLapOrdinals = expectedValid ? expected.filter(n => !raw.laps.some(l => l.ordinal === n)) : null
  if (!expectedValid) reasons.push('LAP_COVERAGE_UNKNOWN')
  else if (missingLapOrdinals!.length || raw.laps.some(l => !expected.includes(l.ordinal))) reasons.push('LAP_COVERAGE_INCOMPLETE_OR_CONFLICTING')
  if (raw.laps.some(l => l.kind === 'UNKNOWN' || !known(l.timingMethod) || l.kind === 'WORK' && !l.structure)) reasons.push('LAP_PURPOSE_TIMING_OR_STRUCTURE_UNCONFIRMED')
  if (raw.laps.some(l => !positive(l.timerSeconds) || !l.distance || !positive(l.distance.value))) reasons.push('LAP_VALUE_UNAVAILABLE')
  if (raw.reportedRests.some(r => !Number.isFinite(r.seconds) || r.seconds < 0 || !r.sourceId || r.afterLapId !== null && !raw.laps.some(l => l.id === r.afterLapId))) reasons.push('REST_SOURCE_OR_POSITION_INVALID')
  if (raw.reportedRests.some(r => r.scope === 'UNLOCATED' || r.afterLapId === null)) reasons.push('REST_POSITION_UNCONFIRMED')
  const binding = raw.occurrenceBinding
  const verifiedOccurrenceId = raw.identityConfirmed && raw.athleteId && binding?.confirmed && binding.athleteId === raw.athleteId && binding.occurrenceId && binding.sourceId ? binding.occurrenceId : null
  if (!verifiedOccurrenceId) reasons.push('ACTIVITY_NOT_BOUND_TO_CONFIRMED_TRAINING_OCCURRENCE')
  const candidate: TrainingImportCandidate = {
    sport: raw.sport, occurredAt: observed(raw.startedAt, raw.sourceId), title: absent(),
    durationSeconds: qualityIssues.some(i=>i.sourceId===raw.sourceId&&i.field==='timerSeconds')?{value:null,status:'AMBIGUOUS',sourceIds:[raw.sourceId]}:observed(positive(raw.timerSeconds), raw.sourceId), totalDistanceMeters: qualityIssues.some(i=>i.sourceId===raw.sourceId&&i.field==='totalDistanceMeters')?{value:null,status:'AMBIGUOUS',sourceIds:[raw.sourceId]}:observed(positive(raw.totalDistanceMeters), raw.sourceId),
    runningStructure: raw.laps.length && raw.laps.every(l => l.kind !== 'UNKNOWN' && l.structure) ? 'REPEATED' : 'UNAVAILABLE',
    runningSegments: raw.laps.map((lap): ImportedRunningSegment => {
      const rests = raw.reportedRests.filter(r => r.afterLapId === lap.id && r.scope === 'BETWEEN_REPEATS' && Number.isFinite(r.seconds) && r.seconds >= 0)
      const distance = lap.distance && positive(lap.distance.value) !== null ? lap.distance.value * (lap.distance.unit === 'km' ? 1000 : 1) : null
      const safeObserved=<T>(value:T|null,field:string):ImportField<T>=>qualityIssues.some(i=>i.sourceId===lap.sourceId&&i.field===field)?{value:null,status:'AMBIGUOUS',sourceIds:[lap.sourceId]}:observed(value,lap.sourceId)
      return {
        id: lap.id, kind: lap.kind === 'WORK' && lap.structure ? 'REPETITION' : lap.kind === 'RECOVERY' ? 'RECOVERY' : 'UNKNOWN',
        round: observed(lap.structure?.round ?? null, lap.sourceId), repeat: observed(lap.structure?.repeat ?? null, lap.sourceId),
        distanceMeters: safeObserved(distance,'distance'), durationSeconds: safeObserved(positive(lap.timerSeconds),'timerSeconds'),
        recoverySeconds: rests.length === 1 ? observed(rests[0].seconds, rests[0].sourceId) : rests.length ? { value: null, status: 'CONFLICTING', sourceIds: rests.map(r => r.sourceId) } : absent(),
        averageHeartRateBpm: safeObserved(positive(lap.averageHeartRateBpm),'averageHeartRateBpm'), heartRateMethod: observed(lap.heartRateMethod, lap.sourceId),
        completion: positive(lap.timerSeconds) === null ? 'NOT_RECORDED' : 'COMPLETED', sourceIds: [lap.sourceId],
      }
    }),
    strengthSets: [], sessionRpe: absent(), subjectiveRecovery: absent(), sleepHours: absent(), pain: absent(), soreness: absent(),
    uncertainFields: reasons, conflicts: reasons.filter(r => /CONFLICT|DUPLICATE|INVALID/.test(r)),
    warnings: ['设备活动不是训练课次；课次须单独确认绑定。', '原始距离、平均/最高心率、计时/经过时间、结构和未定位休息保存在raw；不得用间歇合计生成连续PB。', '只供后续导入审阅；尚未写入正式记录。'],
  }
  const comparisonKey = !reasons.length ? JSON.stringify([raw.athleteId,raw.deviceId,raw.protocolKey,raw.sport,raw.laps.map(l => [l.kind,l.timingMethod,l.distance,l.structure]),raw.reportedRests.map(r => [r.scope,r.seconds,raw.laps.find(l => l.id === r.afterLapId)?.ordinal])]) : null
  return { status: reasons.some(r => /INVALID|DUPLICATE|SOURCE_IDENTITY|IMPLAUSIBLE/.test(r)) ? 'BLOCKED' : 'NEEDS_REVIEW', candidate, raw, reasons, missingLapOrdinals, comparisonKey, verifiedOccurrenceId, automaticImport: false, planWrite: false, actualWorkoutCount: null,qualityIssues }
}

/** Do not merge laps, athletes or devices. Activity count and confirmed occurrence count are different denominators. */
export function summarizeDevicePreparation(rows: readonly PreparedDeviceActivity[]) {
  const keys = rows.map(r => JSON.stringify([r.raw.sourceFileHash,r.raw.activityId,r.raw.deviceId]))
  const ambiguous = keys.some((key,i) => keys.indexOf(key) !== i)
  const athleteIds = [...new Set(rows.map(r => r.raw.athleteId))]
  const completeBindings = rows.length > 0 && !ambiguous && athleteIds.length === 1 && athleteIds[0] !== null && rows.every(r => r.status !== 'BLOCKED' && r.verifiedOccurrenceId)
  return { deviceActivityCount: new Set(keys).size, confirmedTrainingOccurrenceCount: completeBindings ? new Set(rows.map(r => r.verifiedOccurrenceId)).size : null, duplicatesRequireReview: ambiguous, athleteIds, mergedMeasurements: false as const }
}
