/** Generic imported plans can start with actual training text. Only an exact
 * decorative heading may be omitted; never drop a line merely by its position. */
export function mainTrainingLines(day: { main: string[] }): string[] {
  const first = day.main[0]?.trim() ?? '';
  return /^(?:(?:跑步|正式)?主课|主训练|主要训练|训练内容)\s*[:：]?$/.test(first)
    ? day.main.slice(1) : day.main.slice();
}
