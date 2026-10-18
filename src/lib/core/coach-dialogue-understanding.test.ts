/** Synthetic self-reports only. Exercise the live local coach entry point; no model calls. */
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {answerLocally} from './coach-local-first.ts'
import {deriveCoachBrief} from './coach-brief.ts'
import {buildParts} from '../../../evaluation/k12/fixtures.ts'
import {coachPrimaryIntent,emptyDialogue,validDialogue,type CoachDialogue} from './coach-dialogue.ts'
import {clarifyChatRpe,validPendingCoachQuestion} from './coach-dialogue-understanding.ts'
import {saveChatTraining} from './coach-chat-evidence.ts'
import {firstWeekMemory} from './coach-first-week.fixtures.ts'
import {setStoreBackend} from './storage.ts'
import {currentAthleteId} from './events.ts'

const ask=(q:string,p:CoachDialogue=emptyDialogue())=>answerLocally(deriveCoachBrief(buildParts(q,{})),undefined,[],undefined,p)
const visible=(text:string)=>text.split('\n依据：')[0]
const load='50分钟，RPE7，算下负荷'
afterEach(()=>setStoreBackend(null))

for(const prefix of ['不加量','先别加组','暂不加重量','不用加强度','不想多练'])test('declined action does not hijack review: '+prefix,()=>{
 const q=prefix+'，只复盘今天200米×4，30/31/32/33秒'
 assert.equal(coachPrimaryIntent(q),'REVIEW')
 const a=ask(q);assert.match(a.text,/平均31.5秒/);assert.match(a.text,/9.09%/);assert.doesNotMatch(visible(a.text),/^今天不建议加/)
})
for(const q of ['要不要加量，今天状态不错','是否不要加量，先帮我判断','是不是不要加量，还是可以加组','不能加量吗','不用加量吗','今天要不要加组？'])test('decision questions retain increase intent: '+q,()=>assert.equal(coachPrimaryIntent(q),'INCREASE'))
test('unshown intake question is not marked asked and can appear later',()=>{
 const a=ask('今天200米×4，30/31/32/33秒，复盘')
 assert.doesNotMatch(visible(a.text),/你的主项是什么/);assert.ok(!a.dialogue!.asked.includes('event'))
 const b=ask('给我下一次观察建议',a.dialogue);assert.match(b.text,/你的主项是什么/);assert.ok(b.dialogue!.asked.includes('event'))
})
test('task-specific scope question precedes intake and survives JSON refresh',()=>{
 const a=ask(load);assert.match(a.text,/350 AU/);assert.match(a.text,/这里的RPE是整课评分吗/)
 assert.deepEqual(a.dialogue!.asked,[`rpeScope:${a.chatTraining!.id}`]);assert.equal(a.dialogue!.pendingQuestion!.trainingId,a.chatTraining!.id)
 const persisted=JSON.parse(JSON.stringify(a.dialogue));assert.ok(validDialogue(persisted))
 const b=ask('是整课',persisted)
 assert.match(b.text,/350 AU（整课自报，未保存）/);assert.doesNotMatch(visible(b.text),/若这里是整课RPE/)
 assert.equal(b.chatTraining!.rpeAssumed,false);assert.equal(b.chatTraining!.rpe,7);assert.equal(b.chatTraining!.minutes,50)
 assert.equal(b.chatTraining!.rpeScopeClarification!.originalRaw,a.chatTraining!.raw)
 assert.equal(b.chatTraining!.rpeScopeClarification!.originalTrainingId,a.chatTraining!.id)
 assert.equal(b.chatTraining!.rpeScopeClarification!.answer,'是整课')
 assert.notEqual(b.chatTraining!.id,a.chatTraining!.id);assert.equal(a.chatTraining!.rpeAssumed,true);assert.equal(a.dialogue!.lastTraining!.raw,load.normalize('NFKC'))
 assert.equal(b.dialogue!.pendingQuestion,undefined)
})
for(const reply of ['不是整课，是最后一组','只是末组评分','不是整课，是单段'])test('set/segment clarification retracts conditional session AU: '+reply,()=>{
 const a=ask(load),b=ask(reply,a.dialogue)
 assert.equal(b.chatTraining!.rpe,null);assert.equal(b.chatTraining!.rpeAssumed,false);assert.doesNotMatch(visible(b.text),/350\s*AU/)
 assert.match(b.text,/不能乘整课时长/);assert.equal(a.chatTraining!.rpe,7)
})
for(const reply of ['对','不是','是整课吗？','如果是整课','朋友的是整课','是整课RPE8','另一节课是整课','是整课，今天胸痛'])test('ambiguous, new, other or safety input cannot resolve old scope: '+reply,()=>{
 const a=ask(load),p=a.dialogue!
 assert.equal(clarifyChatRpe(reply,p.lastTraining!,p.pendingQuestion,p.turns+1,p.pendingQuestion!.askedAt),null)
})
test('pending scope cannot cross a new course, turn or day',()=>{
 const a=ask(load),p=a.dialogue!,pending=p.pendingQuestion!,chat=p.lastTraining!
 assert.equal(clarifyChatRpe('是整课',chat,{...pending,trainingId:'another-course'},p.turns+1,pending.askedAt),null)
 assert.equal(clarifyChatRpe('是整课',chat,pending,p.turns+2,pending.askedAt),null)
 assert.equal(clarifyChatRpe('是整课',chat,pending,p.turns+1,'2099-01-01T00:00:00Z'),null)
 const b=ask('今天实际训练30分钟，RPE4，算下负荷',p)
 assert.notEqual(b.dialogue!.pendingQuestion!.trainingId,pending.trainingId)
 const c=ask('是整课',b.dialogue);assert.match(c.text,/120 AU/);assert.doesNotMatch(visible(c.text),/350 AU/)
})
test('scope confirmation keeps nested structure, missing splits and purpose',()=>{
 const q='主项400米，冬训期。今天200米×4×2，30/31/没记/33/32/33/34/35秒，组间2分钟，轮间8分钟，整课50分钟，RPE7，本课目的是节奏控制，复盘'
 const a=ask(q);assert.match(a.text,/这里的RPE是整课评分吗/)
 const b=ask('是整课',a.dialogue)
 assert.deepEqual(b.chatTraining!.splits,a.chatTraining!.splits);assert.equal(b.chatTraining!.roundRestSeconds,480);assert.equal(b.chatTraining!.restSeconds,120)
 assert.equal(b.offlineReview!.purpose.purpose,'节奏控制');assert.equal(b.chatTraining!.splits[2].seconds,null)
 assert.match(b.text,/350 AU/);assert.equal(b.offlineReview!.planWrite,false)
})
test('saved records cannot be overwritten by a pending chat confirmation',()=>{
 setStoreBackend(firstWeekMemory())
 const a=ask(load,emptyDialogue(currentAthleteId()))
 const saved=saveChatTraining(a.chatTraining!,'2026-10-17T08:00:00Z',true,'RUNNING');assert.ok(saved.ok)
 const b=ask('是整课',a.dialogue)
 assert.match(b.text,/已保存.*不能直接覆盖/);assert.equal(b.chatTraining,undefined);assert.equal(b.candidate,null)
 assert.equal(b.dialogue!.lastTraining!.id,a.chatTraining!.id)
})
test('urgent safety preempts pending scope and prevents stale later resolution',()=>{
 const a=ask(load),b=ask('我现在胸痛，气短，出冷汗',a.dialogue)
 assert.match(b.text,/120/);assert.equal(b.dialogue!.pendingQuestion,undefined);assert.equal(b.chatTraining,undefined)
 const c=ask('是整课',b.dialogue);assert.match(c.text,/120/);assert.equal(c.chatTraining,undefined)
})
test('malformed optional question is rejected without discarding legacy or medical state',()=>{
 assert.ok(validDialogue(emptyDialogue()))
 const malformed={kind:'RPE_SCOPE',trainingId:'x',askedTurn:1}
 assert.equal(validPendingCoachQuestion(malformed),false)
 const a=ask('我现在胸痛，气短，出冷汗')
 const restored=JSON.parse(JSON.stringify({...a.dialogue,pendingQuestion:malformed}))
 assert.ok(validDialogue(restored));assert.match(ask('是整课',restored).text,/120/)
})
test('local multi-turn clarification never writes formal data or calls fetch',()=>{
 const box=firstWeekMemory();setStoreBackend(box);box.setItem('fr255-strength-plan','synthetic-plan-unchanged')
 const a=ask(load),before=Array.from({length:box.length},(_,i)=>[box.key(i),box.getItem(box.key(i)!)])
 const originalFetch=globalThis.fetch;let calls=0
 globalThis.fetch=()=>{calls++;throw Error('network forbidden in synthetic test')}
 try{const b=ask('是整课',JSON.parse(JSON.stringify(a.dialogue)));assert.match(b.text,/350 AU/);assert.equal(calls,0);assert.deepEqual(Array.from({length:box.length},(_,i)=>[box.key(i),box.getItem(box.key(i)!)]),before)}finally{globalThis.fetch=originalFetch}
})
