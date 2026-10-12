import type { ImportedRunningSegment } from "./training-import.ts"

export type RoundObservation = {
  round: number | null
  count: number
  fastest: number | null
  slowest: number | null
  mean: number | null
  median: number | null
  withinDelta: number | null
}

export type ImportedRunningObservation = {
  planDeviation: "UNAVAILABLE"
  pattern: "UNKNOWN"
  partial: true
  completed: number
  skipped: number
  missing: number
  slots: number
  rounds: RoundObservation[]
  betweenRoundMeanDelta: number | null
  samePositionDeltas: { repeat: number; delta: number | null; comparable: boolean }[]
  lastDelta: number | null
  mixedDistance: boolean
  paceNote: string
  formula: string
}

function recordedNumber(field: { value: number | null; status: string }): number | null {
  return field.status === "RECORDED" && field.value != null ? field.value : null
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  return Number(value.toFixed(2))
}

function mean(values: number[]): number | null {
  if (!values.length) return null
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
}

export function observeImportedRunning(segments: ImportedRunningSegment[]): ImportedRunningObservation {
  const repetitions = segments.filter((segment) => segment.kind === "REPETITION" || segment.kind === "UNKNOWN" || segment.kind === "CONTINUOUS")
  const completed = repetitions.filter((segment) => segment.completion === "COMPLETED" && recordedNumber(segment.durationSeconds) != null)
  const skipped = repetitions.filter((segment) => segment.completion === "SKIPPED").length
  const missing = repetitions.length - completed.length - skipped
  const distances = new Set(completed.map((segment) => recordedNumber(segment.distanceMeters)).filter((value): value is number => value != null))
  const mixedDistance = distances.size > 1
  const byRound = new Map<string, ImportedRunningSegment[]>()
  for (const segment of completed) {
    const key = recordedNumber(segment.round) == null ? "unknown" : String(recordedNumber(segment.round))
    byRound.set(key, [...(byRound.get(key) ?? []), segment])
  }
  const rounds: RoundObservation[] = [...byRound.entries()].map(([key, rows]) => {
    const times = rows.map((row) => recordedNumber(row.durationSeconds)).filter((value): value is number => value != null)
    const first = times[0] ?? null
    const last = times.at(-1) ?? null
    return {
      round: key === "unknown" ? null : Number(key),
      count: times.length,
      fastest: times.length ? Math.min(...times) : null,
      slowest: times.length ? Math.max(...times) : null,
      mean: mean(times),
      median: median(times),
      withinDelta: first != null && last != null && times.length >= 2 ? Number((last - first).toFixed(2)) : null,
    }
  })
  const roundMeans = rounds.map((round) => round.mean).filter((value): value is number => value != null)
  const betweenRoundMeanDelta = roundMeans.length >= 2 ? Number((roundMeans[roundMeans.length - 1]! - roundMeans[0]!).toFixed(2)) : null
  const positions = new Map<number, number[]>()
  if (!mixedDistance) {
    for (const segment of completed) {
      const repeat = recordedNumber(segment.repeat)
      const seconds = recordedNumber(segment.durationSeconds)
      if (repeat == null || seconds == null) continue
      positions.set(repeat, [...(positions.get(repeat) ?? []), seconds])
    }
  }
  const samePositionDeltas = [...positions.entries()].map(([repeat, times]) => ({
    repeat, comparable: times.length >= 2, delta: times.length >= 2 ? Number((times[times.length - 1]! - times[0]!).toFixed(2)) : null,
  }))
  const orderedTimes = completed.map((segment) => recordedNumber(segment.durationSeconds)).filter((value): value is number => value != null)
  const lastDelta = !mixedDistance && orderedTimes.length >= 2 ? Number((orderedTimes.at(-1)! - orderedTimes[0]!).toFixed(2)) : null
  return {
    planDeviation: "UNAVAILABLE",
    pattern: "UNKNOWN",
    partial: true,
    completed: completed.length,
    skipped,
    missing: Math.max(0, missing),
    slots: repetitions.length,
    rounds,
    betweenRoundMeanDelta: mixedDistance ? null : betweenRoundMeanDelta,
    samePositionDeltas,
    lastDelta,
    mixedDistance,
    paceNote: mixedDistance || distances.size === 0 ? "距离不一致或距离未记录时不计算配速，也不直接比较秒数。" : "只在同一距离且用时已记录时，秒数差才是同距比较；配速不是能力结论。",
    formula: "平均=有效用时之和/条数；中位=排序后的中间值；轮内变化=该轮末次减首次；这些只描述已记录部分。",
  }
}
