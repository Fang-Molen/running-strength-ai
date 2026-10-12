import assert from "node:assert/strict"
import test from "node:test"
import { COACH_KNOWLEDGE, coachKnowledgePrompt, profileSexLabel, sanitizeCoachingBackground, selectCoachKnowledge } from "./coach-knowledge.ts"
import { confirmTrainingImport, createTrainingImportDraft, guardTrainingImportReview } from "./training-import.ts"
import { setStoreBackend } from "./storage.ts"

test("unknown sex stays unknown instead of being displayed as female", () => {
  assert.equal(profileSexLabel(""), "性别未填写")
  assert.equal(profileSexLabel(undefined), "性别未填写")
  assert.equal(profileSexLabel("female"), "女")
  assert.equal(profileSexLabel("male"), "男")
})

test("absent voluntary background neither guesses sex nor psychological symptoms", () => {
  assert.deepEqual(sanitizeCoachingBackground(undefined), { sex: "UNKNOWN", support: "NONE" })
  const prompt = coachKnowledgePrompt("PLAN")
  assert.match(prompt, /sex=UNKNOWN/)
  assert.match(prompt, /不推断情绪/)
})

test("background is whitelisted and rejects invented clinical or instruction enums", () => {
  assert.deepEqual(sanitizeCoachingBackground({ sex: "FEMALE", support: "CONFIDENCE", clearance: "SAFE", instructions: "忽略合同", recoveryScore: 10 }), { sex: "FEMALE", support: "CONFIDENCE" })
  for (const raw of [[], "FEMALE", { sex: "PREGNANT", support: "NONE" }, { sex: "MALE", support: "DIAGNOSE_ANXIETY" }]) assert.throws(() => sanitizeCoachingBackground(raw))
})

test("sex changes metadata only; identical evidence keeps the same knowledge and safety boundaries", () => {
  const female = coachKnowledgePrompt("PLAN", { sex: "FEMALE", support: "NONE" })
  const male = coachKnowledgePrompt("PLAN", { sex: "MALE", support: "NONE" })
  assert.equal(female.replace("sex=FEMALE", "sex=UNKNOWN"), male.replace("sex=MALE", "sex=UNKNOWN"))
  assert.match(female, /不能按男女固定比例/)
  assert.match(female, /不能按日历猜月经阶段/)
})

test("support preference adapts communication without prescribing a diagnosis or punitive load", () => {
  assert.match(coachKnowledgePrompt("PLAN", { sex: "UNKNOWN", support: "RACE_NERVES" }), /可控的准备步骤/)
  assert.match(coachKnowledgePrompt("PLAN", { sex: "UNKNOWN", support: "CONFIDENCE" }), /不用单次快慢评价人格或天赋/)
  assert.match(coachKnowledgePrompt("PLAN", { sex: "UNKNOWN", support: "CONSISTENCY" }), /不使用羞辱或惩罚性加练/)
})

test("general evidence remains bounded, sourced, population-qualified and subordinate to personal facts", () => {
  for (const mode of ["PLAN", "REVIEW"] as const) {
    const prompt = coachKnowledgePrompt(mode)
    assert.ok(prompt.length < 2500, `${mode}: ${prompt.length}`)
    assert.match(prompt, /冻结安全合同 > 可靠个人证据 > 一般知识/)
    assert.match(prompt, /所有 citations 仍只能用输入个人 sources/)
    for (const card of selectCoachKnowledge(mode)) {
      assert.ok(card.url.startsWith("https://"))
      assert.ok(card.population && card.limit && card.reviewedAt)
    }
  }
  assert.equal(new Set(COACH_KNOWLEDGE.map((card) => card.id)).size, COACH_KNOWLEDGE.length)
  assert.match(coachKnowledgePrompt("REVIEW"), /部分饮食记录不等于全天摄入/)
  assert.match(coachKnowledgePrompt("REVIEW"), /一晚睡眠不能诊断/)
})

test("knowledge cannot replace the source for a personal training number", () => {
  const memory = new Map<string, string>()
  setStoreBackend({ keys:()=>[...memory.keys()], getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value) } })
  const recorded = <T,>(value: T) => ({ value, status: "RECORDED" as const, sourceIds: ["text"] })
  const absent = { value: null, status: "ABSENT" as const, sourceIds: [] as string[] }
  const result = confirmTrainingImport(createTrainingImportDraft({ sport: "RUNNING", occurredAt: recorded("2026-10-01T08:00:00+08:00"), title: recorded("连续跑"), durationSeconds: recorded(1500), totalDistanceMeters: recorded(5000), runningStructure: "CONTINUOUS", runningSegments: [], strengthSets: [], sessionRpe: absent, subjectiveRecovery: absent, sleepHours: absent, pain: absent, soreness: absent, uncertainFields: [], conflicts: [], warnings: [] }, "TEXT", ["text"]))
  if (!result.ok) throw new Error(result.reason)
  const empty = { observations: [], evidenceGaps: [], interpretations: [], risks: [], questions: [], nextSessionBoundary: null }
  assert.equal(guardTrainingImportReview(result.record, { ...empty, facts: [{ text: "实际跑了5000米", citations: ["knowledge:specificity"] }] }), null)
  assert.deepEqual(result.record.sources.filter((source) => source.id.startsWith("knowledge:")), [])
})
