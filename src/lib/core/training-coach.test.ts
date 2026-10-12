import assert from "node:assert/strict"
import test from "node:test"
import { assessImportedTraining, assessImportedTrainingTrend } from "./training-coach.ts"
import { confirmTrainingImport, createTrainingImportDraft, type ConfirmedTrainingImport } from "./training-import.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"

function memory(): MemoryStore {
  const data = new Map<string, string>()
  return { keys:()=>[...data.keys()], getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) }
}

const recorded = <T>(value: T) => ({ value, status: "RECORDED" as const, sourceIds: ["text"] })
const absent = { value: null, status: "ABSENT" as const, sourceIds: [] as string[] }

function raw(date: string, times = [36, 35, 34], extra: Record<string, unknown> = {}) {
  return {
    sport: "RUNNING", occurredAt: recorded(date), title: recorded("200米重复跑"), durationSeconds: recorded(1200), totalDistanceMeters: recorded(600), runningStructure: "REPEATED",
    runningSegments: times.map((seconds, index) => ({ id: `r${index + 1}`, kind: "REPETITION", round: recorded(1), repeat: recorded(index + 1), distanceMeters: recorded(200), durationSeconds: recorded(seconds), recoverySeconds: recorded(40), completion: "COMPLETED", sourceIds: ["text"] })),
    strengthSets: [], sessionRpe: recorded(8), subjectiveRecovery: absent, sleepHours: absent, pain: absent, soreness: absent,
    uncertainFields: [], conflicts: [], warnings: [], ...extra,
  }
}

function confirm(input: ReturnType<typeof raw>): ConfirmedTrainingImport {
  const draft = createTrainingImportDraft(input, "TEXT", ["text"])
  const result = confirmTrainingImport(draft)
  if (!result.ok) throw new Error(result.reason)
  return result.record
}

test("a single uploaded interval session gets a sourced within-session observation, not an ability verdict", () => {
  setStoreBackend(memory())
  const assessment = assessImportedTraining(confirm(raw("2026-10-01T08:00:00+08:00")))
  assert.equal(assessment.status, "NEEDS_INPUT")
  assert.equal(assessment.observations.some((item) => item.text.includes("首段 36 秒") && item.text.includes("末段 34 秒")), true)
  assert.equal(assessment.observations.some((item) => item.citations.length === 2), true)
  assert.equal(assessment.nextSession.text.includes("先补充"), true)
  assert.equal(assessment.capabilityConclusion, "NOT_ASSESSED_FROM_ONE_SESSION")
  assert.equal(assessment.planComparison, "UNAVAILABLE_ACTUAL_ONLY")
})

test("pain and soreness remain separate and pain blocks progression language", () => {
  setStoreBackend(memory())
  const record = confirm(raw("2026-10-02T08:00:00+08:00", [36, 35, 36], {
    sessionRpe: recorded(6), subjectiveRecovery: recorded(6),
    pain: recorded({ location: "左膝", intensity: 4 }), soreness: recorded({ location: "大腿", intensity: 5 }),
  }))
  const assessment = assessImportedTraining(record)
  assert.equal(assessment.status, "HOLD_OR_REDUCE")
  assert.equal(assessment.observations.some((item) => item.text.includes("左膝疼痛 4/10")), true)
  assert.equal(assessment.observations.some((item) => item.text.includes("酸痛不等于疼痛")), true)
  assert.equal(assessment.nextSession.text.includes("保持、减量或恢复"), true)
  assert.equal(/加量|增加训练量/.test(assessment.nextSession.text), false)
})

test("strength review says recorded completion and never treats unrecorded sets as not done", () => {
  setStoreBackend(memory())
  const record = confirm(raw("2026-10-03T08:00:00+08:00", [], {
    sport: "STRENGTH", runningStructure: "UNAVAILABLE", runningSegments: [], totalDistanceMeters: absent,
    strengthSets: [
      { id: "s1", exerciseName: recorded("深蹲"), setOrdinal: recorded(1), weightKg: recorded(60), repetitions: recorded(8), durationSeconds: absent, recoverySeconds: recorded(90), completion: "COMPLETED", sourceIds: ["text"] },
      { id: "s2", exerciseName: recorded("深蹲"), setOrdinal: recorded(2), weightKg: absent, repetitions: absent, durationSeconds: absent, recoverySeconds: absent, completion: "NOT_RECORDED", sourceIds: ["text"] },
    ], sessionRpe: recorded(6), subjectiveRecovery: recorded(6),
  }))
  const assessment = assessImportedTraining(record)
  const text = assessment.observations.map((item) => item.text).join(" ")
  assert.equal(text.includes("已记录完成 1 组"), true)
  assert.equal(text.includes("不能推断为实际没做"), true)
  assert.equal(text.includes("训练完成量为零"), false)
})

