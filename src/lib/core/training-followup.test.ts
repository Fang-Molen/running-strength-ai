import assert from "node:assert/strict"
import test from "node:test"
import { setStoreBackend, writeEnvelope } from "./storage.ts"
import { confirmTrainingImport, createTrainingImportDraft, loadConfirmedTrainingImports, normalizeConfirmedTrainingImport, type ConfirmedTrainingImport } from "./training-import.ts"
import { assessImportedFollowups, readImportedFollowups, saveImportedFollowup, TRAINING_FOLLOWUPS_KEY, type FollowupInput } from "./training-followup.ts"

const recorded = <T>(value: T) => ({ value, status: "RECORDED" as const, sourceIds: ["text"] })
const absent = { value: null, status: "ABSENT" as const, sourceIds: [] as string[] }
function fixture() {
  const data = new Map<string, string>(), writes: string[] = []
  setStoreBackend({ keys:()=>[...data.keys()], getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); writes.push(key) } })
  const make = (date = "2026-10-01T08:00:00+08:00") => {
    const draft = createTrainingImportDraft({ sport: "RUNNING", occurredAt: recorded(date), title: recorded("连续跑"), durationSeconds: recorded(1500), totalDistanceMeters: recorded(5000), runningStructure: "CONTINUOUS",
      runningSegments: [{ id: "r1", kind: "CONTINUOUS", round: absent, repeat: absent, distanceMeters: recorded(5000), durationSeconds: recorded(1500), recoverySeconds: absent, completion: "COMPLETED", sourceIds: ["text"] }],
      strengthSets: [], sessionRpe: recorded(5), subjectiveRecovery: absent, sleepHours: absent, pain: absent, soreness: absent, uncertainFields: [], conflicts: [], warnings: [],
    }, "TEXT", ["text"])
    const result = confirmTrainingImport(draft)
    if (!result.ok) throw new Error(result.reason)
    return result.record
  }
  const record = make()
  writes.length = 0
  return { data, writes, record, make }
}
function input(record: ConfirmedTrainingImport, requestId = "f1", observedAt = "2026-10-02T08:00:00+08:00"): FollowupInput {
  return { requestId, confirmedImportId: record.confirmedImportId, observedAt, recoveryScore: 5, sleepHours: null,
    pain: { state: "UNKNOWN", location: null, intensity: null }, soreness: { state: "UNKNOWN", location: null, intensity: null } }
}
const now = "2026-10-05T08:00:00+08:00"

test("follow-up is append-only in its own store; read/reopen never writes or modifies original training", () => {
  const { record, data, writes } = fixture()
  const before = [...data.entries()]
  const saved = saveImportedFollowup(input(record), now)
  assert.equal(saved.ok, true)
  if (!saved.ok) return
  assert.equal(saved.followup.canonicalOccurrenceId, null)
  assert.equal(saved.followup.confirmedImportId, record.confirmedImportId)
  assert.equal(saved.followup.window, "24H")
  assert.deepEqual(writes, [TRAINING_FOLLOWUPS_KEY])
  assert.deepEqual([...data.entries()].filter(([key]) => key !== TRAINING_FOLLOWUPS_KEY), before)
  writes.length = 0
  const reopened = normalizeConfirmedTrainingImport(loadConfirmedTrainingImports()[0])!
  assert.equal(readImportedFollowups(reopened).length, 1)
  const assessment = assessImportedFollowups(reopened, now)
  assert.equal(assessment.clearance, "UNKNOWN")
  assert.deepEqual(assessment.facts[0]?.citations, [saved.followup.followupId])
  assert.equal(assessment.sources.some((source) => source.id === saved.followup.followupId), true)
  assert.deepEqual(writes, [])
})

test("same submit id is idempotent; changed payload and cross-record reuse do not overwrite", () => {
  const { record, make } = fixture()
  const original = input(record)
  assert.equal(saveImportedFollowup(original, now).ok, true)
  const duplicate = saveImportedFollowup(original, now)
  assert.equal(duplicate.ok && duplicate.duplicate, true)
  assert.equal(saveImportedFollowup({ ...original, recoveryScore: 8 }, now).ok, false)
  const second = make("2026-10-01T09:00:00+08:00")
  assert.equal(saveImportedFollowup({ ...original, confirmedImportId: second.confirmedImportId }, now).ok, false)
  assert.equal(readImportedFollowups(record).length, 1)
  assert.equal(readImportedFollowups(second).length, 0)
})

test("elapsed windows use absolute training timestamp, not confirmation or UTC day slices", () => {
  const { record } = fixture()
  const cases = [
    ["2026-10-02T07:59:59+08:00", "EARLY"], ["2026-10-02T08:00:00+08:00", "24H"],
    ["2026-10-03T07:59:59+08:00", "24H"], ["2026-10-03T00:00:00Z", "48H"],
    ["2026-10-04T07:59:59+08:00", "48H"], ["2026-10-04T08:00:00+08:00", "LATER"],
  ] as const
  for (const [i, [date, window]] of cases.entries()) {
    const result = saveImportedFollowup(input(record, `case-${i}`, date), now)
    assert.equal(result.ok && result.followup.window, window)
  }
  assert.equal(readImportedFollowups(record).length, cases.length)
})

