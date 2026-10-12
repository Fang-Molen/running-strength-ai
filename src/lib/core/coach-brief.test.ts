import assert from "node:assert/strict"
import test from "node:test"
import type { Session } from "@/lib/strength/model"
import { assembleCoachBrief, deriveCoachBrief, guardCoachResponse, guardSubcode, recordCoachBodyEvidence, recordCoachChoice, recordCoachEvidence, softenUnrecordedSets, type CoachParts } from "./coach-brief.ts"
import { EVENTS_KEY, EVENT_JOURNAL_PREFIX } from "./events.ts"
import { loadEvents } from "./events.ts"
import { bindTrainingStart, listTrainingOccurrences } from "./occurrence.ts"
import { saveRunningPlan } from "./running-plan.ts"
import { setStoreBackend, type MemoryStore, writeEnvelope } from "./storage.ts"
import type { AppEvent } from "./types.ts"

function memory(): MemoryStore & { dump: Map<string, string> } {
  const dump = new Map<string, string>()
  return { dump, keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null, setItem: (key, value) => void dump.set(key, value) }
}

function parts(extra: Partial<CoachParts> = {}): CoachParts {
  return {
    question: "下一次间歇要不要调整",
    occurrenceId: "occ",
    runningStructure: "AVAILABLE",
    sessionRpe: 5,
    sleepHours: 7,
    recoveryState: "SIGNAL_PRESENT",
    fatigueState: "NO_RELEVANT_EVIDENCE",
    duplicateCount: 0,
    repetitionSlots: 2,
    continuousCount: 0,
    plannedSetCount: 3,
    completedSetCount: 3,
    durationSec: 1800,
    pain: false,
    daysToCompetition: null,
    week: 2,
    bias: "build",
    sourceIds: ["occ"],
    ...extra,
  }
}

function event(id: string, type: AppEvent["event_type"], payload: Record<string, unknown>): AppEvent {
  return { event_id: id, athlete_id: "local", timestamp: "2026-10-07T08:00:00.000Z", event_type: type, source: "MANUAL", payload, confidence: 1, data_quality: "HIGH", context: {}, cycle_id: "local-cycle", schema_version: 1 }
}

function strength(): Session {
  return { id: "strength-a", name: "下肢", moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 3, mode: "reps", amount: 8, restSec: 90, weightKg: 60 }] }
}

