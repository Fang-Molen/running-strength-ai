import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNutritionLabel, mergeLabel } from './label-parse.ts'
test('Chinese label per 100g, kJ converted, saturated fat not taken as fat', () => {
  const r = parseNutritionLabel(`营养成分表\n项目 每100克 NRV%\n能量 1850千焦 22%\n蛋白质 6.5克 11%\n脂肪 20.1克 34%\n—饱和脂肪 9.0克\n碳水化合物 60.2克 20%\n膳食纤维 3.0克\n钠 400毫克 20%`)
  assert.equal(r.basis, '100g'); assert.deepEqual(r.values, { kcal: 442, protein: 6.5, fat: 20.1, carb: 60.2, fiber: 3 })
})
test('per serving with kcal and fullwidth digits; missing fields stay blank', () => {
  const r = parseNutritionLabel('每份(30g)\n热量：１２０千卡\n蛋白质 ３.５g\n碳水化合物 18g')
  assert.equal(r.basis, 'serv'); assert.equal(r.servingGrams, 30)
  assert.deepEqual(r.values, { kcal: 120, protein: 3.5, carb: 18 }); assert.equal('fat' in r.values, false)
})
test('energy with both kJ and kcal prefers kcal', () => {
  assert.equal(parseNutritionLabel('Energy 1046 kJ / 250 kcal\nProtein 10 g\nFat 5 g\nCarbohydrate 40 g').values.kcal, 250)
})
test('receipt without nutrition yields nothing (no guessing)', () => {
  assert.deepEqual(parseNutritionLabel('华莱士 收银小票\n香辣鸡腿堡 1 15.00\n合计 15.00').values, {})
})
test('merge accepts only finite non-negative remote values and fills name', () => {
  const m = mergeLabel(parseNutritionLabel('蛋白质 6克'), { kcal: 300.4, fat: -1, carb: 'x', name: '燕麦饼干', basis: '100g' })
  assert.deepEqual(m.values, { protein: 6, kcal: 300 }); assert.equal(m.name, '燕麦饼干'); assert.equal(m.basis, '100g')
})
test('real tesseract output with spaced CJK and misread unit glyphs', () => {
  const r = parseNutritionLabel("营养 成 分 表\n\n项 目 “每 100 死 NRV%\n能 量 《1850 千 焦 220%4\n蛋白 质 6.5 克 ”11%\n脂肪 20.1 克 34%\n碳水 化 合 物 60.2 克 20%\n钠 400 毫 元 20%\n")
  assert.equal(r.basis, '100g'); assert.deepEqual(r.values, { kcal: 442, protein: 6.5, fat: 20.1, carb: 60.2 })
})
