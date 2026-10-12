import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { CoachPlanSessionDetails } from "../../components/coach-plan-session-details.tsx"
import type { PlanSessionCandidate } from "./coach-plan.ts"

const base: PlanSessionCandidate = {
  day: 1, type: "EASY_RUN", title: "轻松跑", durationMinutes: 40, distanceMeters: null, intensity: "EASY",
  prescription: "轻松完成", rationale: "服从时间条件", citations: ["availability"],
  runPrescription: null, strengthPrescription: null,
}

test("a newly rendered running candidate visibly includes its actual stop conditions", () => {
  const session = { ...base, runPrescription: { warmupMinutes: 10, main: [{ label: "轻松跑", repetitions: 1, distanceMeters: null, durationSeconds: 1200, recoverySeconds: null, effort: "EASY_TALK" as const, citations: ["availability"] }], cooldownMinutes: 10, stopConditions: ["左膝出现疼痛就停止", "无法维持轻松呼吸时结束"] } }
  const html = renderToStaticMarkup(<CoachPlanSessionDetails session={session} />)
  assert.match(html, /跑步停止条件/)
  assert.match(html, /<li[^>]*>左膝出现疼痛就停止<\/li>/)
  assert.match(html, /无法维持轻松呼吸时结束/)
  assert.match(html, /1200 秒/)
})

test("a strength candidate renders its own stopping boundary instead of a generic running instruction", () => {
  const session: PlanSessionCandidate = { ...base, type: "STRENGTH", strengthPrescription: { exercises: [{ name: "分腿蹲", sets: 2, repetitions: 8, durationSeconds: null, effort: "LEAVE_3_REPS", restSeconds: 90, citations: ["availability"] }], stopConditions: ["动作失控立即停止"] } }
  const html = renderToStaticMarkup(<CoachPlanSessionDetails session={session} />)
  assert.match(html, /力量停止条件/)
  assert.match(html, /动作失控立即停止/)
  assert.equal(html.includes("跑步停止条件"), false)
  assert.match(html, /LEAVE_3_REPS/)
})