test("coach brief separates enough evidence from gaps and frozen limits", () => {
  assert.deepEqual(deriveCoachBrief(parts()).mustAsk, [])
  assert.deepEqual(deriveCoachBrief(parts({ sessionRpe: null, recoveryState: "NO_RELEVANT_EVIDENCE" })).mustAsk, []) // factual questions remain answerable
  assert.equal(deriveCoachBrief(parts({ duplicateCount: 2 })).mustAsk.includes("DUPLICATE_UNRESOLVED"), true)
  assert.equal(deriveCoachBrief(parts({ occurrenceId: null, runningStructure: "UNAVAILABLE", repetitionSlots: 0 })).runningStructure, "UNAVAILABLE")
  const hard = deriveCoachBrief(parts({ sessionRpe: 8, sleepHours: null, recoveryState: "NO_RELEVANT_EVIDENCE" }))
  assert.deepEqual(hard.mustAsk, [])
  assert.equal(JSON.stringify(hard).includes("恢复不足"), false)
  const pain = deriveCoachBrief(parts({ pain: true }))
  assert.equal(pain.constraints.medicalReferral, true)
  assert.equal(pain.constraints.increaseBlocked, true)
  const race = deriveCoachBrief(parts({ daysToCompetition: 10 }))
  assert.equal(race.constraints.increaseBlocked, true)
  assert.match(race.constraints.blockReason ?? "", /28/)
  assert.equal(deriveCoachBrief(parts({ week: 4 })).constraints.increaseBlocked, true)
  const guarded = guardCoachResponse(hard, JSON.stringify({ mode: "answer", text: "先核对训练", citations: ["missing"], nextStep: "复盘下一课" }))
  assert.equal(guarded.mode, "ask")
  assert.equal(guarded.planChanged, false)
  assert.equal(guarded.nextStep, null)
  const noRpeIncrease = guardCoachResponse(deriveCoachBrief(parts({ sessionRpe: null })), JSON.stringify({ mode: "answer", text: "下一课加一组。", citations: ["occ"], nextStep: null }))
  assert.equal(noRpeIncrease.mode, "ask")
  const highRpeIncrease = guardCoachResponse(hard, JSON.stringify({ mode: "answer", text: "RPE 偏高，但下次提速。", citations: ["occ"], nextStep: null }))
  assert.equal(highRpeIncrease.mode, "ask")
  const blocked = guardCoachResponse(race, JSON.stringify({ mode: "answer", text: "下次加量", citations: ["occ"], nextStep: "下次加量" }))
  assert.equal(blocked.mode, "unavailable")
  assert.equal(blocked.nextStep, null)
  const painful = guardCoachResponse(deriveCoachBrief(parts({ pain: true })), JSON.stringify({ mode: "answer", text: "下一课加重", citations: ["occ"], nextStep: null }))
  assert.equal(painful.mode, "unavailable")
  assert.equal(painful.text.includes("评估"), true)
  assert.equal(painful.planChanged, false)
  const safe = guardCoachResponse(race, JSON.stringify({ mode: "answer", text: "赛前不加量，保持原计划。", citations: ["occ"], nextStep: null }))
  assert.equal(safe.mode, "answer")
  const cited = guardCoachResponse(deriveCoachBrief(parts()), JSON.stringify({ mode: "answer", text: "计划有三组", citations: ["occ", "invented"], nextStep: null }))
  assert.deepEqual(cited.citations, ["occ"])
  const uncited = guardCoachResponse(deriveCoachBrief(parts()), JSON.stringify({ mode: "answer", text: "计划有三组", citations: ["invented"], nextStep: null }))
  assert.equal(uncited.mode, "unavailable")
  assert.equal(deriveCoachBrief(parts()).returnToTraining?.clearance, "UNKNOWN")
  assert.equal(deriveCoachBrief(parts()).nextSession?.status, "KEEP_ONLY")
  const unsupportedIncrease = guardCoachResponse(deriveCoachBrief(parts()), JSON.stringify({ mode: "answer", text: "证据齐了，下一课可以加一组。", citations: ["occ"], nextStep: null }))
  assert.equal(unsupportedIncrease.mode, "unavailable")
  assert.match(unsupportedIncrease.text, /不能据此批准增加训练/)
  const falseReturn = guardCoachResponse(deriveCoachBrief(parts()), JSON.stringify({ mode: "answer", text: "已经安全回归，可以恢复正常训练。", citations: ["occ"], nextStep: null }))
  assert.equal(falseReturn.mode, "unavailable")
  assert.equal(guardCoachResponse(deriveCoachBrief(parts()), JSON.stringify({ mode: "answer", text: "已经安全回归。", citations: ["occ"], nextStep: null })).mode, "unavailable")
  assert.match(falseReturn.text, /恢复或伤病|医学清除/)
  const cautiousReturn = guardCoachResponse(deriveCoachBrief(parts()), JSON.stringify({ mode: "answer", text: "现有证据不能确认已经恢复正常训练，也不能说明没有疼痛。", citations: ["occ"], nextStep: null }))
  assert.equal(cautiousReturn.mode, "answer")
  const returnQuestion = guardCoachResponse(deriveCoachBrief(parts()), JSON.stringify({ mode: "ask", text: "你现在是否已经恢复正常训练？", citations: [], nextStep: null }))
  assert.equal(returnQuestion.mode, "ask")
  assert.equal(guardCoachResponse(deriveCoachBrief(parts()), JSON.stringify({ mode: "answer", text: "目前没有疼痛，可以恢复正常训练。", citations: ["occ"], nextStep: null })).mode, "unavailable")
  const sourcedAdviceBrief = deriveCoachBrief(parts({
    sessionRpe: 8,
    subjectiveRecovery: 3,
    sourceIds: ["occ", "rpe", "recovery"],
    sources: [
      { id: "occ", kind: "FACT", detail: "训练开始" },
      { id: "rpe", kind: "FACT", detail: "SESSION_RPE 本次主观强度：8/10" },
      { id: "recovery", kind: "FACT", detail: "SUBJECTIVE_RECOVERY 本次主观恢复：3/10" },
    ],
  }))
  assert.equal(guardCoachResponse(sourcedAdviceBrief, JSON.stringify({ mode: "answer", text: "下一课建议减量。", citations: ["rpe"], nextStep: null })).mode, "unavailable")
  assert.equal(guardCoachResponse(sourcedAdviceBrief, JSON.stringify({ mode: "answer", text: "下一课建议减量。", citations: ["rpe", "recovery"], nextStep: null })).mode, "answer")
})

