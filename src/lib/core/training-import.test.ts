import assert from "node:assert/strict"
import test from "node:test"
import { confirmTrainingImport, createTrainingImportDraft, criticalImportGaps, assessTrainingImportReview, guardTrainingImportReview, loadConfirmedTrainingImports, normalizeTrainingImportCandidate, normalizeConfirmedTrainingImport, trainingImportSources } from "./training-import.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"

function memory(): MemoryStore {
  const data = new Map<string, string>()
  return { keys:()=>[...data.keys()], getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) }
}

const recorded = <T>(value: T, sourceIds = ["text"]): { value: T; status: "RECORDED"; sourceIds: string[] } => ({ value, status: "RECORDED", sourceIds })
const absent = { value: null, status: "ABSENT" as const, sourceIds: [] as string[] }

function intervalCandidate() {
  return {
    sport: "RUNNING",
    occurredAt: recorded("2026-10-08T08:00:00.000Z"),
    title: recorded("200米重复跑"),
    durationSeconds: recorded(1800),
    totalDistanceMeters: recorded(1600),
    runningStructure: "REPEATED",
    runningSegments: Array.from({ length: 8 }, (_, index) => ({
      id: `r${index + 1}`,
      kind: "REPETITION",
      round: recorded(index < 4 ? 1 : 2),
      repeat: recorded(index % 4 + 1),
      distanceMeters: recorded(200),
      durationSeconds: recorded(34 + index),
      recoverySeconds: recorded(index === 3 ? 170 : 40),
      completion: "COMPLETED",
      sourceIds: ["text"],
    })),
    strengthSets: [],
    sessionRpe: recorded(8),
    subjectiveRecovery: absent,
    sleepHours: absent,
    pain: absent,
    soreness: absent,
    uncertainFields: [],
    conflicts: [],
    warnings: [],
  }
}

test("training import keeps two rounds with four repetitions instead of flattening structure", () => {
  const candidate = normalizeTrainingImportCandidate(intervalCandidate())
  assert.equal(candidate.runningSegments.length, 8)
  assert.deepEqual(candidate.runningSegments.map((item) => [item.round.value, item.repeat.value]), [
    [1, 1], [1, 2], [1, 3], [1, 4], [2, 1], [2, 2], [2, 3], [2, 4],
  ])
  assert.equal(candidate.runningSegments.every((item) => item.distanceMeters.value === 200), true)
})

test("missing, ambiguous and conflicting fields do not become zero", () => {
  const candidate = normalizeTrainingImportCandidate({
    sport: "RUNNING",
    occurredAt: absent,
    title: absent,
    durationSeconds: { value: 0, status: "ABSENT", sourceIds: ["text"] },
    totalDistanceMeters: { value: 5000, status: "AMBIGUOUS", sourceIds: ["image-1"] },
    runningStructure: "UNAVAILABLE",
    runningSegments: [{ kind: "UNKNOWN", distanceMeters: { value: 36, status: "AMBIGUOUS", sourceIds: ["image-1"] } }],
  })
  assert.equal(candidate.durationSeconds.value, null)
  assert.equal(candidate.totalDistanceMeters.status, "AMBIGUOUS")
  assert.equal(candidate.runningSegments[0]?.durationSeconds.value, null)
  assert.equal(candidate.runningSegments[0]?.distanceMeters.value, 36)
})

test("confirmation is actual-only, source-backed and idempotent", () => {
  setStoreBackend(memory())
  const draft = createTrainingImportDraft(intervalCandidate(), "TEXT", ["text"])
  assert.deepEqual(criticalImportGaps(draft), [])
  const first = confirmTrainingImport(draft)
  assert.equal(first.ok, true)
  if (!first.ok) return
  assert.equal(first.record.recordMode, "ACTUAL_ONLY")
  assert.equal(first.record.canonicalOccurrenceId, null)
  assert.equal(first.record.sources.some((item) => item.detail.includes("1600")), true)
  const second = confirmTrainingImport(draft)
  assert.equal(second.ok, true)
  if (!second.ok) return
  assert.equal(second.duplicate, true)
  assert.equal(loadConfirmedTrainingImports().length, 1)
})

test("critical conflicts block confirmation", () => {
  setStoreBackend(memory())
  const draft = createTrainingImportDraft({ ...intervalCandidate(), conflicts: ["第2段用时有两个值"] }, "IMAGE", ["image-1"])
  assert.equal(criticalImportGaps(draft).some((item) => item.includes("冲突")), true)
  assert.equal(confirmTrainingImport(draft).ok, false)
  assert.equal(loadConfirmedTrainingImports().length, 0)
})

