/** 首次引导：5 题，每题有默认值可跳过（借鉴 Fitbod/Runna/Headspace，见 research/顶级UI借鉴.md §1、C）。 */
import { addDays, type ScheduleEntry } from "./day-schedule-rules.ts"
import { TIER_OF_GROUP, type Tier, type WatchId } from "./watch-mode.ts"
export const ONBOARD_KEY = "fk-onboard-v1"
export type Goal = "speed" | "race" | "muscle" | "fat" | "fitness"
export const GOALS: [Goal, string][] = [["speed", "跑步提速"], ["race", "半马/全马"], ["muscle", "增肌"], ["fat", "减脂"], ["fitness", "综合体能"]]
export type Experience = "none" | "lt1" | "1to3" | "gt3"
export const EXPERIENCE: [Experience, string][] = [["none", "没有规律训练"], ["lt1", "不到 1 年"], ["1to3", "1–3 年"], ["gt3", "3 年以上"]]
export type Venue = "gym" | "home" | "bodyweight"
export const VENUES: [Venue, string][] = [["gym", "健身房"], ["home", "家里有哑铃"], ["bodyweight", "只能徒手"]]
export const EQUIPMENT = ["杠铃", "深蹲架", "卧推凳", "哑铃", "壶铃", "弹力带", "引体杆", "器械"] as const
export const PRESET: Record<Venue, string[]> = { gym: ["杠铃", "深蹲架", "卧推凳", "哑铃", "壶铃", "引体杆", "器械"], home: ["哑铃", "弹力带"], bodyweight: [] }
export type When = "morning" | "noon" | "evening"
export const WHEN: [When, string][] = [["morning", "早起"], ["noon", "午休"], ["evening", "下班后"]]
export type Answers = { source: WatchId; goals: Goal[]; experience: Experience; venue: Venue; equipment: string[]; days: number[]; minutes: 20 | 30 | 45 | 60; when: When | null }
/** 稳妥默认：无手表、综合体能、新手、徒手、每周 3 天（一三五）、30 分钟。 */
export const DEFAULTS: Answers = { source: "none", goals: ["fitness"], experience: "none", venue: "bodyweight", equipment: [], days: [0, 2, 4], minutes: 30, when: null }
export const QUESTIONS = ["数据来源", "目标", "经验", "场地器械", "每周时间"] as const

export function toggleGoal(goals: Goal[], g: Goal): Goal[] { return goals.includes(g) ? goals.filter((x) => x !== g) : goals.length >= 2 ? [goals[1], g] : [...goals, g] }
export const tierFor = (a: Answers): Tier => TIER_OF_GROUP[a.source]
export const slotFor = (w: When | null): "am" | "pm" | undefined => (w === "evening" ? "pm" : w ? "am" : undefined)
export const goalLabel = (g: Goal) => GOALS.find((x) => x[0] === g)![1]

/** 本周计划预览：只在剩余日子里排，状态为“待确认”，接到已有审核卡。每节一句理由。 */
export function previewWeek(a: Answers, week: string[], today: string): (ScheduleEntry & { why: string })[] {
  const main = a.goals[0] ?? "fitness"
  const runFirst = main === "speed" || main === "race"
  const lift = main === "muscle" || main === "fat"
  const beginner = a.experience === "none" || a.experience === "lt1"
  const out: (ScheduleEntry & { why: string })[] = []
  a.days.slice().sort().forEach((d, i) => {
    const date = week[d]; if (!date || date < today) return
    const isRun = runFirst ? i % 3 !== 2 : lift ? i % 3 === 2 : i % 2 === 0
    const hard = !beginner && isRun && runFirst && i === 1
    const title = isRun ? (hard ? "节奏跑" : a.days.length >= 3 && i === a.days.length - 1 && main === "race" ? "长距离慢跑" : "轻松跑") : a.venue === "gym" ? "全身力量" : a.venue === "home" ? "哑铃全身" : "徒手全身"
    const why = isRun ? (hard ? "每周一次中等强度，提升配速（新手先不加）" : beginner ? "先用轻松跑建立习惯和有氧基础" : "大部分跑量保持轻松，便于恢复") : `${a.venue === "bodyweight" ? "无需器械" : "按你的器械"}，力量帮助${lift ? "目标" : "防伤"}`
    out.push({ id: `ob-${date}-${i}`, date, kind: isRun ? "run" : "strength", modality: isRun ? "run" : "strength", title, focus: [], minutes: a.minutes, intensity: hard ? "MODERATE" : "EASY", lowerHeavy: false, source: "fangkun", refId: null, status: "proposed", slot: slotFor(a.when), why })
  })
  return out
}
export const nextDay = addDays