test("only real confirmed records accept nonempty, bounded, correctly timed feedback", () => {
  const { record, writes } = fixture()
  const valid = input(record)
  const invalid = [
    { ...valid, confirmedImportId: "not-confirmed" }, { ...valid, observedAt: "2026-10-01T07:59:59+08:00" },
    { ...valid, observedAt: "2026-10-06T08:00:00+08:00" }, { ...valid, observedAt: "2026-10-02T08:00:00" },
    { ...valid, recoveryScore: 0 }, { ...valid, recoveryScore: 11 }, { ...valid, recoveryScore: 5.5 },
    { ...valid, sleepHours: 0 }, { ...valid, sleepHours: NaN }, { ...valid, sleepHours: 25 },
    { ...valid, recoveryScore: null },
    { ...valid, pain: { state: "PRESENT" as const, location: "", intensity: 4 } },
    { ...valid, soreness: { state: "PRESENT" as const, location: "大腿", intensity: 0 } },
    { ...valid, pain: { state: "ABSENT" as const, location: "左膝", intensity: 4 } },
  ]
  for (const row of invalid) assert.equal(saveImportedFollowup(row, now).ok, false)
  assert.deepEqual(writes, [])
  assert.equal(saveImportedFollowup({ ...valid, recoveryScore: null, pain: { state: "ABSENT", location: null, intensity: null } }, now).ok, true)
})

test("unknown is not zero or absence; explicit no pain never grants clearance; soreness stays distinct", () => {
  const { record } = fixture()
  assert.equal(saveImportedFollowup({ ...input(record), recoveryScore: null, sleepHours: 7,
    soreness: { state: "PRESENT", location: "大腿", intensity: 5 } }, now).ok, true)
  let assessment = assessImportedFollowups(record, now)
  assert.match(assessment.facts[0]!.text, /疼痛未记录/)
  assert.doesNotMatch(assessment.facts[0]!.text, /恢复 0|没有疼痛/)
  assert.equal(assessment.observations.some((item) => item.text.includes("酸痛不等于疼痛或伤病")), true)
  assert.equal(saveImportedFollowup({ ...input(record, "no-pain", "2026-10-03T08:00:00+08:00"), pain: { state: "ABSENT", location: null, intensity: null } }, now).ok, true)
  assessment = assessImportedFollowups(record, now)
  assert.equal(assessment.clearance, "UNKNOWN")
  assert.equal(assessment.facts.some((item) => item.text.includes("本次明确表示当前没有疼痛")), true)
  assert.equal(assessment.observations.some((item) => item.text.includes("可以加量") && !item.text.includes("不能")), false)
})

test("exactly one score per window permits sourced self-report comparison, never recovery approval", () => {
  const { record } = fixture()
  saveImportedFollowup({ ...input(record), recoveryScore: 4 }, now)
  saveImportedFollowup({ ...input(record, "f2", "2026-10-03T08:00:00+08:00"), recoveryScore: 6 }, now)
  const assessment = assessImportedFollowups(record, now)
  assert.equal(assessment.status, "OBSERVATION_ONLY")
  const observation = assessment.observations.find((item) => item.text.includes("两次自报变化"))!
  assert.match(observation.text, /4\/10.*6\/10.*不能证明/)
  assert.deepEqual(observation.citations, ["followup:f1", "followup:f2"])
  assert.equal(assessment.clearance, "UNKNOWN")
})

test("multiple same-window reports preserve each value and time, without selecting or averaging", () => {
  const { record } = fixture()
  saveImportedFollowup({ ...input(record), recoveryScore: 3 }, now)
  saveImportedFollowup({ ...input(record, "f2", "2026-10-02T09:00:00+08:00"), recoveryScore: 8 }, now)
  saveImportedFollowup({ ...input(record, "f3", "2026-10-03T08:00:00+08:00"), recoveryScore: 6 }, now)
  const assessment = assessImportedFollowups(record, now)
  assert.equal(assessment.status, "MULTIPLE_RECORDS")
  assert.equal(assessment.facts.length, 3)
  assert.equal(assessment.observations.some((item) => item.text.includes("两次自报变化")), false)
  assert.match(assessment.evidenceGaps[0]!.text, /不平均.*不挑/)
  assert.equal(assessment.evidenceGaps[0]!.citations.includes("followup:f1"), true)
  assert.equal(assessment.evidenceGaps[0]!.citations.includes("followup:f2"), true)
})

test("early or late feedback cannot fill missing windows; caution cites actual low recovery/pain/sleep", () => {
  const { record } = fixture()
  saveImportedFollowup(input(record, "early", "2026-10-01T09:00:00+08:00"), now)
  saveImportedFollowup({ ...input(record, "late", now), recoveryScore: 3, sleepHours: 5, pain: { state: "PRESENT", location: "左膝", intensity: 4 } }, now)
  const assessment = assessImportedFollowups(record, now)
  assert.equal(assessment.status, "CAUTION")
  assert.equal(assessment.evidenceGaps.length, 2)
  assert.equal(assessment.observations.find((item) => item.text.includes("较低主观恢复"))?.citations.includes("followup:late"), true)
  assert.match(assessment.facts[1]!.text, /72h以后.*左膝疼痛 4\/10/)
  assert.equal(assessment.clearance, "UNKNOWN")
})

test("stored identities and elapsed windows are checked; duplicate corruption cannot fabricate evidence", () => {
  const { record } = fixture()
  const result = saveImportedFollowup(input(record), now)
  if (!result.ok) throw new Error(result.reason)
  writeEnvelope(TRAINING_FOLLOWUPS_KEY, [result.followup, result.followup])
  assert.equal(readImportedFollowups(record).length, 1)
  writeEnvelope(TRAINING_FOLLOWUPS_KEY, [result.followup, { ...result.followup, recoveryScore: 8 }])
  assert.equal(readImportedFollowups(record).length, 0)
  writeEnvelope(TRAINING_FOLLOWUPS_KEY, [{ ...result.followup, elapsedSeconds: 0 }, { ...result.followup, canonicalOccurrenceId: "guessed" }, { ...result.followup, window: "EARLY" }])
  assert.equal(readImportedFollowups(record).length, 0)
})