test("legacy and mixed sessions stay traceable, and rejection does not change the plan", () => {
  setStoreBackend(memory())
  writeEnvelope(EVENTS_KEY, [event("legacy", "TRAINING_STARTED", { sessionId: "strength-a", decisionId: "d1" }), event("whole", "RUN_COMPLETED", { km: 8, seconds: 2400 })])
  bindTrainingStart({ startEventId: "legacy", startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: strength() })
  const legacy = assembleCoachBrief(null, "上一课为什么这么累")
  assert.equal(legacy.runningStructure, "UNAVAILABLE")
  assert.equal(legacy.repetitionSlots, 0)
  setStoreBackend(memory())
  saveRunningPlan({ planId: "run", planSlotId: "strength-a", components: [{ componentId: "run", modality: "RUNNING", purpose: "INTERVAL", structure: { kind: "REPEATED", blocks: [{ blockId: "b", roundCount: 1, recoveryAfterRoundSeconds: null, steps: [{ stepId: "s", plannedDistanceMeters: 600, plannedDurationSeconds: 82, repeatCount: 2, recoveryAfterRepeatSeconds: 120, recoveryBeforeNextStepSeconds: null }] }] } }, { componentId: "lift", modality: "STRENGTH", strengthSessionId: "strength-a" }] })
  writeEnvelope(EVENTS_KEY, [event("occ", "TRAINING_STARTED", { sessionId: "strength-a", decisionId: "d1" }), event("rpe", "RPE_RECORDED", { evidenceType: "SESSION_RPE", value: 8, trainingOccurrenceId: "occ" }), event("pain", "PAIN_RECORDED", { trainingOccurrenceId: "occ", location: "膝" })])
  bindTrainingStart({ startEventId: "occ", startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: strength(), runningPlanId: "run" })
  const mixed = assembleCoachBrief({ name: "混合", sessions: [strength()] }, "我今天该怎么练")
  assert.equal(mixed.repetitionSlots, 2)
  assert.equal(mixed.plannedSetCount, 3)
  assert.equal(mixed.sessionRpe, 8)
  assert.equal(mixed.pain, true)
  assert.equal(mixed.running?.[0]?.position.includes("第1轮第1次"), true)
  assert.equal(mixed.sources?.some((source) => source.detail.includes("已记录完成 0 组")), true)
  assert.equal(mixed.sources?.some((source) => source.detail.includes("不能推断为实际没做")), true)
  assert.equal(mixed.sources?.some((source) => source.detail.includes("实际完成")), false)
  assert.equal(mixed.sources?.some((source) => source.id === "rpe"), true)
  assert.equal(mixed.sources?.some((source) => source.id === "pain"), true)
  assert.equal(assembleCoachBrief(null, "哪次", null).occurrenceId, null)
  const before = loadEvents().length
  const choice = recordCoachChoice({ choice: "reject", question: "我今天该怎么练" })
  assert.equal(choice.planChanged, false)
  assert.equal(loadEvents().at(-1)?.event_type, "USER_REJECTED")
  assert.equal(loadEvents().length, before + 1)
})

