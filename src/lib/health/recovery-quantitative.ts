import { calculateQuantitativeRule, type QuantDatum, type QuantInput, type QuantResult } from '../core/coach-quantitative'
import { shiftDay, shortHash, validDay } from './observation'
import type { HealthMetricView, HealthPoint, HealthSnapshot } from './snapshot'

export type RecoveryFact = {
  metric: 'SLEEP' | 'RHR' | 'HRV' | 'FAT_RHR' | 'FAT_HRV' | 'FAT_HRV_CV'
  value: number
  unit: string
  text: string
  sourceIds: string[]
  quality: 'MEASURED' | 'SELF_REPORT_RANGE' | 'CALCULATED'
}
export type RecoveryQuantification = {
  athleteId: string
  day: string
  asOf: string
  facts: RecoveryFact[]
  calculations: QuantResult[]
  missing: string[]
  sourceIds: string[]
  revision: string
  decisionAuthorized: false
  limitations: string[]
}

const RULES = ['REC_SLEEP', 'FAT_RHR', 'FAT_HRV', 'FAT_HRV_CV'] as const
type Rule = typeof RULES[number]
const METRICS = ['SLEEP', 'RHR', 'HRV'] as const
type Metric = typeof METRICS[number]
const LABELS = { SLEEP: '睡眠', RHR: '静息心率', HRV: 'HRV' }
const exactTime = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && validDay(v.slice(0, 10)) && Number.isFinite(Date.parse(v))
const metadata = (p: HealthPoint) => p as HealthPoint & { deviceLabel?: string; measurementMethod?: string }
const protocol = (p: HealthPoint) => JSON.stringify([p.stream, p.source, p.statistic, p.method, p.legacy, metadata(p).deviceLabel ?? '', metadata(p).measurementMethod ?? ''])
const rangeSleep = (p: HealthPoint) => p.stream === 'self:sleep-range' || /区间代表值/.test(p.statistic)
const comparable = (p: HealthPoint) => !p.legacy && !!p.stream.trim() && !p.stream.startsWith('legacy:') && !/^(UNKNOWN|UNSPECIFIED|未知)$/i.test(p.stream) && !!p.statistic.trim() && !/未提供|未知|UNKNOWN|UNSPECIFIED/i.test(p.statistic)
const signed = (value: number, places = 2) => `${value >= 0 ? '+' : ''}${Number(value.toFixed(places))}`
const unique = (values: readonly string[]) => [...new Set(values)]
const pointSignature = (p: HealthPoint) => JSON.stringify([p.id, p.metric, p.day, p.value, protocol(p), p.updatedAt, p.measuredAt])

/**
 * Read-only descriptive adapter. The caller supplies an already athlete-scoped snapshot.
 * A daily observation is indexed at its calendar-day boundary in the supplied offset
 * (or the asOf string's timezone when omitted);
 * this synthetic boundary is NOT a measurement timestamp or intraday readiness claim.
 * Updated-at is knowledge time: missing or later revisions are never backfilled.
 */
