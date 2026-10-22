import test from 'node:test'
import assert from 'node:assert/strict'
import { onlineNutritionFacts } from './online-nutrition-facts'
import { currentAthleteId, setEventContext, EVENTS_KEY, EVENT_JOURNAL_PREFIX } from '../core/events'
import { setStoreBackend } from '../core/storage'
import { commitFoodDraft, draftFromProduct, type FoodSaveInput } from '../nutrition/entry-workflow'
import { loadEntries, updateEntry, removeEntry, type FoodEntry } from '../nutrition/log'
import { upsertCheck, removeCheck } from '../nutrition/body'
import type { FoodRow } from '../nutrition/food-db'
import { commitMeal, type Food } from '../nutrition/ui-records'

const day = '2026-10-22', asOf = day + 'T12:00:00.000Z'
const cereal: FoodRow = { i: 'PRIVATE_FOOD_ID', n: '合成谷物餐', a: [], br: '合成品牌', rg: 'PRIVATE_LOCATION', g: 0, b: 'g', p: [200, 10, 40, 2, 3], s: { g: 100, u: '100g', v: null }, pt: [], src: 'U', st: 'REFERENCE', uri: 'https://example.invalid/PRIVATE_SOURCE' }
function fixture(t: test.TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(asOf) })
  const previous = currentAthleteId(), oldLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), originalFetch = globalThis.fetch
  const map = new Map<string, string>(), store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) }, keys: () => [...map.keys()] }
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true })
  globalThis.fetch = (() => { throw Error('Nutrition fact tests must not make network calls') }) as typeof fetch
  setStoreBackend(store); setEventContext({ athleteId: 'PRIVATE_SYNTHETIC_ATHLETE' })
  t.after(() => {
    setStoreBackend(null); setEventContext({ athleteId: previous }); globalThis.fetch = originalFetch
    for (const [key, old] of [['localStorage', oldLocal], ['window', oldWindow]] as const) { if (old) Object.defineProperty(globalThis, key, old); else Reflect.deleteProperty(globalThis, key) }
  })
  return { map, store }
}
function saveMeal(date = day, name = cereal.n, meal: FoodSaveInput['meal'] = '早餐') {
  const saved = commitFoodDraft({ draft: { ...draftFromProduct({ ...cereal, n: name }), amount: '100' }, date, meal, acknowledged: true, athleteId: currentAthleteId() })
  if (!saved.ok) throw Error(saved.reason)
  return saved.row
}
const legacy = (patch: Partial<FoodEntry> = {}): FoodEntry => ({ id: 'PRIVATE_LEGACY_ID', date: day, meal: '午餐', name: '合成旧餐', kcal: 300, protein: 12, carbs: 45, fat: 6, source: 'MANUAL', athleteId: currentAthleteId(), ...patch })
const text = () => { const f = onlineNutritionFacts(day, asOf); return [...f.summary, ...f.details].join('\n') }

test('confirmed food-sheet records provide daily totals, recent dates and actual meal macros without a training link', t => {
  fixture(t); saveMeal(); saveMeal('2026-10-20', '合成前日餐', '晚餐')
  const facts = onlineNutritionFacts(day, asOf), summary = facts.summary.join('\n'), details = facts.details.join('\n')
  assert.match(summary, /2026-10-22/); assert.match(summary, /200\s*(?:千卡|kcal)/)
  assert.match(summary, /近7天/); assert.match(summary, /2026-10-16/); assert.match(summary, /2\s*天/)
  assert.match(summary, /全天.*完整.*未知|未确认全天.*完整/)
  assert.match(details, /2026-10-22.*早餐.*合成谷物餐.*200/)
  assert.match(details, /蛋白(?:质)?\s*10\s*克/); assert.match(details, /碳水\s*40\s*克/); assert.match(details, /脂肪\s*2\s*克/)
  assert.match(details, /2026-10-20.*晚餐.*合成前日餐/)
})

