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
  photo?: string;
  carb?: number | null;
  fat?: number | null;
  fiber?: number | null;
  foodId?: string;
  amount?: number;
  unit?: string;
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
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-5000)));
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

export function addEntry(entry: Omit<FoodEntry, "id" | "date">, date?: string): FoodEntry[] | null {
  const row = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, date: date ?? today() }
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

export type NutrientKey = "kcal" | "protein" | "carb" | "fat" | "fiber";
export const PENDING_LABEL = "营养待补充";
/** 该条目某营养素是否已知（null/未估算 ≠ 0） */
export function nutrientOf(e: FoodEntry, k: NutrientKey): number | null {
  if (k === "kcal") return e.label === "未估算" || e.label === PENDING_LABEL || (e.kcal === 0 && !e.foodId && e.label !== "手填") ? null : e.kcal;
  const v = e[k]; return typeof v === "number" ? v : null;
}
export type Agg = Record<NutrientKey, { sum: number; known: number; pending: number }>;
export function aggregate(entries: FoodEntry[]): Agg {
  const out = {} as Agg;
  for (const k of ["kcal", "protein", "carb", "fat", "fiber"] as NutrientKey[]) {
    let sum = 0, known = 0, pending = 0;
    for (const e of entries) { const v = nutrientOf(e, k); if (v == null) pending++; else { sum += v; known++; } }
    out[k] = { sum: Math.round(sum * 10) / 10, known, pending };
  }
  return out;
}
export function updateEntry(id: string, patch: Partial<FoodEntry>): FoodEntry[] | null {
  const all = loadEntries(); const next = all.map((e) => (e.id === id ? { ...e, ...patch } : e));
  return saveEntries(next) ? next : null;
}
