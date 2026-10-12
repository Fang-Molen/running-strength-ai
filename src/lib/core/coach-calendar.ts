export const PRODUCT_CALENDAR_TIME_ZONE = "Asia/Shanghai"

export function calendarDay(value: string, timeZone = PRODUCT_CALENDAR_TIME_ZONE): string | null {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(time))
  const year = parts.find((part) => part.type === "year")?.value
  const month = parts.find((part) => part.type === "month")?.value
  const day = parts.find((part) => part.type === "day")?.value
  return year && month && day ? `${year}-${month}-${day}` : null
}
