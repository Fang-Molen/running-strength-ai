import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setRowsForTest, search, similarFoods, portionUnits, sourceLabel, scale, type FoodRow } from './food-db.ts'
import { commitFoodDraft, draftFromProduct, foodPreview } from './entry-workflow.ts'
import { healthModeSummary } from '../health/mode.ts'
import { setStoreBackend } from '../core/storage.ts'
import { setEventContext } from '../core/events.ts'
const rows = JSON.parse(readFileSync(new URL('../../../public/food/cn.json', import.meta.url), 'utf8')) as FoodRow[]
setRowsForTest(rows)
test('round 3 库：4831 行，id 唯一', () => { assert.equal(rows.length, 4831); assert.equal(new Set(rows.map(r => r.i)).size, 4831) })
test('冒烟搜索：每个词首条有来源（非来源不明）', () => {
  for (const q of ['老乡鸡梅菜扣肉', '西红柿炒鸡蛋', '香辣鸡腿堡', '重庆火锅', '星巴克拿铁', '灌汤小笼包', '伯牙绝弦', '生煎', '螺蛳粉', '霸王茶姬青青糯山']) {
    const h = search(q, 8); assert.ok(h.length, q + ' 无结果')
    assert.notEqual(h[0].src, 'L', `${q} 首条是来源不明旧行：${h[0].n}`)
  }
})
test('冲突：旧库无来源行保留但排在品牌行后，标“来源不明”', () => {
  const h = search('伯牙绝弦', 8), brand = h.findIndex(r => r.src === 'B'), old = h.findIndex(r => r.i === 'legacy_original:00461')
  assert.ok(brand >= 0 && old > brand, JSON.stringify(h.map(r => r.n)))
  assert.match(sourceLabel(h[old]), /来源不明/)
  const g = search('多肉葡萄冻', 8); assert.ok(g.findIndex(r => r.src !== 'L') < g.findIndex(r => r.i === 'legacy_original:00775'))
})
test('兜底：没搜到时找输入里包含的 ≥3 字名称，长的优先', () => {
  assert.equal(search('妈妈做的灌汤小笼包子', 8).length, 0)
  const s = similarFoods('妈妈做的灌汤小笼包子'); assert.ok(s.length); assert.match(s[0].n, /灌汤小笼包/)
  assert.equal(similarFoods('包子').length, 0) // 少于 3 字不兜底
})
test('份 单位：每100g + 典型份量的行（薯条/可乐/重庆火锅）按份换算成克', () => {
  for (const q of ['薯条', '可乐', '重庆火锅']) {
    const r = rows.find(x => x.b === 'g' && x.pt?.some(p => p[0] === '份') && (x.n.includes(q) || x.a.some(a => a.includes(q))))
    assert.ok(r, q); const u = portionUnits(r!).find(x => x.label === '份')!; assert.ok(u.grams! > 0)
    const d = { ...draftFromProduct(r!), amount: String(u.grams) }, p = foodPreview(d)
    assert.equal(p.grams, u.grams); assert.equal(p.total.kcal, scale(r!, u.grams!).kcal, q)
  }
  const serv = rows.find(x => x.i === 'fdb2026b:est:灌汤小笼包-1笼8个')!; assert.equal(portionUnits(serv)[0].label, '笼')
})
test('相近食物 / 联网估算 保存时标“估算”，未知项不当 0', () => {
  const values = new Map<string, string>(), backend = { keys: () => [...values.keys()], getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: backend }); setStoreBackend(backend); setEventContext({ athleteId: 'local' })
  const r = rows.find(x => x.i === 'fdb2026b:est:灌汤小笼包-1笼8个')!
  const d = { ...draftFromProduct(r), name: '妈妈做的灌汤小笼包', estimateSource: '相近食物估算：' + r.n }
  const res = commitFoodDraft({ draft: d, date: '2026-10-19', meal: '早餐', acknowledged: true, athleteId: 'local' })
  assert.ok(res.ok, JSON.stringify(res)); if (res.ok) { assert.equal(res.row.nutritionSnapshot!.source.estimated, true); assert.match(res.row.nutritionSnapshot!.source.label, /相近食物估算/); assert.equal(res.row.fiber ?? null, null) }
  setStoreBackend(null); Reflect.deleteProperty(globalThis, 'localStorage')
})
test('健康：没选设备但佳明已连接 → 不显示“尚未选择设备”', () => {
  const snap = { metrics: [] } as never
  assert.equal(healthModeSummary(null, snap).label, '尚未选择设备')
  assert.match(healthModeSummary(null, snap, { connection: 'connected' }).label, /佳明手表（账号已连接）/)
  assert.match(healthModeSummary(null, snap, { connection: 'expired' }).label, /登录已过期/)
  assert.equal(healthModeSummary('basic', snap, { connection: 'connected' }).label, '普通健康手表')
})
