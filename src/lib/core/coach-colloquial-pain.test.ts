import test from 'node:test'
import assert from 'node:assert/strict'
import { detectRedFlags } from './coach-red-flags'
import { answerLocally } from './coach-local-first'
import { assembleCoachBrief } from './coach-brief'
import { firstWeekMemory } from './coach-first-week.fixtures'
import { setStoreBackend } from './storage'

for(const q of ['我昨天跑完腿疼，间歇跑怎么安排？','今天膝盖疼，能跑吗？','脚踝有点疼，怎么练？','膝盖越来越疼，但HRV正常，为什么不能照常间歇跑？'])test('colloquial active pain retains safety boundary: '+q,()=>{
 setStoreBackend(firstWeekMemory());try{
  const red=detectRedFlags(q)
  assert.equal(red.level,'MEDICAL_REVIEW')
  assert.ok(red.classes.includes('PAIN'))
  const a=answerLocally(assembleCoachBrief(null,q,null))
  assert.notEqual(a.localOnly,'GENERAL_EDUCATION')
  assert.equal(a.candidate,null)
  assert.match(a.text,/停止.*(?:疼痛|痛)|暂停.*(?:训练|动作)/)
  assert.doesNotMatch(a.text,/可以照常|放心.*(?:训练|跑步)/)
 }finally{setStoreBackend(null)}
})
for(const q of ['我没有腿疼，想问轻松跑是什么。','现在膝盖不疼。','如果明天腿疼怎么办？','请解释跑步后腿疼的常见原因。','我昨天练完肌肉酸痛。'])test('denial, hypothetical and ordinary soreness do not assert current local pain: '+q,()=>{
 const red=detectRedFlags(q)
 assert.equal(red.level,'NONE')
 assert.equal(red.classes.includes('PAIN'),false)
})
test('historical pain remains history and current pain after a turn remains current',()=>{
 const past=detectRedFlags('去年腿疼过，早已好了，现在没有疼痛。')
 assert.equal(past.classes.includes('PAIN'),false)
 assert.equal(past.evidence.some(s=>s.includes('腿疼')),false)
 const current=detectRedFlags('以前没有腿疼，但是今天腿疼。')
 assert.equal(current.level,'MEDICAL_REVIEW')
 assert.ok(current.classes.includes('PAIN'))
})

for(const q of ['现在跟腱不疼。','现在膝盖没有痛。','没有腿疼、膝盖疼。'])test('body-part pain negation is scoped through body and lists: '+q,()=>{
 assert.equal(detectRedFlags(q).level,'NONE')
})
test('double-negative pain report cannot clear the pain boundary',()=>{
 assert.equal(detectRedFlags('我不是没有腿疼，今天还疼。').level,'MEDICAL_REVIEW')
})
test('a resolved recent report is historical, while a later pain assertion stays current',()=>{
 const resolved=detectRedFlags('昨天腿疼，现在完全好了。')
 assert.equal(resolved.classes.includes('PAIN'),false)
 assert.deepEqual(resolved.evidence,[])
 const active=detectRedFlags('昨天腿疼，现在完全好了，但是今天膝盖疼。')
 assert.ok(active.classes.includes('PAIN'))
 assert.ok(active.evidence.includes('膝盖疼'))
})
