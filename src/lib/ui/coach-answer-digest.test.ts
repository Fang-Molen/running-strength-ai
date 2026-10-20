import test from "node:test"
import assert from "node:assert/strict"
import { digestCoachAnswer } from "./coach-answer-digest.ts"
const parts = (d: ReturnType<typeof digestCoachAnswer>) => [d.conclusion, d.next, ...d.reasoning].filter(Boolean).sort()
test("explicit 结论 leads, next session pulled out, reasoning keeps the rest in order", () => {
  const t = "先看事实：上次 400米×8 平均 82 秒。\n结论：这次是有氧耐力课，不是速度课。\n原因是休息 1 分钟，乳酸没有清除。\n下一课：400米×6，休 2 分钟，RPE 7。\n记下每组用时。"
  const d = digestCoachAnswer(t)
  assert.equal(d.conclusion, "这次是有氧耐力课，不是速度课。")
  assert.equal(d.next, "下一课：400米×6，休 2 分钟，RPE 7。")
  assert.deepEqual(d.reasoning, ["先看事实：上次 400米×8 平均 82 秒。", "原因是休息 1 分钟，乳酸没有清除。", "记下每组用时。"])
  assert.equal(d.risk, false)
})
test("no label: first sentence is the conclusion; nothing is lost or rewritten", () => {
  const t = "今天降为轻松跑。昨晚睡眠 5 小时，HRV 低于基线。明天根据恢复再决定是否加量。"
  const d = digestCoachAnswer(t)
  assert.equal(d.conclusion, "今天降为轻松跑。"); assert.equal(d.next, "明天根据恢复再决定是否加量。")
  assert.deepEqual(parts(d), t.split(/(?<=。)/).sort())
})
test("red flag keeps the safety sentence first", () => {
  const d = digestCoachAnswer("胸痛伴呼吸困难：停止运动，及时寻求急诊评估。\n结论：今天不练。")
  assert.equal(d.risk, true); assert.match(d.conclusion, /胸痛/)
})
test("single short answer has no reasoning", () => {
  const d = digestCoachAnswer("可以。"); assert.equal(d.conclusion, "可以。"); assert.equal(d.next, ""); assert.equal(d.reasoning.length, 0)
})
test("source tag is not the conclusion; incidental safety wording does not force reasoning open", () => {
  const d = digestCoachAnswer("【本地分析 · 联网失败（offline-test）】\n\n下一课：明天的课程尚未确认，先形成观察任务。\n没有批准课程时先核对课程与目的；不编造剂量。\n疼痛加重、胸闷时停止活动并按安全提示处理。")
  assert.equal(d.tag, "【本地分析 · 联网失败（offline-test）】")
  assert.equal(d.conclusion, "下一课：明天的课程尚未确认，先形成观察任务。")
  assert.equal(d.risk, false)
  assert.equal(d.reasoning.length, 2, "； stays inside its sentence")
})
test("very long first sentence is cut at the first ： — the tail is kept verbatim at the top of the reasoning", () => {
  const head = "明天的课程尚未确认，先形成具体观察任务："
  const tail = "从你已有批准课程中选与当前主项目标相符的一课，保留原组次和休息，记录首末用时、原目标偏差及次日反应。"
  const d = digestCoachAnswer(head + tail)
  assert.equal(d.conclusion, head); assert.equal(d.reasoning[0], tail)
})
