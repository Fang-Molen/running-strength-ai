import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {answerLocally} from './coach-local-first.ts'
import {deriveCoachBrief} from './coach-brief.ts'
import {buildParts} from '../../../evaluation/k12/fixtures.ts'
import {emptyDialogue,type CoachDialogue,validDialogue} from './coach-dialogue.ts'
import {setStoreBackend} from './storage.ts'
import {firstWeekMemory} from './coach-first-week.fixtures.ts'
import {saveChatTraining} from './coach-chat-evidence.ts'
const ask=(q:string,state:CoachDialogue=emptyDialogue())=>answerLocally(deriveCoachBrief(buildParts(q,{})),undefined,[],undefined,state)
afterEach(()=>setStoreBackend(null))

for(const q of ['我的朋友800米PB120秒，我主项1500米','我不是800米PB120秒，我主项1500米','我的队友16岁，800米PB120秒，我主项1500米'])test('R189 profile rejects other or negated PB: '+q,()=>{
 const r=ask(q);assert.deepEqual(r.dialogue?.pbs,[]);assert.equal(r.dialogue?.profile.pbSeconds,null);assert.equal(r.dialogue?.profile.event,'1500米');assert.equal(r.dialogue?.profile.age,null)
})
test('R189 a repeated training performance is not a personal best or main event',()=>{const r=ask('今天练了6个400米60秒');assert.deepEqual(r.dialogue?.pbs,[]);assert.equal(r.dialogue?.profile.event,null);assert.equal(r.dialogue?.profile.pbSeconds,null)})
test('R189 own explicit PB after another athlete remains attributable',()=>{const r=ask('朋友800米PB120秒，我1500米PB4:12.36');assert.deepEqual(r.dialogue?.pbs,[{meters:1500,seconds:252.36}]);assert.equal(r.dialogue?.profile.pbSeconds,252.36)})
test('R189 switching event never relabels the previous event PB',()=>{
 const a=ask('主项800米，800米PB120秒');const b=ask('主项1500米',a.dialogue);assert.equal(b.dialogue?.profile.pbSeconds,null);assert.deepEqual(b.dialogue?.pbs,[{meters:800,seconds:120}]);assert.equal(ask('主项800米',b.dialogue).dialogue?.profile.pbSeconds,120)
})
const course='今天200米×4，实际30、31、32、33秒，组间2分钟，本课目的是速度耐力，复盘'
test('R189 same-course follow-up retains purpose through JSON persistence',()=>{
 const a=ask(course),b=ask('再复盘一下这节课',JSON.parse(JSON.stringify(a.dialogue)));assert.equal(b.offlineReview?.purpose.purpose,'速度耐力');assert.match(b.text,/首段30秒/);assert.ok(b.offlineReview?.purpose.sourceIds.length)
})
test('R189 corrected purpose is retained but never borrowed by another course',()=>{
 let a=ask(course);a=ask('复盘这节课，本课目的是节奏控制',a.dialogue);a=ask('再复盘一下这节课',a.dialogue);assert.equal(a.offlineReview?.purpose.purpose,'节奏控制');const b=ask('今天1000米×4，实际210、211、212、213秒，复盘',a.dialogue);assert.equal(b.offlineReview?.purpose.purpose,'UNKNOWN')
})
test('R189 explicitly unknown purpose clears the prior interpretation',()=>{
 let a=ask(course);a=ask('复盘这节课，本课目的不清楚',a.dialogue);assert.equal(a.offlineReview?.purpose.purpose,'UNKNOWN');assert.equal(ask('再复盘一下这节课',a.dialogue).offlineReview?.purpose.purpose,'UNKNOWN')
})
test('R189 confirmed saved course retains purpose while reading corrected formal facts',()=>{
 setStoreBackend(firstWeekMemory());const a=ask(course);assert.ok(a.chatTraining&&a.dialogue?.lastTraining);const saved=saveChatTraining(a.chatTraining,'2026-10-14T08:00:00Z',true);assert.ok(saved.ok);if(!saved.ok)return
 const state={...a.dialogue!,lastTraining:{...a.dialogue!.lastTraining!,savedOccurrenceId:saved.record.confirmedImportId}};const b=ask('复盘刚才保存的训练',JSON.parse(JSON.stringify(state)));assert.equal(b.offlineReview?.purpose.purpose,'速度耐力');assert.doesNotMatch(b.text,/聊天自报、未保存/)
})
test('R189 malformed saved purpose context fails validation safely',()=>{assert.equal(validDialogue({...emptyDialogue(),lastPurpose:{trainingId:'x'}}),false)})
test('R189 implausible race numbers remain reported input, not accepted derived analysis',()=>{const r=ask('今天800米用时20秒，前400米累计10秒，比赛分段请复盘');assert.match(r.text,/核对|有误/);assert.equal(r.offlineReview?.metrics.points.length,0);assert.doesNotMatch(r.text,/累计分段换算|后半相对前半用时差|速度下降/)})
