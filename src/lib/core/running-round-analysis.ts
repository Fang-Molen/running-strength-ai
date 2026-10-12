import type { RunningRepetitionProjection, RunningRepetitionSlot } from "./running-execution.ts"
import type { RunningPlanSnapshot, RunningPurpose } from "./running-plan.ts"

// Derived, read-only observations. These are never a fatigue score, diagnosis or prescription.
export type RecordedTiming = {
  repeatOrdinal: number
  distanceMeters: number
  durationSeconds: number
  plannedDurationSeconds: number | null
  deviationFromPlanSeconds: number | null
  sourceEventId: string
}

export type RoundObservation = {
  roundOrdinal: number
  plannedCount: number
  completedCount: number
  skippedCount: number
  notRecordedCount: number
  unresolvedCount: number
  timings: RecordedTiming[]
  // Only timings with the same actual distance may share one set of statistics.
  timingGroups: {
    distanceMeters: number
    count: number
    minSeconds: number
    maxSeconds: number
    meanSeconds: number
    medianSeconds: number
    sourceEventIds: string[]
  }[]
}

export type RoundComparison = {
  earlierRound: number
  laterRound: number
  distanceMeters: number
  meanDifferenceSeconds: number
  positionDifferencesSeconds: { repeatOrdinal: number; differenceSeconds: number; sourceEventIds: [string, string] }[]
  sourceEventIds: string[]
}

export type RepeatedStepObservation = {
  trainingOccurrenceId: string
  runningSnapshotId: string
  componentId: string
  blockId: string
  stepId: string
  purpose: RunningPurpose
  rounds: RoundObservation[]
  roundComparisons: RoundComparison[]
}

export type RunningRoundAnalysis = {
  availability: "UNAVAILABLE" | "AVAILABLE"
  observations: RepeatedStepObservation[]
}

function validPositive(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 0
}

function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function sourceTiming(slot: RunningRepetitionSlot): RecordedTiming | null {
  if (slot.status !== "COMPLETED" || slot.sourceEventIds.length !== 1) return null
  if (!validPositive(slot.actualDistanceMeters) || !validPositive(slot.actualDurationSeconds)) return null
  const targetComparable = slot.plannedDistanceMeters === slot.actualDistanceMeters && validPositive(slot.plannedDurationSeconds)
  return {
    repeatOrdinal: slot.repeatOrdinal,
    distanceMeters: slot.actualDistanceMeters,
    durationSeconds: slot.actualDurationSeconds,
    plannedDurationSeconds: targetComparable ? slot.plannedDurationSeconds : null,
    deviationFromPlanSeconds: targetComparable ? slot.actualDurationSeconds - slot.plannedDurationSeconds! : null,
    sourceEventId: slot.sourceEventIds[0]!,
  }
}

function roundObservation(roundOrdinal: number, slots: RunningRepetitionSlot[]): RoundObservation {
  const timings = slots.map(sourceTiming).filter((timing): timing is RecordedTiming => timing !== null)
  const distances = [...new Set(timings.map((timing) => timing.distanceMeters))].sort((a, b) => a - b)
  const timingGroups = distances.map((distanceMeters) => {
    const matching = timings.filter((timing) => timing.distanceMeters === distanceMeters)
    const seconds = matching.map((timing) => timing.durationSeconds).sort((a, b) => a - b)
    return {
      distanceMeters,
      count: matching.length,
      minSeconds: seconds[0]!,
      maxSeconds: seconds[seconds.length - 1]!,
      meanSeconds: seconds.reduce((sum, value) => sum + value, 0) / seconds.length,
      medianSeconds: median(seconds),
      sourceEventIds: matching.map((timing) => timing.sourceEventId),
    }
  })
  return {
    roundOrdinal,
    plannedCount: slots.length,
    completedCount: slots.filter((slot) => slot.status === "COMPLETED").length,
    skippedCount: slots.filter((slot) => slot.status === "SKIPPED").length,
    notRecordedCount: slots.filter((slot) => slot.status === "NOT_RECORDED" || slot.status === "NOT_YET_RECORDED").length,
    unresolvedCount: slots.filter((slot) => slot.status === "DUPLICATE_UNRESOLVED").length,
    timings,
    timingGroups,
  }
}

