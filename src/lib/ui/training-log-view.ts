/** Read-only calendar grouping. It does not assign evidence or invent a day. */

export function calendarDayShanghai(value: string | null | undefined): string | null {
  if (!value) return null
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(time)
  return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? parts : null
}

export type LogMark = { day: string; imports: number; occurrences: number }

export function logMarks(imports: { at: string | null }[], occurrences: { at: string | null }[]): { marks: LogMark[]; undatedImports: number; undatedOccurrences: number } {
  const map = new Map<string, LogMark>()
  let undatedImports = 0
  let undatedOccurrences = 0
  for (const item of imports) {
    const day = calendarDayShanghai(item.at)
    if (!day) { undatedImports += 1; continue }
    const row = map.get(day) ?? { day, imports: 0, occurrences: 0 }
    row.imports += 1
    map.set(day, row)
  }
  for (const item of occurrences) {
    const day = calendarDayShanghai(item.at)
    if (!day) { undatedOccurrences += 1; continue }
    const row = map.get(day) ?? { day, imports: 0, occurrences: 0 }
    row.occurrences += 1
    map.set(day, row)
  }
  return { marks: [...map.values()].sort((a, b) => a.day.localeCompare(b.day)), undatedImports, undatedOccurrences }
}

function readableTrainingName(value: string | null | undefined, sessionId?: string | null): string {
  const text = value?.trim() ?? ""
  if (!text || text === sessionId || /^[a-z0-9_-]{6,}$/i.test(text)) return ""
  return text
}

export function occurrenceTitle(snapshotName: string | null | undefined, planName: string | null | undefined, sessionId?: string | null): string {
  return readableTrainingName(snapshotName, sessionId) || readableTrainingName(planName, sessionId) || "未命名训练"
}

export function formatDeviceLocal(value: string | null | undefined): string {
  if (!value) return "未记录"
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return "未记录"
  const date = new Date(time)
  const hour = String(date.getHours()).padStart(2, "0")
  const minute = String(date.getMinutes()).padStart(2, "0")
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hour}:${minute}`
}

export function userFacingStatus(input: { lifecycle: string; outcome: string; voided: boolean }): string {
  if (input.voided) return "已作废"
  if (input.lifecycle === "IN_PROGRESS") return "进行中"
  if (input.lifecycle === "INTERRUPTED" || input.outcome === "INTERRUPTED") return "已中断"
  if (input.lifecycle === "SKIPPED" || input.outcome === "SKIPPED") return "已跳过"
  if (input.lifecycle === "COMPLETED" && input.outcome === "COMPLETED") return "已完成"
  return "状态待确认"
}
