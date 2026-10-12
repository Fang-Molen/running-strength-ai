import { dispatchEvent } from "@/lib/core/events";

export type BodyCheck = {
  id: string;
  date: string;
  weight: number;
  fat?: number;
  fatMass?: number;
  bmi?: number;
  water?: number;
  waterRate?: number;
  muscle?: number;
  muscleRate?: number;
  boneRate?: number;
  bmr?: number;
  waist?: number;
};

const KEY = "fr255-body-v1";

export const BODY_FIELDS = [
  { key: "weight", label: "体重", suffix: "公斤", min: 30, max: 150 },
  { key: "fat", label: "脂肪率", suffix: "%", min: 2, max: 60 },
  { key: "fatMass", label: "脂肪量", suffix: "公斤", min: 0.5, max: 80 },
  { key: "bmi", label: "BMI", suffix: "", min: 12, max: 50 },
  { key: "water", label: "含水量", suffix: "公斤", min: 10, max: 90 },
  { key: "waterRate", label: "水分", suffix: "%", min: 20, max: 85 },
  { key: "muscle", label: "肌肉量", suffix: "公斤", min: 8, max: 80 },
  { key: "muscleRate", label: "肌肉率", suffix: "%", min: 15, max: 80 },
  { key: "boneRate", label: "骨率", suffix: "%", min: 1, max: 15 },
  { key: "bmr", label: "基础代谢", suffix: "千卡", min: 800, max: 4000 },
  { key: "waist", label: "腰围", suffix: "厘米", min: 40, max: 150 },
] as const;

export type BodyKey = (typeof BODY_FIELDS)[number]["key"];

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function todayDate(): string {
  return today();
}

export function loadChecks(): BodyCheck[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]") as BodyCheck[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.weight === "number" && /^\d{4}-\d{2}-\d{2}$/.test(item.date)).slice(-180) : [];
  } catch {
    return [];
  }
}

export function saveChecks(checks: BodyCheck[]): BodyCheck[] | null {
  const sorted = [...checks].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-180);
  try {
    localStorage.setItem(KEY, JSON.stringify(sorted));
  } catch {
    return null
  }
  return sorted;
}

export function upsertCheck(check: Omit<BodyCheck, "id">): BodyCheck[] | null {
  const checks = loadChecks().filter((item) => item.date !== check.date);
  const saved = saveChecks([...checks, { ...check, id: check.date }]);
  if (!saved) return null
  dispatchEvent("BODY_MEASUREMENT_RECORDED", { date: check.date, weight: check.weight, fat: check.fat ?? null, muscle: check.muscle ?? null });
  return saved;
}

export function removeCheck(id: string): BodyCheck[] | null {
  return saveChecks(loadChecks().filter((item) => item.id !== id));
}

function daysAgo(date: string): number {
  const then = new Date(`${date}T12:00:00`);
  const now = new Date(`${today()}T12:00:00`);
  return Math.round((now.getTime() - then.getTime()) / 86400000);
}

function average(items: BodyCheck[]): number | null {
  if (items.length === 0) return null;
  return items.reduce((sum, item) => sum + item.weight, 0) / items.length;
}

export function bodyTrend(checks = loadChecks()) {
  const sorted = [...checks].sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = sorted.at(-1) ?? null;
  const previous = sorted.at(-2) ?? null;
  const last7 = sorted.filter((item) => daysAgo(item.date) <= 6);
  const prior7 = sorted.filter((item) => {
    const age = daysAgo(item.date);
    return age >= 7 && age <= 13;
  });
  const avg7 = average(last7);
  const avgPrior = average(prior7);
  return {
    latest,
    previous,
    delta: latest && previous ? latest.weight - previous.weight : null,
    avg7,
    weekDelta: avg7 != null && avgPrior != null ? avg7 - avgPrior : null,
    count: sorted.length,
  };
}

export function bodyLine(): string {
  const trend = bodyTrend();
  if (!trend.latest) return "";
  const bits = [`最近体重 ${trend.latest.weight} 公斤`];
  if (trend.latest.fat != null) bits.push(`脂肪率 ${trend.latest.fat}%`);
  if (trend.delta != null) bits.push(`比上次 ${trend.delta >= 0 ? "+" : ""}${trend.delta.toFixed(1)}`);
  return bits.join("，");
}
