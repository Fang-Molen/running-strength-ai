import assert from "node:assert/strict"
import test, { afterEach, beforeEach } from "node:test"
import { loadEvents, setEventContext } from "../core/events.ts"
import { setStoreBackend, type MemoryStore } from "../core/storage.ts"
import { CONFIRMED_TRAINING_IMPORTS_KEY, confirmTrainingImport, loadConfirmedTrainingImports } from "../core/training-import.ts"
import { readConfirmedPerformances } from "../core/import-history.ts"
import { loadTrainingActivities } from "./training-read-model.ts"
import { summarize } from "./log-range.ts"
import { parseQuickLog } from "./quick-log.ts"
import { clearQuickLogDraft, deleteQuickLogNote, loadQuickLogDraft, loadQuickLogNotes, parsedQuickLog, QUICK_LOG_DRAFT_KEY, QUICK_LOG_NOTES_KEY, quickLogTrainingDraft, saveQuickLog, saveQuickLogDraft, type QuickLogDraft } from "./quick-log-store.ts"

let data: Map<string, string>, failKey: string | null, notesWrites: number, failNoteWrite: number | null, removeFails: boolean
let previousStorage: Storage | undefined
beforeEach(() => {
  data = new Map(); failKey = null; notesWrites = 0; failNoteWrite = null; removeFails = false
  const backend: MemoryStore & { removeItem(key: string): void } = {
    keys: () => [...data.keys()], getItem: key => data.get(key) ?? null,
    setItem: (key, value) => {
      if (key === QUICK_LOG_NOTES_KEY) notesWrites++
      if (key === failKey || (key === QUICK_LOG_NOTES_KEY && notesWrites === failNoteWrite)) throw new Error("injected storage failure")
      data.set(key, value)
    },
    removeItem: key => { if (removeFails) throw new Error("cleanup failed"); data.delete(key) },
  }
  previousStorage = globalThis.localStorage
  Object.defineProperty(globalThis, "localStorage", { value: backend, configurable: true })
  setStoreBackend(backend); setEventContext({ athleteId: "local" })
})
afterEach(() => {
  setStoreBackend(null); setEventContext({ athleteId: "local" })
  if (previousStorage === undefined) delete (globalThis as { localStorage?: Storage }).localStorage
  else Object.defineProperty(globalThis, "localStorage", { value: previousStorage, configurable: true })
})
const draft = (changes: Partial<QuickLogDraft> = {}): QuickLogDraft => ({ id: "n-quick-test", date: "2026-10-19", at: "2026-10-19T08:00:00.000Z", text: "今天跑了5公里", atts: [], rpe: null, confirmActual: true, athleteId: "local", ...changes })

test("5km self-report stores distance with unknown duration and no synthetic schedule or planned adherence", () => {
  const saved = saveQuickLog(draft())
  assert.equal(saved.ok, true)
  const [record] = loadConfirmedTrainingImports()
  assert.equal(record.recordMode, "ACTUAL_ONLY"); assert.equal(record.canonicalOccurrenceId, null)
  assert.equal(record.totalDistanceMeters.value, 5000)
  assert.deepEqual(record.durationSeconds, { value: null, status: "ABSENT", sourceIds: [] })
  assert.equal(record.runningSegments[0].durationSeconds.value, null)
  assert.equal(record.runningStructure, "UNAVAILABLE")
  assert.equal(record.sessionRpe.value, null)
  assert.equal(data.has("fk-schedule-v1"), false)
  assert.match(record.title.value ?? "", /计划外实际/)
  assert.doesNotMatch(JSON.stringify(record), /as_planned|按计划/)
  assert.deepEqual(loadQuickLogNotes()[0].generatedRecordIds, [record.confirmedImportId])
  assert.equal(record.draftId, `qlog-${loadQuickLogNotes()[0].id}`)
  assert.match(record.warnings.join(" "), /n-quick-test/)
})

