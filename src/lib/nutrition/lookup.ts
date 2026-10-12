import { CATALOG, type CatalogFood } from "./catalog";
import { USDA_FOODS } from "./catalog-usda";

export type FoodHit = {
  name: string;
  label: string;
  kcal: number;
  protein: number;
  grams: number;
};

const originalNames = new Set<string>();
const byName = new Map<string, CatalogFood>();
for (const food of CATALOG) {
  for (const name of food.names) {
    if (name && !byName.has(name)) {
      byName.set(name, food);
      originalNames.add(name);
    }
  }
}
for (const food of USDA_FOODS) {
  for (const name of food.names) {
    if (name && !byName.has(name)) byName.set(name, food);
  }
}

const names = [...byName.keys()].sort((a, b) => b.length - a.length);

function round1(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

function portion(food: CatalogFood, count?: number, unit?: string): { grams: number; label: string } {
  if (!unit) {
    if (food.bowl && food.fallback === food.bowl) return { grams: food.fallback, label: "1碗" };
    if (food.piece && food.fallback === food.piece) return { grams: food.piece, label: "1个" };
    if (food.piece && food.fallback > food.piece * 2) return { grams: food.fallback, label: "1份" };
    return { grams: food.fallback, label: `${round1(food.fallback)}克` };
  }
  const n = count ?? 1;
  const text = round1(n);
  if (unit === "克" || unit.toLowerCase() === "g") return { grams: n, label: `${text}克` };
  if (unit === "毫升" || unit.toLowerCase() === "ml") return { grams: n, label: `${text}毫升` };
  if (unit === "两") return { grams: n * 50, label: `${text}两` };
  if (unit === "斤") return { grams: n * 500, label: `${text}斤` };
  if (unit === "公斤" || unit === "千克") return { grams: n * 1000, label: `${text}${unit}` };
  if (unit === "片") return { grams: (food.slice ?? food.piece ?? 35) * n, label: `${text}片` };
  if (unit === "勺") return { grams: (food.scoop ?? 15) * n, label: `${text}勺` };
  if (unit === "碗" || unit === "份") return { grams: (food.bowl ?? food.fallback) * n, label: `${text}${unit}` };
  if (unit === "盒") return { grams: (food.bowl ?? food.piece ?? food.fallback) * n, label: `${text}盒` };
  if (unit === "杯" || unit === "罐" || unit === "听") return { grams: (food.cup ?? food.piece ?? 250) * n, label: `${text}${unit}` };
  if (unit === "瓶") return { grams: (food.piece ?? food.cup ?? food.fallback) * n, label: `${text}瓶` };
  if (unit === "把") return { grams: food.fallback * n, label: `${text}把` };
  if (unit === "根" || unit === "条") return { grams: (food.root ?? food.piece ?? food.fallback) * n, label: `${text}${unit}` };
  return { grams: (food.piece ?? food.fallback) * n, label: `${text}${unit}` };
}

const QTY = /(\d+(?:\.\d+)?)(克|g|G|毫升|ml|ML|两|斤|公斤|千克|片|勺|碗|份|盒|杯|罐|听|瓶|把|根|条|个)?/;

function findAll(text: string): { name: string; index: number; food: CatalogFood }[] {
  const used = Array<boolean>(text.length).fill(false);
  const found: { name: string; index: number; food: CatalogFood }[] = [];
  for (const name of names) {
    if (name.length < 2 && text.replace(/\d+(?:\.\d+)?(克|g|毫升|ml|两|斤|片|勺|碗|份|盒|杯|罐|听|瓶|把|根|条|个)?/gi, "") !== name) continue;
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(name, from);
      if (index < 0) break;
      const overlap = used.slice(index, index + name.length).some(Boolean);
      if (!overlap) {
        for (let i = index; i < index + name.length; i += 1) used[i] = true;
        const food = byName.get(name);
        if (food) found.push({ name, index, food });
        break;
      }
      from = index + 1;
    }
  }
  found.sort((a, b) => a.index - b.index);
  return found;
}

function hitFrom(food: CatalogFood, name: string, count?: number, unit?: string): FoodHit {
  const sized = portion(food, count, unit);
  return {
    name,
    label: sized.label,
    kcal: Math.round((food.kcal * sized.grams) / 100),
    protein: Math.round((food.protein * sized.grams) / 10) / 10,
    grams: Math.round(sized.grams),
  };
}

export function parseFoodLine(input: string): FoodHit[] {
  const parts = input
    .split(/[\n,，、;；+＋]/)
    .map((part) => part.replace(/\s+/g, ""))
    .filter(Boolean);
  const hits: FoodHit[] = [];
  for (const part of parts) {
    const custom = part.match(/(\d+(?:\.\d+)?)千卡/);
    if (custom) {
      const protein = part.match(/蛋白(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)蛋白/);
      const name = part.replace(custom[0], "").replace(/蛋白\d+(?:\.\d+)?|\d+(?:\.\d+)?蛋白/g, "").replace(/[克个份碗毫升杯勺]+/g, "") || "这项";
      hits.push({
        name,
        label: `${custom[1]}千卡`,
        kcal: Math.round(Number(custom[1])),
        protein: protein ? Math.round(Number(protein[1] ?? protein[2])) : 0,
        grams: 0,
      });
      continue;
    }
    const found = findAll(part);
    if (found.length === 0) continue;
    let index = 0;
    while (index < found.length) {
      let end = index;
      while (end + 1 < found.length) {
        const gap = part.slice(found[end].index + found[end].name.length, found[end + 1].index);
        if (QTY.test(gap) || /[和跟与加配]/.test(gap) || gap.includes("还有") || gap.includes("以及")) break;
        end += 1;
      }
      const last = found[end];
      const name = part.slice(found[index].index, last.index + last.name.length);
      const after = part.slice(last.index + last.name.length, found[end + 1]?.index ?? part.length);
      const qty = after.match(QTY);
      hits.push(hitFrom(last.food, name, qty ? Number(qty[1]) : undefined, qty?.[2]));
      index = end + 1;
    }
  }
  return hits;
}

export function catalogSize(): number {
  return byName.size;
}

export function searchFoods(input: string): FoodHit[] {
  const parsed = parseFoodLine(input);
  if (parsed.length > 0) return parsed.slice(0, 8);
  const query = input.trim().toLowerCase();
  if (query.length < 2) return [];
  const ranked: { name: string; food: CatalogFood; rank: number }[] = [];
  for (const [name, food] of byName) {
    const text = name.toLowerCase();
    if (text === query) ranked.push({ name, food, rank: 0 });
    else if (originalNames.has(name) && text.startsWith(query)) ranked.push({ name, food, rank: 1 });
    else if (text.startsWith(query)) ranked.push({ name, food, rank: 2 });
    else if (originalNames.has(name) && text.includes(query)) ranked.push({ name, food, rank: 3 });
    else if (text.includes(query)) ranked.push({ name, food, rank: 4 });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length);
  return ranked.slice(0, 8).map((item) => hitFrom(item.food, item.name));
}
