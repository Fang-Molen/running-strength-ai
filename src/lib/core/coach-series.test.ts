import assert from "node:assert/strict"
import test from "node:test"
import { deriveCoachBrief, type CoachBrief } from "./coach-brief.ts"
import { compactCoachSeriesPacket, groundSeriesResponseSources, guardSeriesResponse, projectCoachSeries, readSeriesIds, toggleSeriesId, type CoachSeriesPoint } from "./coach-series.ts"

function point(id: string, startedAt: string, seconds: number, partial: Partial<CoachBrief> = {}): CoachSeriesPoint {
  const eventId = `${id}-rep`
  const brief = deriveCoachBrief({
    question: "最近三次同一重复有什么变化",
    occurrenceId: id,
    runningStructure: "AVAILABLE",
    sessionRpe: 5,
    sleepHours: 8,
    subjectiveRecovery: 6,
    recoveryState: "NO_RELEVANT_EVIDENCE",
    fatigueState: "NO_RELEVANT_EVIDENCE",
    duplicateCount: 0,
    repetitionSlots: 1,
    continuousCount: 0,
    plannedSetCount: null,
    completedSetCount: null,
    durationSec: null,
    pain: false,
    soreness: false,
    daysToCompetition: null,
    week: 2,
    bias: "build",
    sourceIds: [id, eventId],
    sources: [
      { id, kind: "FACT", detail: `训练开始；${startedAt}` },
      { id: eventId, kind: "FACT", detail: `REPETITION intervals/b1/s200 第1轮第1次：COMPLETED；实际 200米/${seconds}秒` },
    ],
    running: [{ kind: "REPETITION", position: "intervals/b1/s200 第1轮第1次", status: "COMPLETED", planned: "200米/?秒", actual: `200米/${seconds}秒`, sourceEventIds: [eventId] }],
    ...partial,
  })
  return { occurrenceId: id, startedAt, brief }
}

test("a longitudinal series keeps only the same completed slot with each source", () => {
  const series = projectCoachSeries([
    point("a", "2026-10-01T09:00:00.000Z", 36),
    point("b", "2026-10-04T09:00:00.000Z", 35),
    point("c", "2026-10-07T09:00:00.000Z", 34),
  ])
  assert.ok(series)
  assert.equal(series.observations.length, 1)
  assert.deepEqual(series.observations[0]!.points.map((item) => item.actual), ["200米/36秒", "200米/35秒", "200米/34秒"])
  const packet = compactCoachSeriesPacket(series, [{ role: "user", text: "只看三次同槽位用时" }])
  assert.equal(packet.question, "最近三次同一重复有什么变化")
  assert.deepEqual(packet.points.map((item) => item.sourceIds.includes(`${item.occurrenceId}-rep`)), [true, true, true])
  const citations = ["a-rep", "b-rep", "c-rep"]
  const observed = guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "三次同槽位已记录用时分别是 36 秒、35 秒、34 秒；这是观察，不能证明能力提升。", citations, nextStep: null }))
  assert.equal(observed.mode, "answer")
  const serverGrounded = guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "三次同槽位已记录用时分别是 36 秒、35 秒、34 秒；这是观察，不能证明能力提升。", citations: ["a", "b", "c"], nextStep: null }))
  assert.equal(serverGrounded.mode, "answer")
  assert.deepEqual(serverGrounded.citations.filter((id) => id.endsWith("-rep")), ["a-rep", "b-rep", "c-rep"])
  assert.equal(guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "三次同槽位已记录用时依次为 34 秒、35 秒、36 秒。", citations: ["a", "b", "c"], nextStep: null })).mode, "unavailable")
  assert.equal(guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "最近三次已记录用时分别是 36 秒、35 秒、34 秒，这只是观察，不能证明能力提升。", citations: ["a", "b", "c"], nextStep: null })).mode, "answer")
  assert.equal(guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "最近三次同槽位已记录用时分别是 36 秒、35 秒、34 秒；这只是观察。", citations: ["a", "b", "c"], nextStep: null })).mode, "answer")
  assert.equal(guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "最近三次已记录用时依次为 34 秒、35 秒、36 秒。", citations: ["a", "b", "c"], nextStep: null })).mode, "unavailable")
  assert.match(groundSeriesResponseSources(series, JSON.stringify({ mode: "answer", text: "三次是 36 秒、35 秒、33 秒。", citations: ["a", "b", "c"] })), /a-rep/)
  assert.equal(guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "第一次 34 秒，第二次 35 秒，最近一次 36 秒。", citations, nextStep: null })).mode, "unavailable")
  assert.equal(guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "第一次 36 秒，第二次 35 秒，最近一次 34 秒。", citations, nextStep: null })).mode, "answer")
  assert.equal(guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "2026-10-01 是 36 秒，2026-10-07 是 34 秒。", citations, nextStep: null })).mode, "answer")
  assert.equal(guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "三次用时逐步变快。", citations: ["a", "b", "c"], nextStep: null })).mode, "unavailable")
  assert.equal(guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "能力持续提高。", citations, nextStep: null })).mode, "unavailable")
  assert.equal(guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "三次分别是 36 秒、35 秒、33 秒。", citations, nextStep: null })).mode, "unavailable")
  assert.equal(guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "三次都有记录。", citations: ["a-rep", "b-rep"], nextStep: null })).mode, "unavailable")
})

