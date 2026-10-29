import { dispatchEvent, loadEvents, currentAthleteId } from "@/lib/core/events";
import { validDate } from '../ui/fieldwork-plan-drafts';
import type { NutritionSnapshot } from './entry-workflow';

export type Meal = "早餐" | "午餐" | "晚餐" | "加餐";

export type FoodEntry = {
  id: string;
  date: string;
  meal: Meal;
  name: string;
  grams?: number;
  kcal: number | null;
  protein?: number;
  carb?: number | null; fiber?: number | null; foodId?: string; amount?: number; unit?: string; photo?: string;
  nutritionSource?: {kind:string;model?:string;at?:string;evidence:string;uncertainty:string;reviewed:boolean};
  carbs?: number;
  fat?: number | null;
  athleteId?: string;
  source?: "MANUAL";
  recordedAt?: string;
  label?: string;
  /** User-entered actual eating time; absent means unknown. */
  eatenAt?: string;
  revisionId?: string;
  /** Stable capture identity, committed with the nutrition event itself. */
  requestId?: string;
  requestFingerprint?: string;
  nutritionSnapshot?: NutritionSnapshot;
  foodSnapshot?: {foodId:string;brand:string;region:string;variant:string;amount:number;unit:"g"|"份";nutrients:Record<"kcal"|"protein"|"carbs"|"fat",number|null>&{fiber?:number|null};source:{kind:string;status:string;uri:string|null;notes:string;checkedOn:string|null};note:string};
};

export function eatenAtFromClock(clock:string,day=new Date()):string|undefined{
 const m=clock.trim().match(/^(\d{1,2}):(\d{2})$/);if(!m||!Number.isFinite(day.getTime()))return undefined
 const h=Number(m[1]),minute=Number(m[2]);if(h>23||minute>59)return undefined
 const d=new Date(day);d.setHours(h,minute,0,0);return d.toISOString()
}

export const MEALS: Meal[] = ["早餐", "午餐", "晚餐", "加餐"];

const KEY = "fr255-food-log-v1";

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function loadEntries(): FoodEntry[] {
  let legacy: FoodEntry[] = [];
  try {
    const parsed = JSON.parse(typeof localStorage === "undefined" ? "[]" : localStorage.getItem(KEY) || "[]") as FoodEntry[];
    legacy = Array.isArray(parsed) ? parsed.filter((item) => item && validFoodEntry(item) && (item.athleteId ? item.athleteId === currentAthleteId() : currentAthleteId() === "local")) : [];
  } catch { /* Preserve unreadable legacy storage. */ }
  const entries = new Map(legacy.map(row => [row.id, row]));
  for (const event of loadEvents()) {
    if (event.event_type !== "NUTRITION_RECORDED" || event.athlete_id !== currentAthleteId()) continue;
    const row = event.payload.foodEntry as FoodEntry | undefined;
    if (row && validFoodEntry(row) && row.athleteId === event.athlete_id) entries.set(row.id, row);
    for (const item of (Array.isArray(event.payload.foodEntries) ? event.payload.foodEntries : []) as FoodEntry[]) {
      if (validFoodEntry(item) && item.athleteId === event.athlete_id) entries.set(item.id, item);
    }
    for (const id of (Array.isArray(event.payload.removedFoodIds) ? event.payload.removedFoodIds : [])) if (typeof id === 'string') entries.delete(id);
    if (typeof event.payload.removedFoodId === "string") entries.delete(event.payload.removedFoodId);
  }
  return [...entries.values()];
}

export function foodChanged() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('fk-food-changed')); }
export function saveEntries(entries: FoodEntry[]): boolean {
  try {
    // Do not destroy a corrupt legacy store, foreign athletes or immutable corrections.
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (raw) { const old = JSON.parse(raw); if (!Array.isArray(old) || old.some(r => !validFoodEntry(r))) return false; }
    if (entries.some(r => !validFoodEntry(r) || (r.athleteId && r.athleteId !== currentAthleteId()))) return false;
    const rows = entries.map(r => ({...r, athleteId:currentAthleteId()}));
    const removedFoodIds = loadEntries().filter(r => !rows.some(n => n.id === r.id)).map(r => r.id);
    if (!dispatchEvent('NUTRITION_RECORDED', {foodEntries:rows, removedFoodIds})) return false;
    foodChanged(); return true;
  } catch { return false; }
}

export function todayEntries(entries: FoodEntry[] = loadEntries()): FoodEntry[] {
  const date = today();
  return entries.filter((item) => item.date === date);
}

export function todayEaten(entries?: FoodEntry[]): number {
  return todayEntries(entries).reduce((sum, item) => sum + (item.kcal ?? 0), 0);
}

