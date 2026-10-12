import { loadEvents } from "@/lib/core/events"
import { projectRunningRepetitions } from "@/lib/core/running-execution"
import { getRunningPlanSnapshot, type RunningPurpose } from "@/lib/core/running-plan"
import { analyzeRunningRounds } from "@/lib/core/running-round-analysis"

const PURPOSE: Record<RunningPurpose, string> = {
  UNSPECIFIED: "未知",
  WARMUP: "热身",
  EASY_AEROBIC: "轻松有氧",
  LONG: "长距离",
  TEMPO_THRESHOLD: "节奏",
  INTERVAL: "间歇",
  REPETITION_SPEED: "速度重复",
  HILL: "坡",
  RACE: "比赛",
  COOLDOWN: "冷身",
  OTHER: "其他",
}

function seconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function sameTarget(observation: { rounds: { timings: { plannedDurationSeconds: number | null }[] }[] }): boolean {
  const planned = observation.rounds.flatMap((round) => round.timings.map((timing) => timing.plannedDurationSeconds)).filter((value): value is number => value != null)
  return planned.length > 0 && planned.every((value) => value === planned[0])
}

export function RunningRoundReadout({ occurrenceId }: { occurrenceId: string }) {
  const snapshot = getRunningPlanSnapshot(occurrenceId)
  if (!snapshot || snapshot.trainingOccurrenceId !== occurrenceId) {
    return <p className="mb-2 text-xs text-muted">这节没有冻结的跑步计划。逐轮观察不可用，不会用上传记录伪造训练绑定。</p>
  }
  const analysis = analyzeRunningRounds(projectRunningRepetitions(occurrenceId, loadEvents()), snapshot)
  if (!analysis.observations.length) {
    return <p className="mb-2 text-xs text-muted">已记录部分：没有可逐次对齐的重复跑。连续跑和没有结构的旧课不会被拆成轮次。</p>
  }
  return <details className="mb-2 rounded-card border border-line bg-surface p-3 text-xs" open>
    <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">已记录部分 · 逐轮逐次</summary>
    <p className="mt-2 text-muted">只统计已记录、且实际距离相同的成绩。未记录不等于没做。这是算术差，不是能力、疲劳或伤病结论。模型复盘未完成时，下面仍是规则层事实。</p>
    {analysis.observations.map((observation) => <div key={`${observation.stepId}`} className="mt-3">
      <p>目的 {observation.purpose === "UNSPECIFIED" ? "未知，不根据用时猜测" : PURPOSE[observation.purpose]} · 绑定 {observation.trainingOccurrenceId}</p>
      {observation.rounds.map((round) => <div key={round.roundOrdinal} className="mt-2">
        <p>第 {round.roundOrdinal} 轮 · 计划 {round.plannedCount} 次 · 完成 {round.completedCount} · 跳过 {round.skippedCount} · 未记录 {round.notRecordedCount} · 冲突 {round.unresolvedCount}</p>
        {round.timings.map((timing) => <p key={timing.sourceEventId} className="mt-1">第 {timing.repeatOrdinal} 次 · 实际 {timing.distanceMeters} 米 · {seconds(timing.durationSeconds)} 秒 · {timing.deviationFromPlanSeconds == null ? "计划偏差不可用" : `偏差 ${timing.deviationFromPlanSeconds > 0 ? "+" : ""}${seconds(timing.deviationFromPlanSeconds)} 秒`} · 来源 {timing.sourceEventId}</p>)}
        {round.timingGroups.map((group) => <p key={group.distanceMeters} className="mt-1 text-muted">已记录 {group.distanceMeters} 米 {group.count} 次：最快 {seconds(group.minSeconds)} · 最慢 {seconds(group.maxSeconds)} · 平均 {seconds(group.meanSeconds)} · 中位 {seconds(group.medianSeconds)}</p>)}
      </div>)}
      {observation.roundComparisons.length ? observation.roundComparisons.map((comparison) => <p key={`${comparison.earlierRound}-${comparison.laterRound}`} className="mt-2">轮间均值差 {seconds(comparison.meanDifferenceSeconds)} 秒（第 {comparison.laterRound} 轮减第 {comparison.earlierRound} 轮）。只因两轮每个槽位都有唯一、同距离的成绩。</p>) : <p className="mt-2 text-muted">两轮没有全部对应槽位的唯一同距离成绩，所以不计算轮间差。</p>}
      {sameTarget(observation) ? <p className="mt-2">计划要求这些已记录槽位的目标用时相同。某一趟更快或更慢只记在该趟偏差上，不能把整课说成完美执行，也不能因为用时下降就叫掉速。</p> : <p className="mt-2 text-muted">计划各次目标并不相同，或有的槽位没有可比较的目标。用时变化先按各趟偏差看。</p>}
    </div>)}
  </details>
}