test("explicitly confirmed follow-up evidence is bound once; duplicate and old data cannot be silently resolved", () => {
  setStoreBackend(memory())
  writeEnvelope(EVENTS_KEY, [event("start", "TRAINING_STARTED", { sessionId: "strength-a", decisionId: "d1" })])
  bindTrainingStart({ startEventId: "start", startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: strength() })
  assert.equal(recordCoachEvidence("missing", { sessionRpe: 8 }).ok, false)
  assert.equal(recordCoachEvidence("start", { sessionRpe: 0 }).ok, false)
  const before = loadEvents().length
  assert.equal(recordCoachEvidence("start", { sessionRpe: 8, subjectiveRecovery: 3 }).ok, true)
  assert.equal(loadEvents().length, before + 2)
  assert.equal(recordCoachEvidence("start", { sessionRpe: 5 }).ok, false)
  const brief = assembleCoachBrief(null, "下一课要加量吗", "start")
  assert.equal(brief.sessionRpe, 8)
  assert.equal(brief.subjectiveRecovery, 3)
  assert.equal(brief.runningStructure, "UNAVAILABLE")
  assert.equal(brief.sources?.some((source) => source.detail.includes("SUBJECTIVE_RECOVERY")), true)
  writeEnvelope(EVENTS_KEY, [...loadEvents(), event("second", "RPE_RECORDED", { evidenceType: "SESSION_RPE", value: 6, trainingOccurrenceId: "start" })])
  const conflict = assembleCoachBrief(null, "这次 RPE 多少", "start")
  assert.equal(conflict.sessionRpe, null)
  assert.equal(conflict.duplicateCount > 0, true)
  assert.equal(guardCoachResponse(conflict, JSON.stringify({ mode: "answer", text: "RPE 8", citations: ["second"], nextStep: null })).mode, "ask")
  const zero = guardCoachResponse(deriveCoachBrief(parts({ plannedSetCount: 3, completedSetCount: 0, sourceIds: ["occ"] })), JSON.stringify({ mode: "answer", text: "这次力量训练完成量为零，一组都没做。", citations: ["occ"], nextStep: null }))
  assert.equal(zero.text.includes("训练完成量为零"), false)
  assert.equal(zero.text.includes("一组都没"), false)
  assert.equal(zero.text.includes("已记录完成 0 组"), true)
  assert.equal(zero.text.includes("不能推断为实际没做"), true)
  assert.equal(softenUnrecordedSets({ plannedSetCount: 3, completedSetCount: 0 }, "已记录完成 0 组"), "已记录完成 0 组")
})

test("coach cites bound recovery and soreness without treating soreness as pain", () => {
  setStoreBackend(memory())
  writeEnvelope(EVENTS_KEY, [
    event("start", "TRAINING_STARTED", { sessionId: "strength-a" }),
    event("recovery", "SUBJECTIVE_FEEDBACK", { evidenceType: "SUBJECTIVE_RECOVERY", value: 3, trainingOccurrenceId: "start" }),
    event("sleep", "SLEEP_RECORDED", { hours: 6.5, trainingOccurrenceId: "start" }),
    event("sore", "SUBJECTIVE_FEEDBACK", { evidenceType: "SORENESS", location: "大腿", intensity: 5, trainingOccurrenceId: "start" }),
    event("loose-pain", "PAIN_RECORDED", { location: "膝", intensity: 8 }),
    event("loose-recovery", "SUBJECTIVE_FEEDBACK", { evidenceType: "SUBJECTIVE_RECOVERY", value: 9 }),
  ])
  bindTrainingStart({ startEventId: "start", startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: strength() })
  const brief = assembleCoachBrief(null, "这次恢复和腿部感觉如何", "start")
  assert.equal(brief.subjectiveRecovery, 3)
  assert.equal(brief.sleepHours, 6.5)
  assert.equal(brief.soreness, true)
  assert.equal(brief.pain, false)
  assert.equal(brief.constraints.medicalReferral, false)
  assert.equal(brief.musculoskeletalState, "SIGNAL_PRESENT")
  assert.match(brief.sources?.find((source) => source.id === "sore")?.detail ?? "", /酸痛：5\/10；部位 大腿/)
  assert.match(brief.sources?.find((source) => source.id === "recovery")?.detail ?? "", /本次主观恢复：3\/10/)
  assert.equal(brief.sourceIds.includes("loose-pain"), false)
  assert.equal(brief.sourceIds.includes("loose-recovery"), false)
  assert.equal(guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "本次已记录疼痛。", citations: ["start"], nextStep: null })).mode, "unavailable")
  assert.equal(guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "没有疼痛，可以加量。", citations: ["start"], nextStep: null })).mode, "unavailable")
  assert.equal(guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "已记录大腿酸痛。", citations: ["sore"], nextStep: null })).mode, "answer")
  assert.equal(guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "尚未能判断是否恢复正常。", citations: ["recovery"], nextStep: null })).mode, "answer")
  const answer = guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "记录了大腿酸痛和恢复感 3 分，下一课先核对恢复变化。", citations: ["sore", "recovery"], nextStep: null }))
  assert.equal(answer.mode, "answer")
  assert.equal(answer.medicalReferral, false)
  assert.equal(guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "恢复感 3 分", citations: ["start"], nextStep: null })).mode, "unavailable")
  assert.equal(guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "酸痛 5 分", citations: ["recovery"], nextStep: null })).mode, "unavailable")
  assert.equal(guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "睡眠 6.5 小时", citations: ["sore"], nextStep: null })).mode, "unavailable")
  assert.equal(guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "睡眠 6.5 小时", citations: ["sleep"], nextStep: null })).mode, "answer")
  assert.equal(guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "恢复感 3 分，酸痛 5 分", citations: ["recovery", "sore"], nextStep: null })).mode, "answer")
  const falseDiagnosis = guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "大腿酸痛就是受伤，已完全恢复。", citations: ["sore"], nextStep: null }))
  assert.equal(falseDiagnosis.mode, "unavailable")
  const falseClearance = guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "没有伤病风险，可以继续。", citations: ["sore"], nextStep: null }))
  assert.equal(falseClearance.mode, "unavailable")
  assert.equal(loadEvents().length, 6)
})