export function quantifyRecoverySnapshot({ snapshot, athleteId, asOf, calendarOffsetMinutes }: {
  snapshot: HealthSnapshot
  athleteId: string
  asOf: string
  /** Calendar timezone, minutes east of UTC. This does not change the asOf instant. */
  calendarOffsetMinutes?: number
}): RecoveryQuantification {
  const day = snapshot.asOf
  const out: RecoveryQuantification = {
    athleteId, day, asOf, facts: [], calculations: [], missing: [], sourceIds: [], revision: '', decisionAuthorized: false,
    limitations: [
      '仅描述已记录事实与个人同协议变化；不输出综合疲劳分，不授权减量、停训、加量或医学回归。',
      '日级记录以分析时区的日期边界参与计算；日期边界不代表实际测量时刻，不能推断盘中状态。',
      '基线限定此前7个日历日；窗口检查不代表每天均有数据，缺失日不补零。',
      '同协议仅指记录中已提供的来源、设备、统计口径与算法；未记录的测量条件仍未知。',
      '日历窗口使用本次固定UTC偏移；跨夏令时或旅行时区的测量条件仍需核对。',
    ],
  }
  const base: QuantInput = { athleteId, asOf }
  const blocked = (rule: Rule, reason: string): QuantResult => ({ ...calculateQuantitativeRule(rule, base), status: 'UNAVAILABLE', value: null, missing: [reason] })
  const explicitZone = typeof asOf === 'string' ? asOf.match(/(Z|([+-])(\d\d):(\d\d))$/) : null
  const stringOffset = explicitZone?.[1] === 'Z' ? 0 : explicitZone ? (explicitZone[2] === '+' ? 1 : -1) * (Number(explicitZone[3]) * 60 + Number(explicitZone[4])) : NaN
  const offset = calendarOffsetMinutes === undefined ? stringOffset : calendarOffsetMinutes
  const validOffset = Number.isInteger(offset) && offset >= -840 && offset <= 840
  const validAsOf = exactTime(asOf)
  const analysisDay = validAsOf && validOffset ? new Date(Date.parse(asOf) + offset * 60000).toISOString().slice(0, 10) : ''
  const badContext = !athleteId.trim() || !validAsOf || !validOffset || !validDay(day) || !validDay(analysisDay) || day > analysisDay
  if (snapshot.unreadable || badContext) {
    const reason = snapshot.unreadable ? 'HEALTH_SNAPSHOT_UNREADABLE：健康记录不可读，未使用部分记录形成结论' : 'ASOF_OR_ATHLETE_INVALID：分析时间或运动员范围无效'
    out.calculations = RULES.map(rule => blocked(rule, reason))
    out.missing = [reason]
    out.revision = `recovery-1:${shortHash(JSON.stringify([athleteId, day, reason]))}`
    return out
  }
  const zone = `${offset >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`
  const boundary = (d: string) => `${d}T00:00:00${zone}`
  const start = shiftDay(day, -7), end = shiftDay(day, -1)
  const knownSignatures: string[] = []
  const notes: string[] = []
  const selection = (metric: Metric): { current: HealthPoint | null; prior: HealthPoint[]; error: string } => {
    const views = snapshot.metrics.filter(v => v.metric === metric)
    if (views.length !== 1) return { current: null, prior: [], error: `${LABELS[metric]}：${views.length ? '重复指标视图，需核对来源' : '当天记录缺失'}` }
    const view: HealthMetricView = views[0]
    // Re-read individual points instead of trusting a precomputed mean or a future correction.
    const all = [...view.series, ...view.candidates, ...(view.current ? [view.current] : [])]
    const valid: HealthPoint[] = []
    for (const p of all) {
      if (p.metric !== metric || !validDay(p.day) || p.day < start || p.day > day || view.selectedSource && p.stream !== view.selectedSource) continue
      if (!exactTime(p.updatedAt)) { notes.push(`${LABELS[metric]}：缺少可靠记录知晓时间，未使用`); continue }
      if (Date.parse(p.updatedAt) > Date.parse(asOf)) { notes.push(`${LABELS[metric]}：分析时点之后录入或更正的记录未使用`); continue }
      if (Date.parse(p.updatedAt) < Date.parse(boundary(p.day)) || p.measuredAt != null && (!exactTime(p.measuredAt) || Date.parse(p.measuredAt) > Date.parse(asOf) || Date.parse(p.measuredAt) > Date.parse(p.updatedAt))) {
        notes.push(`${LABELS[metric]}：测量或记录时间不一致，未使用`); continue
      }
      if (!p.id?.trim() || !p.source?.trim() || !p.stream?.trim() || !Number.isFinite(p.value) || p.value < 0 || metric === 'SLEEP' && p.value > 24 || metric !== 'SLEEP' && p.value === 0) {
        notes.push(`${LABELS[metric]}：数值或来源无效，未使用`); continue
      }
      knownSignatures.push(pointSignature(p))
      valid.push(p)
    }
    const byId = new Map<string, HealthPoint[]>()
    for (const p of valid) byId.set(p.id, [...byId.get(p.id) ?? [], p])
    const rows: HealthPoint[] = []
    for (const copies of byId.values()) {
      const sorted = [...copies].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
      const last = sorted.at(-1)!
      if (copies.some(p => p.day !== last.day || protocol(p) !== protocol(last)) || sorted.some(p => p.updatedAt === last.updatedAt && p.value !== last.value)) {
        notes.push(`${LABELS[metric]}：重复标识内容冲突，相关记录未使用`); continue
      }
      rows.push(last)
    }
    const daily = new Map<string, HealthPoint[]>()
    for (const p of rows) daily.set(p.day, [...daily.get(p.day) ?? [], p])
    const today = daily.get(day) ?? []
    if (!today.length) return { current: null, prior: [], error: `${LABELS[metric]}：当天无截至分析时点已知的有效记录` }
    if (new Set(today.map(p => protocol(p))).size !== 1 || new Set(today.map(p => p.value)).size !== 1) return { current: null, prior: [], error: `${LABELS[metric]}：当天存在来源或独立观测冲突，未取平均` }
    const current = [...today].sort((a, b) => a.id.localeCompare(b.id))[0]
    const prior: HealthPoint[] = []
    for (const [date, points] of daily) {
      if (date === day) continue
      const same = points.filter(p => protocol(p) === protocol(current))
      if (!same.length) continue
      if (new Set(same.map(p => p.value)).size !== 1) { notes.push(`${LABELS[metric]}：${date}同协议独立观测冲突，该日未纳入基线`); continue }
      prior.push([...same].sort((a, b) => a.id.localeCompare(b.id))[0])
    }
    return { current, prior: prior.sort((a, b) => a.day.localeCompare(b.day)), error: '' }
  }
  const selected = { SLEEP: selection('SLEEP'), RHR: selection('RHR'), HRV: selection('HRV') }
  const datum = (p: HealthPoint, value: number, unit: string): QuantDatum => ({
    id: p.id, athleteId, value, unit, sourceIds: [p.id], revision: shortHash(pointSignature(p)),
    kind: rangeSleep(p) ? 'SELF_REPORT' : 'ACTUAL', at: boundary(p.day), recordedAt: p.updatedAt, protocol: protocol(p),
  })
  for (const metric of METRICS) {
    const p = selected[metric].current
    if (!p) { out.missing.push(selected[metric].error); continue }
    const unit = metric === 'SLEEP' ? 'h' : metric === 'RHR' ? 'bpm' : 'ms'
    const quality: RecoveryFact['quality'] = rangeSleep(p) ? 'SELF_REPORT_RANGE' : 'MEASURED'
    const qualifier = rangeSleep(p) ? '（自报区间代表值，非精确测量）' : metric === 'HRV' ? `（${p.method || '算法未知'}）` : ''
    out.facts.push({ metric, value: p.value, unit, text: `${day} ${LABELS[metric]} ${p.value} ${unit}${qualifier}；${p.source} · ${p.statistic}`, sourceIds: [p.id], quality })
  }
  const sleep = selected.SLEEP.current
  out.calculations.push(!sleep ? blocked('REC_SLEEP', selected.SLEEP.error) : rangeSleep(sleep)
    ? blocked('REC_SLEEP', 'SELF_REPORT_RANGE_NOT_EXACT：自报睡眠区间代表值仅原样展示，不转成精确睡眠计算')
    : calculateQuantitativeRule('REC_SLEEP', { ...base, values: { minutes: datum(sleep, sleep.value * 60, 'min') } }))
  for (const [metric, rule] of [['RHR', 'FAT_RHR'], ['HRV', 'FAT_HRV']] as const) {
    const { current, prior, error } = selected[metric]
    const unavailable = !current ? error : !comparable(current) ? `${LABELS[metric]}：设备、算法或统计口径不完整，仅展示原值` : metric === 'HRV' && current.method !== 'RMSSD' ? 'HRV_METHOD_NOT_RMSSD：只有明确RMSSD才计算lnRMSSD差值，SDNN或未知算法仅展示原值' : ''
    if (unavailable || !current) { out.calculations.push(blocked(rule, unavailable)); continue }
    const unit = metric === 'RHR' ? 'bpm' : 'ms', ids = [current.id, ...prior.map(p => p.id)]
    out.calculations.push(calculateQuantitativeRule(rule, {
      ...base, values: { current: datum(current, current.value, unit) }, series: prior.map(p => datum(p, p.value, unit)),
      conditions: ['BASELINE_VALID'], conditionSourceIds: ids,
      window: { startDay: start, endDay: end, complete: true, sourceIds: ids },
    }))
  }
  const hrv = selected.HRV
  out.calculations.push(!hrv.current || !comparable(hrv.current) || hrv.current.method !== 'RMSSD'
    ? blocked('FAT_HRV_CV', 'HRV_COMPARABLE_RMSSD_REQUIRED：缺少当天明确来源及RMSSD协议，未拼接历史来源')
    : calculateQuantitativeRule('FAT_HRV_CV', {
      ...base, series: hrv.prior.map(p => datum(p, p.value, 'ms')),
      window: { startDay: start, endDay: end, complete: true, sourceIds: hrv.prior.map(p => p.id) },
    }))
  for (const result of out.calculations) {
    result.limitations.push(...out.limitations.slice(1))
    if (result.status === 'UNAVAILABLE') { out.missing.push(`${result.ruleId} UNAVAILABLE：${result.missing.join('；')}`); continue }
    if (result.ruleId === 'REC_SLEEP') continue // Raw sleep hours already displayed above.
    const metric = result.ruleId as 'FAT_RHR' | 'FAT_HRV' | 'FAT_HRV_CV'
    const text = metric === 'FAT_RHR'
      ? `静息心率较前7天同协议${result.metrics.baselineSamples}个记录日的个人中位数 ${result.metrics.baselineMedian} bpm 变化 ${signed(result.value!)} bpm。`
      : metric === 'FAT_HRV'
        ? `HRV lnRMSSD较前7天同协议${result.metrics.baselineSamples}个记录日均值变化 ${signed(result.value!, 4)} ln(ms)；仅表示个人变化，不代表病因或恢复许可。`
        : `此前7个日历日同协议lnRMSSD变异系数 ${Number(result.value!.toFixed(2))}%（7个记录日）。`
    out.facts.push({ metric, value: result.value!, unit: result.unit, text, sourceIds: unique(result.sourceRefs.map(s => s.id)), quality: 'CALCULATED' })
  }
  out.missing = unique([...out.missing, ...notes])
  out.sourceIds = unique([...out.facts.flatMap(f => f.sourceIds), ...out.calculations.flatMap(c => c.sourceRefs.map(r => r.id))])
  // Future values never enter the revision, even when a projection contains them.
  out.revision = `recovery-1:${shortHash(JSON.stringify([athleteId, day, unique(knownSignatures).sort(), out.missing, snapshot.metrics.filter(v => METRICS.includes(v.metric as Metric)).map(v => [v.metric, v.selectedSource]).sort()]))}`
  return out
}
