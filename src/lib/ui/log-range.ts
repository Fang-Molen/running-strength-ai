import { fmtDistance, fmtDuration, fmtHr, fmtPace } from './activity-format.ts'
/** 训练日志 v76：范围、类型筛选和摘要共用一套规则。
 * 日期 = 活动开始时间在用户时区的日期（ActivityRow.date），不是同步时间。
 * 本周 = 周一到周日（按天）；近4周 = 含本周在内的 4 个自然周（按周）。缺失的距离/时长单独计数，不当 0。 */
import type { ActivityRow } from './training-read-model'
import { componentCompleted } from './training-component-facts'
export type LogRange = 'week' | '4w'
export type LogKind = 'all' | 'run' | 'lift'
const add = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
export const mondayOf = (d: string) => { const wd = (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; return add(d, -wd) }
export function rangeOf(range: LogRange, today: string) {
  const mon = mondayOf(today)
  if (range === 'week') return { start: mon, end: add(mon, 6), buckets: Array.from({ length: 7 }, (_, i) => { const d = add(mon, i); return { start: d, end: d, label: ['一', '二', '三', '四', '五', '六', '日'][i] + ' ' + d.slice(8) } }) }
  const start = add(mon, -21)
  return { start, end: add(mon, 6), buckets: Array.from({ length: 4 }, (_, i) => { const s = add(start, 7 * i); return { start: s, end: add(s, 6), label: `${s.slice(5)}起` } }) }
}
const srcs = (x: ActivityRow) => x.sources ?? [x.source]
export const isGarmin = (x: ActivityRow) => srcs(x).includes('garmin') || x.originIds.some(id => id.startsWith('garmin:'))
/** 手机记录 = 在方坤里记的（开始训练/逐组清单/今日卡片/+记一笔/按计划完成）。 */
export const isPhone = (x: ActivityRow) => srcs(x).some(s => s === 'execution' || s === 'phone') || !!x.appMade
export const sourceLabels = (x: ActivityRow) => [...(isPhone(x) ? ['手机记录'] : []), ...(isGarmin(x) ? ['佳明'] : []), ...(!isPhone(x) && !isGarmin(x) ? ['聊天/上传'] : [])]
/** 单一记录标签：复盘依据/列表/方坤共用同一套格式化（activity-format）。 */
export const recordLabel = (x: ActivityRow) => [sourceLabels(x).join('+'), x.title || (x.sport === 'RUNNING' ? '跑步' : x.sport === 'STRENGTH' ? '力量' : '训练'), fmtDistance(x.distanceM), x.durationSec ? fmtDuration(x.durationSec) : null, x.sport === 'RUNNING' ? fmtPace(x.distanceM, x.durationSec) : null, x.avgHr ? `心率 ${fmtHr(x.avgHr)}` : null, x.sets ? `${x.sets} 组` : null].filter(Boolean).join(' · ')
export const kindOf = (r: ActivityRow) => r.sport === 'RUNNING' ? 'run' : r.sport === 'STRENGTH' ? 'lift' : r.sport === 'MIXED' ? 'mixed' : 'other'
export const matchKind = (r: ActivityRow, k: LogKind) => k === 'all' || (k === 'run' ? ['run', 'mixed'].includes(kindOf(r)) : ['lift', 'mixed'].includes(kindOf(r)))
export function filterRows(rows: ActivityRow[], range: LogRange, kind: LogKind, today: string) {
  const r = rangeOf(range, today)
  return rows.filter(x => x.date >= r.start && x.date <= r.end && matchKind(x, kind)).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
export function summarize(rows: ActivityRow[], range: LogRange, kind: LogKind, today: string) {
  // 旧未完成草稿仍不计量；已完成分项/已确认来源的实际观测不因整课待补而丢失。课程完成另由 completedPlanIds 派生。
  const r = rangeOf(range, today), all = filterRows(rows, range, kind, today), list = all.filter(x => x.status !== 'incomplete' || x.componentFacts?.some(componentCompleted) || isGarmin(x) || x.sources?.includes('import'))
  const runs = list.filter(x => ['run', 'mixed'].includes(kindOf(x)))
  return {
    ...r, list: all, counted: list, count: list.length, run: runs.length, lift: list.filter(x => ['lift', 'mixed'].includes(kindOf(x))).length,
    distanceM: runs.reduce((s, x) => s + (x.distanceM ?? 0), 0), missingDistance: runs.filter(x => x.distanceM == null).length,
    durationSec: list.reduce((s, x) => s + (x.durationSec ?? 0), 0), missingDuration: list.filter(x => x.durationSec == null).length,
    bySource: { garmin: list.filter(isGarmin).length, app: list.filter(isPhone).length, upload: list.filter(x => !isGarmin(x) && !isPhone(x)).length }, incomplete: all.filter(x => x.status === 'incomplete').length,
    bars: r.buckets.map(b => { const inB = list.filter(x => x.date >= b.start && x.date <= b.end); return { ...b, minutes: Math.round(inB.reduce((s, x) => s + (x.durationSec ?? 0), 0) / 60), count: inB.length, unknown: inB.filter(x => x.durationSec == null).length, future: b.start > today } }),
  }
}
/** 当前范围里没有、但别的日期有同类记录时，给出明确提示（不编造、不挪日期）。 */
export function outsideHint(rows: ActivityRow[], range: LogRange, kind: LogKind, today: string): string | null {
  const r = rangeOf(range, today), other = rows.filter(x => matchKind(x, kind) && (x.date < r.start || x.date > r.end)).sort((a, b) => b.date.localeCompare(a.date))
  if (!other.length) return null
  const label = kind === 'run' ? '跑步' : kind === 'lift' ? '力量' : '训练'
  return `${r.start.slice(5)}–${r.end.slice(5)} 没有${label}记录；最近一条${label}在 ${other[0].date}${range === 'week' ? '，可切到“近4周”查看' : ''}（共 ${other.length} 条在此范围外）。`
}