test("a bound pain or soreness return boundary is not erased by a missing RPE", () => {
  const pain = deriveCoachBrief(parts({
    question: "左膝疼痛后怎么分阶段恢复训练",
    sessionRpe: null,
    sleepHours: null,
    subjectiveRecovery: null,
    pain: true,
    sourceIds: ["occ", "pain"],
    sources: [
      { id: "occ", kind: "FACT", detail: "训练开始" },
      { id: "pain", kind: "FACT", detail: "PAIN 疼痛：4/10；部位 左膝" },
    ],
  }))
  const painAnswer = guardCoachResponse(pain, JSON.stringify({
    mode: "answer",
    text: "先停止诱发疼痛的动作，只保持或减量；必要时做运动医学或康复评估，这不是诊断。",
    citations: ["pain"],
    nextStep: "先核对当前症状，再决定是否继续保持或减量。",
  }))
  assert.equal(painAnswer.mode, "answer")
  assert.equal(painAnswer.citations.includes("pain"), true)

  const soreness = deriveCoachBrief(parts({
    question: "大腿酸痛后如何逐步回到训练",
    sessionRpe: null,
    sleepHours: null,
    subjectiveRecovery: null,
    soreness: true,
    sourceIds: ["occ", "sore"],
    sources: [
      { id: "occ", kind: "FACT", detail: "训练开始" },
      { id: "sore", kind: "FACT", detail: "SORENESS 酸痛：5/10；部位 大腿" },
    ],
  }))
  assert.equal(guardCoachResponse(soreness, JSON.stringify({
    mode: "answer",
    text: "已记录的是大腿酸痛；酸痛不等于疼痛或伤病诊断，先保持或减量并核对当前感觉。",
    citations: ["sore"],
    nextStep: "确认当前症状后再复盘。",
  })).mode, "answer")
  assert.equal(guardCoachResponse(soreness, JSON.stringify({
    mode: "answer",
    text: "先保持或减量并核对当前感觉。",
    citations: ["occ"],
    nextStep: null,
  })).mode, "unavailable")
  assert.equal(guardCoachResponse(soreness, JSON.stringify({
    mode: "answer",
    text: "下一课加一组。",
    citations: ["sore"],
    nextStep: null,
  })).mode, "unavailable")
})

