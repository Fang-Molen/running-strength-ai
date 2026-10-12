export const SPORT_GOAL_KEY = "fr255-sport-goal-v1"

export const SPORTS = [
  { id: "track", label: "田径 / 跑步" },
  { id: "strength", label: "健身 / 力量" },
  { id: "conditioning", label: "综合体能" },
] as const

export const GOALS = [
  { id: "performance", label: "专项成绩" },
  { id: "fat-loss", label: "减脂" },
  { id: "muscle", label: "增肌" },
  { id: "strength", label: "力量" },
  { id: "fitness", label: "基础体能" },
] as const

export type SportId = (typeof SPORTS)[number]["id"]
export type GoalId = (typeof GOALS)[number]["id"]
export type HomeVariant = "track" | "fat-loss" | "muscle" | "conditioning"

export type SportGoalPreference = {
  version: 1
  sport: SportId
  primaryGoal: GoalId
  secondaryGoal: GoalId | null
}

export const DEFAULT_SPORT_GOAL: SportGoalPreference = {
  version: 1,
  sport: "track",
  primaryGoal: "performance",
  secondaryGoal: null,
}

type Readable = { getItem(key: string): string | null }
type Writable = Readable & { setItem(key: string, value: string): void }

const SPORT_IDS = new Set<string>(SPORTS.map((item) => item.id))
const GOAL_IDS = new Set<string>(GOALS.map((item) => item.id))

function isSport(value: unknown): value is SportId {
  return typeof value === "string" && SPORT_IDS.has(value)
}

function isGoal(value: unknown): value is GoalId {
  return typeof value === "string" && GOAL_IDS.has(value)
}

export function normalizeSportGoal(raw: unknown): SportGoalPreference | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Partial<SportGoalPreference>
  if (item.version !== 1 || !isSport(item.sport) || !isGoal(item.primaryGoal)) return null
  const secondary = item.secondaryGoal == null ? null : isGoal(item.secondaryGoal) ? item.secondaryGoal : null
  return {
    version: 1,
    sport: item.sport,
    primaryGoal: item.primaryGoal,
    secondaryGoal: secondary && secondary !== item.primaryGoal ? secondary : null,
  }
}

export function homeVariant(preference: SportGoalPreference): HomeVariant {
  if (preference.primaryGoal === "fat-loss") return "fat-loss"
  if (preference.primaryGoal === "muscle" || preference.primaryGoal === "strength" || preference.sport === "strength") return "muscle"
  if (preference.sport === "conditioning") return "conditioning"
  return "track"
}

export function loadSportGoal(storage: Readable | null = typeof localStorage === "undefined" ? null : localStorage): SportGoalPreference {
  if (!storage) return DEFAULT_SPORT_GOAL
  try {
    const raw = storage.getItem(SPORT_GOAL_KEY)
    if (!raw) return DEFAULT_SPORT_GOAL
    return normalizeSportGoal(JSON.parse(raw)) ?? DEFAULT_SPORT_GOAL
  } catch {
    return DEFAULT_SPORT_GOAL
  }
}

export function saveSportGoal(preference: SportGoalPreference, storage: Writable): boolean {
  const next = normalizeSportGoal(preference)
  if (!next) return false
  try {
    storage.setItem(SPORT_GOAL_KEY, JSON.stringify(next))
    return storage.getItem(SPORT_GOAL_KEY) === JSON.stringify(next)
  } catch {
    return false
  }
}

export function sportLabel(id: SportId): string {
  return SPORTS.find((item) => item.id === id)?.label ?? "田径 / 跑步"
}

export function goalLabel(id: GoalId): string {
  return GOALS.find((item) => item.id === id)?.label ?? "专项成绩"
}
