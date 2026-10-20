/** 今日恢复一句话结论。只描述“今天的状态”，不评价能力（手册：状态≠能力，一次不判定；数据缺失不推断恢复良好 S-05）。 */
import { sleepHoursText } from '../health/observation'
import { RULES } from "./day-schedule-rules.ts"
export type RecoveryInput = { readiness: number | null; bodyBattery: number | null; sleepH: number | null; sleepBase: number | null; hrv: number | null; hrvBase: number | null; rhr: number | null; rhrBase: number | null; subjective: number | null; stress: number | null; pain?: "none" | "mild" | "sharp" | null }
export type Verdict = { level: "go" | "watch" | "reduce" | "unknown"; title: string; reasons: string[]; note: string }
export const VERDICT_RULES = { rhrRise: 5, lowBattery: 30, lowSubjective: 4, watchSubjective: 5, highStress: 75 } as const // 本应用【经验规则】
export function recoveryVerdict(i: RecoveryInput): Verdict {
  const bad: string[] = [], soft: string[] = [], good: string[] = []
  if (i.readiness != null) (i.readiness < RULES.lowReadiness ? bad : good).push(`训练准备度 ${i.readiness}`)
  if (i.bodyBattery != null) (i.bodyBattery < VERDICT_RULES.lowBattery ? soft : good).push(`身体电量 ${i.bodyBattery}`)
  if (i.hrv != null && i.hrvBase) (i.hrv < i.hrvBase * (1 - RULES.hrvDropPct / 100) ? bad : good).push(`HRV ${i.hrv}（平时 ${Math.round(i.hrvBase)}）`)
  if (i.rhr != null && i.rhrBase) (i.rhr >= i.rhrBase + VERDICT_RULES.rhrRise ? soft : good).push(`静息心率 ${i.rhr}（平时 ${Math.round(i.rhrBase)}）`)
  if (i.sleepH != null && i.sleepBase) (i.sleepH <= i.sleepBase - RULES.sleepWorseHours ? soft : good).push(`睡眠 ${sleepHoursText(i.sleepH)}（平时 ${i.sleepBase.toFixed(1)}）`)
  // v81：主观恢复统一 1–10（旧 1–5 已在读取时 ×2）。≤4 降强度；5 留意；≥6 正常。
  if (i.subjective != null) (i.subjective <= VERDICT_RULES.lowSubjective ? bad : i.subjective <= VERDICT_RULES.watchSubjective ? soft : good).push(`主观恢复 ${i.subjective}/10`)
  if (i.stress != null && i.stress >= VERDICT_RULES.highStress) soft.push(`压力 ${i.stress}`)
  if (i.pain === "sharp") bad.push("明显疼痛（手册 P-03：疼痛先处理）")
  if (i.pain === "mild") soft.push("有点疼")
  const note = "这只反映今天的状态，不代表能力变化。"
  if (!bad.length && !soft.length && !good.length) return { level: "unknown", title: "数据不足，按身体感觉来", reasons: ["今天还没有恢复数据"], note: "缺数据不代表恢复良好，可导入手表数据或手动记一下。" }
  if (bad.length || soft.length >= 2) return { level: "reduce", title: "建议降强度", reasons: [...bad, ...soft].slice(0, 3), note }
  if (soft.length) return { level: "watch", title: "可以练，留意感觉", reasons: soft, note }
  // 只有单项正向客观指标（例如静息心率略低于平时），不能据此宣布适合训练。
  // 不把设备正常当成疼痛、主观疲劳或热身表现已经核对过。
  if (good.length === 1 && i.subjective == null) return {
    level: "unknown", title: "仅有单项恢复参考，仍需结合身体感受", reasons: good,
    note: "这项数据未见明显不利线索，但不能单独作为训练许可。训练前核对疼痛、疲劳与热身状态。",
  }
  return { level: "go", title: "目前未见明显不利信号", reasons: good.slice(0, 3), note: "这不是训练许可；按计划前仍需结合疼痛、疲劳和热身表现。" }
}
