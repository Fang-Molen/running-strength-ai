// v88：U09 个人趋势统计（只读）折叠卡，只放在健康页「健康记录」卡里（一处）。
import { loadHealthSnapshot } from "@/lib/health/snapshot"
import { currentAthleteId } from "@/lib/core/events"
import { personalStatsCards } from "@/lib/health/personal-stats-host"
import { intradayMonitoringLine } from "@/lib/health/u07-v88-host"
import { reviewFatigue, dailyCheckin } from "@/lib/health/analysis"
export function PersonalStatsPanel({ day, className = "home-card mt-3 p-3" }: { day: string; revision?: number; className?: string }) {
  let cards: ReturnType<typeof personalStatsCards> = []
  let intraday: string | null = null
  try {
    const snapshot = loadHealthSnapshot(day)
    cards = personalStatsCards(snapshot, currentAthleteId(), `${day}T23:59:59`)
    intraday = intradayMonitoringLine(snapshot, reviewFatigue(snapshot, dailyCheckin(day)), new Date().toISOString()).text
  } catch { cards = []; intraday = '日内数据暂时无法核对。' }
  return <details className={className} data-testid="u09-stats">
    <summary className="min-h-11 cursor-pointer text-sm font-bold">个人趋势统计（只读）</summary>
    {intraday ? <p className="keep mt-2 text-xs text-muted" data-testid="u07-intraday">{intraday}</p> : null}
    {cards.map(c => <div key={c.metric} className="mt-2 text-xs" data-testid={`u09-${c.metric}`}><p className="font-bold">{c.title}</p>{c.lines.map((l, i) => <p key={i} className="keep">{l}</p>)}{c.caveats.map((l, i) => <p key={i} className="keep text-muted">{l}</p>)}</div>)}
    <p className="keep mt-2 text-xs text-muted">只用同一来源、同一统计口径的记录；不足或冲突时不显示趋势。不是恢复许可、诊断或改课依据。</p>
  </details>
}
