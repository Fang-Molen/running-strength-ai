export const MODEL_RUNNING_CAP = 24
export const MODEL_STRENGTH_CAP = 16

export type ImportCompleteness = {
  status: "COMPLETE" | "PARTIAL" | "UNKNOWN"
  expectedRunning: number | null
  extractedRunning: number
  expectedStrength: number | null
  extractedStrength: number
  note: string
  acknowledged: boolean
}

const BANNER = "可能未完整提取，请核对总次数、轮次和力量组数。"

function normalizeMarkup(text: string): string {
  return text.replace(/[×xX*＊]/g, "×").replace(/[＋+]/g, "+").replace(/（/g, "(").replace(/）/g, ")")
}

export function declaredSlotCounts(text: string): { running: number | null; strength: number | null } {
  const source = normalizeMarkup(text)
  let running = 0
  let sawRunning = false
  let rest = source.replace(/\(([^)]+)\)\s*×\s*(\d+)/g, (full, inner: string, times: string) => {
    const distances = inner.match(/\d+(?:\.\d+)?\s*(?:m|米)/g)
    if (!distances?.length) return full
    sawRunning = true
    running += distances.length * Number(times)
    return " "
  })
  rest = rest.replace(/(\d+(?:\.\d+)?)\s*(?:m|米)\s*×\s*(\d+)\s*×\s*(\d+)/g, (_full, _distance, reps: string, rounds: string) => {
    sawRunning = true
    running += Number(reps) * Number(rounds)
    return " "
  })
  rest = rest.replace(/(\d+(?:\.\d+)?)\s*(?:m|米)\s*×\s*(\d+)/g, (_full, _distance, reps: string) => {
    sawRunning = true
    running += Number(reps)
    return " "
  })
  for (const _match of rest.matchAll(/(?:^|[\s+、,，])(\d+(?:\.\d+)?)\s*(?:m|米)(?!\s*×)/g)) {
    sawRunning = true
    running += 1
  }
  const sets = [...source.matchAll(/(\d+)\s*组/g)].map((match) => Number(match[1]))
  return { running: sawRunning ? running : null, strength: sets.length ? sets.reduce((sum, count) => sum + count, 0) : null }
}

function gapNote(expectedRunning: number | null, extractedRunning: number, expectedStrength: number | null, extractedStrength: number): string | null {
  const parts: string[] = []
  if (expectedRunning != null && extractedRunning < expectedRunning) parts.push(`原文约 ${expectedRunning} 条跑步实际，草稿只有 ${extractedRunning} 条`)
  if (expectedStrength != null && extractedStrength < expectedStrength) parts.push(`原文约 ${expectedStrength} 组力量，草稿只有 ${extractedStrength} 组`)
  return parts.length ? `${parts.join("；")}，不能显示为完整。${BANNER}未列出的重复不算没做。` : null
}

export function assessImportCompleteness(input: { text: string; extractedRunning: number; extractedStrength: number; runningCap?: number; strengthCap?: number }): ImportCompleteness {
  const declared = declaredSlotCounts(input.text)
  const runningCap = input.runningCap ?? MODEL_RUNNING_CAP
  const strengthCap = input.strengthCap ?? MODEL_STRENGTH_CAP
  const short = gapNote(declared.running, input.extractedRunning, declared.strength, input.extractedStrength)
  const hitCap = input.extractedRunning >= runningCap || input.extractedStrength >= strengthCap
  let status: ImportCompleteness["status"] = "COMPLETE"
  let note = "可见结构的条数已经对齐。这仍只覆盖已写出的槽位。"
  if (short) {
    status = "PARTIAL"
    note = short
  } else if (hitCap && declared.running == null && declared.strength == null) {
    status = "PARTIAL"
    note = `已到单次提取上限。${BANNER}不能声称全部提取完成。`
  } else if (declared.running == null && declared.strength == null) {
    status = "UNKNOWN"
    note = `${BANNER}总数未知，不能声称全部提取完成。`
  }
  return {
    status, expectedRunning: declared.running, extractedRunning: input.extractedRunning,
    expectedStrength: declared.strength, extractedStrength: input.extractedStrength, note, acknowledged: false,
  }
}

export function refreshImportCompleteness(previous: ImportCompleteness, extractedRunning: number, extractedStrength: number): ImportCompleteness {
  const short = gapNote(previous.expectedRunning, extractedRunning, previous.expectedStrength, extractedStrength)
  if (short) {
    const sameGap = previous.note === short
    return { ...previous, status: "PARTIAL", extractedRunning, extractedStrength, note: short, acknowledged: sameGap ? previous.acknowledged : false }
  }
  if (previous.expectedRunning == null && previous.expectedStrength == null) {
    return { ...previous, status: "UNKNOWN", extractedRunning, extractedStrength, note: `${BANNER}总数未知，不能声称全部提取完成。` }
  }
  return {
    ...previous, status: "COMPLETE", extractedRunning, extractedStrength, acknowledged: true,
    note: "补录后条数已与原文可见结构对齐。补录来源是用户编辑或确认，不是图片提取。",
  }
}
