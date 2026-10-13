/** 首页卡片自定义（仿 Garmin My Day）：增删、排序；快捷入口 4 格可换，“更多”固定。 */
export const LAYOUT_KEY = "fk-home-layout-v1"
export const HOME_CARDS = [["summary", "目标与连续打卡"], ["recovery", "恢复一句话"], ["override", "今天临时改"], ["quick", "快捷入口"], ["week", "本周训练"], ["detail", "详细记录"]] as const
export type CardId = (typeof HOME_CARDS)[number][0]
export const QUICK_OPTIONS = [["log", "记一笔"], ["import", "导入"], ["timer", "计时"], ["coach", "找方坤"], ["diet", "饮食"], ["weight", "记体重"], ["health", "今日恢复"]] as const
export type QuickId = (typeof QUICK_OPTIONS)[number][0]
export type Layout = { order: CardId[]; hidden: CardId[]; quick: QuickId[] }
export const LAYOUT_DEFAULT: Layout = { order: HOME_CARDS.map((c) => c[0]), hidden: [], quick: ["log", "import", "timer", "coach"] }
const LOCKED: CardId[] = ["week"] // 本周训练是首页主体，不能隐藏
export function normalize(l: Partial<Layout> | null): Layout {
  const ids = HOME_CARDS.map((c) => c[0]) as CardId[]
  const order = [...(l?.order ?? []).filter((x) => ids.includes(x)), ...ids.filter((x) => !(l?.order ?? []).includes(x))]
  const hidden = (l?.hidden ?? []).filter((x) => ids.includes(x) && !LOCKED.includes(x))
  const qids = QUICK_OPTIONS.map((q) => q[0]) as QuickId[]
  const quick = [...new Set((l?.quick ?? LAYOUT_DEFAULT.quick).filter((x) => qids.includes(x)))].slice(0, 4)
  while (quick.length < 4) quick.push(qids.find((x) => !quick.includes(x))!)
  return { order, hidden, quick }
}
export function move(l: Layout, id: CardId, dir: -1 | 1): Layout { const o = [...l.order], i = o.indexOf(id), j = i + dir; if (i < 0 || j < 0 || j >= o.length) return l; [o[i], o[j]] = [o[j], o[i]]; return { ...l, order: o } }
export function toggleCard(l: Layout, id: CardId): Layout { if (LOCKED.includes(id)) return l; return { ...l, hidden: l.hidden.includes(id) ? l.hidden.filter((x) => x !== id) : [...l.hidden, id] } }
export function setQuick(l: Layout, slot: number, id: QuickId): Layout { if (slot < 0 || slot > 3) return l; const q = [...l.quick]; const other = q.indexOf(id); if (other >= 0) q[other] = q[slot]; q[slot] = id; return { ...l, quick: q } }
export const visibleCards = (l: Layout) => l.order.filter((x) => !l.hidden.includes(x))
type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void }
const st = (): KV | null => (typeof localStorage === "undefined" ? null : localStorage)
export function loadLayout(s: KV | null = st()): Layout { try { return normalize(JSON.parse(s?.getItem(LAYOUT_KEY) ?? "null")) } catch { return LAYOUT_DEFAULT } }
export function saveLayout(l: Layout, s: KV | null = st()) { s?.setItem(LAYOUT_KEY, JSON.stringify(l)) }
