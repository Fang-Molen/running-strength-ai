import test from "node:test"
import assert from "node:assert/strict"
import { CARB_RANGE, dailyTargets, dayType, fuelFlags, homeTips, mealByHour, sessionTiming } from "./fuel-guide.ts"
const run = (minutes: number, intensity: "EASY" | "MODERATE" | "HARD" = "EASY") => ({ title: "跑", modality: "run" as const, minutes, intensity })
test("day type follows schedule; carb ranges are ACSM 2016 values", () => {
  assert.equal(dayType([]), "rest"); assert.equal(dayType([run(30)]), "light"); assert.equal(dayType([run(40, "HARD")]), "moderate"); assert.equal(dayType([run(60, "HARD")]), "high"); assert.equal(dayType([run(50), { ...run(45), modality: "strength" }]), "high")
  assert.deepEqual(CARB_RANGE.moderate, [5, 7]); assert.deepEqual(CARB_RANGE.high, [6, 10])
})
test("targets: 1.6 g/kg protein spread, carbs g by weight, labels", () => {
  const t = dailyTargets(60, [run(60, "HARD")])!
  assert.deepEqual(t.carbG, [360, 600]); assert.equal(t.proteinG, 96); assert.equal(t.proteinPerMeal, 18); assert.equal(t.meals, 5)
  assert.equal(dailyTargets(0, []), null)
  assert.equal(dailyTargets(60, [])!.tips[0].tag, "【经验规则】")
})
test("timing: during-fuel only ≥60 min; refuel when next session <8 h", () => {
  assert.match(sessionTiming(run(75), 60).during[0].text, /30–60 g/)
  assert.match(sessionTiming(run(40), 60).during[0].text, /喝水就够/)
  assert.match(sessionTiming(run(40), 60, 5).after[0].text, /60–72 g/)
  assert.match(sessionTiming(run(40), 60).before[2].text, /300–420 ml/)
})
test("flags: no diagnosis, refer on REDs signs, deficit warnings", () => {
  const f = fuelFlags({ targetKcal: 1200, bmr: 1400, aim: "lose", dayType: "high", loggedDays: [{ kcal: 1000, trainingDay: true }, { kcal: 1100, trainingDay: true }, { kcal: 900, trainingDay: true }], weekWeightDeltaKg: null, signs: { missedPeriods: true } })
  assert.equal(f.length, 4); const r = f.find((x) => x.level === "refer")!
  assert.match(r.text, /运动医学医生/); assert.match(r.text, /不做诊断/); assert.doesNotMatch(r.text, /你患有|确诊/)
  assert.equal(fuelFlags({ targetKcal: 2000, bmr: 1400, aim: "keep", dayType: "rest", loggedDays: [], weekWeightDeltaKg: 0, signs: {} }).length, 0)
})
test("home tips: 1–3, refer first, tied to session", () => {
  const t = dailyTargets(60, [run(70)])
  const tips = homeTips(t, [run(70)], [{ level: "refer", text: "就医", tag: "【共识】" }])
  assert.equal(tips.length, 3); assert.equal(tips[0].text, "就医"); assert.match(tips[1].text, /「跑」前/)
  assert.ok(homeTips(dailyTargets(60, []), [], []).length >= 1)
  assert.equal(mealByHour(8), "早餐"); assert.equal(mealByHour(12), "午餐"); assert.equal(mealByHour(19), "晚餐"); assert.equal(mealByHour(15), "加餐")
})

import { goalTargets, weightTrendAdvice } from "./fuel-guide.ts"
test("goal targets: cut higher protein + lower carb end, gain upper end, run periodized; labels present", () => {
  const hard = [run(70, "HARD")]
  const cut = goalTargets("cut", 70, hard)!, gain = goalTargets("gain", 70, hard)!, r = goalTargets("run", 70, hard)!, rest = goalTargets("run", 70, [])!
  assert.equal(cut.proteinG, 140); assert.equal(gain.proteinG, 112)
  assert.deepEqual(cut.carbPerKg, [6, 8]); assert.deepEqual(gain.carbPerKg, [8, 10]); assert.deepEqual(r.carbPerKg, [6, 10]); assert.deepEqual(rest.carbPerKg, [3, 5])
  for (const g of [cut, gain, r]) assert.ok(g.goalTips.every((t) => /【(证据|共识|经验规则)】/.test(t.tag)))
  assert.match(goalTargets("cut", 70, [], -1)!.goalTips.at(-1)!.text, /少 1 份主食/)
})
test("weight trend advice vs goal (Helms/Iraki rates, 经验规则)", () => {
  assert.equal(weightTrendAdvice("cut", 70, -1.2).status, "fast"); assert.equal(weightTrendAdvice("cut", 70, -1.2).adjust, 1)
  assert.equal(weightTrendAdvice("cut", 70, -0.5).status, "ok")
  assert.equal(weightTrendAdvice("cut", 70, 0.1).adjust, -1)
  assert.equal(weightTrendAdvice("gain", 70, 0.7).status, "fast"); assert.equal(weightTrendAdvice("gain", 70, 0.25).status, "ok")
  assert.equal(weightTrendAdvice("keep", 70, -0.2).status, "ok"); assert.equal(weightTrendAdvice("keep", 70, -1).adjust, 1)
  assert.equal(weightTrendAdvice("gain", null, null).status, "unknown")
})
