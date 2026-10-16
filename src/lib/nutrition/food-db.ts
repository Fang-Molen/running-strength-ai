/** 方坤食物库（fangkun-food-library-20261017）：public/food/cn.json 先加载，usda.json 按需加载。null = 未知，不当 0。 */
export type N5 = [number | null, number | null, number | null, number | null, number | null]; // kcal, protein, carb, fat, fiber
export type FoodRow = { i: string; n: string; a: string[]; g: 0 | 1 | 2; b: "g" | "serv"; p: N5 | null; s: { g: number | null; u: string; v: N5 | null }; pt: [string, number][]; src: string; st: string; br?: string; rg?: string; uri?: string };
export type Macros = { kcal: number | null; protein: number | null; carb: number | null; fat: number | null; fiber: number | null };

let cn: FoodRow[] | null = null, us: FoodRow[] | null = null;
let cnP: Promise<FoodRow[]> | null = null, usP: Promise<FoodRow[]> | null = null;
const get = (u: string) => fetch(u).then((r) => r.json() as Promise<FoodRow[]>);
export function loadCn(): Promise<FoodRow[]> { return (cnP ??= get("/food/cn.json").then((x) => (cn = x))); }
export function loadUsda(): Promise<FoodRow[]> { return (usP ??= get("/food/usda.json").then((x) => (us = x))); }
export function setRowsForTest(a: FoodRow[], b: FoodRow[] = []) { cn = a; us = b; }

/** 待核：旧库未记来源、品牌待标签、演示估算 */
export function needsCheck(r: FoodRow): boolean { return r.src === "L" || r.st === "PENDING_LABEL" || r.src === "D" || r.st === "UNVERIFIED"; }
export function sourceLabel(r: FoodRow): string { return r.src === "U" ? "USDA SR26" : r.src === "B" ? (r.st === "HISTORICAL_RECHECK" ? "品牌官网（旧）" : "品牌官网") : r.src === "P" ? "品牌·待标签" : r.src === "D" ? "估算·待核" : "内置库·待核"; }

export function search(q: string, limit = 8): FoodRow[] {
  const s = q.trim().toLowerCase(); if (!s) return [];
  const rank = (r: FoodRow) => { const names = [r.n, ...r.a].map((x) => x.toLowerCase()); let k = 9; for (const x of names) { const m = x === s ? 0 : x.startsWith(s) ? 1 : x.includes(s) ? 2 : s.includes(x) && x.length >= 2 ? 3 : 9; if (m < k) k = m; } return k; };
  const hits: [number, FoodRow][] = [];
  for (const r of [...(cn ?? []), ...(us ?? [])]) { const k = rank(r); if (k < 9) hits.push([k * 10 + r.g, r]); }
  hits.sort((a, b) => a[0] - b[0] || a[1].n.length - b[1].n.length);
  return hits.slice(0, limit).map((x) => x[1]);
}
const mul = (v: N5 | null, k: number): Macros => ({ kcal: v?.[0] == null ? null : Math.round(v[0] * k), protein: v?.[1] == null ? null : Math.round(v[1] * k * 10) / 10, carb: v?.[2] == null ? null : Math.round(v[2] * k * 10) / 10, fat: v?.[3] == null ? null : Math.round(v[3] * k * 10) / 10, fiber: v?.[4] == null ? null : Math.round(v[4] * k * 10) / 10 });
/** 每100g食物按克；按份食物只按份数，不做克换算 */
export function scale(r: FoodRow, amount: number): Macros { return r.b === "g" ? mul(r.p, amount / 100) : mul(r.s.v, amount); }
export function defaultAmount(r: FoodRow): number { return r.b === "g" ? Math.round(r.s.g || 100) : 1; }