test("pace and distance do not backfill rounded actual minutes or false zero", () => {
  const parsed = parseQuickLog("跑了5公里 配速5:40")
  assert.equal(parsed.kind, "run")
  if (parsed.kind !== "run") return
  assert.equal(parsed.minutes, null); assert.equal(parsed.pace, "5:40")
  const candidate = quickLogTrainingDraft(draft(), parsed)!
  assert.equal(candidate.durationSeconds.value, null)
  const zero = parseQuickLog("跑了0公里 0分")
  assert.equal(zero.kind, "run")
  if (zero.kind === "run") { assert.equal(zero.minutes, null); assert.equal(zero.km, null) }
})

test("decimal total minutes preserve 30.5min as 1830 seconds while Chinese pace does not become duration", () => {
  for (const text of ["跑步5km 30.5分钟", "跑步5km 30.5min", "跑步5km 用时30.5分 配速5分30秒"]) {
    const parsed = parseQuickLog(text)
    assert.equal(parsed.kind, "run")
    if (parsed.kind === "run") assert.equal(parsed.minutes, 30.5)
  }
  for (const text of ["跑步5km 配速5分30", "跑步5km 配速5分30秒", "跑步5km 配速5:30"]) {
    const parsed = parseQuickLog(text)
    assert.equal(parsed.kind, "run")
    if (parsed.kind === "run") { assert.equal(parsed.minutes, null); assert.equal(parsed.pace, "5:30") }
  }
  assert.equal(saveQuickLog(draft({ text: "跑步5km 30.5min" })).ok, true)
  assert.equal(loadConfirmedTrainingImports()[0].durationSeconds.value, 1830)
})

test("training requires explicit actual confirmation; multiple records remain a note", () => {
  assert.equal(saveQuickLog(draft({ confirmActual: false })).ok, true)
  assert.equal(loadConfirmedTrainingImports().length, 0)
  assert.equal(loadQuickLogNotes()[0].saveState, "saved")
  const multiple = "跑了5公里；深蹲3x8"
  assert.equal(parsedQuickLog(multiple), null)
  assert.equal(saveQuickLog(draft({ id: "n-multiple", text: multiple })).ok, true)
  assert.equal(loadConfirmedTrainingImports().length, 0)
})

test("missing running totals and invalid body ranges stay editable without creating trapped pending notes", () => {
  const input = draft({ text: "跑步" })
  assert.equal(saveQuickLog(input).ok, false)
  assert.equal(loadQuickLogNotes().length, 0)
  assert.equal(loadConfirmedTrainingImports().length, 0)
  assert.equal(saveQuickLog({ ...input, text: "跑步5公里" }).ok, true)
  const body = draft({ id: "n-invalid-weight", text: "体重160kg" })
  assert.equal(saveQuickLog(body).ok, false)
  assert.equal(loadQuickLogNotes().length, 1)
  assert.equal(saveQuickLog({ ...body, text: "体重65kg" }).ok, true)
})

test("strength only records explicitly reported, confirmed sets; unknown weight and duration remain absent", () => {
  assert.equal(saveQuickLog(draft({ text: "深蹲3x8" })).ok, true)
  const [record] = loadConfirmedTrainingImports()
  assert.equal(record.sport, "STRENGTH"); assert.equal(record.strengthSets.length, 3)
  assert.ok(record.strengthSets.every(set => set.repetitions.value === 8 && set.weightKg.value === null && set.durationSeconds.value === null))
  assert.equal(record.durationSeconds.value, null); assert.equal(record.sessionRpe.value, null)
  assert.equal(data.has("fk-schedule-v1"), false)
})

test("repeated save with one stable note ID creates one note and one import", () => {
  const input = draft()
  assert.equal(saveQuickLog(input).ok, true); assert.equal(saveQuickLog(input).ok, true)
  assert.equal(loadQuickLogNotes().length, 1); assert.equal(loadConfirmedTrainingImports().length, 1)
})

