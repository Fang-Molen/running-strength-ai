import test from 'node:test'
import assert from 'node:assert/strict'
import {answerLocally,answerStaysLocal} from './coach-local-first'
import {assembleCoachBrief} from './coach-brief'
import {setStoreBackend} from './storage'
import {firstWeekMemory} from './coach-first-week.fixtures'
for(const question of ['为什么力量训练能帮助跑步？','间歇跑组间休息长短有什么区别？','什么是轻松跑？']){
 test('无个人记录也能解释：'+question,()=>{
  setStoreBackend(firstWeekMemory());try{
   const answer=answerLocally(assembleCoachBrief(null,question,null));
   assert.equal(answerStaysLocal(answer),true);
   assert.equal(answer.localOnly,'GENERAL_EDUCATION');
   assert.doesNotMatch(answer.text,/没有可核验的联网|无法回答|你的主项|先记录下一节/);
   assert.ok(answer.text.length>30&&answer.text.length<=1000);
   assert.equal(answer.candidate,null);
  }finally{setStoreBackend(null)}
 })
}
test('个人处方和危险症状不走一般知识捷径',()=>{
 setStoreBackend(firstWeekMemory());try{
  for(const q of ['我昨天跑完腿疼，间歇跑怎么安排？','根据我这两周训练，力量怎么安排？','胸痛呼吸困难怎么办？']){
   const answer=answerLocally(assembleCoachBrief(null,q,null));
   assert.notEqual(answer.localOnly,'GENERAL_EDUCATION');
  }
 }finally{setStoreBackend(null)}
})

test('轻松跑教学解释目的、交谈强度和停止条件，并保留现有来源',()=>{
 setStoreBackend(firstWeekMemory());try{
  const a=answerLocally(assembleCoachBrief(null,'什么是轻松跑？',null))
  assert.equal(a.localOnly,'GENERAL_EDUCATION')
  assert.match(a.text,/低强度|轻松活动/)
  assert.match(a.text,/交谈/)
  assert.match(a.text,/疼痛.*停止/)
  assert.ok(a.sources.includes('PB-HEART'))
  assert.ok(a.text.length<=1000)
 }finally{setStoreBackend(null)}
})
for(const q of ['请给我解释轻松跑是什么。','我想了解间歇跑组间休息的原理。'])test('礼貌教学请求不等于个人处方：'+q,()=>{
 setStoreBackend(firstWeekMemory());try{
  const a=answerLocally(assembleCoachBrief(null,q,null))
  assert.equal(a.localOnly,'GENERAL_EDUCATION')
  assert.equal(a.escalationAvailable,false)
  assert.equal(a.candidate,null)
  assert.ok(a.text.length<=1000)
 }finally{setStoreBackend(null)}
})
for(const q of ['昨天间歇跑为什么掉速？','最近深蹲提高了，为什么跑步反而变慢？','这次轻松跑为什么心率这么高？','为什么我的力量训练没有帮助跑步？','请给我解释昨天间歇跑为什么掉速。'])test('含个人经历的原因问题不转成一般教学：'+q,()=>{
 setStoreBackend(firstWeekMemory());try{
  assert.notEqual(answerLocally(assembleCoachBrief(null,q,null)).localOnly,'GENERAL_EDUCATION')
 }finally{setStoreBackend(null)}
})