test("conflicting recovery is unresolved while bound pain remains distinct and cited", () => {
  setStoreBackend(memory())
  writeEnvelope(EVENTS_KEY, [
    event("start", "TRAINING_STARTED", { sessionId: "strength-a" }),
    event("recovery-a", "SUBJECTIVE_FEEDBACK", { evidenceType: "SUBJECTIVE_RECOVERY", value: 3, trainingOccurrenceId: "start" }),
    event("recovery-b", "RPE_RECORDED", { evidenceType: "SUBJECTIVE_RECOVERY", value: 8, trainingOccurrenceId: "start" }),
    event("pain", "PAIN_RECORDED", { location: "膝", intensity: 4, trainingOccurrenceId: "start" }),
  ])
  bindTrainingStart({ startEventId: "start", startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: strength() })
  const brief = assembleCoachBrief(null, "能否加量", "start")
  assert.equal(brief.subjectiveRecovery, null)
  assert.equal(brief.duplicateCount > 0, true)
  assert.equal(brief.pain, true)
  assert.equal(brief.constraints.medicalReferral, true)
  assert.match(brief.sources?.find((source) => source.id === "pain")?.detail ?? "", /疼痛：4\/10；部位 膝/)
  assert.equal(guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "恢复 8 分，可以加量", citations: ["recovery-b"], nextStep: null })).mode, "ask")
})

test("confirmed body feedback writes only its own bound event and does not infer an injury", () => {
  const box = memory()
  setStoreBackend(box)
  writeEnvelope(EVENTS_KEY, [event("start", "TRAINING_STARTED", { sessionId: "strength-a" })])
  bindTrainingStart({ startEventId: "start", startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: strength() })
  const originalOccurrence = JSON.stringify(listTrainingOccurrences())
  const otherStorage = [...box.dump].filter(([key]) => key !== EVENTS_KEY && !key.startsWith(EVENT_JOURNAL_PREFIX))
  assert.equal(recordCoachBodyEvidence("missing", { kind: "PAIN", location: "左膝", intensity: 4 }).ok, false)
  assert.equal(recordCoachBodyEvidence("start", { kind: "SORENESS", location: "", intensity: 4 }).ok, false)
  assert.equal(recordCoachBodyEvidence("start", { kind: "PAIN", location: "左膝", intensity: 0 }).ok, false)
  assert.equal(loadEvents().length, 1)
  assert.equal(recordCoachBodyEvidence("start", { kind: "SORENESS", location: " 大腿 ", intensity: 5 }).ok, true)
  assert.equal(loadEvents().at(-1)?.event_type, "SUBJECTIVE_FEEDBACK")
  assert.equal(loadEvents().at(-1)?.payload.evidenceType, "SORENESS")
  assert.equal(loadEvents().at(-1)?.payload.trainingOccurrenceId, "start")
  assert.equal(recordCoachBodyEvidence("start", { kind: "SORENESS", location: "大腿", intensity: 5 }).ok, false)
  assert.equal(loadEvents().length, 2)
  const sore = assembleCoachBrief(null, "腿部怎么样", "start")
  assert.equal(sore.pain, false)
  assert.equal(sore.soreness, true)
  assert.equal(sore.constraints.medicalReferral, false)
  assert.equal(recordCoachBodyEvidence("start", { kind: "PAIN", location: "左膝", intensity: 4 }).ok, true)
  assert.equal(loadEvents().at(-1)?.event_type, "PAIN_RECORDED")
  assert.equal(loadEvents().at(-1)?.payload.trainingOccurrenceId, "start")
  const painful = assembleCoachBrief(null, "膝痛怎么处理", "start")
  assert.equal(painful.pain, true)
  assert.equal(painful.constraints.increaseBlocked, true)
  assert.equal(painful.constraints.medicalReferral, true)
  assert.equal(painful.sources?.some((source) => source.detail.includes("部位 左膝")), true)
  assert.equal(JSON.stringify(listTrainingOccurrences()), originalOccurrence)
  assert.deepEqual([...box.dump].filter(([key]) => key !== EVENTS_KEY && !key.startsWith(EVENT_JOURNAL_PREFIX)), otherStorage)
  assert.equal(loadEvents().length, 3)
})