test("completed continuous run gets a sourced pace; unrecorded or aggregate-only running does not", () => {
  setStoreBackend(memory())
  const segment = { id: "continuous", kind: "CONTINUOUS" as const, round: absent, repeat: absent, distanceMeters: recorded(5000), durationSeconds: recorded(1500), recoverySeconds: absent, completion: "COMPLETED" as const, sourceIds: ["text"] }
  const input = raw("2026-10-04T08:00:00+08:00", [], {
    runningStructure: "CONTINUOUS", totalDistanceMeters: recorded(5000), durationSeconds: recorded(1500),
    runningSegments: [segment], sessionRpe: recorded(5), subjectiveRecovery: recorded(6),
  })
  const completed = confirm(input)
  const pace = assessImportedTraining(completed).observations.find((item) => item.text.includes("秒/公里"))
  assert.match(pace?.text ?? "", /5000 米、1500 秒.*5 分 00 秒\/公里/)
  assert.deepEqual(pace?.citations, [`import:${completed.draftId}:run-1`])
  assert.equal(assessImportedTraining({ ...completed, runningSegments: [{ ...segment, completion: "NOT_RECORDED" }] }).observations.some((item) => item.text.includes("秒/公里")), false)
  assert.equal(assessImportedTraining({ ...completed, runningSegments: [] }).observations.some((item) => item.text.includes("秒/公里")), false)
})

test("partial repetition records cannot be cherry-picked into a first-to-last change", () => {
  setStoreBackend(memory())
  const complete = confirm(raw("2026-10-04T08:00:00+08:00", [36, 35, 34]))
  const partial = { ...complete, runningSegments: complete.runningSegments.map((segment, index) => index === 1 ? { ...segment, completion: "NOT_RECORDED" as const } : segment) }
  const assessment = assessImportedTraining(partial)
  assert.equal(assessment.observations.some((item) => item.text.includes("首段")), false)
  assert.equal(assessment.evidenceGaps.some((item) => item.text.includes("局部成绩") && item.text.includes("未记录不等于没做")), true)
})

test("low recovery without pain and short sleep keep their distinct sources and do not invent injury", () => {
  setStoreBackend(memory())
  const low = confirm(raw("2026-10-04T08:00:00+08:00", [36, 35, 34], { sessionRpe: recorded(5), subjectiveRecovery: recorded(3) }))
  const lowAssessment = assessImportedTraining(low)
  assert.equal(lowAssessment.status, "HOLD_OR_REDUCE")
  assert.deepEqual(lowAssessment.nextSession.citations, [`import:${low.draftId}:recovery`])
  assert.equal(lowAssessment.nextSession.text.includes("停止诱发疼痛"), false)

  const short = confirm(raw("2026-10-05T08:00:00+08:00", [36, 35, 34], { sessionRpe: recorded(5), subjectiveRecovery: recorded(6), sleepHours: recorded(5) }))
  const shortAssessment = assessImportedTraining(short)
  assert.equal(shortAssessment.status, "HOLD_OR_REDUCE")
  assert.equal(shortAssessment.facts.some((item) => item.text.includes("睡眠 5 小时") && item.citations.includes(`import:${short.draftId}:sleep`)), true)
  assert.equal(shortAssessment.nextSession.citations.includes(`import:${short.draftId}:sleep`), true)
  assert.equal(shortAssessment.nextSession.text.includes("证明表现变化的原因"), true)
})

test("three matching sessions form an observation but never establish capability change or auto progression", () => {
  setStoreBackend(memory())
  const records = [
    confirm(raw("2026-10-01T08:00:00+08:00", [36, 36, 36], { sessionRpe: recorded(6), subjectiveRecovery: recorded(6) })),
    confirm(raw("2026-10-03T08:00:00+08:00", [35, 35, 35], { sessionRpe: recorded(6), subjectiveRecovery: recorded(6) })),
    confirm(raw("2026-10-05T08:00:00+08:00", [34, 34, 34], { sessionRpe: recorded(6), subjectiveRecovery: recorded(6) })),
  ]
  const trend = assessImportedTrainingTrend(records)
  assert.equal(trend.status, "OBSERVATION_READY")
  assert.equal(trend.observations[0]?.text.includes("36 秒、35 秒、34 秒"), true)
  assert.equal(trend.capabilityConclusion, "NOT_ESTABLISHED")
  assert.equal(trend.adjustment.action, "HOLD")
  assert.equal(trend.adjustment.requiresUserConfirmation, true)
})

