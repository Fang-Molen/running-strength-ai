import assert from "node:assert/strict"
import test from "node:test"
import { renderToString } from "react-dom/server"
import { DayCard } from "../../components/day-card.tsx"
import { StrengthApp } from "../../components/strength-app.tsx"
import { TrainingDecisionCard } from "../../components/training-decision-card.tsx"
import { TEMPLATES } from "../strength/model.ts"

test("first render does not depend on browser training and day records", () => {
  const plan = TEMPLATES.find((template) => template.id === "run")!.plan()
  const session = plan.sessions[0]!
  const render = () => renderToString(<>
    <DayCard part="run" />
    <TrainingDecisionCard plan={plan} session={session} onApply={() => {}} onLive={() => {}} />
  </>)
  const previous = globalThis.localStorage
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  try {
    delete (globalThis as { localStorage?: Storage }).localStorage
    const serverHtml = render()
    const serverApp = renderToString(<StrengthApp />)
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => {
          if (key === "fr255-day-v1") return JSON.stringify({ date: today, burn: 2100, runs: [{ id: "saved", km: 5, seconds: 1500, note: "已记录" }] })
          if (key === "fr255-body-v1") return JSON.stringify([{ id: "2026-10-08", date: "2026-10-08", weight: 70.5, fat: 28 }])
          if (key === "fr255-food-log-v1") return JSON.stringify([{ id: "rice", date: today, meal: "午餐", name: "米饭", grams: 150, kcal: 174, protein: 4 }])
          if (key === "fr255-profile-v1") return JSON.stringify({ sex: "female", age: "26", heightCm: "165", weightKg: "70.5", bodyFat: "28", aim: "lose", targetKg: "65", weeks: 12, activity: "run" })
          if (key === "fr255-strength-plan-v3") return JSON.stringify({ name: "已保存课表", kind: "run", sessions: [{ id: "saved-session", name: "已保存的推进课", moves: [] }], cycle: { block: 1, week: 1, logs: [] } })
          if (key === "fr255-confirmed-training-imports-v1") return JSON.stringify({ schemaVersion: 1, revision: 1, updatedAt: "", data: [{ schemaVersion: 1, userConfirmed: true, sleepHours: { status: "RECORDED", value: 7.5 }, subjectiveRecovery: { status: "RECORDED", value: 6 } }] })
          return null
        },
      },
    })
    assert.equal(render(), serverHtml)
    assert.equal(renderToString(<StrengthApp />), serverApp)
    assert.match(serverHtml, /今天还没有跑步记录/)
    assert.match(serverApp, /data-ready="false"/)
    assert.match(serverApp, /这天还没有安排|没有其他自建或方坤的训练/) // v83 P1-01：今天的 V4 只在主卡出现一次
    assert.doesNotMatch(serverApp, /70\.5/)
    assert.doesNotMatch(serverApp, /米饭/)
    assert.doesNotMatch(serverApp, /已保存的推进课/)
    assert.doesNotMatch(serverApp, /7\.5 小时/)
    assert.match(serverApp, /本周计划与实际/)
  } finally {
    if (previous === undefined) delete (globalThis as { localStorage?: Storage }).localStorage
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previous })
  }
})
