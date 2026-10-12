/** Local engagement preview only. Never use these values to authorize online AI. */
import type { Plan } from "../strength/model";

export const GROWTH_LEVELS = [
  { level: 1, name: "初识跑道", xp: 0 },
  { level: 2, name: "训练新星", xp: 100 },
  { level: 3, name: "稳定训练者", xp: 300 },
  { level: 4, name: "自律训练者", xp: 700 },
  { level: 5, name: "进阶运动员", xp: 1000 },
  { level: 6, name: "周期实践者", xp: 1600 },
  { level: 7, name: "长期同行者", xp: 2500 },
] as const;

/** Existing cycle logs are a snapshot, not lifetime history. Deduplicate by session ID. */
export function currentWeekGrowth(plan: Pick<Plan, "cycle">) {
  const logs = plan.cycle?.logs ?? [];
  const unique = new Map(logs.filter(log => log.sessionId).map(log => [log.sessionId, log]));
  const feedbackCount = [...unique.values()].filter(log => log.feel !== "skip").length;
  const recoveryCount = [...unique.values()].filter(log => log.feel === "skip").length;
  const xp = feedbackCount * 15 + recoveryCount * 5;
  const current = [...GROWTH_LEVELS].reverse().find(item => xp >= item.xp) ?? GROWTH_LEVELS[0];
  const next = GROWTH_LEVELS.find(item => item.xp > xp) ?? null;
  return { xp, current, next, feedbackCount, recoveryCount, levelFiveEligible: false as const };
}
