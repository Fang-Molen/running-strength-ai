/** R5 presentation-only digest of a 方坤 answer: one-line conclusion, the next session, reasoning on demand.
 *  The answer text is never rewritten: every sentence lands in exactly one of conclusion / next / reasoning, in order. */
import { isRedFlag } from "./coach-bubble.ts"
export type AnswerDigest = { tag: string; conclusion: string; next: string; reasoning: string[]; risk: boolean }
const NEXT = /下一课|下一节|下节课|下次|下一次|明天|下周|接下来|处方|下一组/
const CONCLUSION = /^(?:【[^】]{1,12}】\s*)?(?:结论|一句话|先说结论)[:：]\s*/
function sentences(text: string): string[] {
  return text.split(/\n+/).flatMap((line) => line.trim().split(/(?<=[。！？!?])/)).map((s) => s.trim()).filter(Boolean)
}
export function digestCoachAnswer(text: string): AnswerDigest {
  // Strip paired presentation markers before splitting. The persisted raw answer
  // remains untouched, including its sources; sentence boundaries cannot orphan **.
  text = text.replace(/\*\*([\s\S]+?)\*\*/g, '$1').replace(/__([\s\S]+?)__/g, '$1')
  // 【本地分析 · …】之类的来源标签单独显示，不当作结论。
  const tm = /^\s*(【[^】\n]{1,40}】)\s*/.exec(text)
  const tag = tm ? tm[1] : ""
  const all = sentences(tm ? text.slice(tm[0].length) : text)
  if (!all.length) return { tag, conclusion: "", next: "", reasoning: [], risk: isRedFlag(text) }
  let at = all.findIndex((s) => CONCLUSION.test(s))
  // 安全类回答：第一句就是安全提醒时保持第一句领头、理由默认展开；正文里顺带的安全提示不算。
  const risk = isRedFlag(all[0])
  if (at < 0 || risk) at = 0
  let conclusion = all[at].replace(CONCLUSION, "") || all[at]
  const rest = all.filter((_, i) => i !== at)
  // 一句话结论：超长首句在第一个「：」或「；」处断开，后半句原样放进理由最前面（不改字）。
  if (conclusion.length > 50) {
    const cut = [...conclusion].findIndex((ch, i) => (ch === "：" || ch === "；") && i >= 6 && i <= 44)
    if (cut > 0) { rest.unshift(conclusion.slice(cut + 1)); conclusion = conclusion.slice(0, cut + 1) }
  }
  const ni = rest.findIndex((s) => NEXT.test(s))
  const next = ni >= 0 ? rest[ni] : ""
  const reasoning = rest.filter((_, i) => i !== ni)
  return { tag, conclusion, next, reasoning, risk }
}
