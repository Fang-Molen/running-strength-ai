import { clockSeconds, daysUntil, distanceLabel, formatTime, kindFor, type RunGoal } from "./agent";
import { dispatchEvent } from "@/lib/core/events";

export type Mark = {
  meters: number;
  goal: string;
  recent: string;
  deadline: string;
};

export type Profile = {
  sex: "" | "female" | "male";
  age: string;
  heightCm: string;
  weightKg: string;
  bodyFat: string;
  aim: "" | "lose" | "keep" | "gain";
  targetKg: string;
  weeks: number;
  activity: "desk" | "light" | "run" | "hard";
  days: number;
  minutes: number;
  marks: Mark[];
  limit: string;
  note: string;
};

const KEY = "fr255-profile-v1";
/** When the athlete profile was last saved, so pages can tell which value is current. */
export const PROFILE_SAVED_AT_KEY = "fr255-profile-v1-saved-at";
export const PROFILE_CHANGED = "fk-profile-changed";
export function profileSavedAt(): string | null {
  try {
    const v = localStorage.getItem(PROFILE_SAVED_AT_KEY);
    return v && Number.isFinite(Date.parse(v)) ? v : null;
  } catch {
    return null;
  }
}

export const PRESETS = [
  { meters: 400, label: "400" },
  { meters: 800, label: "800" },
  { meters: 1500, label: "1500" },
  { meters: 3000, label: "3公里" },
  { meters: 5000, label: "5公里" },
  { meters: 10000, label: "10公里" },
];

export function emptyProfile(): Profile {
  return {
    sex: "",
    age: "",
    heightCm: "",
    weightKg: "",
    bodyFat: "",
    aim: "",
    targetKg: "",
    weeks: 12,
    activity: "run",
    days: 3,
    minutes: 30,
    marks: [400, 800, 1500].map((meters) => ({ meters, goal: "", recent: "", deadline: "" })),
    limit: "",
    note: "",
  };
}

export function loadProfile(): Profile {
  if (typeof localStorage === "undefined") return emptyProfile();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyProfile();
    const parsed = JSON.parse(raw) as Partial<Profile>;
    const base = emptyProfile();
    return {
      sex: parsed.sex === "female" || parsed.sex === "male" ? parsed.sex : "",
      age: String(parsed.age ?? ""),
      heightCm: String(parsed.heightCm ?? ""),
      weightKg: String(parsed.weightKg ?? ""),
      bodyFat: String(parsed.bodyFat ?? ""),
      aim: parsed.aim === "lose" || parsed.aim === "keep" || parsed.aim === "gain" ? parsed.aim : "",
      targetKg: String(parsed.targetKg ?? ""),
      weeks: clamp(Number(parsed.weeks) || 12, 4, 52),
      activity: parsed.activity === "desk" || parsed.activity === "light" || parsed.activity === "hard" ? parsed.activity : "run",
      days: clamp(Number(parsed.days) || 3, 1, 6),
      minutes: clamp(Number(parsed.minutes) || 30, 15, 60),
      marks: readMarks(parsed.marks, base.marks),
      limit: String(parsed.limit ?? "").slice(0, 80),
      note: String(parsed.note ?? "").slice(0, 120),
    };
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(profile: Profile) {
  const previous = loadProfile();
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
    localStorage.setItem(PROFILE_SAVED_AT_KEY, new Date().toISOString());
  } catch {
    /* private mode */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PROFILE_CHANGED));
  const marksChanged = JSON.stringify(previous.marks) !== JSON.stringify(profile.marks);
  const aimChanged = previous.aim !== profile.aim || previous.targetKg !== profile.targetKg;
  if (marksChanged || aimChanged) {
    dispatchEvent("GOAL_UPDATED", { aim: profile.aim, targetKg: profile.targetKg, marks: profile.marks });
    dispatchEvent("USER_MODIFIED", { field: "profile", aim: profile.aim, targetKg: profile.targetKg });
  }
  const competition = profile.marks.some((mark, index) => mark.deadline !== previous.marks[index]?.deadline && mark.deadline);
  if (competition) dispatchEvent("COMPETITION_UPDATED", { marks: profile.marks.filter((mark) => mark.deadline) });
}

export function goalsFromProfile(profile: Profile): RunGoal[] {
  return profile.marks.flatMap((mark) => {
    const goalSec = clockSeconds(mark.goal);
    if (!goalSec) return [];
    const deadline = daysUntil(mark.deadline) === null ? undefined : mark.deadline;
    return [{ meters: mark.meters, goalSec, kind: kindFor(mark.meters), deadline }];
  });
}

export function profileFilled(profile: Profile): boolean {
  return Boolean(
    profile.sex || profile.age || profile.heightCm || profile.weightKg || profile.aim || profile.limit || profile.note || profile.marks.some((mark) => mark.goal || mark.recent || mark.deadline),
  );
}

export function profileSummary(profile: Profile): string {
  const bits: string[] = [];
  if (profile.aim === "gain") bits.push("增重");
  if (profile.aim === "lose") bits.push("减重");
  if (profile.weightKg) bits.push(`${profile.weightKg} 公斤`);
  for (const mark of profile.marks) {
    if (!mark.goal) continue;
    bits.push(`${distanceLabel(mark.meters)} ${mark.goal}`);
    if (bits.length >= 3) break;
  }
  if (bits.length < 3) bits.push(`一周 ${profile.days} 次 · ${profile.minutes} 分钟`);
  return bits.join(" · ");
}

export function withCoachGoals(profile: Profile, goals: RunGoal[]): Profile {
  return {
    ...profile,
    marks: profile.marks.map((mark) => {
      if (mark.goal.trim()) return mark;
      const goal = goals.find((item) => item.meters === mark.meters);
      return goal ? { ...mark, goal: formatTime(goal.goalSec), deadline: mark.deadline || goal.deadline || "" } : mark;
    }),
  };
}

export function badClocks(profile: Profile): string[] {
  return profile.marks.flatMap((mark) => {
    const fields = [
      [mark.goal, "目标"],
      [mark.recent, "最近"],
    ] as const;
    return fields.flatMap(([value, label]) => (value.trim() && clockSeconds(value) === null ? [`${distanceLabel(mark.meters)}${label}看不懂，写成 62秒、1分33 或 25分`] : []));
  });
}

export function profileError(profile: Profile): string {
  const age = Number(profile.age);
  const fat = Number(profile.bodyFat);
  const target = Number(profile.targetKg);
  if (profile.age && (age < 12 || age > 80)) return "年龄写成 12 到 80。";
  if (profile.bodyFat && (fat < 3 || fat > 60)) return "体脂写成百分比，比如 20。";
  if (profile.targetKg && (target < 35 || target > 200)) return "目标体重写成公斤。";
  if (profile.marks.some((mark) => mark.deadline && daysUntil(mark.deadline) === null)) return "期限用日期，比如 2027-06-01。";
  return badClocks(profile)[0] ?? "";
}

function readMarks(saved: Mark[] | undefined, fallback: Mark[]): Mark[] {
  if (!Array.isArray(saved) || saved.length === 0) return fallback;
  const marks = saved
    .map((item) => ({
      meters: Number(item.meters) || 0,
      goal: String(item.goal ?? ""),
      recent: String(item.recent ?? ""),
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(item.deadline ?? "")) ? String(item.deadline) : "",
    }))
    .filter((item) => item.meters >= 100 && item.meters <= 50000);
  return marks.length ? marks : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