test("missing, conflicting, same-day, and recovery gaps cannot become a trend or load increase", () => {
  const missing = point("c", "2026-10-07T09:00:00.000Z", 34, { running: [] })
  const series = projectCoachSeries([point("a", "2026-10-01T09:00:00.000Z", 36), point("b", "2026-10-04T09:00:00.000Z", 35), missing])
  assert.ok(series)
  assert.equal(series.observations.length, 0)
  assert.equal(guardSeriesResponse(series, JSON.stringify({ mode: "answer", text: "最近持续变快。", citations: ["a", "b", "c"], nextStep: null })).mode, "unavailable")
  assert.equal(projectCoachSeries([point("a", "2026-10-01T01:00:00.000Z", 36), point("b", "2026-10-01T03:00:00.000Z", 35), point("c", "2026-10-07T09:00:00.000Z", 34)]), null)
  const high = projectCoachSeries([point("a", "2026-10-01T09:00:00.000Z", 36), point("b", "2026-10-04T09:00:00.000Z", 35), point("c", "2026-10-07T09:00:00.000Z", 34, { sessionRpe: 8, sleepHours: null, subjectiveRecovery: null })])!
  assert.equal(guardSeriesResponse(high, JSON.stringify({ mode: "answer", text: "下一课加一组。", citations: ["a-rep", "b-rep", "c-rep"], nextStep: null })).mode, "ask")
  const conflict = point("c", "2026-10-07T09:00:00.000Z", 34, { duplicateCount: 1 })
  assert.equal(guardSeriesResponse(projectCoachSeries([point("a", "2026-10-01T09:00:00.000Z", 36), point("b", "2026-10-04T09:00:00.000Z", 35), conflict])!, JSON.stringify({ mode: "answer", text: "持续变快。", citations: ["a-rep", "b-rep", "c-rep"], nextStep: null })).mode, "ask")
})

test("series routing accepts three to six unique allowed ids", () => {
  assert.deepEqual(readSeriesIds(JSON.stringify({ seriesIds: ["a", "b", "c"] }), ["a", "b", "c", "d"]), ["a", "b", "c"])
  assert.equal(readSeriesIds(JSON.stringify({ seriesIds: ["a", "a", "c"] }), ["a", "c"]), null)
  assert.equal(readSeriesIds(JSON.stringify({ seriesIds: ["a", "b"] }), ["a", "b"]), null)
  assert.deepEqual(toggleSeriesId(["a", "b"], "c"), ["a", "b", "c"])
  assert.deepEqual(toggleSeriesId(["a", "b", "c"], "b"), ["a", "c"])
  assert.deepEqual(toggleSeriesId(["a", "b", "c"], "d", 3), ["a", "b", "c"])
})

test("a recovery trend needs one cited recovery score from every occurrence", () => {
  const recoveryPoint = (id: string, date: string, value: number) => point(id, date, 35, {
    subjectiveRecovery: value,
    sourceIds: [id, `${id}-rep`, `${id}-recovery`],
    sources: [
      { id, kind: "FACT", detail: `训练开始；${date}` },
      { id: `${id}-rep`, kind: "FACT", detail: "REPETITION slot：COMPLETED；实际 200米/35秒" },
      { id: `${id}-recovery`, kind: "FACT", detail: `SUBJECTIVE_RECOVERY 本次主观恢复：${value}/10；已绑定本次训练的记录，不能单独作为恢复或伤病诊断` },
    ],
  })
  const complete = projectCoachSeries([recoveryPoint("a", "2026-10-01T09:00:00.000Z", 4), recoveryPoint("b", "2026-10-04T09:00:00.000Z", 5), recoveryPoint("c", "2026-10-07T09:00:00.000Z", 6)])!
  assert.equal(guardSeriesResponse(complete, JSON.stringify({ mode: "answer", text: "已记录的主观恢复逐次提高，但这不是恢复诊断。", citations: ["a-recovery", "b-recovery", "c-recovery"], nextStep: null })).mode, "answer")
  assert.equal(guardSeriesResponse(complete, JSON.stringify({ mode: "answer", text: "恢复持续改善。", citations: ["a", "b", "c"], nextStep: null })).mode, "unavailable")
  const missing = projectCoachSeries([recoveryPoint("a", "2026-10-01T09:00:00.000Z", 4), recoveryPoint("b", "2026-10-04T09:00:00.000Z", 5), point("c", "2026-10-07T09:00:00.000Z", 35, { subjectiveRecovery: null })])!
  assert.equal(guardSeriesResponse(missing, JSON.stringify({ mode: "answer", text: "恢复趋势正在改善。", citations: ["a-recovery", "b-recovery", "c"], nextStep: null })).mode, "unavailable")
  assert.equal(guardSeriesResponse(missing, JSON.stringify({ mode: "answer", text: "最近一次恢复未记录，数据不足，不能判断恢复趋势。", citations: ["a-recovery", "b-recovery", "c"], nextStep: null })).mode, "answer")
  const groundedGap = guardSeriesResponse(missing, JSON.stringify({ mode: "answer", text: "最近一次恢复未记录，数据不足，不能判断恢复趋势。", citations: ["a-recovery", "b-recovery"], nextStep: null }))
  assert.equal(groundedGap.mode, "answer")
  assert.equal(groundedGap.citations.includes("c"), true)
})
