import type { Profile } from "../strength/profile"
import type { SportGoalPreference } from "./sport-goal"

export type OnboardingStep = { id: "event" | "performance" | "safety"; label: string; complete: boolean; hint: string }

/** Read-only checklist; never interprets absent medical information as safe. */
export function onboardingSteps(profile: Profile, preference: SportGoalPreference): OnboardingStep[] {
  const eventChosen = profile.marks.some(mark => Boolean(mark.goal.trim() || mark.recent.trim() || mark.deadline.trim()))
  const hasResult = profile.marks.some(mark => Boolean(mark.goal.trim() || mark.recent.trim()))
  return [
    { id: "event", label: "确认专项与比赛目标", complete: eventChosen, hint: `当前首页项目：${preference.sport}。请在个人情况里填写至少一项比赛信息。` },
    { id: "performance", label: "补充最近成绩或目标成绩", complete: hasResult, hint: "没有成绩也能记录训练；系统不会假设你的能力水平。" },
    { id: "safety", label: "核对身体限制与不适", complete: false, hint: "未填写限制不代表没有疼痛。请在个人情况里核对；目前没有独立的安全确认记录。" },
  ]
}
