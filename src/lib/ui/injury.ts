/** 伤病卡：第一次排力量课时问（不在首次引导里问）。只描述情况，不说病名（手册 P-08）。 */
export const INJURY_KEY = "fk-injury-v1"
export const PARTS = ["肩", "肘/腕", "下背", "髋", "膝", "脚踝/跟腱", "足底"] as const
export type Part = (typeof PARTS)[number]
export type Injury = { part: Part; kind: "old" | "current"; score?: number; since?: string }
export type InjuryStore = { asked: boolean; items: Injury[] }
/** 每个部位主要受力的动作关键词（经验规则，用于选动作，不是诊断）。 */
const LOADS: Record<Part, RegExp> = {
  "肩": /推举|卧推|俯卧撑|臂屈伸|引体|划船|上斜|飞鸟|抓举|挺举/, "肘/腕": /弯举|臂屈伸|卧推|俯卧撑|引体|下压/, "下背": /硬拉|罗马尼亚|早安|划船|深蹲|摆|挺举/,
  "髋": /深蹲|硬拉|臀推|弓步|保加利亚|箭步|侧弓/, "膝": /深蹲|弓步|箭步|跳|保加利亚|腿屈伸|台阶|蹲/, "脚踝/跟腱": /跳|提踵|弓步|冲刺|跳绳|箭步/, "足底": /跳|提踵|跳绳|冲刺/,
}
export type InjuryAdvice = { avoid: string[]; caution: string[]; safety: { text: string; rule: string; red: boolean }[] }
export function injuryAdvice(moves: string[], items: Injury[], today: string): InjuryAdvice {
  const avoid = new Set<string>(), caution = new Set<string>(), safety: InjuryAdvice["safety"] = []
  for (const it of items) for (const m of moves) if (LOADS[it.part].test(m)) (it.kind === "current" ? avoid : caution).add(m)
  for (const it of items.filter((x) => x.kind === "current")) {
    if ((it.score ?? 0) > 3) safety.push({ text: `${it.part}当前疼痛 ${it.score}/10：会引起疼痛的动作先不做；48 小时内不缓解请找专业人员检查。`, rule: "P-03", red: true })
    else safety.push({ text: `${it.part}有轻微疼痛：相关动作换成不痛的替代，练中疼痛 ≤3/10 且不改变动作才继续。`, rule: "P-01", red: false })
    if (it.since && (Date.parse(today) - Date.parse(it.since)) / 864e5 > 14) safety.push({ text: `${it.part}疼痛已超过 14 天：建议找运动医学或康复专业人员检查。`, rule: "P-07", red: true })
  }
  for (const it of items.filter((x) => x.kind === "old")) safety.push({ text: `${it.part}有旧伤：相关动作从较轻重量开始，逐步加。`, rule: "经验规则", red: false })
  return { avoid: [...avoid], caution: [...caution].filter((m) => !avoid.has(m)), safety }
}
type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void }
const st = (): KV | null => (typeof localStorage === "undefined" ? null : localStorage)
export function loadInjury(s: KV | null = st()): InjuryStore { try { const v = JSON.parse(s?.getItem(INJURY_KEY) ?? "null"); if (v && Array.isArray(v.items)) return v } catch { /* default */ } return { asked: false, items: [] } }
export function saveInjury(v: InjuryStore, s: KV | null = st()) { s?.setItem(INJURY_KEY, JSON.stringify(v)) }
export const needsInjuryAsk = (store: InjuryStore, hasStrength: boolean) => hasStrength && !store.asked