test("different structures or missing recovery do not become a progression recommendation", () => {
  setStoreBackend(memory())
  const mismatched = [
    confirm(raw("2026-10-01T15:30:00Z", [36, 35, 34], { subjectiveRecovery: recorded(6) })),
    confirm(raw("2026-10-01T16:30:00Z", [36, 35], { subjectiveRecovery: absent })),
    confirm(raw("2026-10-03T08:00:00+08:00", [35, 34, 33], { subjectiveRecovery: recorded(6) })),
  ]
  const trend = assessImportedTrainingTrend(mismatched)
  assert.equal(trend.distinctDayCount, 3)
  assert.equal(trend.status, "NOT_COMPARABLE")
  assert.equal(trend.adjustment.action, "ASK")
  assert.equal(trend.capabilityConclusion, "NOT_ESTABLISHED")

  const sameDay = assessImportedTrainingTrend([
    confirm(raw("2026-10-07T15:30:00Z", [36, 35, 34], { subjectiveRecovery: recorded(6) })),
    confirm(raw("2026-10-07T16:30:00Z", [36, 35, 34], { subjectiveRecovery: recorded(6) })),
    confirm(raw("2026-10-07T17:30:00Z", [36, 35, 34], { subjectiveRecovery: recorded(6) })),
  ])
  assert.equal(sameDay.status, "INSUFFICIENT_SESSIONS")
  assert.equal(sameDay.distinctDayCount, 2)
})

test("duplicates, incomplete slots and mixed distances cannot manufacture a comparable trend", () => {
  setStoreBackend(memory())
  const a = confirm(raw("2026-10-01T08:00:00+08:00", [36, 35, 34], { subjectiveRecovery: recorded(6) }))
  const b = confirm(raw("2026-10-03T08:00:00+08:00", [36, 35, 34], { subjectiveRecovery: recorded(6) }))
  const c = confirm(raw("2026-10-05T08:00:00+08:00", [36, 35, 34], { subjectiveRecovery: recorded(6) }))
  assert.equal(assessImportedTrainingTrend([a, a, b]).sessionCount, 2)
  const incomplete = { ...c, runningSegments: [...c.runningSegments, { ...c.runningSegments[0]!, id: "missing", completion: "NOT_RECORDED" as const }] }
  assert.equal(assessImportedTrainingTrend([a, b, incomplete]).status, "NOT_COMPARABLE")
  const mixed = [a, b, c].map((record) => ({ ...record, runningSegments: record.runningSegments.map((segment, index) => index === 1 ? { ...segment, distanceMeters: recorded(400) } : segment) }))
  assert.equal(assessImportedTrainingTrend(mixed).status, "NOT_COMPARABLE")
  assert.equal(assessImportedTrainingTrend([a, b, { ...c, occurredAt: { ...c.occurredAt, status: "AMBIGUOUS" } }]).sessionCount, 2)
})

test("partial completeness stays out of full-session trend while legacy records still compare", () => {
  setStoreBackend(memory())
  const dates = ["2026-10-01T08:00:00+08:00", "2026-10-03T08:00:00+08:00", "2026-10-05T08:00:00+08:00"]
  const legacy = dates.map((date) => confirm(raw(date, [36, 35, 34], { subjectiveRecovery: recorded(6) })))
  assert.equal(assessImportedTrainingTrend(legacy).status, "OBSERVATION_READY")
  const draft = createTrainingImportDraft(raw("2026-10-05T08:00:00+08:00", [36, 35, 34], { subjectiveRecovery: recorded(6) }), "TEXT", ["text"])
  draft.importCompleteness = { status: "PARTIAL", expectedRunning: 9, extractedRunning: 3, expectedStrength: null, extractedStrength: 0, note: "原文约 9 条跑步实际，草稿只有 3 条", acknowledged: true }
  const partial = confirmTrainingImport(draft)
  assert.equal(partial.ok, true)
  if (!partial.ok) return
  const blocked = assessImportedTrainingTrend([legacy[0]!, legacy[1]!, partial.record])
  assert.equal(blocked.status, "NOT_COMPARABLE")
  assert.match(blocked.evidenceGaps[0]!.text, /不是完整/)
})
