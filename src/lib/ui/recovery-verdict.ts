/** 今日恢复一句话结论。只描述“今天的状态”，不评价能力（手册：状态≠能力，一次不判定；数据缺失不推断恢复良好 S-05）。 */
import { RULES } from "./day-schedule-rules.ts"
export type RecoveryInput = { readiness: number | null; bodyBattery: number | null; sleepH: number | null; sleepBase: number | null; hrv: number | null; hrvBase: number | null; rhr: number | null; rhrBase: number | null; subjective: number | null; stress: number | null }
export type Verdict = { level: "go" | "watch" | "reduce" | "unknown"; title: string; reasons: string[]; note: string }
export const VERDICT_RULES = { rhrRise: 5, lowBattery: 30, lowSubjective: 4, highStress: 75 } as const // 本应用【经验规则】
export function recoveryVerdict(i: RecoveryInput): Verdict {
  const bad: string[] = [], soft: string[] = [], good: string[] = []
  if (i.readiness != null) (i.readiness < RULES.lowReadiness ? bad : good).push(`训练准备度 ${i.readiness}`)
  if (i.bodyBattery != null) (i.bodyBattery < VERDICT_RULES.lowBattery ? soft : good).push(`身体电量 ${i.bodyBattery}`)
  if (i.hrv != null && i.hrvBase) (i.hrv < i.hrvBase * (1 - RULES.hrvDropPct / 100) ? bad : good).push(`HRV ${i.hrv}（平时 ${Math.round(i.hrvBase)}）`)
  if (i.rhr != null && i.rhrBase) (i.rhr >= i.rhrBase + VERDICT_RULES.rhrRise ? soft : good).push(`静息心率 ${i.rhr}（平时 ${Math.round(i.rhrBase)}）`)
  if (i.sleepH != null && i.sleepBase) (i.sleepH <= i.sleepBase - RULES.sleepWorseHours ? soft : good).push(`睡眠 ${i.sleepH} 小时（平时 ${i.sleepBase.toFixed(1)}）`)
  if (i.subjective != null) (i.subjective <= VERDICT_RULES.lowSubjective ? bad : good).push(`主观恢复 ${i.subjective}/10`)
  if (i.stress != null && i.stress >= VERDICT_RULES.highStress) soft.push(`压力 ${i.stress}`)
  const note = "这只反映今天的状态，不代表能力变化。"
  if (!bad.length && !soft.length && !good.length) return { level: "unknown", title: "数据不足，按身体感觉来", reasons: ["今天还没有恢复数据"], note: "缺数据不代表恢复良好，可导入手表数据或手动记一下。" }
  if (bad.length || soft.length >= 2) return { level: "reduce", title: "建议降强度", reasons: [...bad, ...soft].slice(0, 3), note }
  if (soft.length) return { level: "watch", title: "可以练，留意感觉", reasons: soft, note }
  return { level: "go", title: "适合正常训练", reasons: good.slice(0, 3), note: "按计划来；练中不对劲随时降。" }
}
