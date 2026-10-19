/* ui-r2（只读派生，不改任何持久化结构）：V4 组合课（跑步＋力量）按“跑步 / 力量”两个分项展示状态。
 * 数据来源都是现有存储：
 *  - 跑步：fk-plan400-v4-log[date] 的 reps/rest/aux（用户手填）＋ 同日的设备跑步（佳明账号同步缓存 / 已确认的文件导入），设备记录只作“同日候选”，不关联、不写入；
 *  - 力量：fk-schedule-v1 里 plan400:<date>:strength（逐组引导的执行投影）＋ fk-plan400-v4-log[date].strength（手填）；
 *  - 整课标记 done/rpe/pain 是旧口径（跑步与力量没分开），只原样显示为“整课（旧口径）”，绝不拆给两个分项。
 * 规则：设备跑步永远不能让力量变成“已完成”；只有一个分项有记录时，总览不显示“整课完成”。 */
import { activityLocalDay, activityLocalTime, fmtDistance, fmtDuration, fmtHr, fmtPace } from './activity-format'
import { dayKind, hasStrength, type V4Day, type V4Log } from './plan400-view'
import { STATUS_TEXT, type DayComponents, type PartFeedback } from './plan400-components-store'
const partState = (p: PartFeedback | undefined): ComponentState | null => !p?.status ? null : { label: STATUS_TEXT[p.status] + (p.rpe != null ? ` · RPE ${p.rpe}` : ''), tone: p.status === 'not_recorded' ? 'none' : p.status === 'skipped' ? 'skipped' : p.status === 'done' ? 'done' : 'partial' }

export type DeviceRun = { id: string; source: 'garmin' | 'import'; sourceLabel: string; startedAt: string; distanceM: number | null; durationSec: number | null; avgHr: number | null; title: string }
export type ComponentTone = 'none' | 'candidate' | 'partial' | 'live' | 'done' | 'skipped'
export type ComponentState = { label: string; tone: ComponentTone; detail?: string }
export type StrengthEntryLite = { id: string; status?: string; actual?: { outcome?: string; executionState?: string; occurrenceIds?: string[] } | null } | undefined
export type ComboView = { combo: boolean; running: ComponentState; strength: ComponentState | null; legacy: { done: string | null; rpe: string | null; pain: string | null }; overall: string }

const filled = (v: unknown) => String(v ?? '').trim().length > 0
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
export function comboView(d: V4Day, log: V4Log | undefined, opts: { deviceRuns: DeviceRun[]; strengthEntry: StrengthEntryLite; strengthLive: boolean; parts?: DayComponents; runLinked?: boolean }): ComboView {
  const l = log ?? {}
  const combo = dayKind(d) !== 'rest' && dayKind(d) !== 'recovery' && hasStrength(d)
  const runHand = filled(l.reps) || filled(l.rest) || filled(l.aux)
  // v79：分项反馈（附加 key）优先；关联了手表跑步 = 跑步有实际记录（只影响跑步，不碰力量）
  const runPart = partState(opts.parts?.running)
  const running: ComponentState = runPart ? (opts.runLinked ? { ...runPart, detail: '已关联佳明跑步' } : runPart) : opts.runLinked ? { label: '已关联佳明跑步 · 待评价', tone: 'partial' } : runHand
    ? { label: '已手填跑步记录', tone: 'partial', ...(opts.deviceRuns.length ? { detail: `另有 ${opts.deviceRuns.length} 条同日手表跑步（未关联）` } : {}) }
    : opts.deviceRuns.length ? { label: opts.deviceRuns.length === 1 ? '有同日手表跑步 · 未关联' : `有 ${opts.deviceRuns.length} 条同日手表跑步 · 未关联`, tone: 'candidate' }
    : { label: '未记录', tone: 'none' }
  let strength: ComponentState | null = null
  if (hasStrength(d)) {
    const a = opts.strengthEntry?.actual
    const liftPart = partState(opts.parts?.strength)
    if (opts.strengthLive) strength = { label: '逐组引导进行中', tone: 'live' }
    else if (liftPart) strength = liftPart
    else if (a?.executionState === 'COMPLETED') strength = { label: '逐组记录已完成', tone: 'done' }
    else if (a?.executionState === 'PARTIAL' || a?.executionState === 'INTERRUPTED') strength = { label: '逐组记录未做完', tone: 'partial' }
    else if (a?.outcome === 'missed') strength = { label: '标记没练', tone: 'skipped' }
    else if (filled(l.strength)) strength = { label: '已手填力量记录', tone: 'partial' }
    else strength = { label: '尚未记录', tone: 'none' }
  }
  const legacy = { done: filled(l.done) ? String(l.done) : null, rpe: filled(l.rpe) ? String(l.rpe) : null, pain: filled(l.pain) ? String(l.pain) : null }
  const runHas = ['partial', 'live', 'done'].includes(running.tone), liftHas = !!strength && ['partial', 'live', 'done'].includes(strength.tone)
  const overall = !combo ? '' : runHas && liftHas ? '跑步、力量都有记录（各自状态见下）' : runHas ? '只有跑步有记录 · 力量待记录' : liftHas ? '只有力量有记录 · 跑步待记录' : '两项都还没有记录'
  return { combo, running, strength, legacy, overall }
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
