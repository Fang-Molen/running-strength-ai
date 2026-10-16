// 组间休息 / 换侧间隔 / 动作之间休息. null or undefined = 未设置 (never 0 by default).
export type RestFields = { restSec?: number | null; sideRestSec?: number | null };
export const REST_SUGGEST = 75;
export function fmtRest(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s) || s <= 0) return "未设置";
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  if (!r) return `${m}分钟`;
  return s < 600 ? `${Math.round(s)}秒` : `${m}分${r}秒`;
}
export function toSec(min: string, sec: string): number | null {
  if (!min.trim() && !sec.trim()) return null;
  const v = (Number(min) || 0) * 60 + (Number(sec) || 0);
  return v > 0 ? Math.min(v, 3600) : null;
}
export function splitSec(s: number | null | undefined): [string, string] {
  if (s == null || s <= 0) return ["", ""];
  return [String(Math.floor(s / 60) || ""), String(Math.round(s % 60) || (s >= 60 ? "" : "0"))];
}
export type RestLog = { name: string; planned: number | null; actual: number; at: string };
type ExLike = { name: string } & RestFields;
type EntryLike = { date: string; title: string; exercises?: ExLike[]; restFillSec?: number | null };
/** t422: one-time, idempotent fill of 75s 组间休息 for the 2026-10-17 力量·下肢 session only. */
export function fillRestOnce<T extends EntryLike>(entries: T[], date = "2026-10-17", sec = REST_SUGGEST): { entries: T[]; changed: number } {
  let changed = 0;
  const out = entries.map((e) => {
    if (e.date !== date || !/^力量(课)?\s*·\s*下肢/.test(e.title)) return e;
    if (e.exercises?.length) {
      const ex = e.exercises.map((x) => (x.restSec == null ? (changed++, { ...x, restSec: sec }) : x));
      return { ...e, exercises: ex };
    }
    if (e.restFillSec == null) { changed++; return { ...e, restFillSec: sec }; }
    return e;
  });
  return { entries: out, changed };
}