test("draft or first note write failure cannot create an orphan training fact", () => {
  failKey = QUICK_LOG_DRAFT_KEY
  const failedDraft = saveQuickLog(draft())
  assert.equal(failedDraft.ok, false); assert.equal(loadConfirmedTrainingImports().length, 0)
  failKey = QUICK_LOG_NOTES_KEY
  const failedNote = saveQuickLog(draft())
  assert.equal(failedNote.ok, false); assert.equal(loadConfirmedTrainingImports().length, 0)
  assert.equal(loadQuickLogDraft("2026-10-19")?.text, draft().text)
  assert.equal(loadQuickLogNotes().length, 0)
})

test("import failure keeps pending note and original draft; retry saves exactly one actual", () => {
  failKey = CONFIRMED_TRAINING_IMPORTS_KEY
  const failed = saveQuickLog(draft())
  assert.equal(failed.ok, false)
  if (failed.ok) return
  assert.equal(failed.partial, "note"); assert.match(failed.reason, /笔记已保存/)
  assert.equal(loadQuickLogNotes()[0].saveState, "pending")
  assert.equal(loadConfirmedTrainingImports().length, 0)
  const restored = loadQuickLogDraft("2026-10-20")!
  assert.equal(restored.id, draft().id); assert.equal(restored.date, "2026-10-19")
  assert.equal(restored.text, draft().text); assert.equal(restored.confirmActual, true)
  failKey = null
  assert.equal(saveQuickLog(restored).ok, true)
  assert.equal(loadConfirmedTrainingImports().length, 1); assert.equal(loadQuickLogNotes().length, 1)
})

test("import commit followed by note finalization failure survives reload and idempotent retry", () => {
  failNoteWrite = 2
  const failed = saveQuickLog(draft())
  assert.equal(failed.ok, false)
  if (failed.ok) return
  assert.equal(failed.partial, "training"); assert.match(failed.reason, /关联数据已保存/)
  assert.equal(failed.generatedRecordIds.length, 1)
  assert.equal(loadConfirmedTrainingImports().length, 1)
  assert.equal(loadQuickLogNotes()[0].saveState, "pending")
  const restored = loadQuickLogDraft("2026-10-20")!
  failNoteWrite = null
  assert.equal(saveQuickLog(restored).ok, true)
  assert.equal(loadConfirmedTrainingImports().length, 1)
  assert.equal(loadQuickLogNotes().length, 1); assert.equal(loadQuickLogNotes()[0].saveState, "saved")
})

test("edited retry cannot silently replace the original payload or return a stale duplicate", () => {
  failNoteWrite = 2
  saveQuickLog(draft())
  failNoteWrite = null
  const edited = draft({ text: "今天跑了10公里" })
  assert.equal(saveQuickLogDraft(edited), false)
  const result = saveQuickLog(edited)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /未覆盖或重复生成训练/)
  assert.equal(loadQuickLogDraft("2026-10-19")?.text, draft().text)
  assert.equal(loadConfirmedTrainingImports()[0].totalDistanceMeters.value, 5000)
  assert.equal(loadConfirmedTrainingImports().length, 1)
})

test("a colliding import ID or athlete does not accept the existing fact as a successful retry", () => {
  const collision = quickLogTrainingDraft(draft({ text: "跑了10公里" }), parseQuickLog("跑了10公里"))!
  assert.equal(confirmTrainingImport(collision).ok, true)
  const result = saveQuickLog(draft())
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.reason, /标识冲突/)
  assert.equal(loadConfirmedTrainingImports()[0].totalDistanceMeters.value, 10000)
  assert.equal(loadConfirmedTrainingImports().length, 1)
})

