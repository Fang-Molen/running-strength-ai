import assert from "node:assert/strict"
import test from "node:test"
import { assertCoachPacket, deriveCoachBrief, guardCoachResponse, type CoachParts } from "./coach-brief.ts"
import { fuelForTraining } from "./coach-fuel.ts"
import type { FoodEntry } from "@/lib/nutrition/log"

const now = "2026-10-07T16:30:00.000Z" // 00:30 on October 8 in Shanghai
const start = "2026-10-07T17:00:00.000Z"
const food: FoodEntry = { id: "meal-1", date: "2026-10-08", meal: "早餐", name: "记录", grams: 100, kcal: 400 }

function brief(fuel: ReturnType<typeof fuelForTraining>) {
  const sources: NonNullable<CoachParts["sources"]> = [{ id: "start", kind: "FACT", detail: "训练开始" }]
  if (fuel.logSourceId) sources.push({ id: fuel.logSourceId, kind: "DERIVED", detail: "本地饮食记录，未确认全天完整" })
  if (fuel.targetSourceId) sources.push({ id: fuel.targetSourceId, kind: "CONTEXT", detail: "今日热量目标" })
  const parts: CoachParts = {
    question: "今天掉速是不是能力不够", occurrenceId: "start", runningStructure: "AVAILABLE",
    sessionRpe: 5, sleepHours: 8, subjectiveRecovery: 6, recoveryState: null, fatigueState: null,
    duplicateCount: 0, repetitionSlots: 2, continuousCount: 0, plannedSetCount: null,
    completedSetCount: null, durationSec: null, pain: false, daysToCompetition: null,
    week: 2, bias: "build", sourceIds: sources.map((source) => source.id), sources, running: [], fuel,
  }
  return deriveCoachBrief(parts)
}

test("fuel stays on the Shanghai training day and absence is unknown, never zero", () => {
  const matched = fuelForTraining(start, now, [food], 1854)
  assert.equal(matched.status, "SAME_DAY_RECORDED")
  assert.equal(matched.recordedKcal, 400)
  assert.equal(matched.targetKcal, 1854)
  assertCoachPacket(brief(matched))
  const empty = fuelForTraining(start, now, [], 1854)
  assert.equal(empty.status, "NO_RECORD")
  assert.equal(empty.recordedKcal, null)
  assert.equal(empty.logSourceId, null)
  const older = fuelForTraining("2026-10-07T15:30:00.000Z", now, [food], 1854)
  assert.equal(older.status, "DIFFERENT_DAY")
  assert.equal(older.recordedKcal, null)
  assert.equal(older.targetKcal, null)
  assert.throws(() => assertCoachPacket(brief({ ...matched, recordedKcal: 0 })), /bad fuel packet/)
})

test("fuel answers require both sources and cannot turn partial logs into a cause", () => {
  const matched = brief(fuelForTraining(start, now, [food], 1854))
  const citations = [matched.occurrenceId, matched.fuel?.logSourceId, matched.fuel?.targetSourceId]
  const raw = (text: string, refs = citations) => JSON.stringify({ mode: "answer", text, citations: refs, nextStep: null })
  const safe = guardCoachResponse(matched, raw("已记录摄入 400 千卡，目标 1854 千卡；记录可能未记全，不能据此判断掉速原因。"))
  assert.equal(safe.mode, "answer")
  assert.equal(guardCoachResponse(matched, raw("已记录摄入 400 千卡，目标 1854 千卡；不能据此确认热量赤字，也不能证明能力不足。" )).mode, "answer")
  assert.equal(guardCoachResponse(matched, raw("已记录摄入 400 千卡，目标 1854 千卡。", [matched.occurrenceId])).mode, "unavailable")
  assert.equal(guardCoachResponse(matched, raw("热量赤字导致掉速，说明能力不够。" )).mode, "unavailable")
  const absent = brief(fuelForTraining(start, now, [], 1854))
  assert.equal(guardCoachResponse(absent, raw("今天摄入 0 千卡。", ["start"])).mode, "unavailable")
  const different = brief(fuelForTraining("2026-10-07T15:30:00.000Z", now, [food], 1854))
  assert.equal(guardCoachResponse(different, raw("已记录摄入 400 千卡。", ["start"])).mode, "unavailable")
  assert.equal(guardCoachResponse(absent, JSON.stringify({ mode: "ask", text: "这天的饮食有没有记录完整？", citations: [], nextStep: null })).mode, "ask")
})