test("coach will not duplicate a recovery already recorded through subjective feedback", () => {
  setStoreBackend(memory())
  writeEnvelope(EVENTS_KEY, [
    event("start", "TRAINING_STARTED", { sessionId: "strength-a" }),
    event("prior", "SUBJECTIVE_FEEDBACK", { evidenceType: "SUBJECTIVE_RECOVERY", value: 4, trainingOccurrenceId: "start" }),
  ])
  bindTrainingStart({ startEventId: "start", startedAt: "2026-10-07T08:00:00.000Z", sessionId: "strength-a", planSlotId: "strength-a", plan: strength() })
  assert.equal(recordCoachEvidence("start", { subjectiveRecovery: 5 }).ok, false)
  assert.equal(loadEvents().length, 2)
  assert.equal(assembleCoachBrief(null, "恢复感是多少", "start").subjectiveRecovery, 4)
})

test("high RPE without recovery must ask, and soreness return must separate pain", () => {
  const gap = deriveCoachBrief(parts({
    question: "疼痛后怎么分阶段恢复训练？",
    sessionRpe: 8,
    sleepHours: null,
    subjectiveRecovery: null,
    sourceIds: ["rpe"],
    sources: [{ id: "rpe", kind: "FACT", detail: "SESSION_RPE 本次主观强度：8/10" }],
  }))
  const keep = guardCoachResponse(gap, JSON.stringify({ mode: "answer", text: "下一课保持。", citations: ["rpe"], nextStep: null }))
  assert.equal(keep.mode, "unavailable")
  assert.equal(guardSubcode(keep), "HIGH_RPE_RECOVERY_REQUIRED")
  const reduce = guardCoachResponse(gap, JSON.stringify({ mode: "answer", text: "下一课减量。", citations: ["rpe"], nextStep: null }))
  assert.equal(reduce.mode, "unavailable")
  assert.equal(guardSubcode(reduce), "HIGH_RPE_RECOVERY_REQUIRED")
  const asked = guardCoachResponse(gap, JSON.stringify({ mode: "ask", text: "恢复和睡眠都尚未记录。这次主观恢复是多少？", citations: ["rpe"], nextStep: null }))
  assert.equal(asked.mode, "ask")
  assert.equal(asked.citations.includes("rpe"), true)
  const invented = guardCoachResponse(gap, JSON.stringify({ mode: "ask", text: "恢复是 0，状态正常。睡眠尚未记录吗？", citations: ["rpe"], nextStep: null }))
  assert.equal(invented.mode, "unavailable")
  assert.equal(guardSubcode(invented), "HIGH_RPE_RECOVERY_REQUIRED")

  const sore = deriveCoachBrief(parts({
    question: "酸痛后怎么分阶段恢复训练？",
    sessionRpe: null,
    sleepHours: null,
    subjectiveRecovery: null,
    soreness: true,
    sourceIds: ["sore"],
    sources: [{ id: "sore", kind: "FACT", detail: "SORENESS 酸痛：5/10；部位 大腿" }],
  }))
  const diagnosisOnly = guardCoachResponse(sore, JSON.stringify({ mode: "answer", text: "这不是诊断。先保持或减量。", citations: ["sore"], nextStep: null }))
  assert.equal(diagnosisOnly.mode, "unavailable")
  assert.equal(guardSubcode(diagnosisOnly), "SORENESS_BOUNDARY_MISSING")
  const separated = guardCoachResponse(sore, JSON.stringify({ mode: "answer", text: "酸痛不等于疼痛或伤病诊断。先保持或减量。", citations: ["sore"], nextStep: null }))
  assert.equal(separated.mode, "answer")
  const equivalent = guardCoachResponse(sore, JSON.stringify({ mode: "answer", text: "仅凭酸痛不能说明受伤。先观察。", citations: ["sore"], nextStep: null }))
  assert.equal(equivalent.mode, "answer")
  assert.equal(guardCoachResponse(sore, JSON.stringify({ mode: "answer", text: "酸痛就是疼痛。", citations: ["sore"], nextStep: null })).mode, "unavailable")
  assert.equal(guardCoachResponse(sore, JSON.stringify({ mode: "answer", text: "已经安全回归。", citations: ["sore"], nextStep: null })).mode, "unavailable")
})