test("cleanup failure does not report committed facts as failed or resurrect a completed draft", () => {
  removeFails = true
  assert.equal(saveQuickLog(draft()).ok, true)
  assert.equal(data.has(QUICK_LOG_DRAFT_KEY), true)
  assert.equal(loadQuickLogDraft("2026-10-19"), null)
  clearQuickLogDraft()
  assert.equal(saveQuickLog(draft()).ok, true)
  assert.equal(loadConfirmedTrainingImports().length, 1)
})

test("only deleting the note preserves associated actuals and every legacy note field", () => {
  const legacy = { id: "n-old", at: "2026-10-18T08:00:00Z", date: "2026-10-18", text: "旧笔记", parsed: "已记入训练日志", customLegacyField: { preserved: true } }
  data.set(QUICK_LOG_NOTES_KEY, JSON.stringify([legacy]))
  assert.equal(loadQuickLogNotes()[0].text, "旧笔记")
  assert.equal(loadConfirmedTrainingImports().length, 0)
  assert.equal(saveQuickLog(draft()).ok, true)
  assert.deepEqual(JSON.parse(data.get(QUICK_LOG_NOTES_KEY)!).find((row: { id: string }) => row.id === legacy.id), legacy)
  assert.equal(deleteQuickLogNote(draft().id).ok, true)
  assert.equal(loadConfirmedTrainingImports().length, 1)
  assert.deepEqual(JSON.parse(data.get(QUICK_LOG_NOTES_KEY)!), [legacy])
  assert.equal(deleteQuickLogNote(legacy.id).ok, true)
  assert.equal(loadConfirmedTrainingImports().length, 1)
})

test("pending note cannot be deleted before its saved actual state is reconciled", () => {
  failNoteWrite = 2; saveQuickLog(draft())
  assert.equal(deleteQuickLogNote(draft().id).ok, false)
  assert.equal(loadQuickLogNotes().length, 1); assert.equal(loadConfirmedTrainingImports().length, 1)
})

test("corrupt note storage is preserved and blocks any new training side effect", () => {
  data.set(QUICK_LOG_NOTES_KEY, "{broken original")
  assert.equal(saveQuickLog(draft()).ok, false)
  assert.equal(data.get(QUICK_LOG_NOTES_KEY), "{broken original")
  assert.equal(loadConfirmedTrainingImports().length, 0)
})

test("weight retry after note finalization failure keeps one source-linked body event", () => {
  failNoteWrite = 2
  const input = draft({ text: "体重65.2" })
  assert.equal(saveQuickLog(input).ok, false)
  assert.equal(loadEvents().filter(row => row.event_type === "BODY_MEASUREMENT_RECORDED").length, 1)
  failNoteWrite = null
  assert.equal(saveQuickLog(loadQuickLogDraft("2026-10-19")!).ok, true)
  const events = loadEvents().filter(row => row.event_type === "BODY_MEASUREMENT_RECORDED")
  assert.equal(events.length, 1)
  assert.deepEqual(loadQuickLogNotes()[0].generatedRecordIds, [events[0].event_id])
  assert.equal(deleteQuickLogNote(input.id).ok, true)
  assert.equal(loadEvents().filter(row => row.event_type === "BODY_MEASUREMENT_RECORDED").length, 1)
})

test("actual-only 5km flows to log and coach history with unknown duration after note deletion", () => {
  assert.equal(saveQuickLog(draft()).ok, true)
  const rows = loadTrainingActivities()
  assert.equal(rows.length, 1); assert.equal(rows[0].distanceM, 5000); assert.equal(rows[0].durationSec, null)
  const summary = summarize(rows, "week", "run", "2026-10-19")
  assert.equal(summary.count, 1); assert.equal(summary.distanceM, 5000); assert.equal(summary.missingDuration, 1)
  const [fact] = readConfirmedPerformances("2026-10-20T00:00:00Z")
  assert.equal(fact.distanceMeters, 5000); assert.equal(fact.durationSeconds, null)
  assert.equal(deleteQuickLogNote(draft().id).ok, true)
  assert.equal(loadTrainingActivities().length, 1)
})
