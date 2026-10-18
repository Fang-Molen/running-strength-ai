import assert from "node:assert/strict"
import test from "node:test"
import { deriveCoachBrief, type CoachParts } from "./coach-brief.ts"
import { coachQuestionIntent, compactSingleCoachPacket } from "./coach-model-packet.ts"

function brief(question: string) {
  const parts: CoachParts = {
    question,
    occurrenceId: "train-a",
    runningStructure: "AVAILABLE",
    sessionRpe: 5,
    sleepHours: 7,
    subjectiveRecovery: 6,
    recoveryState: "SIGNAL_PRESENT",
    fatigueState: "NO_RELEVANT_EVIDENCE",
    duplicateCount: 0,
    repetitionSlots: 1,
    continuousCount: 0,
    plannedSetCount: 3,
    completedSetCount: 2,
    durationSec: 1800,
    pain: false,
    soreness: true,
    musculoskeletalState: "SIGNAL_PRESENT",
    daysToCompetition: 10,
    week: 4,
    bias: "deload",
    sourceIds: ["train-a", "sore", "rpe", "recovery", "rep", "context:competition", "context:cycle"],
    sources: [
      { id: "train-a", kind: "FACT", detail: "训练开始" },
      { id: "sore", kind: "FACT", detail: "SORENESS 酸痛：5/10；部位 大腿" },
      { id: "rpe", kind: "FACT", detail: "SESSION_RPE 本次主观强度：5/10" },
      { id: "recovery", kind: "FACT", detail: "SUBJECTIVE_RECOVERY 本次主观恢复：6/10" },
      { id: "rep", kind: "FACT", detail: "REPETITION 第1次：COMPLETED；实际 200米/35秒" },
      { id: "context:competition", kind: "CONTEXT", detail: "距比赛 10 天" },
      { id: "context:cycle", kind: "CONTEXT", detail: "第 4 周；bias deload" },
    ],
    running: [{ kind: "REPETITION", position: "第1次", status: "COMPLETED", planned: "200米", actual: "200米/35秒", sourceEventIds: ["rep"] }],
  }
  return deriveCoachBrief(parts)
}

test("coach questions are routed before the model sees the packet", () => {
  assert.equal(coachQuestionIntent("左膝疼痛后怎么分阶段恢复训练"), "RETURN")
  assert.equal(coachQuestionIntent("下一课要不要减量"), "NEXT_SESSION")
  assert.equal(coachQuestionIntent("最近三次同一重复有什么变化"), "SERIES")
  assert.equal(coachQuestionIntent("比较两节课谁更快"), "COMPARE")
  assert.equal(coachQuestionIntent("这次掉速是不是吃少了"), "FUEL")
  assert.equal(coachQuestionIntent("200 米这次用了多少秒"), "RUNNING")
})

test("next-session packet retains measured running evidence and required safety context", () => {
  const source = brief("下一课要不要调整")
  const packet = compactSingleCoachPacket(source, [], [])
  assert.equal(packet.intent, "NEXT_SESSION")
  assert.ok("running" in packet.current); assert.deepEqual((packet.current as {running:unknown}).running,source.running)
  assert.equal(packet.current.sourceIds.includes("sore"), true)
  assert.equal(packet.current.sourceIds.includes("context:competition"), true)
  assert.equal(packet.current.sourceIds.includes("context:cycle"), true)
  assert.equal(packet.current.sourceIds.includes("rep"), true)
  assert.equal(JSON.stringify(packet).length < JSON.stringify({ history: [], current: source, candidates: [] }).length, true)
})

test("running and fuel packets retain mandatory safety sources without unrelated running payload", () => {
  const run = compactSingleCoachPacket(brief("200 米这次用了多少秒"), [], [])
  assert.equal(run.intent, "RUNNING")
  assert.equal(run.current.sourceIds.includes("rep"), true)
  for (const id of brief("200 米这次用了多少秒").nextSession?.requiredSourceIds ?? []) assert.ok(run.current.sourceIds.includes(id)); assert.ok(run.current.sourceIds.includes("sore"))

  const fuel = compactSingleCoachPacket(brief("这次掉速是不是吃少了"), [], [])
  assert.equal(fuel.intent, "FUEL")
  assert.equal(fuel.current.sourceIds.includes("rep"), false)
})