test('the nutrition-and-health panel save path reaches the same read-only facts', t => {
  const f = fixture(t)
  const food: Food = { id: 'PRIVATE_PANEL_FOOD_ID', name: '合成页面餐', brand: '合成品牌', region: 'PRIVATE_PANEL_LOCATION', category: '测试', amount: 1, per100g: true, nutrients: { kcal: 250, protein: 20, carbs: 30, fat: 5 }, source: { kind: 'MANUAL', status: '用户确认', uri: 'https://example.invalid/PRIVATE_PANEL_URI', notes: 'PRIVATE_PANEL_NOTE', checkedOn: null } }
  const saved = commitMeal({ food, amount: 100, date: day, meal: '午餐', time: '', note: 'PRIVATE_MEAL_NOTE', acknowledged: true })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const before = new Map(f.map), out = text()
  assert.match(out, /合成页面餐/); assert.match(out, /250\s*(?:千卡|kcal)/); assert.match(out, /碳水\s*30\s*克/)
  assert.doesNotMatch(out, /PRIVATE_|https?:\/\//); assert.deepEqual(f.map, before)
})

test('unknown nutrients remain unknown while an explicit recorded zero remains zero', t => {
  const f = fixture(t)
  f.store.setItem('fr255-food-log-v1', JSON.stringify([
    legacy({ id: 'unknown', name: '合成未知餐', kcal: 0, source: undefined, label: '未估算', protein: undefined, carbs: undefined, fat: undefined }),
    legacy({ id: 'zero', name: '合成明确零值餐', kcal: 0, protein: 0, carbs: 0, fat: 0, label: '手填' }),
  ]))
  const out = text()
  assert.match(out, /合成未知餐[^\n]*热量未知/); assert.doesNotMatch(out, /合成未知餐[^\n]*热量\s*0/)
  assert.match(out, /合成明确零值餐[^\n]*热量\s*0\s*(?:千卡|kcal)/)
  assert.match(out, /1\s*条.*热量未知|热量未知\s*1\s*条/)
  assert.match(out, /蛋白(?:质)?未知/); assert.match(out, /碳水未知/); assert.match(out, /脂肪未知/)
})

test('legacy food without a recordedAt remains visible with an explicit unknown save time', t => {
  const f = fixture(t); f.store.setItem('fr255-food-log-v1', JSON.stringify([legacy()]))
  const out = text()
  assert.match(out, /合成旧餐/); assert.match(out, /300\s*(?:千卡|kcal)/); assert.match(out, /保存时间未知/)
  assert.doesNotMatch(out, /没有饮食数据|无餐食记录/)
})

test('future meals and other athletes do not enter food totals or weight facts', t => {
  const f = fixture(t)
  f.store.setItem('fr255-food-log-v1', JSON.stringify([
    legacy(),
    legacy({ id: 'future-day', name: 'EXCLUDE_FUTURE_DAY', date: '2026-10-23' }),
    legacy({ id: 'future-save', name: 'EXCLUDE_FUTURE_SAVE', recordedAt: '2026-10-22T13:00:00.000Z' }),
    legacy({ id: 'future-eat', name: 'EXCLUDE_FUTURE_EAT', eatenAt: '2026-10-22T13:00:00.000Z' }),
    legacy({ id: 'foreign', name: 'EXCLUDE_FOREIGN_MEAL', athleteId: 'different-athlete' }),
  ]))
  f.store.setItem('fr255-body-v1', JSON.stringify([
    { id: 'weight-known', date: day, weight: 65.4, athleteId: currentAthleteId() },
    { id: 'weight-future', date: '2026-10-23', weight: 66.6, athleteId: currentAthleteId() },
    { id: 'weight-future-save', date: '2026-10-21', weight: 77.7, recordedAt: '2026-10-22T13:00:00.000Z', athleteId: currentAthleteId() },
    { id: 'weight-other', date: day, weight: 88.8, athleteId: 'different-athlete' },
  ]))
  const out = text()
  assert.match(out, /已记录\s*1\s*条/); assert.match(out, /体重[^\n]*65\.4\s*公斤/)
  assert.doesNotMatch(out, /EXCLUDE_|66\.6|77\.7|88\.8/)
})

test('repeated calls reread food corrections, deletions, body measurements and athlete changes', t => {
  fixture(t); const row = saveMeal(); assert.ok(upsertCheck({ date: day, weight: 65.4 }))
  assert.match(text(), /200\s*(?:千卡|kcal)/); assert.match(text(), /65\.4\s*公斤/)
  assert.ok(updateEntry(row.id, { kcal: 450, carb: 80 })); assert.ok(upsertCheck({ date: day, weight: 66.2 }))
  assert.match(text(), /450\s*(?:千卡|kcal)/); assert.match(text(), /碳水\s*80\s*克/); assert.match(text(), /66\.2\s*公斤/); assert.doesNotMatch(text(), /65\.4/)
  assert.ok(removeEntry(row.id)); const check = upsertCheck({ date: day, weight: 66.2 })![0]; assert.ok(removeCheck(check.id))
  assert.doesNotMatch(text(), /合成谷物餐|450|66\.2/); assert.match(text(), /无餐食记录|未找到.*餐食记录/)
  saveMeal(); setEventContext({ athleteId: 'different-athlete' }); assert.doesNotMatch(text(), /合成谷物餐|200/)
})

test('unreadable legacy nutrition is a read failure instead of a false empty record claim', t => {
  const f = fixture(t); f.store.setItem('fr255-food-log-v1', '{broken')
  const out = text()
  assert.match(out, /饮食.*读取失败/); assert.doesNotMatch(out, /已记录\s*0\s*条|无餐食记录|没有饮食数据/)
})

test('malformed event sources and unavailable key enumeration are reported rather than silently ignored', t => {
  const f = fixture(t); f.store.setItem(EVENTS_KEY, JSON.stringify({ data: {} }))
  assert.match(text(), /饮食.*读取失败/)
  f.map.clear(); f.store.setItem(EVENT_JOURNAL_PREFIX + 'bad', '{broken')
  assert.match(text(), /饮食.*读取失败/)
  f.map.clear(); setStoreBackend({ getItem: f.store.getItem, setItem: f.store.setItem })
  assert.match(text(), /饮食.*读取失败/)
})

test('body read failure does not hide valid food records or pretend that weight is absent', t => {
  const f = fixture(t); saveMeal(); f.store.setItem('fr255-body-v1', '{broken')
  const out = text()
  assert.match(out, /合成谷物餐/); assert.match(out, /体重.*读取失败/)
  assert.doesNotMatch(out, /体重.*(?:无记录|未记录|未找到)/)
})

test('nutrition packets cap detail count and omit IDs, location, note, photo and raw source metadata', t => {
  fixture(t)
  for (let i = 0; i < 10; i++) saveMeal(day, `合成餐${i}` + '长'.repeat(350))
  const row = loadEntries()[0]
  assert.ok(updateEntry(row.id, { photo: 'PRIVATE_PHOTO', nutritionSource: { kind: 'MANUAL', evidence: 'PRIVATE_ACCOUNT', uncertainty: 'PRIVATE_NOTE', reviewed: true } }))
  assert.ok(upsertCheck({ date: day, weight: 65.4 }))
  const f = onlineNutritionFacts(day, asOf), out = [...f.summary, ...f.details].join('\n')
  assert.ok(f.details.length > 0 && f.details.length <= 6)
  assert.ok(f.details.every(line => line.length <= 280))
  assert.match(out, /已记录\s*10\s*条/); assert.match(out, /体重[^\n]*65\.4/)
  assert.doesNotMatch(out, /PRIVATE_|example\.invalid|https?:\/\//)
})

test('no meals in the requested week does not erase older records, and latest measured weight stays dated', t => {
  const f = fixture(t)
  f.store.setItem('fr255-food-log-v1', JSON.stringify([legacy({ date: '2026-10-01' })]))
  f.store.setItem('fr255-body-v1', JSON.stringify([{ id: 'old-weight', date: '2026-09-30', weight: 64.2, athleteId: currentAthleteId() }]))
  const out = text()
  assert.match(out, /近7天/); assert.match(out, /2026-10-01/); assert.match(out, /2026-09-30.*64\.2|64\.2.*2026-09-30/)
  assert.doesNotMatch(out, /没有饮食数据/)
})
