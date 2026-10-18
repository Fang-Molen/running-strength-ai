import { calendarDay } from './coach-calendar.ts'
import { strictIso } from './coach-v4-c11-adapter.ts'
import type { EvolutionEvidence, EvolutionSnapshot } from './coach-evolution-v4.ts'
import type { PeriodContext } from './coach-period-context.ts'

export const COACH_INTEGRATION_VERSION = 'FK-R13-COACH-INTEGRATION-1' as const
export const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && strictIso(`${value}T00:00:00Z`)
export function periodStart(end: string, days: number): string {
  if (!validDay(end) || !Number.isInteger(days) || days < 1 || days > 366) throw Error('INVALID_PERIOD')
  return new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10)
}
export type PeriodReview = {
  version: typeof COACH_INTEGRATION_VERSION
  athleteId: string; start: string; end: string; asOf: string
  sessions: { occurrenceId: string; day: string; runningSegments: number; strengthSets: number; sourceIds: string[]; durationMinutes?: number; durationOnly?: boolean }[]
  recoveryClues: { kind: 'RHR' | 'SLEEP'; day: string; value: number; unit: 'bpm' | 'h'; sourceId: string; method: string }[]
  execution: { status: 'PARTIAL_RECORDS_ONLY'; recordedSessions: number; completionRate: null }
  trends: { protocol: string; unit: string; values: number[]; occurrenceIds: string[]; sourceIds: string[]; direction: 'INCREASING' | 'DECREASING' | 'UNCHANGED' | 'MIXED' }[]
  outcome: { status: 'NOT_ASSESSED'; reason: string }
  unknowns: string[]; followup: string; sourceIds: string[]; decisionAuthorization: false; writes: 0
}
const work = (e: EvolutionEvidence) => ['SPLIT_SECONDS', 'STRENGTH_REPS', 'STRENGTH_SECONDS'].includes(e.metric)
/** Describe current effective observations; never infer completion, adaptation or a missing day as rest. */
export function buildPeriodReview(snapshot: EvolutionSnapshot, start: string, end: string, unknownRecords = 0, context?: PeriodContext): PeriodReview {
  if (!validDay(start) || !validDay(end) || start > end || !strictIso(snapshot.asOf) || end > calendarDay(snapshot.asOf)!) throw Error('INVALID_PERIOD')
  const active = snapshot.active.filter(e => e.athleteId === snapshot.athleteId && e.source !== 'PLAN' && e.source !== 'THIRD_PARTY' && e.value !== null &&
    strictIso(e.eventAt) && strictIso(e.recordedAt) && Date.parse(e.recordedAt) <= Date.parse(snapshot.asOf) && Date.parse(e.eventAt) <= Date.parse(snapshot.asOf))
  const rows = active.filter(e => { const day = calendarDay(e.eventAt)!; return day >= start && day <= end })
  const ids = [...new Set(rows.filter(work).map(e => e.occurrenceId))]
  const sessions: PeriodReview['sessions'] = ids.map(occurrenceId => {
    const records = rows.filter(e => e.occurrenceId === occurrenceId && work(e))
    return { occurrenceId, day: calendarDay(records[0].eventAt)!, runningSegments: records.filter(e => e.metric === 'SPLIT_SECONDS').length,
      strengthSets: new Set(records.filter(e => e.metric !== 'SPLIT_SECONDS').map(e => e.context)).size, sourceIds: [...new Set(records.map(e => e.sourceId))] }
  }).sort((a, b) => a.day.localeCompare(b.day) || a.occurrenceId.localeCompare(b.occurrenceId))
  for (const d of context?.durations ?? []) {
    if (d.athleteId !== snapshot.athleteId || !validDay(d.day) || d.day < start || d.day > end || !strictIso(d.knownAt) || Date.parse(d.knownAt) > Date.parse(snapshot.asOf) || !Number.isFinite(d.minutes) || d.minutes <= 0 || d.minutes > 1440) continue
    const existing = sessions.find(s => s.occurrenceId === d.occurrenceId)
    if (existing) { existing.durationMinutes = d.minutes; existing.sourceIds = [...new Set([...existing.sourceIds, ...d.sourceIds])] }
    else sessions.push({ occurrenceId: d.occurrenceId, day: d.day, runningSegments: 0, strengthSets: 0, durationMinutes: d.minutes, durationOnly: true, sourceIds: [...d.sourceIds] })
  }
  sessions.sort((a, b) => a.day.localeCompare(b.day) || a.occurrenceId.localeCompare(b.occurrenceId))
  const recoveryClues: PeriodReview['recoveryClues'] = rows.filter(e => e.metric === 'SLEEP_HOURS' && e.value !== null).map(e => ({ kind: 'SLEEP', day: calendarDay(e.eventAt)!, value: e.value!, unit: 'h', sourceId: e.sourceId, method: e.source }))
  for (const c of context?.clues ?? []) if (c.athleteId === snapshot.athleteId && validDay(c.day) && c.day >= start && c.day <= end && strictIso(c.knownAt) && Date.parse(c.knownAt) <= Date.parse(snapshot.asOf) && Number.isFinite(c.value) && (c.kind === 'RHR' ? c.unit === 'bpm' && c.value >= 20 && c.value <= 200 : c.unit === 'h' && c.value > 0 && c.value <= 24)) recoveryClues.push({ kind: c.kind, day: c.day, value: c.value, unit: c.unit, sourceId: c.sourceId, method: c.method })
  recoveryClues.sort((a, b) => a.day.localeCompare(b.day) || a.sourceId.localeCompare(b.sourceId))
  const buckets = new Map<string, EvolutionEvidence[]>()
  // Exact protocol and recorded recovery match are required. Unrecorded weather/technique remain limitations.
  for (const e of rows.filter(e => e.metric === 'SPLIT_SECONDS' && e.confirmation === 'CONFIRMED')) {
    const rests = rows.filter(r => r.occurrenceId === e.occurrenceId && r.metric === 'REST_SECONDS')
    if (!rests.length || rests.some(r => r.confirmation !== 'CONFIRMED')) continue
    const restKey = rests.map(r => [r.context, r.value, r.unit]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    const key = JSON.stringify([e.context, e.unit, e.source, e.measurement?.method ?? null, restKey])
    buckets.set(key, [...(buckets.get(key) ?? []), e])
  }
  const trends: PeriodReview['trends'] = []
  if (!snapshot.quarantined.length && !snapshot.scopeConflictCount && !unknownRecords) for (const group of buckets.values()) {
    const ordered = [...group].sort((a, b) => Date.parse(a.eventAt) - Date.parse(b.eventAt) || a.id.localeCompare(b.id))
    if (ordered.length < 3 || new Set(ordered.map(e => e.occurrenceId)).size !== ordered.length || new Set(ordered.map(e => calendarDay(e.eventAt))).size !== ordered.length) continue
    const values = ordered.map(e => e.value!)
    const direction = values.every(v => v === values[0]) ? 'UNCHANGED' : values.every((v, i) => !i || v > values[i - 1]) ? 'INCREASING' : values.every((v, i) => !i || v < values[i - 1]) ? 'DECREASING' : 'MIXED'
    const recoverySources = rows.filter(r => r.metric === 'REST_SECONDS' && ordered.some(e => e.occurrenceId === r.occurrenceId)).map(r => r.sourceId)
    trends.push({ protocol: ordered[0].context, unit: ordered[0].unit, values, occurrenceIds: ordered.map(e => e.occurrenceId), sourceIds: [...new Set([...ordered.map(e => e.sourceId), ...recoverySources])], direction })
  }
  const unknowns = ['未确认整个日期范围内记录完整；空白日期不代表休息。', '执行记录不等于整课达标，缺少当时处方时不计算完成率。', '天气、动作标准及当前身体反应仍需核对；同协议记录变化不等于能力提升。']
  unknowns.push(...(context?.unknowns ?? []))
  if (recoveryClues.length) unknowns.push('静息心率和睡眠仅为已记录线索；设备、时刻或方法不同不直接比较，不据此诊断或批准加量。')
  if (unknownRecords) unknowns.push('存在提交时间未知或被截断的记录，不能据此判定完整趋势。')
  if (snapshot.quarantined.length || snapshot.scopeConflictCount) unknowns.push('存在冲突记录，保留有效观察并暂缓趋势结论。')
  if (!trends.length) unknowns.push('尚无三次日期不同、协议及已记录恢复一致的正式跑步观察。')
  if (snapshot.corrections.length) unknowns.push('已按当前有效更正投影统计，旧值不再作为当前依据。')
  return { version: COACH_INTEGRATION_VERSION, athleteId: snapshot.athleteId, start, end, asOf: snapshot.asOf, sessions, recoveryClues,
    execution: { status: 'PARTIAL_RECORDS_ONLY', recordedSessions: sessions.length, completionRate: null }, trends,
    outcome: { status: 'NOT_ASSESSED', reason: '尚未绑定独立的目标测量协议及前后测试；不能将完成课表或训练趋势当作目标已经达成。' },
    unknowns, followup: '下次保留当时处方、实际分段或工作组、整课感受及后续恢复；先核对可比条件，再评估是否调整。',
    sourceIds: [...new Set(sessions.flatMap(s => s.sourceIds).concat(trends.flatMap(t => t.sourceIds), recoveryClues.map(c => c.sourceId)))], decisionAuthorization: false, writes: 0 }
}
export function formatPeriodReview(review: PeriodReview): string {
  return [`${review.start} 至 ${review.end}：有执行记录的训练共 ${review.execution.recordedSessions} 次。`,
    '完成情况：只统计已记录执行，暂不计算整周完成率。',
    ...review.sessions.filter(s => s.durationOnly).map(s => `${s.day} 力量课：仅记录 ${s.durationMinutes} 分钟；工作组、重量与次数未知，不判定达标。`),
    ...(review.recoveryClues.length ? [`恢复线索：有 ${review.recoveryClues.filter(c => c.kind === 'RHR').length} 条静息心率、${review.recoveryClues.filter(c => c.kind === 'SLEEP').length} 条睡眠记录，仅作线索，不做诊断。`] : []),
    review.trends.length ? '表现观察：部分正式记录具备同协议比较条件，仍需核对环境与当天反应；这不证明能力提高。' : '表现观察：可比证据不足，暂不判断持续进步或退步。',
    `目标结果：${review.outcome.reason}`, ...review.unknowns, review.followup, '本次为只读复盘，没有修改计划。'].join('\n')
}