test("review requires numeric provenance and rejects plan or long-term claims for actual-only records", () => {
  setStoreBackend(memory())
  const draft = createTrainingImportDraft(intervalCandidate(), "TEXT", ["text"])
  const saved = confirmTrainingImport(draft)
  assert.equal(saved.ok, true)
  if (!saved.ok) return
  const runSource = saved.record.sources.find((item) => item.id.endsWith("run-1"))?.id ?? ""
  const safe = guardTrainingImportReview(saved.record, {
    facts: [{ text: "第1段已确认200米、34秒。", citations: [runSource] }],
    observations: [{ text: "这只是本次实际记录。", citations: [] }],
    evidenceGaps: [{ text: "没有原计划，不能比较计划与实际。", citations: [] }],
    interpretations: [],
    risks: [],
    questions: ["这次主观恢复是多少？"],
    nextSessionBoundary: null,
  })
  assert.ok(safe)
  assert.equal(guardTrainingImportReview(saved.record, {
    facts: [{ text: "第1段已确认199米、34秒。", citations: [runSource] }], observations: [], evidenceGaps: [], interpretations: [], risks: [], questions: [], nextSessionBoundary: null,
  }), null)
  assert.equal(guardTrainingImportReview(saved.record, {
    facts: [], observations: [{ text: "已经完成计划，长期能力提高。", citations: [] }], evidenceGaps: [], interpretations: [], risks: [], questions: [], nextSessionBoundary: null,
  }), null)
})

test("plan-only slots and invalid or unzoned dates cannot be confirmed as actual training", () => {
  setStoreBackend(memory())
  const raw = intervalCandidate()
  const planned = createTrainingImportDraft({ ...raw, durationSeconds: absent, totalDistanceMeters: absent, runningSegments: raw.runningSegments.map((segment) => ({ ...segment, completion: "NOT_RECORDED", durationSeconds: absent })) }, "TEXT", ["text"])
  assert.equal(confirmTrainingImport(planned).ok, false)
  assert.match(criticalImportGaps(planned).join(" "), /计划或未记录/)
  for (const date of ["bad-date", "2026-10-08", "2026-10-08T08:00:00"]) {
    assert.equal(confirmTrainingImport(createTrainingImportDraft({ ...raw, occurredAt: recorded(date) }, "TEXT", ["text"])).ok, false)
  }
  assert.equal(loadConfirmedTrainingImports().length, 0)
})

test("feedback conflicts block confirmation; ambiguous feedback stays unavailable rather than confirmed", () => {
  const raw = intervalCandidate()
  const conflicted = createTrainingImportDraft({ ...raw, subjectiveRecovery: { value: 6, status: "CONFLICTING", sourceIds: ["text"] } }, "TEXT", ["text"])
  assert.equal(confirmTrainingImport(conflicted).ok, false)
  const ambiguous = createTrainingImportDraft({ ...raw, subjectiveRecovery: { value: 6, status: "AMBIGUOUS", sourceIds: ["text"] } }, "TEXT", ["text"])
  assert.equal(trainingImportSources(ambiguous).some((source) => source.id.endsWith(":recovery")), false)
  const invalid = createTrainingImportDraft({ ...raw, sessionRpe: recorded(13) }, "TEXT", ["text"])
  assert.equal(invalid.sessionRpe.status, "AMBIGUOUS")
  assert.equal(trainingImportSources(invalid).some((source) => source.id.endsWith(":rpe")), false)
})

test("server consistency normalization rebuilds citations and never trusts supplied source descriptions", () => {
  setStoreBackend(memory())
  const confirmed = confirmTrainingImport(createTrainingImportDraft(intervalCandidate(), "TEXT", ["text"]))
  assert.ok(confirmed.ok)
  if (!confirmed.ok) return
  const rebuilt = normalizeConfirmedTrainingImport({ ...confirmed.record, sources: [{ id: "fake", detail: "训练50000米" }], sourceIds: ["fake"] })
  assert.ok(rebuilt)
  assert.equal(rebuilt?.sourceIds.includes("fake"), false)
  assert.equal(rebuilt?.sources.some((source) => source.detail.includes("50000")), false)
  assert.equal(normalizeConfirmedTrainingImport({ ...confirmed.record, canonicalOccurrenceId: "guessed-latest" }), null)
  assert.equal(normalizeConfirmedTrainingImport({ ...confirmed.record, runningSegments: Array(49).fill(confirmed.record.runningSegments[0]) }), null)
})

