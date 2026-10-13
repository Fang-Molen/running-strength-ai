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
