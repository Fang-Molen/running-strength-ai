/** 气力槽：RPE 0–10。力量用 RIR 对照（Zourdos 2016 RIR-RPE 量表），跑步用“说话测试”描述（Foster CR-10 + talk test），均标【经验规则】。 */
export type RpeMode = "strength" | "run"
export const RPE_SOURCE: Record<RpeMode, string> = { strength: "【经验规则】RIR 对照，Zourdos 2016", run: "【经验规则】说话测试，Foster 2001 CR-10" }
export function snapRpe(v: number, half = false): number { const step = half ? 0.5 : 1; return Math.min(10, Math.max(0, Math.round(v / step) * step)) }
export function rpeLabel(v: number, mode: RpeMode): string {
  if (mode === "strength") {
    if (v >= 10) return "力竭，一次都做不了了"
    if (v >= 6) { const rir = Math.round((10 - v) * 2) / 2; return `还能再做约 ${rir} 次` }
    if (v >= 4) return "还能再做 5 次以上"
    return v > 0 ? "很轻松，热身强度" : "没用力"
  }
  if (v >= 10) return "极限，完全说不出话"
  if (v >= 9) return "几乎说不出话"
  if (v >= 7) return "只能蹦几个词"
  if (v >= 5) return "能说短句，有点喘"
  if (v >= 3) return "能完整说话"
  return v > 0 ? "能轻松聊天" : "没用力"
}
/** 蓝 → 红渐变色。 */
export function rpeColor(v: number): string { const t = Math.min(1, Math.max(0, v / 10)); const h = Math.round(215 - 215 * t); return `hsl(${h} 75% ${48 - t * 4}%)` }
/** 键盘：←↓ 减、→↑ 加、Home/End 到 0/10、PageUp/Down ±2。 */
export function rpeKey(v: number, key: string, half = false): number | null {
  const s = half ? 0.5 : 1
  const m: Record<string, number> = { ArrowRight: v + s, ArrowUp: v + s, ArrowLeft: v - s, ArrowDown: v - s, Home: 0, End: 10, PageUp: v + 2, PageDown: v - 2 }
  return key in m ? snapRpe(m[key], half) : null
}
