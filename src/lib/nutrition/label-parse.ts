/** 营养成分表 / 小票 OCR 文字 → 待核对的营养字段。只取文字里明确出现的数值；读不到的留空，不估算。 */
export type LabelKey = 'kcal' | 'protein' | 'carb' | 'fat' | 'fiber'
export type LabelResult = { name: string; brand: string; basis: '100g' | 'serv' | 'this'; servingGrams: number | null; values: Partial<Record<LabelKey, number>> }
const num = '(\\d+(?:[.,]\\d+)?)'
const norm = (t: string) => t.normalize('NFKC').replace(/(?<=[\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, '').replace(/[：]/g, ':').replace(/(\d)\s*[oO](?=\d|\b)/g, '$10').replace(/(\d),(\d)/g, '$1.$2')
const n = (s: string) => Number(s.replace(',', '.'))
const KEYS: [LabelKey, RegExp][] = [
  ['protein', new RegExp(`(?:蛋白质|蛋白|protein)[^\\d\\n]{0,8}${num}\\s*(?:g|克)?`, 'i')],
  ['fat', new RegExp(`(?<!饱和|反式|饱和脂肪酸|trans |saturated )(?:脂肪|fat)(?!酸)[^\\d\\n]{0,8}${num}\\s*(?:g|克)?`, 'i')],
  ['carb', new RegExp(`(?:碳水化合物|碳水|carbohydrates?|carbs?)[^\\d\\n]{0,8}${num}\\s*(?:g|克)?`, 'i')],
  ['fiber', new RegExp(`(?:膳食纤维|纤维|dietary fib(?:er|re)|fib(?:er|re))[^\\d\\n]{0,8}${num}\\s*(?:g|克)?`, 'i')],
]
export function parseNutritionLabel(raw: string): LabelResult {
  const t = norm(raw || '')
  const values: LabelResult['values'] = {}
  const e = new RegExp(`(?:能量|热量|energy|calories)[^\\d\\n]{0,8}${num}\\s*(kj|千焦|kcal|千卡|大卡|卡)?(?:[^\\d\\n]{0,10}${num}\\s*(kcal|千卡|大卡))?`, 'i').exec(t)
  if (e) {
    if (e[3] && e[4]) values.kcal = Math.round(n(e[3]))
    else if (/kj|千焦/i.test(e[2] ?? '')) values.kcal = Math.round(n(e[1]) / 4.184)
    else values.kcal = Math.round(n(e[1]))
  }
  for (const [k, re] of KEYS) { const m = re.exec(t); if (m) { const v = n(m[1]); if (Number.isFinite(v) && v >= 0 && v < 1000) values[k] = Math.round(v * 10) / 10 } }
  const per100 = /每\s*100(?!\d)|per\s*100\s*(?:g|ml)|\/\s*100\s*(?:g|ml)/i.test(t)
  const serv = new RegExp(`(?:每份|每\\s*1\\s*份|per serving|serving size)[^\\d\\n]{0,6}(?:${num}\\s*(?:g|克))?`, 'i').exec(t)
  const basis: LabelResult['basis'] = per100 ? '100g' : serv ? 'serv' : 'this'
  return { name: '', brand: '', basis, servingGrams: serv?.[1] ? n(serv[1]) : null, values }
}
/** 合并：在线整理结果优先，但只接受有限非负数值；本机解析补空。 */
export function mergeLabel(local: LabelResult, remote: unknown): LabelResult {
  if (!remote || typeof remote !== 'object') return local
  const r = remote as Record<string, unknown>, out: LabelResult = { ...local, values: { ...local.values } }
  for (const k of ['kcal', 'protein', 'carb', 'fat', 'fiber'] as LabelKey[]) { const v = r[k]; if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 10000) out.values[k] = k === 'kcal' ? Math.round(v) : Math.round(v * 10) / 10 }
  if (typeof r.name === 'string' && r.name.trim()) out.name = r.name.trim().slice(0, 80)
  if (typeof r.brand === 'string' && r.brand.trim()) out.brand = r.brand.trim().slice(0, 80)
  if (r.basis === '100g' || r.basis === 'serv' || r.basis === 'this') out.basis = r.basis
  if (typeof r.servingGrams === 'number' && r.servingGrams > 0 && r.servingGrams < 5000) out.servingGrams = r.servingGrams
  return out
}
