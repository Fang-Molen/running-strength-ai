import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {detectRedFlags,redFlagResponse} from './coach-red-flags.ts'
import {secondsToken,parseChatTraining} from './coach-chat-evidence.ts'
import {reportedPbs,reportedRace,calculateRaceSplits,intervalTargetAnalysis,proposeNominalDistance,explicitlyReviewsRecord} from './coach-specialty-analysis.ts'
import {answerLocally} from './coach-local-first.ts'
import {deriveCoachBrief} from './coach-brief.ts'
import {emptyDialogue} from './coach-dialogue.ts'
import {buildParts} from '../../../evaluation/k12/fixtures.ts'
const ask=(q:string,prior=emptyDialogue())=>answerLocally(deriveCoachBrief(buildParts(q,{})),undefined,[],undefined,prior)
for(const q of ['队友倒地没有反应，只有叹息样呼吸','他跑完叫不醒，抽泣样呼吸','队友倒地抽搐后没有反应'])test('R189 arrest '+q,()=>{
 const red=detectRedFlags(q);assert.equal(red.level,'EMERGENCY');assert.ok(red.classes.includes('CARDIAC_ARREST'));const text=redFlagResponse(red)!;for(const v of ['120','心肺复苏','胸外按压','AED'])assert.ok(text.includes(v),v)
})
for(const q of ['我现在没有胸痛，没有呼吸困难，没有晕倒','假设队友没有反应也没有正常呼吸怎么办'])test('R189 scoped nonactual '+q,()=>assert.equal(detectRedFlags(q).level,'NONE'))
test('R189 heat mild has cooling and explicit escalation',()=>{const t=redFlagResponse(detectRedFlags('今天35度跑完头晕恶心，出了很多汗'))!;for(const v of ['阴凉','降温','120','意识','说话','抽搐'])assert.ok(t.includes(v),v)})
test('R189 cardiac warning is not cardiac arrest AED script',()=>{const t=redFlagResponse(detectRedFlags('我跑完胸痛'))!;assert.match(t,/120/);assert.doesNotMatch(t,/AED|胸外按压/)})
for(const [raw,n] of [['1:54.32',114.32],["2'03.125",123.125],['59.875',59.875],['1:60.1',null],['缺',null]] as const)test('R189 seconds '+raw,()=>assert.equal(secondsToken(raw),n))
test('R189 count is not event and hundredths retained',()=>{const c=parseChatTraining('今天6个400米，实际60.12、61.24、62.3、63.45、64、64.8秒，组间3分钟');assert.equal(c.planned,6);assert.equal(c.splits[0].seconds,60.12);assert.equal(ask('练6个400米').dialogue?.profile.event,null)})
test('R189 paired distance/time arrays do not turn meters into seconds',()=>{const c=parseChatTraining('今天实际距离依次200、400、600米，用时依次30、65、100秒');assert.deepEqual(c.splits.map(s=>[s.meters,s.seconds]),[[200,30],[400,65],[600,100]])})
test('R189 mismatched arrays stay unresolved',()=>{const c=parseChatTraining('今天实际距离200、400、600米，用时30、65秒');assert.equal(c.splits.length,0);assert.ok(c.issues.length)})
test('R189 target values do not become actual times',()=>{const c=parseChatTraining('今天400米×4，目标60秒，实际59、61、62、63秒，组间3分钟');assert.deepEqual(c.splits.map(s=>s.seconds),[59,61,62,63]);const r=intervalTargetAnalysis(c,c.raw,'速度耐力')!;assert.deepEqual(r.deviations.map(d=>d.deltaSeconds),[-1,1,2,3]);assert.match(r.text,/第1轮第4次\+3秒/);assert.equal(r.sourceId,c.id)})
test('R189 exact two rounds retained',()=>{const c=parseChatTraining('200米×4×2，实际30、31、32、33、31、32、33、34秒，组间2分钟，轮间6分钟');assert.deepEqual(c.splits.map(s=>s.round),[1,1,1,1,2,2,2,2]);assert.equal(c.restSeconds,120);assert.equal(c.roundRestSeconds,360)})
test('R189 minute PB parses without inventing a completed session',()=>{assert.equal(reportedPbs('1500米PB 4:12.36')[0].seconds,252.36);assert.equal(ask('1500米PB 4:12.36').dialogue?.profile.pbSeconds,252.36);assert.deepEqual(reportedPbs('目标1500米PB 4:00'),[])})
test('R189 cumulative splits derive exact unreported tail and never interpolate 600',()=>{const r=calculateRaceSplits(800,114.32,[{atM:400,seconds:54.1,sourceId:'oral400',source:'USER_REPORT'}]);assert.equal(r.status,'AVAILABLE');assert.equal(r.segments.length,2);assert.ok(Math.abs(r.segments[1].seconds-60.22)<1e-9);assert.ok(Math.abs(r.halfDifferenceSeconds!-6.12)<1e-9);assert.equal(r.segments.some(s=>s.toM===600),false)})
test('R189 conflicting total is not silently preferred',()=>{const r=calculateRaceSplits(800,114,[{atM:800,seconds:115,sourceId:'watch',source:'DEVICE'}]);assert.equal(r.status,'UNKNOWN');assert.ok(r.errors.includes('TOTAL_CONFLICT'))})
test('R189 cumulative report actually enters review text',()=>{const q='今天800米用时1:54.32，前400米累计54.1秒，比赛分段请复盘';assert.equal(reportedRace(q)?.eventMeters,800);const r=ask(q);assert.match(r.text,/60.22/);assert.match(r.text,/6.12秒/);assert.match(r.text,/推导/);assert.doesNotMatch(r.text,/预测.*1:5/)})
test('R189 nominal proposals preserve raw, never auto apply',()=>{const raw=[390,410,402,398],r=proposeNominalDistance(raw,400,'GPS',true);assert.equal(r.status,'REVIEW_REQUIRED');assert.deepEqual(r.rawMeters,raw);assert.equal(r.autoApply,false);assert.equal(proposeNominalDistance(raw,400,'GPS',false).status,'UNKNOWN')})
for(const q of ['明天怎么安排','运动后为什么酸痛','我800米PB两分钟，怎么提高','下周训练计划怎么安排'])test('R189 free question does not bind prior training '+q,()=>assert.equal(explicitlyReviewsRecord(q),false))
test('R189 free follow-up does not reuse stale chat course',()=>{const first=ask('今天200米×4，实际30、31、32、33秒，组间2分钟，复盘');const next=ask('明天练什么',first.dialogue);assert.equal(next.offlineReview,undefined);assert.equal(next.candidate,null);assert.match(next.text,/具体观察任务/);assert.doesNotMatch(next.text,/前次有效记录有4段/)})
test('R189 unknown purpose stays unknown even in a stage',()=>{const r=ask('减量期，今天1000米×4，实际210、211、212、213秒，组间2分钟，复盘');assert.equal(r.offlineReview?.purpose.purpose,'UNKNOWN');assert.match(r.text,/目的/);assert.match(r.text,/原计划|教练/)})
test('R189 supplied course purpose changes interpretation but not actual facts',()=>{const base='今天400米×4，目标60秒，实际59、61、62、63秒，组间3分钟，';const a=ask(base+'本课目的是速度耐力，复盘'),b=ask(base+'本课目的是赛前节奏熟悉，复盘');assert.match(a.text,/速度耐力/);assert.match(b.text,/赛前节奏熟悉/);assert.match(a.text,/\+3秒/);assert.match(b.text,/\+3秒/)})
test('R189 medical hold still dominates next-step observation',()=>{let r=ask('我15岁，已经3个月没来月经');r=ask('明天练什么',JSON.parse(JSON.stringify(r.dialogue)));assert.ok(r.dialogue?.medicalHold);assert.equal(r.candidate,null);assert.doesNotMatch(r.text,/具体观察任务|原课程执行/)})
test('R189 chat UI scopes selected record only for explicit review',()=>{const s=readFileSync(new URL('../../components/coach-sheet.tsx',import.meta.url),'utf8');assert.match(s,/explicitlyReviewsRecord\(value\)\?selectedOccurrenceId:null/)})
