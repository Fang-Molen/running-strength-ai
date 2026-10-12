import assert from "node:assert/strict"
import test from "node:test"
import { bindTrainingStart } from "./occurrence.ts"
import { saveRunningPlan, getRunningPlanSnapshot } from "./running-plan.ts"
import { recordRunningRepetitionCompleted } from "./running-execution.ts"
import { dispatchEvent, loadEvents, EVENTS_KEY } from "./events.ts"
import { setStoreBackend, writeEnvelope, type MemoryStore } from "./storage.ts"
import { assertCoachPacket } from "./coach-brief.ts"
import { guardComparison, listBoundTrainings, orderOccurrenceIds, orientPair, pairedRunningObservations, readCompareIds, resolveRecentIntervalPair, sameCalendarDay, separateBriefs } from "./coach-compare.ts"
import { recordCoachChoice } from "./coach-brief.ts"
import type { AppEvent } from "./types.ts"

function memory(): MemoryStore {
  const dump = new Map<string, string>()
  return { keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function event(id: string, type: AppEvent["event_type"], payload: Record<string, unknown>, timestamp: string): AppEvent {
  return { event_id: id, athlete_id: "local", timestamp, event_type: type, source: "MANUAL", payload, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 }
}

const newerSession = { id: "mix-new", name: "间歇", moves: [{ id: "squat", catalogId: "goblet", customName: "", sets: 4, mode: "reps" as const, amount: 8, restSec: 90, weightKg: 20 }] }
const olderSession = { id: "mix-old", name: "间歇", moves: [{ id: "squat", catalogId: "goblet", customName: "", sets: 4, mode: "reps" as const, amount: 8, restSec: 90, weightKg: 20 }] }

function intervalPlan(planId: string) {
  return saveRunningPlan({
    planId,
    planSlotId: planId,
    components: [{ componentId: "intervals", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b1", roundCount: 2, recoveryAfterRoundSeconds: 120, steps: [{ stepId: "s200", plannedDistanceMeters: 200, plannedDurationSeconds: null, repeatCount: 4, recoveryAfterRepeatSeconds: 60, recoveryBeforeNextStepSeconds: null }] }] } }],
  })
}

test("interval pairs stay on their own started events", () => {
  setStoreBackend(memory())
  assert.equal(sameCalendarDay("2026-10-07T09:00:00.000Z", "2026-10-07T10:00:00.000Z"), true)
  assert.equal(sameCalendarDay("2026-10-07T15:30:00.000Z", "2026-10-07T16:30:00.000Z"), false)
  assert.equal(sameCalendarDay("2026-10-07T16:30:00.000Z", "2026-10-08T14:30:00.000Z"), true)
  assert.equal(resolveRecentIntervalPair([]).status, "INSUFFICIENT")
  intervalPlan("newer")
  intervalPlan("older")
  writeEnvelope(EVENTS_KEY, [
    event("new", "TRAINING_STARTED", { sessionId: "mix-new", decisionId: "d1" }, "2026-10-07T09:00:00.000Z"),
    event("old", "TRAINING_STARTED", { sessionId: "mix-old", decisionId: "d2" }, "2026-10-05T09:00:00.000Z"),
    event("legacy", "TRAINING_STARTED", { sessionId: "old-run", decisionId: "d3" }, "2026-10-01T08:00:00.000Z"),
  ])
  bindTrainingStart({ startEventId: "new", startedAt: "2026-10-07T09:00:00.000Z", sessionId: "mix-new", planSlotId: "newer", plan: newerSession, runningPlanId: "newer" })
  bindTrainingStart({ startEventId: "old", startedAt: "2026-10-05T09:00:00.000Z", sessionId: "mix-old", planSlotId: "older", plan: olderSession, runningPlanId: "older" })
  bindTrainingStart({ startEventId: "legacy", startedAt: "2026-10-01T08:00:00.000Z", sessionId: "old-run", planSlotId: "legacy", plan: null })
  const snap = getRunningPlanSnapshot("new")
  assert.ok(snap)
  recordRunningRepetitionCompleted({ trainingOccurrenceId: "new", runningSnapshotId: snap.runningSnapshotId, componentId: "intervals", blockId: "b1", stepId: "s200", roundOrdinal: 1, repeatOrdinal: 1, actualDistanceMeters: 200, actualDurationSeconds: 33 })
  const pair = resolveRecentIntervalPair()
  assert.deepEqual(pair, { status: "READY", newerId: "new", olderId: "old" })
  const briefs = separateBriefs(null, "最近两次间歇有什么不同", "new", "old")
  assert.ok(briefs)
  assert.equal(briefs.newer.repetitionSlots, 8)
  assert.equal(briefs.older.repetitionSlots, 8)
  assert.equal(briefs.older.running?.some((slot) => slot.status === "COMPLETED"), false)
  assert.deepEqual(pairedRunningObservations(briefs.newer, briefs.older), [])
  assert.equal(briefs.newer.sourceIds.includes("old"), false)
  assert.equal(briefs.older.runningStructure === "AVAILABLE", true)
  assert.equal(listBoundTrainings().some((item) => item.trainingOccurrenceId === "legacy" && item.running === "UNAVAILABLE"), true)
  const same = resolveRecentIntervalPair(listBoundTrainings().map((item) => item.trainingOccurrenceId === "old" ? { ...item, startedAt: "2026-10-07T07:00:00.000Z" } : item))
  assert.equal(same.status, "SAME_DAY")
  assert.equal(readCompareIds(JSON.stringify({ compareIds: ["old", "new"] }), ["new", "old"])?.[0], "old")
  const reversed = orderOccurrenceIds("old", "new", listBoundTrainings())
  assert.equal(reversed?.newerId, "new")
  assert.equal(reversed?.olderId, "old")
  assert.equal(orientPair("old", "new", "2026-10-05T09:00:00.000Z", "2026-10-07T09:00:00.000Z")?.newerId, "new")
  const ready = { ...briefs.newer, sessionRpe: 5, sleepHours: 8, subjectiveRecovery: 6 }
  const other = { ...briefs.older, sessionRpe: 5, sleepHours: 8, subjectiveRecovery: 6 }
  const both = guardComparison(ready, other, JSON.stringify({ mode: "answer", text: "两节各自有记录", citations: [ready.occurrenceId, other.occurrenceId], nextStep: null }))
  assert.equal(both.mode, "answer")
  assert.equal(both.citations.includes(ready.occurrenceId ?? ""), true)
  assert.equal(both.citations.includes(other.occurrenceId ?? ""), true)
  assert.equal(guardComparison(ready, other, JSON.stringify({ mode: "answer", text: "较新一节更快。", citations: ["new", "old"], nextStep: null })).mode, "unavailable")
  assert.equal(guardComparison(ready, other, JSON.stringify({ mode: "answer", text: "无法判断哪节更快。", citations: ["new", "old"], nextStep: null })).mode, "answer")
  const oneSide = guardComparison(ready, other, JSON.stringify({ mode: "answer", text: "只引用较新一节", citations: [ready.occurrenceId], nextStep: null }))
  assert.equal(oneSide.mode, "unavailable")
  assert.throws(() => assertCoachPacket({ ...ready, running: Array.from({ length: 49 }, () => ready.running?.[0]).filter((item): item is NonNullable<typeof item> => item != null) }), /bad evidence packet/)
  assert.equal(readCompareIds(JSON.stringify({ compareIds: ["new", "missing"] }), ["new", "old"]), null)
  const conflict = guardComparison({ ...briefs.newer, duplicateCount: 2 }, briefs.older, JSON.stringify({ mode: "answer", text: "信第一条", citations: [briefs.newer.occurrenceId], nextStep: "下一课加量" }))
  assert.equal(conflict.mode, "ask")
  assert.equal(conflict.text.includes("重复"), true)
  const high = guardComparison({ ...briefs.newer, sessionRpe: 8, sleepHours: null, subjectiveRecovery: null }, briefs.older, JSON.stringify({ mode: "answer", text: "保持原计划", citations: [briefs.newer.occurrenceId ?? ""], nextStep: "下一课加一组" }))
  assert.equal(high.mode, "ask")
  assert.equal(high.nextStep, null)
  const oldSnapshot = getRunningPlanSnapshot("old")!
  recordRunningRepetitionCompleted({ trainingOccurrenceId: "old", runningSnapshotId: oldSnapshot.runningSnapshotId, componentId: "intervals", blockId: "b1", stepId: "s200", roundOrdinal: 1, repeatOrdinal: 1, actualDistanceMeters: 200, actualDurationSeconds: 36 })
  const completed = separateBriefs(null, "这两节同一重复有什么差异", "new", "old")!
  const pairs = pairedRunningObservations(completed.newer, completed.older)
  assert.equal(pairs.length, 1)
  assert.match(pairs[0]!.newer.actual, /200米\/33秒/)
  assert.match(pairs[0]!.older.actual, /200米\/36秒/)
  assert.equal(pairedRunningObservations({ ...completed.newer, running: completed.newer.running?.map((slot) => ({ ...slot, status: "DUPLICATE_UNRESOLVED" })) }, completed.older).length, 0)
  const newerEvent = pairs[0]!.newer.sourceEventIds[0]!
  const olderEvent = pairs[0]!.older.sourceEventIds[0]!
  const citedTimes = guardComparison(completed.newer, completed.older, JSON.stringify({ mode: "answer", text: "较新这一次记录 33 秒，较旧同一重复记录 36 秒；不能据此判断长期能力。", citations: [newerEvent, olderEvent], nextStep: null }))
  assert.equal(citedTimes.mode, "answer")
  assert.equal(guardComparison(completed.newer, completed.older, JSON.stringify({ mode: "answer", text: "较新一节 36 秒，较旧一节 33 秒。", citations: [newerEvent, olderEvent], nextStep: null })).mode, "unavailable")
  assert.equal(guardComparison(completed.newer, completed.older, JSON.stringify({ mode: "answer", text: "新课 33 秒，旧课 36 秒。", citations: [newerEvent, olderEvent], nextStep: null })).mode, "answer")
  assert.equal(guardComparison(completed.newer, completed.older, JSON.stringify({ mode: "answer", text: "新课 33 秒，旧课 36 秒；较新比旧课快 3 秒。", citations: [newerEvent, olderEvent], nextStep: null })).mode, "answer")
  assert.equal(guardComparison(completed.newer, completed.older, JSON.stringify({ mode: "answer", text: "这一重复较新更快，但不能据此判断长期能力。", citations: [newerEvent, olderEvent], nextStep: null })).mode, "answer")
  assert.equal(guardComparison(completed.newer, completed.older, JSON.stringify({ mode: "answer", text: "能力提高了。", citations: [newerEvent, olderEvent], nextStep: null })).mode, "unavailable")
  assert.equal(guardComparison(completed.newer, completed.older, JSON.stringify({ mode: "answer", text: "同一重复的已记录用时相差 3 秒，不能据此判断长期能力。", citations: [newerEvent, olderEvent], nextStep: null })).mode, "answer")
  assert.equal(guardComparison(completed.newer, completed.older, JSON.stringify({ mode: "answer", text: "较新 33 秒，较旧 36 秒。", citations: ["new", "old"], nextStep: null })).mode, "unavailable")
  assert.equal(guardComparison(completed.newer, completed.older, JSON.stringify({ mode: "answer", text: "较新 32 秒，较旧 36 秒。", citations: [newerEvent, olderEvent], nextStep: null })).mode, "unavailable")
  const recovery = { kind: "RECOVERY" as const, position: "intervals/b1/AFTER_REPEAT 第1轮", status: "RECORDED", planned: "60秒", actual: "40秒", sourceEventIds: ["rest-new"] }
  const newerWithRest = { ...completed.newer, sourceIds: [...completed.newer.sourceIds, "rest-new"], running: [...(completed.newer.running ?? []), recovery] }
  const olderWithRest = { ...completed.older, sourceIds: [...completed.older.sourceIds, "rest-old"], running: [...(completed.older.running ?? []), { ...recovery, actual: "65秒", sourceEventIds: ["rest-old"] }] }
  assert.equal(pairedRunningObservations(newerWithRest, olderWithRest).some((pair) => pair.kind === "RECOVERY"), true)
  assert.equal(guardComparison(newerWithRest, olderWithRest, JSON.stringify({ mode: "answer", text: "已记录恢复 40 秒和 65 秒。", citations: ["rest-new", "rest-old"], nextStep: null })).mode, "answer")
  assert.equal(guardComparison(newerWithRest, olderWithRest, JSON.stringify({ mode: "answer", text: "两边计划恢复 60 秒，实际分别记录 40 秒和 65 秒。", citations: ["rest-new", "rest-old"], nextStep: null })).mode, "answer")
  const before = loadEvents().length
  assert.equal(recordCoachChoice({ choice: "reject", question: "比较" }).planChanged, false)
  assert.equal(loadEvents().length, before + 1)
  assert.equal(loadEvents().at(-1)?.event_type, "USER_REJECTED")
  assert.equal(dispatchEvent("RPE_RECORDED", { evidenceType: "SESSION_RPE", value: 9, trainingOccurrenceId: "new" }) == null, false)
})