function compareCompleteRounds(earlier: RoundObservation, later: RoundObservation): RoundComparison | null {
  // No comparison from a selected subset: both rounds must have every prescribed
  // slot timed once, at the same distance in the same position.
  if (earlier.plannedCount === 0 || earlier.plannedCount !== later.plannedCount) return null
  if (earlier.timings.length !== earlier.plannedCount || later.timings.length !== later.plannedCount) return null
  const distances = new Set([...earlier.timings, ...later.timings].map((timing) => timing.distanceMeters))
  if (distances.size !== 1) return null
  const pairs = earlier.timings.map((timing) => {
    const other = later.timings.find((candidate) => candidate.repeatOrdinal === timing.repeatOrdinal)
    return other && other.distanceMeters === timing.distanceMeters ? { repeatOrdinal: timing.repeatOrdinal, differenceSeconds: other.durationSeconds - timing.durationSeconds, sourceEventIds: [timing.sourceEventId, other.sourceEventId] as [string, string] } : null
  })
  if (pairs.some((pair) => pair === null)) return null
  const positionDifferencesSeconds = pairs.filter((pair): pair is NonNullable<typeof pair> => pair !== null)
  return {
    earlierRound: earlier.roundOrdinal,
    laterRound: later.roundOrdinal,
    distanceMeters: distances.values().next().value!,
    meanDifferenceSeconds: positionDifferencesSeconds.reduce((sum, pair) => sum + pair.differenceSeconds, 0) / positionDifferencesSeconds.length,
    positionDifferencesSeconds,
    sourceEventIds: positionDifferencesSeconds.flatMap((pair) => pair.sourceEventIds),
  }
}

export function analyzeRunningRounds(projection: RunningRepetitionProjection, snapshot: RunningPlanSnapshot | null): RunningRoundAnalysis {
  if (!snapshot || projection.availability !== "AVAILABLE") return { availability: "UNAVAILABLE", observations: [] }
  const observations: RepeatedStepObservation[] = []
  for (const component of snapshot.components) {
    if (component.modality !== "RUNNING" || component.structure.kind !== "REPEATED") continue
    for (const block of component.structure.blocks) {
      for (const step of block.steps) {
        const slots = projection.slots.filter((slot) => slot.trainingOccurrenceId === snapshot.trainingOccurrenceId && slot.runningSnapshotId === snapshot.runningSnapshotId && slot.componentId === component.componentId && slot.blockId === block.blockId && slot.stepId === step.stepId)
        // A stale or partial projection must not masquerade as the full plan.
        if (slots.length !== block.roundCount * step.repeatCount || new Set(slots.map((slot) => `${slot.roundOrdinal}:${slot.repeatOrdinal}`)).size !== slots.length) continue
        if (slots.some((slot) => !Number.isInteger(slot.roundOrdinal) || slot.roundOrdinal < 1 || slot.roundOrdinal > block.roundCount || !Number.isInteger(slot.repeatOrdinal) || slot.repeatOrdinal < 1 || slot.repeatOrdinal > step.repeatCount)) continue
        const rounds = Array.from({ length: block.roundCount }, (_, index) => roundObservation(index + 1, slots.filter((slot) => slot.roundOrdinal === index + 1)))
        if (rounds.some((round) => round.plannedCount !== step.repeatCount)) continue
        const roundComparisons = rounds.slice(1).map((round, index) => compareCompleteRounds(rounds[index]!, round)).filter((comparison): comparison is RoundComparison => comparison !== null)
        observations.push({ trainingOccurrenceId: snapshot.trainingOccurrenceId, runningSnapshotId: snapshot.runningSnapshotId, componentId: component.componentId, blockId: block.blockId, stepId: step.stepId, purpose: component.purpose, rounds, roundComparisons })
      }
    }
  }
  return { availability: "AVAILABLE", observations }
}