export function addEntry(entry: Omit<FoodEntry, "id" | "date">, date?: string): FoodEntry[] | null {
  if(entry.eatenAt!==undefined&&!Number.isFinite(Date.parse(entry.eatenAt)))return null
  const row = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, date: date ?? today(), athleteId:currentAthleteId(), recordedAt:new Date().toISOString() }
  const next = [...loadEntries(), row]
  if (!saveEntries(next)) return null
  return next
}

export function removeEntry(id: string): FoodEntry[] | null {
  if (!loadEntries().some(row => row.id === id)) return null;
  if (!dispatchEvent("NUTRITION_RECORDED", { removedFoodId: id })) return null;
  foodChanged(); return loadEntries();
}

/** Persist an entire confirmed meal in one write. No partial batch on storage failure. */
export function addEntriesBatch(items: Array<Omit<FoodEntry, "id" | "date">>, date?: string): FoodEntry[] | null {
  if (items.length === 0 || items.length > 30 || items.some((item) => item.kcal !== null && (!Number.isFinite(item.kcal) || item.kcal < 0) || item.grams!==undefined&&(!Number.isFinite(item.grams)||item.grams<0) || item.eatenAt!==undefined&&!Number.isFinite(Date.parse(item.eatenAt)))) return null;
  const stamp = Date.now();
  const rows: FoodEntry[] = items.map((item, index) => ({ ...item, id: `${stamp}-${index}-${Math.random().toString(36).slice(2, 9)}`, date: date ?? today(), athleteId:currentAthleteId(), recordedAt:new Date().toISOString() }));
  const next = [...loadEntries(), ...rows];
  if (!saveEntries(next)) return null;
  return next;
}

export function validFoodEntry(row: FoodEntry): boolean {
  return !!row && typeof row.id === "string" && typeof row.name === "string" && row.name.trim().length > 0 && validDate(row.date) && MEALS.includes(row.meal) && (row.kcal === null || Number.isFinite(row.kcal) && row.kcal >= 0) &&
    [row.protein, row.carbs, row.carb, row.fat, row.fiber, row.grams].every(v => v == null || Number.isFinite(v) && v >= 0) &&
    (row.eatenAt === undefined || Number.isFinite(Date.parse(row.eatenAt)));
}

/** One existing immutable event commits the meal and its provenance together. */
export function recordManualFood(input: Omit<FoodEntry, "id" | "athleteId" | "source">): FoodEntry | null {
  if (input.requestId) {
    const prior = findFoodRequest(input.requestId);
    if (prior) {
      const current = loadEntries().find(row => row.id === prior.row.id);
      return input.requestFingerprint && prior.row.requestFingerprint === input.requestFingerprint && current && JSON.stringify(current) === JSON.stringify(prior.row) ? current : null;
    }
  }
  const row: FoodEntry = { ...input, id: `food-${crypto.randomUUID()}`, athleteId: currentAthleteId(), source: "MANUAL", recordedAt: new Date().toISOString() };
  if (!validFoodEntry(row)) return null;
  if (!dispatchEvent("NUTRITION_RECORDED", { foodEntry: row })) return null;
  foodChanged(); return loadEntries().find(saved => saved.id === row.id) ?? null;
}

/** Original receipt is read from immutable history, including after deletion. */
export function findFoodRequest(requestId: string) {
  for (const event of loadEvents()) {
    if (event.event_type !== 'NUTRITION_RECORDED' || event.athlete_id !== currentAthleteId()) continue;
    const row = event.payload.foodEntry as FoodEntry | undefined;
    if (row?.requestId === requestId && row.athleteId === event.athlete_id && validFoodEntry(row)) return {event, row};
  }
  return null;
}

export type NutrientKey = "kcal" | "protein" | "carb" | "fat" | "fiber";
export const PENDING_LABEL = "营养待补充";
/** 该条目某营养素是否已知（null/未估算 ≠ 0） */
export function nutrientOf(e: FoodEntry, k: NutrientKey): number | null {
  if (k === "kcal") return e.label === "未估算" || e.label === PENDING_LABEL || (e.kcal === 0 && !e.foodId && e.label !== "手填" && !e.nutritionSource?.reviewed && e.source !== "MANUAL") ? null : e.kcal;
  const v = k === "carb" ? (Object.prototype.hasOwnProperty.call(e,"carb") ? e.carb : e.carbs) : e[k]; return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
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
export function updateEntry(id: string, patch: Partial<FoodEntry>, expectedRevision?: string): FoodEntry[] | null {
  const old = loadEntries().find(e => e.id === id);
  if (!old || expectedRevision !== undefined && expectedRevision !== (old.revisionId || JSON.stringify(old))) return null;
  const row = { ...old, ...patch, id: old.id, athleteId: currentAthleteId(), revisionId: crypto.randomUUID(), recordedAt: new Date().toISOString() };
  if (!validFoodEntry(row) || !dispatchEvent('NUTRITION_RECORDED', { foodEntry: row, previousRevision: old.revisionId || JSON.stringify(old) })) return null;
  foodChanged(); return loadEntries();
}
