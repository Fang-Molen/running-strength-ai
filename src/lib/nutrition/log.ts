import { dispatchEvent } from "@/lib/core/events";

export type Meal = "早餐" | "午餐" | "晚餐" | "加餐";

export type FoodEntry = {
  id: string;
  date: string;
  meal: Meal;
  name: string;
  grams: number;
  kcal: number;
  protein?: number;
  label?: string;
};

export const MEALS: Meal[] = ["早餐", "午餐", "晚餐", "加餐"];

const KEY = "fr255-food-log-v1";

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function loadEntries(): FoodEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]") as FoodEntry[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.kcal === "number").slice(-200) : [];
  } catch {
    return [];
  }
}

export function saveEntries(entries: FoodEntry[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-200)));
    return true
  } catch {
    return false
  }
}

export function todayEntries(entries: FoodEntry[] = loadEntries()): FoodEntry[] {
  const date = today();
  return entries.filter((item) => item.date === date);
}

export function todayEaten(entries?: FoodEntry[]): number {
  return todayEntries(entries).reduce((sum, item) => sum + item.kcal, 0);
}

export function addEntry(entry: Omit<FoodEntry, "id" | "date">): FoodEntry[] | null {
  const row = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, date: today() }
  const next = [...loadEntries(), row]
  if (!saveEntries(next)) return null
  dispatchEvent("NUTRITION_RECORDED", { id: row.id, meal: row.meal, name: row.name, grams: row.grams, kcal: row.kcal, protein: row.protein ?? 0 })
  return next
}

export function removeEntry(id: string): FoodEntry[] | null {
  const next = loadEntries().filter((item) => item.id !== id);
  if (!saveEntries(next)) return null
  return next;
}

/** Persist an entire confirmed meal in one write. No partial batch on storage failure. */
export function addEntriesBatch(items: Array<Omit<FoodEntry, "id" | "date">>): FoodEntry[] | null {
  if (items.length === 0 || items.length > 30 || items.some((item) => !Number.isFinite(item.kcal) || item.kcal < 0 || !Number.isFinite(item.grams) || item.grams < 0)) return null;
  const stamp = Date.now();
  const rows: FoodEntry[] = items.map((item, index) => ({ ...item, id: `${stamp}-${index}-${Math.random().toString(36).slice(2, 9)}`, date: today() }));
  const next = [...loadEntries(), ...rows];
  if (!saveEntries(next)) return null;
  for (const row of rows) dispatchEvent("NUTRITION_RECORDED", { id: row.id, meal: row.meal, name: row.name, grams: row.grams, kcal: row.kcal, protein: row.protein ?? 0 });
  return next;
}
