import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { AbilityPanel, DecisionCard, SessionReview } from "../../components/coach-panels.tsx"
import { abilityUnchangedBySession } from "./state.ts"
import { createTrainingDecision } from "./training-decision.ts"
import {
  abilityRows,
  competitionView,
  currentStoredDecision,
  describeSession,
  deviationsOf,
  suggestionAddsLoad,
  trendText,
  type SessionFacts,
} from "./coach-view.ts"
import type { DecisionRecord } from "./types.ts"

function facts(partial: Partial<SessionFacts> = {}): SessionFacts {
  return {
    name: "深蹲",
    plannedSets: 4,
    plannedAmount: 8,
    plannedWeight: 60,
    actualSets: 4,
    actualAmount: 8,
    actualWeight: 60,
    rpe: null,
    pain: false,
    interrupted: false,
    completion: true,
    modified: false,
    adopted: "ORIGINAL_PLAN",
    decisionId: "td-1",
    fatigue: 20,
    ...partial,
  }
}

test("a finished session shows the plan, the actual work, and no fake deviation", () => {
  const view = describeSession(facts())
  const html = renderToStaticMarkup(<SessionReview view={view} />)
  assert.equal(view.quality, "GOOD")
  assert.equal(view.reason, "按计划完成")
  assert.equal(view.deviation.sets, 0)
  assert.equal(view.deviation.reps, 0)
  assert.equal(view.deviation.loadKg, 0)
  assert.equal(html.includes("60kg × 4 × 8"), true)
  assert.equal(html.includes("GOOD"), true)
})

test("a short session keeps the set and load deviation", () => {
  const view = describeSession(facts({ actualSets: 3, fatigue: 61, adopted: "AI_RECOMMENDED" }))
  assert.equal(view.deviation.sets, -1)
  assert.equal(view.deviation.reps, 0)
  assert.equal(view.deviation.loadKg, -480)
  assert.equal(view.reason, "当前疲劳较高")
  assert.equal(view.quality, "ACCEPTABLE")
  assert.equal(view.next.includes("不增加"), true)
})

test("high fatigue and pain do not propose more load", () => {
  const planned = { name: "深蹲", sets: 4, amount: 8, weightKg: 60 }
  const tired = createTrainingDecision({ fatigue: 80, pain: false, rehab: false, sleepHours: null, recentRunKm: null, recentRunRpe: null, daysToCompetition: null, week: 2, bias: "build", previousFeel: null, facts: 3 }, planned)
  assert.equal(suggestionAddsLoad(tired, planned), false)
  const html = renderToStaticMarkup(<DecisionCard decision={tired} planned="60kg × 4 × 8" onAccept={() => {}} onOriginal={() => {}} onEdit={() => {}} />)
  assert.equal(/加重量|加量/.test(html), false)
  assert.equal(html.includes("为什么"), true)
  const pain = createTrainingDecision({ ...{ fatigue: 20, pain: true, rehab: false, sleepHours: null, recentRunKm: null, recentRunRpe: null, daysToCompetition: null, week: 2, bias: "build", previousFeel: null, facts: 3 } }, planned)
  assert.equal(pain.readiness, "PAIN_REPORTED")
  assert.equal(pain.risk, "CRITICAL")
})

test("missing numbers stay unknown and one miss does not lower ability", () => {
  const view = describeSession(facts({ actualSets: null, actualAmount: null, actualWeight: null, completion: false }))
  assert.equal(view.quality, "UNKNOWN")
  assert.equal(view.reason, "信息不足")
  assert.equal(view.deviation.sets, null)
  const before = abilityUnchangedBySession({ speed: null, aerobic: 82, strength: null, power: null, endurance: null, runningEconomy: null, sportSpecificAbility: null, limiter: null, confidence: 0.2 })
  const rows = abilityRows(before, 0, null)
  const html = renderToStaticMarkup(<AbilityPanel rows={rows} />)
  assert.equal(before.aerobic, 82)
  assert.equal(rows.find((row) => row.key === "speed")?.value, null)
  assert.equal(html.includes("未记录"), true)
  assert.equal(rows.every((row) => row.trend === "数据不足" && row.confidence === "LOW"), true)
})

test("no race, no history, and an expired decision stay off the current screen", () => {
  assert.equal(competitionView({ target: "", date: null, days: null, week: 2, bias: "build" }), null)
  assert.equal(competitionView({ target: "800米", date: "2020-01-01", days: -10, week: 2, bias: "build" }), null)
  assert.equal(trendText(0).note.includes("没有足够历史"), true)
  assert.equal(trendText(0).days7, "数据不足")
  const expired = { status: "EXPIRED", expiry: "2020-01-01T00:00:00.000Z", decision_id: "old", reasoning: "把重量加上去" } as DecisionRecord
  assert.equal(currentStoredDecision([expired], Date.parse("2026-10-07T00:00:00.000Z")), null)
  const modified = describeSession(facts({ actualSets: 3, actualAmount: 8, actualWeight: 55, modified: true, adopted: "USER_MODIFIED", decisionId: "td-9", fatigue: null }))
  assert.equal(modified.adoptedLabel, "用户修改")
  assert.equal(modified.decisionId, "td-9")
  assert.equal(modified.deviation.sets, -1)
  assert.equal(deviationsOf(facts()).duration, null)
})
