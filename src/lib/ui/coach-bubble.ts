/** Presentation-only split of a coach reply: conclusion first, ≤3 visible points, rest on demand. Text is never rewritten. */
const RED = /胸痛|胸闷|呼吸困难|晕厥|昏厥|晕倒|急诊|就医|立即停止|停止运动|停止训练|心悸|黑便|血尿|麻木无力|红旗/
export function isRedFlag(text: string): boolean { return RED.test(text) }
const EVIDENCE = /^(依据|证据|来源|数据|记录显示|口径|参考|引用|事实)[:：]?|^\[(?:来源|依据)/
export type BubbleParts = { lead: string; points: string[]; more: string[]; evidence: string[]; risk: boolean }
export function splitReply(text: string): BubbleParts {
  const risk = isRedFlag(text)
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return { lead: "", points: [], more: [], evidence: [], risk }
  let lead = lines[0]
  let rest = lines.slice(1)
  if (lines.length === 1 && lead.length > 90) {
    const sentences = lead.split(/(?<=[。！？!?；;])/).map((s) => s.trim()).filter(Boolean)
    lead = sentences[0]; rest = sentences.slice(1)
  }
  const evidence = rest.filter((l) => EVIDENCE.test(l))
  const body = rest.filter((l) => !EVIDENCE.test(l)).map((l) => l.replace(/^([-•·*]|\d+[.、)）])\s*/, ""))
  if (risk) return { lead, points: body, more: [], evidence, risk }
  return { lead, points: body.slice(0, 3), more: body.slice(3), evidence, risk }
}

/** 回复里的行内操作：按内容给最多 3 个按钮；安全类回复不给（先处理安全）。 */
export type ReplyAction = "plan" | "adjust" | "data"
export function replyActions(text: string): ReplyAction[] {
  if (isRedFlag(text)) return []
  const out: ReplyAction[] = []
  if (/加一节|安排|排(一|进)|计划里|加入计划|今天练/.test(text)) out.push("plan")
  if (/调整|降强度|缩短|进阶|减量|下调|先不加/.test(text)) out.push("adjust")
  if (/HRV|心率|睡眠|数据|记录显示|配速|体重/.test(text)) out.push("data")
  return out
}
export const ACTION_LABEL: Record<ReplyAction, string> = { plan: "加入计划", adjust: "接受调整", data: "看数据" }
