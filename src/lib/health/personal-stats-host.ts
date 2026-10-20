/**
 * v88：U09 个人统计的受信宿主接入（只读）。从现有 HealthSnapshot（已按当前运动员 + 已选来源）取同协议可比序列，
 * 生成健康页折叠卡片与方坤事实行。不写存储、不改课表、不给训练许可（decisionAuthorized 恒为 false）。
 * 预测草稿桥（personal-forecast-decision-bridge）需要受信 sourceVersions/coverageVersion，宿主尚无可靠版本句柄 → 暂不接入。
 */
import type { HealthSnapshot } from './snapshot'
import { comparableHealthSeries } from './personal-statistics-adapter'
import { buildPersonalStatisticsCard, type PersonalStatisticsCard } from './personal-statistics-view'
export const U09_METRICS = ['RHR', 'HRV', 'SLEEP'] as const
const NAME: Record<(typeof U09_METRICS)[number], string> = { RHR: '静息心率', HRV: 'HRV', SLEEP: '睡眠' }
export type U09Card = PersonalStatisticsCard & { metric: (typeof U09_METRICS)[number]; name: string }
export function personalStatsCards(snapshot: HealthSnapshot, athleteId: string, asOf: string): U09Card[] {
  const out: U09Card[] = []
  for (const metric of U09_METRICS) {
    try { const c = buildPersonalStatisticsCard(comparableHealthSeries({ snapshot, athleteId, metric, asOf })); out.push({ ...c, metric, name: NAME[metric], title: `${NAME[metric]} · 个人趋势` }) } catch { /* 单项失败不影响其他 */ }
  }
  return out
}
/** 给方坤（本地/联网）的一行事实：只有达到“描述”及以上才写数字；否则写“数据不足/冲突”，不编趋势。 */
export function personalStatsFactLine(cards: U09Card[]): string | null {
  if (!cards.length) return null
  const bits = cards.map(c => c.status === 'DESCRIPTIVE' || c.status === 'HISTORY_ONLY' || c.status === 'STATISTICAL_REVIEW' ? `${c.name}：${c.lines.join(' ')}${c.status === 'HISTORY_ONLY' ? '（最新记录不是今天）' : ''}` : c.status === 'DATA_CONFLICT' ? `${c.name}：来源冲突，不做统计` : `${c.name}：可比记录不足，不做统计`)
  return `个人统计（U09，只读研究性描述，不是恢复许可/诊断/改课依据）：${bits.join('；')}`
}
