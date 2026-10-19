/** 方坤食物库（fangkun-food-library-20261017）：public/food/cn.json 先加载，usda.json 按需加载。null = 未知，不当 0。 */
export type N5 = [number | null, number | null, number | null, number | null, number | null]; // kcal, protein, carb, fat, fiber
export type FoodRow = { i: string; n: string; a: string[]; g: 0 | 1 | 2; b: "g" | "serv"; p: N5 | null; s: { g: number | null; u: string; v: N5 | null }; pt: [string, number][]; src: string; st: string; br?: string; rg?: string; uri?: string; c?: string; lbl?: string; note?: string; ref?: string; chk?: string; cmp?: [string, number, string][] };
export type Macros = { kcal: number | null; protein: number | null; carb: number | null; fat: number | null; fiber: number | null };

let cn: FoodRow[] | null = null, us: FoodRow[] | null = null;
let cnP: Promise<FoodRow[]> | null = null, usP: Promise<FoodRow[]> | null = null;
const get = (u: string) => fetch(u).then(async (r) => { if (!r.ok) throw Error("食物库暂不可用"); const rows = await r.json(); if (!Array.isArray(rows)) throw Error("食物库数据不完整"); return rows as FoodRow[]; });
export function loadCn(): Promise<FoodRow[]> { return (cnP ??= get("/food/cn.json").then((x) => (cn = x)).catch(e => { cnP = null; throw e; })); }
export function loadUsda(): Promise<FoodRow[]> { return (usP ??= get("/food/usda.json").then((x) => (us = x)).catch(e => { usP = null; throw e; })); }
export function setRowsForTest(a: FoodRow[], b: FoodRow[] = []) { cn = a; us = b; }

/** 待核：旧库未记来源、品牌待标签、演示估算 */
export function needsCheck(r: FoodRow): boolean { return r.src === "L" || r.src === "O" || r.st === "PENDING_LABEL" || r.src === "D" || r.st === "UNVERIFIED" || r.st === "HISTORICAL_RECHECK"; }
export function sourceLabel(r: FoodRow): string { if (r.lbl) return r.lbl; return r.src === "C" ? "中国食物成分表 第6版" : r.src === "O" ? "Open Food Facts·标签待核" : r.src === "U" ? "USDA SR26" : r.src === "B" ? (r.st === "HISTORICAL_RECHECK" ? "品牌官网（旧）" : "品牌官网") : r.src === "P" ? "品牌·待标签" : r.src === "D" ? "估算·待核" : "来源不明（旧库）"; }

export function search(q: string, limit = 8): FoodRow[] {
  const s = q.trim().toLowerCase(); if (!s) return [];
  const rank = (r: FoodRow) => {
    const names=[r.n,...r.a,r.br||'',r.br?r.br+' '+r.n:''].map(x=>x.toLocaleLowerCase().normalize('NFKC'));
    const normalized=s.normalize('NFKC'), tokens=normalized.split(/\s+/).filter(Boolean), text=names.join(' ');
    if(names.some(x=>x===normalized))return 0;
    if(names.some(x=>x.startsWith(normalized)))return 1;
    if(names.some(x=>x.includes(normalized))||tokens.length>1&&tokens.every(t=>text.includes(t)))return 2;
    return 9;
  };
  // 有来源的行（官网/成分表 > USDA/OFF > 估算）排在来源不明的旧库行和待补充行前面；同一组内再按匹配等级。
  // 例：霸王茶姬 旧库 60kcal/100g（来源不明）vs 伯牙绝弦 品牌公布 130kcal/杯 → 品牌行在前，旧行保留并标“来源不明”。
  const SRC: Record<string, number> = { B: 0, C: 0, U: 1, O: 1, D: 2, L: 3, P: 4 };
  const hits: [number, FoodRow][] = [];
  for (const r of [...(cn ?? []), ...(us ?? [])]) { const k = rank(r); if (k < 9) { const src = SRC[r.src] ?? 3; hits.push([(src >= 3 ? 1000 : 0) + k * 100 + src * 10 + r.g, r]); } }
  hits.sort((a, b) => a[0] - b[0] || a[1].n.length - b[1].n.length);
  return hits.slice(0, limit).map((x) => x[1]);
}
/** 没搜到时的兜底：库里 ≥3 个字的名称/别名，若整个出现在输入里，按长度从长到短给出（“妈妈做的灌汤小笼包” → 灌汤小笼包）。结果只当“相近食物”。 */
export function similarFoods(q: string, limit = 5): FoodRow[] {
  const s = q.trim().toLocaleLowerCase().normalize('NFKC'); if (s.length < 3) return [];
  const SRC: Record<string, number> = { B: 0, C: 0, U: 1, O: 1, D: 2, L: 3, P: 4 };
  const out: [number, number, FoodRow][] = [], seen = new Set<string>();
  for (const r of [...(cn ?? []), ...(us ?? [])]) {
    if (r.src === 'P' || seen.has(r.i)) continue
    let best = 0; for (const x of [r.n, ...r.a]) { const t = x.toLocaleLowerCase().normalize('NFKC').replace(/（.*?）|\(.*?\)/g, '').trim(); if (t.length >= 3 && t.length > best && s.includes(t)) best = t.length }
    if (best) { seen.add(r.i); out.push([best, SRC[r.src] ?? 3, r]) }
  }
  out.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2].n.length - b[2].n.length);
  return out.slice(0, limit).map(x => x[2]);
}
/** 份量单位：每100g的行用 pt 里的常用单位（份/个/碗/杯…≈克数）；按份的行用它自己的份名（笼/杯/份）。 */
export function portionUnits(r: FoodRow): { label: string; grams: number | null }[] {
  if (r.b === 'serv') { const u = (r.s.u.match(/^\d*\s*([^\d（(\s])/)?.[1]) || '份'; return [{ label: u, grams: r.s.g }] }
  const seen = new Set<string>(), out: { label: string; grams: number | null }[] = []
  for (const [label, g] of r.pt ?? []) if (label && g > 0 && !seen.has(label)) { seen.add(label); out.push({ label, grams: g }) }
  return out
}
const mul = (v: N5 | null, k: number): Macros => ({ kcal: v?.[0] == null ? null : Math.round(v[0] * k), protein: v?.[1] == null ? null : Math.round(v[1] * k * 10) / 10, carb: v?.[2] == null ? null : Math.round(v[2] * k * 10) / 10, fat: v?.[3] == null ? null : Math.round(v[3] * k * 10) / 10, fiber: v?.[4] == null ? null : Math.round(v[4] * k * 10) / 10 });
/** 每100g食物按克；按份食物只按份数，不做克换算 */
export function scale(r: FoodRow, amount: number): Macros { if(!Number.isFinite(amount)||amount<=0)throw Error("份量必须大于0"); return r.b === "g" ? mul(r.p, amount / 100) : mul(r.s.v, amount); }
export function defaultAmount(r: FoodRow): number { return r.b === "g" ? Math.round(r.s.g || 100) : 1; }