test("conflicting recovery must be asked with both scores and cannot be resolved or prescribed", () => {
  const brief = deriveCoachBrief(parts({
    question: "疼痛后怎么分阶段恢复训练？",
    duplicateCount: 1,
    sessionRpe: 5,
    subjectiveRecovery: null,
    sourceIds: ["occ", "low", "high"],
    sources: [
      { id: "occ", kind: "FACT", detail: "训练开始" },
      { id: "low", kind: "FACT", detail: "SUBJECTIVE_RECOVERY 本次主观恢复：3/10" },
      { id: "high", kind: "FACT", detail: "SUBJECTIVE_RECOVERY 本次主观恢复：8/10" },
    ],
  }))
  const asked = guardCoachResponse(brief, JSON.stringify({ mode: "ask", text: "本次有两条主观恢复记录，3/10 和 8/10，请确认哪条有效。", citations: ["low", "high"], nextStep: null }))
  assert.equal(asked.mode, "ask")
  assert.deepEqual(asked.citations, ["low", "high"])
  assert.equal(guardSubcode(asked), null)
  const one = guardCoachResponse(brief, JSON.stringify({ mode: "ask", text: "请确认 3/10 和 8/10 哪条有效。", citations: ["low"], nextStep: null }))
  assert.equal(one.mode, "unavailable")
  assert.equal(guardSubcode(one), "CONFLICT_NOT_ASKED")
  const picked = guardCoachResponse(brief, JSON.stringify({ mode: "ask", text: "以 8/10 为准，请忽略另一条。", citations: ["low", "high"], nextStep: null }))
  assert.equal(picked.mode, "unavailable")
  assert.equal(guardSubcode(picked), "CONFLICT_NOT_ASKED")
  const averaged = guardCoachResponse(brief, JSON.stringify({ mode: "ask", text: "3/10 和 8/10 的平均值是 5.5。", citations: ["low", "high"], nextStep: null }))
  assert.equal(averaged.mode, "unavailable")
  assert.equal(guardSubcode(averaged), "CONFLICT_NOT_ASKED")
  const increased = guardCoachResponse(brief, JSON.stringify({ mode: "ask", text: "先确认 3/10 还是 8/10，然后下一课增加距离。", citations: ["low", "high"], nextStep: null }))
  assert.equal(increased.mode, "unavailable")
  assert.equal(guardSubcode(increased), "PROPOSED_INCREASE")
  const cleared = guardCoachResponse(brief, JSON.stringify({ mode: "ask", text: "3/10 与 8/10 待确认，但已经安全回归。", citations: ["low", "high"], nextStep: null }))
  assert.equal(cleared.mode, "unavailable")
  assert.equal(guardSubcode(cleared), "FALSE_CLEARANCE")
  const normal = guardCoachResponse(brief, JSON.stringify({ mode: "answer", text: "可以恢复正常训练。", citations: ["low", "high"], nextStep: null }))
  assert.equal(normal.mode, "unavailable")
  assert.equal(guardSubcode(normal), "FALSE_CLEARANCE")
  const denied = guardCoachResponse(deriveCoachBrief(parts({ question: "疼痛后怎么分阶段恢复训练？", pain: true, sourceIds: ["occ"], sources: [{ id: "occ", kind: "FACT", detail: "训练开始" }] })), JSON.stringify({ mode: "answer", text: "已经安全回归。", citations: ["occ"], nextStep: null }))
  assert.equal(denied.mode, "unavailable")
  const cautious = guardCoachResponse(deriveCoachBrief(parts({ question: "疼痛后怎么分阶段恢复训练？", pain: true, sourceIds: ["pain"], sources: [{ id: "pain", kind: "FACT", detail: "PAIN 疼痛：4/10；部位 左膝" }] })), JSON.stringify({ mode: "answer", text: "不能确认已经安全回归。先停止诱发动作，只保持或减量。", citations: ["pain"], nextStep: null }))
  assert.equal(cautious.mode, "answer")
  const negatedIncrease = guardCoachResponse(cautious && deriveCoachBrief(parts({ question: "疼痛后怎么分阶段恢复训练？", pain: true, sourceIds: ["pain"], sources: [{ id: "pain", kind: "FACT", detail: "PAIN 疼痛：4/10；部位 左膝" }] })), JSON.stringify({ mode: "answer", text: "不能批准增加距离、速度、组数、重量或强度。先停止诱发动作，只保持或减量。", citations: ["pain"], nextStep: null }))
  assert.equal(negatedIncrease.mode, "answer")
  assert.equal(guardSubcode(negatedIncrease), null)
})
