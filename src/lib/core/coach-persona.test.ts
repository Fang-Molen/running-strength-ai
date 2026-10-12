import test from 'node:test'
import assert from 'node:assert/strict'
import { PERSONAS, parsePersona, presentCoachAnswer, classifyReplyContext } from './coach-persona.ts'
test('four unique styles and safe fallback',()=>{ assert.equal(PERSONAS.length,4); assert.equal(new Set(PERSONAS.map(x=>x.id)).size,4); assert.equal(parsePersona('invalid'),'balanced') })
test('safety wording remains unchanged for all styles',()=>{ const warning='胸痛伴呼吸困难：停止运动，及时寻求急诊评估。'; for(const p of PERSONAS){ const result=presentCoachAnswer(warning,p.id); assert.ok(result.endsWith(warning)); assert.ok(!result.includes('继续训练')); assert.ok(!result.includes('可以跑')) } })
test('balanced does not alter response',()=>assert.equal(presentCoachAnswer('证据不足','balanced'),'证据不足'))
test('styles vary by subject, without editing original evidence',()=>{
 const training='今天训练完成了4组，RPE 8。'; const nutrition='今天记录了600千卡饮食，不能当作全天摄入。'
 for(const style of ['strict','gentle','analytical'] as const){
  const a=presentCoachAnswer(training,style); const b=presentCoachAnswer(nutrition,style)
  assert.notEqual(a.slice(0,a.indexOf('\n')),b.slice(0,b.indexOf('\n')))
  assert.ok(a.endsWith(training)); assert.ok(b.endsWith(nutrition))
 }
})
test('classifies risk before nutrition or training',()=>{ assert.equal(classifyReplyContext('贫血，运动中胸痛，建议急诊'), 'safety') })
test('invalid preference fails closed to balanced',()=>assert.equal(presentCoachAnswer('原始事实','other' as never),'原始事实'))
test('empty response never creates invented answer',()=>assert.equal(presentCoachAnswer('','strict'),''))
