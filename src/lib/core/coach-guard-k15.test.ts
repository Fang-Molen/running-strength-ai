/**
 * K15 regression: open issues left after K13/K14 (known/dev cases, not blind),
 * with adversarial counterparts that must still be blocked.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { deriveCoachBrief, guardCoachResponse, scrubInternalTerms, type CoachParts } from "./coach-brief.ts"
import { compactSingleCoachPacket } from "./coach-model-packet.ts"
import { coachSystemPrompt, verbalCorrection } from "../strength/coach-pipeline.ts"

function parts(extra: Partial<CoachParts> = {}): CoachParts {
  return {
    question: "下次训练要不要调整", occurrenceId: "occ-k15", runningStructure: "UNAVAILABLE", sessionRpe: 6, sleepHours: 7, subjectiveRecovery: 6,
    recoveryState: "INSUFFICIENT_EVIDENCE", fatigueState: "INSUFFICIENT_EVIDENCE", duplicateCount: 0, repetitionSlots: 0, continuousCount: 0,
    plannedSetCount: null, completedSetCount: null, durationSec: null, pain: false, soreness: false, musculoskeletalState: "NO_RELEVANT_EVIDENCE",
    daysToCompetition: null, week: 2, bias: "build",
    sourceIds: ["occ-k15", "ev:k15:rpe", "ev:k15:sleep", "ev:k15:rec"],
    sources: [
      { id: "occ-k15", kind: "FACT", detail: "训练开始；2026-10-11T09:30:00.000Z；COMPLETED" },
      { id: "ev:k15:rpe", kind: "FACT", detail: "SESSION_RPE 本次主观强度：6/10；已绑定本次训练的记录" },
      { id: "ev:k15:sleep", kind: "FACT", detail: "SLEEP 睡眠：7小时；已绑定本次训练的记录" },
      { id: "ev:k15:rec", kind: "FACT", detail: "SUBJECTIVE_RECOVERY 本次主观恢复：6/10；已绑定本次训练的记录" },
    ],
    running: [],
    ...extra,
  }
}
const reply = (text: string, citations: string[], nextStep: string | null = null, mode = "answer") => JSON.stringify({ mode, text, citations, nextStep, medicalReferral: false, compareIds: null, seriesIds: null })
const general = () => deriveCoachBrief(parts({ question: "力量训练会不会让中长跑选手变重变慢？", occurrenceId: null, sessionRpe: null, sleepHours: null, subjectiveRecovery: null, sourceIds: [], sources: [] }))

test("K14-STR-b: hedged outcome '不一定会导致体重显著增加' is not an increase proposal", () => {
  const turn = guardCoachResponse(general(), reply("合理规划的力量训练可以改善跑步经济性，而不一定会导致体重显著增加或速度变慢。你目前每周练几次力量？", [], null, "ask"))
  assert.equal(turn.mode, "ask")
  assert.match(turn.text, /不一定会导致体重显著增加/)
})

test("hedged-outcome exemption does not hide a proposal", () => {
  for (const text of ["不一定会导致体重增加，所以建议下次增加组数。", "不会导致受伤，可以增加跑量。", "不一定会导致疲劳，下次可以加两次课。"]) {
    const turn = guardCoachResponse(general(), reply(text, [], null, "ask"))
    assert.match(turn.text, /^请先选择一条有训练开始事件的记录/, text)
  }
  const brief = deriveCoachBrief(parts({ week: 4, bias: "deload" }))
  assert.equal(guardCoachResponse(brief, reply("不一定会导致体重增加，建议提高配速。", ["ev:k15:rpe"])).mode, "unavailable")
})

test("internal field names, enums and source ids are scrubbed from visible text", () => {
  const brief = deriveCoachBrief(parts())
  const turn = guardCoachResponse(brief, reply("根据SESSION_RPE（ev:k15:rpe）为6，increaseSupported为false，clearance为UNKNOWN，下一课保持原计划。", ["ev:k15:rpe", "ev:k15:sleep", "ev:k15:rec"], "按KEEP_ONLY执行"))
  assert.equal(turn.mode, "answer")
  for (const leak of ["SESSION_RPE", "ev:k15:rpe", "increaseSupported", "clearance", "UNKNOWN", "KEEP_ONLY"]) {
    assert.ok(!turn.text.includes(leak) && !(turn.nextStep ?? "").includes(leak), leak)
  }
  assert.deepEqual(turn.citations, ["ev:k15:rpe", "ev:k15:sleep", "ev:k15:rec"])
  assert.equal(scrubInternalTerms({ sourceIds: [] }, "UNKNOWN 不等于 0"), "未知 不等于 0")
})

test("K12-YOUTH-1: ask-mode referral in nextStep is kept in the visible text", () => {
  const brief = deriveCoachBrief(parts({ question: "我儿子14岁，膝盖下方跑完会疼，还能每天练间歇吗？", occurrenceId: null, sessionRpe: null, sleepHours: null, subjectiveRecovery: null, sourceIds: [], sources: [] }))
  const turn = guardCoachResponse(brief, reply("生长期膝盖下方疼痛不建议继续每天高强度间歇。日常走路时是否也痛？", [], "建议暂停高强度间歇跑并咨询运动医学医生或专业康复师评估。", "ask"))
  assert.equal(turn.mode, "ask")
  assert.equal(turn.nextStep, null)
  assert.match(turn.text, /运动医学医生或专业康复师评估/)
})

test("ask-mode nextStep with training advice is still dropped, not promoted", () => {
  const brief = deriveCoachBrief(parts({ occurrenceId: null, sessionRpe: null, sleepHours: null, subjectiveRecovery: null, sourceIds: [], sources: [] }))
  for (const step of ["评估后下次可以增加间歇组数。", "咨询医生后提高配速。", "下一课加量，并找康复师评估。"]) {
    const turn = guardCoachResponse(brief, reply("请问疼痛在什么位置？", [], step, "ask"))
    assert.ok(!turn.text.includes(step), step)
  }
})

test("next-session packet carries running sources; required sources visible in every intent", () => {
  const run = { kind: "REPETITION" as const, position: "c/b/s 第1轮第1次", status: "RECORDED", planned: "300米/?秒", actual: "300米/43秒", sourceEventIds: ["ev:k15:r1"] }
  const p = parts({ question: "下次训练怎么安排？", sessionRpe: 8, runningStructure: "AVAILABLE", repetitionSlots: 1, running: [run],
    sourceIds: [...parts().sourceIds, "ev:k15:r1"], sources: [...parts().sources!, { id: "ev:k15:r1", kind: "FACT" as const, detail: "REPETITION：RECORDED；实际 300米/43秒" }].map((s) => s.id === "ev:k15:rpe" ? { ...s, detail: "SESSION_RPE 本次主观强度：8/10；已绑定本次训练的记录" } : s) })
  const brief = deriveCoachBrief(p)
  const next = compactSingleCoachPacket(brief, [], []).current as { sourceIds: string[]; running?: unknown[] }
  assert.ok(next.sourceIds.includes("ev:k15:r1"))
  assert.ok(Array.isArray(next.running) && next.running.length === 1)
  const runningQ = compactSingleCoachPacket(deriveCoachBrief({ ...p, question: "两次300米掉速说明什么？" }), [], []).current as { sourceIds: string[] }
  for (const id of brief.nextSession?.requiredSourceIds ?? []) assert.ok(runningQ.sourceIds.includes(id), id)
})

test("K12-CORR-1: verbal correction is detected and reaches the high-RPE prompt", () => {
  assert.ok(verbalCorrection("更正一下，刚才说的RPE 9是记错了，实际是RPE 6，下次训练怎么安排？"))
  assert.ok(!verbalCorrection("下次训练怎么安排？"))
  assert.match(coachSystemPrompt("candidate-route", "NEXT_SESSION", false, true, false, "RPE 9是记错了，实际是6"), /训练记录里更正/)
  assert.doesNotMatch(coachSystemPrompt("candidate-route", "NEXT_SESSION", false, true, false, "下次怎么练"), /口头更正了数值：/)
})

// A lack of evidence is a restriction; a later contrast or double negation is not.
test("insufficient evidence to authorize an increase preserves the explanation, not a training-selection fallback",()=>{
 const text="可先核对这条记录与当前感受是否一致；单项资料不足以确认恢复或批准加量。";
 assert.match(guardCoachResponse(general(),reply(text,[])).text,/可先核对这条记录与当前感受是否一致/);
 assert.doesNotMatch(guardCoachResponse(general(),reply(text,[])).text,/请先选择一条有训练开始事件/);
 for(const text of ["单项资料不足以批准加量，但是可以增加跑量。","并非资料不足以批准加量。","我不认为资料不足以支持增加跑量。"]){
  assert.match(guardCoachResponse(general(),reply(text,[])).text,/请先选择一条有训练开始事件/,text);
 }
});
