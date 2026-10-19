/* ui-r2（只读派生，不改任何持久化结构）：V4 组合课（跑步＋力量）按“跑步 / 力量”两个分项展示状态。
 * 数据来源都是现有存储：
 *  - 跑步：fk-plan400-v4-log[date] 的 reps/rest/aux（用户手填）＋ 同日的设备跑步（佳明账号同步缓存 / 已确认的文件导入），设备记录只作“同日候选”，不关联、不写入；
 *  - 力量：fk-schedule-v1 里 plan400:<date>:strength（逐组引导的执行投影）＋ fk-plan400-v4-log[date].strength（手填）；
 *  - 整课标记 done/rpe/pain 是旧口径（跑步与力量没分开），只原样显示为“整课（旧口径）”，绝不拆给两个分项。
 * 规则：设备跑步永远不能让力量变成“已完成”；只有一个分项有记录时，总览不显示“整课完成”。 */
import { activityLocalDay, activityLocalTime, fmtDistance, fmtDuration, fmtHr, fmtPace } from './activity-format'
import { v4DayFact, type DayParts, type PartFact, type PartState, type V4Day, type V4Log } from './plan400-view'
import type { DayComponents } from './plan400-components-store'

export type DeviceRun = { id: string; source: 'garmin' | 'import'; sourceLabel: string; startedAt: string; distanceM: number | null; durationSec: number | null; avgHr: number | null; title: string }
export type ComponentTone = 'none' | 'candidate' | 'partial' | 'live' | 'done' | 'skipped'
export type ComponentState = { label: string; tone: ComponentTone; detail?: string }
export type StrengthEntryLite = { id: string; status?: string; actual?: { outcome?: string; executionState?: string; occurrenceIds?: string[] } | null } | undefined
export type ComboView = { combo: boolean; running: ComponentState; strength: ComponentState | null; legacy: { done: string | null; rpe: string | null; pain: string | null }; overall: string }

/** 同一天（用户时区）的设备跑步；只认有来源 id 的佳明/文件导入行，不按标题或时长猜。 */
export function deviceRunsOn(date: string, rows: readonly { id: string; source: string; sport: string; startedAt: string; date: string; distanceM: number | null; durationSec: number | null; avgHr?: number | null; title?: string; sources?: string[] }[]): DeviceRun[] {
  return rows.filter(r => r.sport === 'RUNNING' && activityLocalDay(r.startedAt) === date && (r.source === 'garmin' || r.source === 'import' || r.sources?.some(s => s === 'garmin' || s === 'import')))
    .map(r => { const src = r.source === 'garmin' || r.sources?.includes('garmin') ? 'garmin' as const : 'import' as const
      return { id: r.id, source: src, sourceLabel: src === 'garmin' ? '佳明账号同步' : '文件导入', startedAt: r.startedAt, distanceM: r.distanceM, durationSec: r.durationSec, avgHr: r.avgHr ?? null, title: r.title ?? '' } })
}
/** 一行摘要，只放设备真实给出的字段；缺的字段不出现，不写 0。 */
export function deviceRunFacts(r: DeviceRun): string[] {
  const out: string[] = []
  const t = activityLocalTime(r.startedAt); if (t) out.push(`${t} 开始`)
  const d = fmtDistance(r.distanceM); if (d) out.push(d)
  if (r.durationSec != null) out.push(`用时 ${fmtDuration(r.durationSec)}`)
  const p = fmtPace(r.distanceM, r.durationSec); if (p) out.push(`平均配速 ${p}（由距离/用时算出）`)
  const hr = fmtHr(r.avgHr); if (hr != null) out.push(`平均心率 ${hr}`)
  return out
}
/** v83：组合课展示 = v4DayFact（plan400-view，唯一分项投影）的展示适配；不在这里另判状态。
 * 同日手表跑步未确认 → candidate（“待你确认”），不算“有记录”。 */
const TONE: Record<PartState, ComponentTone> = { done: 'done', reduced: 'partial', skipped: 'skipped', partial: 'partial', live: 'live', candidate: 'candidate', none: 'none' }
const toState = (f: PartFact): ComponentState => ({ label: f.label, tone: TONE[f.state], ...(f.detail ? { detail: f.detail } : {}) })
const phrase = (n: string, f: PartFact) => f.state === 'done' ? `${n}完成` : f.state === 'reduced' ? `${n}减量完成` : f.state === 'skipped' ? `${n}跳过` : f.state === 'partial' ? `${n}有记录·未标完成` : f.state === 'live' ? `${n}进行中` : f.state === 'candidate' ? `${n}有同日手表记录·待确认` : `${n}待记录`
export function comboView(d: V4Day, log: V4Log | undefined, opts: { deviceRuns: DeviceRun[]; strengthEntry: StrengthEntryLite; strengthLive: boolean; parts?: DayComponents; runLinked?: boolean; /** v83：读模型给的同一份分项输入（有就用它，保证与日志/首页一致） */ shared?: DayParts }): ComboView {
  const a = opts.strengthEntry?.actual
  const ex = a?.executionState === 'COMPLETED' || a?.executionState === 'PARTIAL' || a?.executionState === 'INTERRUPTED' ? a.executionState : null
  const own: DayParts = { parts: opts.parts, runLinked: opts.runLinked, runCandidates: opts.runLinked ? 0 : opts.deviceRuns.length, strengthExec: ex, strengthMarked: !ex && a?.outcome ? a.outcome as 'as_planned' | 'different' | 'missed' : null }
  const x: DayParts = opts.shared ? { ...opts.shared, parts: opts.parts ?? opts.shared.parts, strengthExec: opts.shared.strengthExec ?? ex, strengthMarked: opts.shared.strengthMarked ?? own.strengthMarked } : own
  const f = v4DayFact(d, log, x, opts.strengthLive)
  const combo = f.combo
  const running: ComponentState = f.running ? toState(f.running) : { label: '未记录', tone: 'none' }
  const strength = f.strength ? toState(f.strength) : null
  const overall = !combo ? '' : f.legacyOverall ? f.summary : f.overall === 'done' ? '跑步、力量都完成' : f.overall === 'reduced' ? '已结束：有减量或跳过（各自状态见下）' : f.overall === 'skipped' ? '跑步、力量都跳过' : `${phrase('跑步', f.running!)} · ${phrase('力量', f.strength!)}`
  return { combo, running, strength, legacy: f.legacy, overall }
}
/** 24–72h：训练当晚的睡眠在健康页只有一条（第二天日期），这里只引用，不再让用户填第二次。 */
export function sharedSleepFor(date: string, records: readonly { kind: string; value: number; observedOn: string; source?: string; deviceLabel?: string; note?: string; createdAt?: string; athleteId?: string }[], athlete = 'local'): { hours: number; day: string; source: string } | null {
  const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); const day = next.toISOString().slice(0, 10)
  const hit = records.filter(r => r.kind === 'SLEEP' && r.observedOn === day && (r.athleteId ?? 'local') === athlete && Number.isFinite(r.value)).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0]
  return hit ? { hours: hit.value, day, source: hit.source === 'DEVICE_CONFIRMED' ? (hit.note || '设备') : '手动' } : null
}
/** 迟补标记：超过 72 小时才补的恢复信息要说明是事后补的（不伪装成当时填写）。 */
export function recoveryTiming(date: string, today: string): 'too_early' | 'window' | 'late' {
  const days = Math.round((Date.parse(today) - Date.parse(date)) / 864e5)
  return days < 1 ? 'too_early' : days <= 3 ? 'window' : 'late'
}
