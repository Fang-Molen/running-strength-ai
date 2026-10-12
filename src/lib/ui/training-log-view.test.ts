import assert from "node:assert/strict"
import test from "node:test"
import { calendarDayShanghai, formatDeviceLocal, logMarks, occurrenceTitle, userFacingStatus } from "./training-log-view.ts"

test("shanghai day does not invent a date for empty or invalid times", () => {
  assert.equal(calendarDayShanghai(null), null)
  assert.equal(calendarDayShanghai("not-a-time"), null)
  assert.equal(calendarDayShanghai("2026-10-08T16:30:00.000Z"), "2026-10-09")
})

test("imports and occurrences stay counted apart on the same day", () => {
  const grouped = logMarks(
    [{ at: "2026-10-08T02:00:00.000Z" }, { at: null }],
    [{ at: "2026-10-08T03:00:00.000Z" }, { at: "bad" }],
  )
  assert.deepEqual(grouped.marks, [{ day: "2026-10-08", imports: 1, occurrences: 1 }])
  assert.equal(grouped.undatedImports, 1)
  assert.equal(grouped.undatedOccurrences, 1)
})

test("log titles use a real name and never an internal id", () => {
  assert.equal(occurrenceTitle("下肢力量", "别的名字"), "下肢力量")
  assert.equal(occurrenceTitle("  ", "全身 A"), "全身 A")
  assert.equal(occurrenceTitle("", ""), "未命名训练")
  assert.equal(occurrenceTitle("lpf928mk", "下肢力量"), "下肢力量")
  assert.equal(occurrenceTitle("lpf928mk", "ym36cr3b", "ym36cr3b"), "未命名训练")
  assert.equal(occurrenceTitle("strength-a", "strength-a", "strength-a"), "未命名训练")
})

test("device local clock is not the raw timestamp", () => {
  assert.equal(formatDeviceLocal(null), "未记录")
  assert.equal(formatDeviceLocal("not-a-time"), "未记录")
  const shown = formatDeviceLocal("2026-10-09T09:25:00.000Z")
  assert.match(shown, /^\d+月\d+日 \d{2}:\d{2}$/)
  assert.equal(shown.includes("T09"), false)
})

test("unknown and duplicate close stay unconfirmed, and void is its own status", () => {
  assert.equal(userFacingStatus({ lifecycle: "COMPLETED", outcome: "COMPLETED", voided: false }), "已完成")
  assert.equal(userFacingStatus({ lifecycle: "IN_PROGRESS", outcome: "UNKNOWN", voided: false }), "进行中")
  assert.equal(userFacingStatus({ lifecycle: "INTERRUPTED", outcome: "INTERRUPTED", voided: false }), "已中断")
  assert.equal(userFacingStatus({ lifecycle: "DUPLICATE_CLOSE", outcome: "UNKNOWN", voided: false }), "状态待确认")
  assert.equal(userFacingStatus({ lifecycle: "UNCLASSIFIED_CLOSE", outcome: "UNKNOWN", voided: false }), "状态待确认")
  assert.equal(userFacingStatus({ lifecycle: "COMPLETED", outcome: "UNKNOWN", voided: false }), "状态待确认")
  assert.equal(userFacingStatus({ lifecycle: "COMPLETED", outcome: "COMPLETED", voided: true }), "已作废")
})
