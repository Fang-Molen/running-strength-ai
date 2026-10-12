import { loadConfirmedTrainingImports } from "./training-import.ts"

export type HistoricalPerformanceFact = {
  sourceId: string
  draftId: string
  occurredAt: string
  distanceMeters: number | null
  durationSeconds: number | null
  completion: "COMPLETED" | "NOT_RECORDED"
}

/** Reads confirmed import facts strictly before a cutoff. Does not score ability or change a plan. */
export function readConfirmedPerformances(beforeIso: string): HistoricalPerformanceFact[] {
  const cutoff = Date.parse(beforeIso)
  if (!Number.isFinite(cutoff)) return []
  const facts: HistoricalPerformanceFact[] = []
  for (const record of loadConfirmedTrainingImports()) {
    const occurredAt = record.occurredAt.status === "RECORDED" ? record.occurredAt.value : null
    const at = occurredAt ? Date.parse(occurredAt) : Number.NaN
    if (!occurredAt || !Number.isFinite(at) || at >= cutoff) continue
    record.runningSegments.forEach((segment, index) => {
      const distance = segment.distanceMeters.status === "RECORDED" ? segment.distanceMeters.value : null
      const duration = segment.durationSeconds.status === "RECORDED" ? segment.durationSeconds.value : null
      if (segment.completion === "NOT_RECORDED") {
        facts.push({ sourceId: `import:${record.draftId}:run-${index + 1}`, draftId: record.draftId, occurredAt, distanceMeters: null, durationSeconds: null, completion: "NOT_RECORDED" })
        return
      }
      if (segment.completion !== "COMPLETED" || (distance == null && duration == null)) return
      facts.push({ sourceId: `import:${record.draftId}:run-${index + 1}`, draftId: record.draftId, occurredAt, distanceMeters: distance, durationSeconds: duration, completion: "COMPLETED" })
    })
  }
  return facts
}