test("review rejects numeric substrings, unknown citations, invalid boundary and unsolicited progression", () => {
  setStoreBackend(memory())
  const saved = confirmTrainingImport(createTrainingImportDraft(intervalCandidate(), "TEXT", ["text"]))
  assert.ok(saved.ok)
  if (!saved.ok) return
  const source = saved.record.sourceIds.find((id) => id.endsWith("run-1"))!
  const base = { facts: [], observations: [], evidenceGaps: [], interpretations: [], risks: [], questions: [], nextSessionBoundary: null }
  assert.equal(guardTrainingImportReview(saved.record, { ...base, facts: [{ text: "实际跑了20米", citations: [source] }] }), null)
  assert.equal(guardTrainingImportReview(saved.record, { ...base, facts: [{ text: "实际跑了200米", citations: [source, "fake"] }] }), null)
  assert.equal(guardTrainingImportReview(saved.record, { ...base, nextSessionBoundary: { text: "加组", citations: [source] } }), null)
  assert.equal(guardTrainingImportReview(saved.record, { ...base, nextSessionBoundary: { text: "199米", citations: [source] } }), null)
  assert.equal(guardTrainingImportReview(saved.record, { ...base, nextSessionBoundary: { text: "下一课保持训练", citations: [source] } }), null)
  assert.equal(guardTrainingImportReview(saved.record, { ...base, risks: [{ text: "不能批准增加，也不加组。", citations: [source] }] }), null)
  assert.ok(guardTrainingImportReview(saved.record, { ...base, questions: ["你的主观恢复是多少？"], risks: [{ text: "不能批准增加，也不加组。", citations: [source] }] }))
})

test("compact model fields normalize without turning absent into zero", () => {
  const candidate = normalizeTrainingImportCandidate({
    sport: "RUNNING",
    occurredAt: { v: "2026-10-08T18:10:00+08:00", s: "R", i: ["text"] },
    durationSeconds: { v: null, s: "A", i: [] },
    sessionRpe: { v: 9, s: "R", i: ["text"] },
    runningSegments: [{
      kind: "REPETITION", completion: "COMPLETED",
      round: { v: 1, s: "R", i: ["text"] },
      repeat: { v: 1, s: "R", i: ["text"] },
      distanceMeters: { v: 200, s: "R", i: ["image-1"] },
      durationSeconds: { v: 36, s: "R", i: ["image-1"] },
      recoverySeconds: { v: null, s: "A", i: [] },
    }],
  })
  assert.equal(candidate.occurredAt.status, "RECORDED")
  assert.equal(candidate.occurredAt.value, "2026-10-08T18:10:00+08:00")
  assert.equal(candidate.durationSeconds.status, "ABSENT")
  assert.equal(candidate.durationSeconds.value, null)
  assert.equal(candidate.sessionRpe.value, 9)
  assert.equal(candidate.runningSegments[0]?.distanceMeters.value, 200)
  assert.equal(candidate.runningSegments[0]?.recoverySeconds.value, null)
  assert.equal(candidate.runningSegments.length, 1)
})

test("high RPE with pain and soreness needs a recovery question and both body sources", () => {
  setStoreBackend(memory())
  const saved = confirmTrainingImport(createTrainingImportDraft({
    ...intervalCandidate(),
    sessionRpe: recorded(9),
    subjectiveRecovery: absent,
    pain: recorded({ location: "左膝", intensity: 6 }),
    soreness: recorded({ location: "大腿", intensity: 4 }),
  }, "TEXT", ["text"]))
  assert.ok(saved.ok)
  if (!saved.ok) return
  const pain = saved.record.sourceIds.find((id) => id.endsWith(":pain"))!
  const soreness = saved.record.sourceIds.find((id) => id.endsWith(":soreness"))!
  const base = {
    facts: [{ text: "已确认疼痛", citations: [pain] }, { text: "已确认酸痛", citations: [soreness] }],
    observations: [{ text: "酸痛不等于疼痛", citations: [soreness] }],
    evidenceGaps: [{ text: "恢复未记录", citations: [] }],
    interpretations: [{ text: "不能判断原因", citations: [] }],
    risks: [{ text: "不要加量", citations: [] }],
    questions: ["请补充这次之后的恢复"],
    nextSessionBoundary: null,
  }
  assert.equal(assessTrainingImportReview(saved.record, base).code, "OK")
  assert.equal(assessTrainingImportReview(saved.record, { ...base, nextSessionBoundary: { text: "下一课减量", citations: [] } }).code, "HIGH_RPE_HIDDEN_PRESCRIPTION")
  assert.equal(assessTrainingImportReview(saved.record, { ...base, questions: ["膝盖怎样"] }).code, "MISSING_RECOVERY_QUESTION")
  assert.equal(assessTrainingImportReview(saved.record, { ...base, facts: [{ text: "已确认酸痛", citations: [soreness] }] }).code, "PAIN_SORENESS_SPLIT")
})
