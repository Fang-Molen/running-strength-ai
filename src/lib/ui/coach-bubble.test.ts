import test from "node:test"
import assert from "node:assert/strict"
import { splitReply } from "./coach-bubble.ts"
test("conclusion first, max 3 points, rest hidden, evidence separate", () => {
  const p = splitReply("今天降为轻松跑。\n- 一\n- 二\n- 三\n- 四\n依据：昨晚睡眠 5 小时")
  assert.equal(p.lead, "今天降为轻松跑。"); assert.deepEqual(p.points, ["一", "二", "三"]); assert.deepEqual(p.more, ["四"]); assert.equal(p.evidence.length, 1); assert.equal(p.risk, false)
})
test("red flag shows everything, nothing collapsed", () => {
  const p = splitReply("胸痛伴呼吸困难：停止运动，及时寻求急诊评估。\n一\n二\n三\n四")
  assert.equal(p.risk, true); assert.equal(p.points.length, 4); assert.equal(p.more.length, 0)
})
