/** V88.1 read-only U07 bridge. Never grants training clearance or plan changes. */
import type { HealthSnapshot } from './snapshot'
import type { FatigueReview } from './analysis'
import { projectPilotHealth } from '../core/u07-pilot'

export type IntradayMonitoringLine = { state: 'CURRENT' | 'DAILY_OR_STALE' | 'UNAVAILABLE' | 'CONFLICT' | 'SOURCE_ERROR'; text: string; authorizedToTrain: false }
export function intradayMonitoringLine(snapshot: HealthSnapshot, review: FatigueReview, asOf: string): IntradayMonitoringLine {
  const projection = projectPilotHealth(snapshot, review, asOf)
  const battery = projection.metrics.find(m => m.metric === 'BODY_BATTERY')
  const unknown = (state: IntradayMonitoringLine['state'], text: string): IntradayMonitoringLine => ({state, text, authorizedToTrain:false})
  if (projection.status !== 'READ_ONLY') return unknown('SOURCE_ERROR', '当前数据状态无法核对，未判断日内恢复。')
  if (!battery || battery.state === 'MISSING') return unknown('UNAVAILABLE', '身体电量：尚无可核对读数。全天心率曲线需实际带时间戳的样本。')
  if (battery.state === 'CONFLICT') return unknown('CONFLICT', '身体电量：来源冲突，请先核对；不生成日内曲线。')
  if (battery.state === 'SOURCE_ERROR' || battery.state === 'UNVERIFIED_TIME') return unknown('SOURCE_ERROR', '身体电量：数据读取或测量时间待核对。')
  if (battery.value === null) return unknown('UNAVAILABLE', '身体电量：无有效数值。')
  const when = battery.measuredAt ? `测量时间 ${battery.measuredAt}` : '测量时间未提供'
  if (battery.currentValue) return unknown('CURRENT', `设备身体电量 ${battery.value}/100（${when}，仅为设备读数；不是训练许可）。`)
  return unknown('DAILY_OR_STALE', `设备身体电量 ${battery.value}/100（${battery.statistic ?? '统计口径未提供'}；${when}；非当前电量）。`)
}
