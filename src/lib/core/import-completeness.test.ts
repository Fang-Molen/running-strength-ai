import assert from "node:assert/strict"
import test from "node:test"
import { assessImportCompleteness, declaredSlotCounts, refreshImportCompleteness } from "./import-completeness.ts"
import { createTrainingImportDraft, criticalImportGaps } from "./training-import.ts"

test("declared structures cover the real long sessions and ignore a bare total", () => {
  assert.equal(declaredSlotCounts("200m×4×2").running, 8)
  assert.equal(declaredSlotCounts("200米×4×2＋300米").running, 9)
  assert.equal(declaredSlotCounts("(300m＋200m)×3").running, 6)
  assert.equal(declaredSlotCounts("110m×4＋200m×2＋400m").running, 7)
  assert.equal(declaredSlotCounts("总距离800米").running, null)
  assert.equal(declaredSlotCounts("卧推4组，硬拉3组").strength, 7)
})

test("nine source slots against eight extracted rows stay partial", () => {
  const judged = assessImportCompleteness({ text: "200m×4×2＋300m", extractedRunning: 8, extractedStrength: 0 })
  assert.equal(judged.status, "PARTIAL")
  assert.match(judged.note, /原文约 9 条/)
  assert.match(judged.note, /草稿只有 8 条/)
  assert.match(judged.note, /可能未完整提取/)
  assert.equal(judged.acknowledged, false)
})

test("unknown totals stay unknown and acknowledgement does not invent completeness", () => {
  const judged = assessImportCompleteness({ text: "", extractedRunning: 4, extractedStrength: 0 })
  assert.equal(judged.status, "UNKNOWN")
  assert.match(judged.note, /不能声称全部提取完成/)
  const kept = refreshImportCompleteness({ ...judged, acknowledged: true }, 4, 0)
  assert.equal(kept.status, "UNKNOWN")
  assert.equal(kept.acknowledged, true)
  const draft = createTrainingImportDraft({ sport: "RUNNING", runningStructure: "REPEATED", runningSegments: [], strengthSets: [] }, "TEXT", ["text"])
  draft.importCompleteness = judged
  assert.equal(criticalImportGaps(draft).some((gap) => gap.includes("不能声称")), true)
  draft.importCompleteness = kept
  assert.equal(criticalImportGaps({ ...draft, sport: "RUNNING", occurredAt: { value: "2026-10-08T18:10:00+08:00", status: "RECORDED", sourceIds: ["text"] }, durationSeconds: { value: 900, status: "RECORDED", sourceIds: ["text"] }, runningSegments: [{ id: "r1", kind: "REPETITION", round: { value: 1, status: "RECORDED", sourceIds: ["user-edited"] }, repeat: { value: 1, status: "RECORDED", sourceIds: ["user-edited"] }, distanceMeters: { value: 200, status: "RECORDED", sourceIds: ["user-edited"] }, durationSeconds: { value: 36, status: "RECORDED", sourceIds: ["user-edited"] }, recoverySeconds: { value: null, status: "ABSENT", sourceIds: [] }, completion: "COMPLETED", sourceIds: ["user-edited"] }] }).some((gap) => gap.includes("不能声称")), false)
})

test("manual rows close a known gap without claiming the model extracted them", () => {
  const judged = assessImportCompleteness({ text: "200m×4×2", extractedRunning: 7, extractedStrength: 0 })
  const still = refreshImportCompleteness({ ...judged, acknowledged: true }, 7, 0)
  assert.equal(still.acknowledged, true)
  const changed = refreshImportCompleteness(still, 6, 0)
  assert.equal(changed.acknowledged, false)
  const closed = refreshImportCompleteness(judged, 8, 0)
  assert.equal(closed.status, "COMPLETE")
  assert.match(closed.note, /用户编辑或确认/)
  assert.equal(closed.acknowledged, true)
})
