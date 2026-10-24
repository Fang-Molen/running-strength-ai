import test from 'node:test'
import assert from 'node:assert/strict'
import {computePlan,nutritionPlanGate} from '@/lib/nutrition/calc'
import {emptyProfile} from '@/lib/strength/profile'
const p={...emptyProfile(),sex:'female' as const,age:'30',heightCm:'165',weightKg:'70',activity:'desk' as const,aim:'lose' as const}
test('legacy nutrition pauses only the precise estimate for minors and out-of-range profiles, with a reason',()=>{
 const minor=nutritionPlanGate({...p,age:'16'});assert.equal(minor.plan,null);assert.equal(minor.paused,'MINOR');assert.match(minor.paused?minor.reason:'',/一般建议照常提供/)
 assert.equal(computePlan({...p,age:'85',heightCm:'120',weightKg:'35'}),null)
 assert.ok(computePlan({...p,age:'80'}),'the existing 12–80 range is not narrowed for adults')
 assert.ok(computePlan({...p,age:'70'})?.notes?.some(n=>/65岁以上/.test(n)))
})
test('legacy nutrition never gives a weight-loss deficit to a low BMI and floors very low targets',()=>{
 const low=computePlan({...p,weightKg:'45'})!;assert.equal(low.aim,'keep');assert.equal(low.kcal,low.maintain);assert.ok(low.notes?.some(n=>/BMI/.test(n)))
 const small=computePlan({...p,heightCm:'150',weightKg:'48',age:'60'})!;assert.ok(small.kcal>=Math.max(1200,small.bmr)||small.kcal===small.maintain)
})
test('legacy nutrition does not turn an aggressive deadline into a deficit above 20% of maintenance',()=>{
 const a=computePlan({...p,targetKg:'35',weeks:2})!;assert.ok(a.maintain-a.kcal<=a.maintain*.2+1);assert.ok(a.notes?.some(n=>/缺口过大/.test(n)))
})
