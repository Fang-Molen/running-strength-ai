import test from 'node:test'
import assert from 'node:assert/strict'
import {parseQuickLog} from './quick-log'
import {quickDraftInput,saveQuickTraining} from './quick-log-save'
test('混合一句话不悄悄只保存跑步，原文和原因保留',()=>{
 for(const text of ['跑5公里然后深蹲40公斤3组8次','跑5公里和10组深蹲','跑5公里，卧推3组8次']){
  const p=parseQuickLog(text,'2026-10-29');assert.equal(p.kind,'unknown');assert.equal(p.kind==='unknown'?p.text:'',text);assert.ok(p.unrecorded?.some(x=>/混合/.test(x)));assert.equal(saveQuickTraining(p,'synthetic-mixed','2026-10-29T10:00:00Z',null).ok,false)
 }
})
test('未支持心率明确作为原文，结构化训练不冒称已经记录心率',()=>{
 const p=parseQuickLog('跑5公里，用了30分钟，平均心率160','2026-10-29');assert.equal(p.kind,'run');assert.ok(p.unrecorded?.some(x=>/心率/.test(x)))
 if(p.kind==='run'){const draft=quickDraftInput(p,'2026-10-29T10:00:00Z',null);assert.ok(draft.warnings.some(x=>/心率/.test(x)));assert.equal(draft.durationSeconds.value,1800)}
})
test('明确每手和总重口径保存到逐组字段，不只放标题',()=>{
 for(const [text,basis]of [['哑铃卧推每手20公斤3组8次','PER_HAND'],['深蹲总重40公斤3组8次','TOTAL_EXTERNAL']] as const){
  const p=parseQuickLog(text,'2026-10-29');assert.equal(p.kind,'strength');if(p.kind==='strength')assert.equal(quickDraftInput(p,'2026-10-29T10:00:00Z',null).strengthSets[0].loadBasis.value,basis)
 }
})
