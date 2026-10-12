// Narrow exclusions for negated failure prescriptions; affirmative clauses remain blocked.
export function containsPrescribedFailure(text: string): boolean {
  for (const match of text.matchAll(/力竭|做到失败|(?:做到)?极限/g)) {
    const index = match.index!
    const before = text.slice(Math.max(0, index - 20), index).split(/[，。；、!?！？\n]/).at(-1) ?? ""
    const after = text.slice(index + match[0].length)
    if (match[0] === "力竭" && /^前(?:就)?(?:停止|结束)/.test(after)) continue
    if (/(?:不要|不得|不能|避免|禁止|不|未到)(?:做到|练到|训练至|达到|到|进入)?$/.test(before)) continue
    return true
  }
  return false
}
