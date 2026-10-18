import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerLocally } from './coach-local-first.ts'
import { assembleCoachBrief } from './coach-brief.ts'
import { firstWeekMemory } from './coach-first-week.fixtures.ts'
import { setStoreBackend } from './storage.ts'
import { dispatchEvent } from './events.ts'
import { bindTrainingStart } from './occurrence.ts'
import { emptyDialogue } from './coach-dialogue.ts'
import { saveWatch } from '../health/legacy-inputs.ts'
const base = {question:'', occurrenceId:null, sources:[],sourceIds:[],sessionRpe:null,sleepHours:null,subjectiveRecovery:null,completedSetCount:null,plannedSetCount:null,pain:false,mustAsk:[], runningStructure:'UNAVAILABLE' as const,recoveryState:null,fatigueState:null,duplicateCount:0,repetitionSlots:0,continuousCount:0,durationSec:null,daysToCompetition:null,week:null,bias:null, constraints:{medicalReferral:false,increaseBlocked:false,blockReason:null}}
test('configured health mode cannot replace load facts with a daily fatigue summary',()=>{
 const store=firstWeekMemory();setStoreBackend(store);
 try{
  for(const mode of ['none','basic','pro'] as const){
   assert.equal(saveWatch(mode),true);
   for(const scope of ['RPE7','整课RPE7']){
    const brief=assembleCoachBrief(null,`50分钟，${scope}，算下负荷，没有HRV数据`,null);
    assert.equal(brief.appData?.mode.mode,mode);
    const before=[...store.data.entries()];const a=answerLocally(brief,undefined,[],undefined,emptyDialogue());
    assert.match(a.text,/350 AU/);assert.match(a.text,/整课/);assert.match(a.text,/未保存|不能当作已保存负荷/);
    if(scope==='RPE7')assert.match(a.text,/若|如果|需确认|待确认/);
    assert.doesNotMatch(a.text,/基于已保存记录的判断：/);assert.deepEqual([...store.data.entries()],before);
   }
  }
 }finally{setStoreBackend(null)}
})
test('load routing keeps emergency and persistent medical safety ahead of arithmetic',()=>{
 setStoreBackend(firstWeekMemory());
 try{
  assert.equal(saveWatch('none'),true);
  const brief=assembleCoachBrief(null,'50分钟，整课RPE7，现在胸痛，算负荷，没有HRV数据',null);
  assert.equal(brief.appData?.mode.mode,'none');
  const first=answerLocally(brief,undefined,[],undefined,emptyDialogue());
  assert.match(first.text,/120|急救/);assert.doesNotMatch(first.text,/350 AU/);
  const follow=assembleCoachBrief(null,'50分钟，整课RPE7，算下负荷，没有HRV数据',null);
  assert.equal(follow.appData?.mode.mode,'none');
  const next=answerLocally(follow,undefined,[],undefined,first.dialogue);
  assert.match(next.text,/120|急救/);assert.doesNotMatch(next.text,/350 AU/);
 }finally{setStoreBackend(null)}
})
for (const [q, expected] of [['双阈值适合我吗','双阈值'],['热量缺口怎么计算','RED-S'],['铁蛋白低吃什么','铁缺乏'],['胸痛呼吸困难怎么办','急诊'],['今天训练怎么样','训练事实']]) {
 test(q,()=>{const r=answerLocally({...base,question:q} as Parameters<typeof answerLocally>[0]);assert.match(r.text,new RegExp(expected));if(!/胸痛/.test(q))assert.match(r.text,/没有修改计划或记录/);else {assert.match(r.text,/停止.*(?:120|急救)/);assert.equal(r.escalationAvailable,false);}})
}
test('no false evidence and pain safety',()=>{const r=answerLocally({...base,question:'训练',pain:true,sessionRpe:9} as Parameters<typeof answerLocally>[0]);assert.match(r.text,/RPE 9/);assert.match(r.text,/不建议.*加量/);assert.doesNotMatch(r.text,/睡眠 \d/);})

test('recovery decision uses reported sleep and effort without promoting them to stored facts',()=>{
 const store=firstWeekMemory();setStoreBackend(store);
 for(const question of ['昨夜只睡3.5小时，今天间歇照常做吗？','上次力量课RPE8，今天腿很沉，下一课要调整吗？']){
  const brief=assembleCoachBrief(null,question,null);const before=new Map(store.data);const answer=answerLocally(brief);
  assert.ok(answer.recoveryDecision);assert.equal(answer.deviceAudit,undefined);
  assert.ok(answer.recoveryDecision.observations.some(o=>o.origin==='USER_REPORT'));
  assert.equal(brief.sleepHours,null);assert.equal(brief.sessionRpe,null);
  assert.match(answer.text,/精神状态/);assert.match(answer.text,/近期.*负荷/);assert.match(answer.text,/暂缓|降低/);
  assert.deepEqual(store.data,before);
 }setStoreBackend(null);
})
test('absent device metrics cannot divert an exertion decision into device audit',()=>{
 setStoreBackend(firstWeekMemory());const a=answerLocally(assembleCoachBrief(null,'昨天跑步RPE8，今天明显疲劳，下一课高强度要调整吗？没有HRV数据。',null));
 assert.equal(a.deviceAudit,undefined);assert.ok(a.recoveryDecision);
 assert.equal(a.curriculum?.lessons.some(l=>l.originalId==='R03'),false);
 assert.doesNotMatch(a.text,/再补.*RPE/);assert.match(a.text,/周期|比赛/);setStoreBackend(null);
})
test('reported effort with missing recovery asks instead of granting high intensity',()=>{
 setStoreBackend(firstWeekMemory());const a=answerLocally(assembleCoachBrief(null,'上次跑步RPE8，下一课高强度照常做吗？',null));
 assert.ok(a.recoveryDecision);assert.match(a.text,/未知|缺失/);assert.match(a.text,/待确认|暂不/);
 assert.equal(a.recoveryDecision.decisionAuthorization,false);assert.equal(a.recoveryDecision.executable,false);setStoreBackend(null);
})
test('planned, negated, third-party and invalid values are not current recovery observations',()=>{
 setStoreBackend(firstWeekMemory());
 for(const q of ['计划训练RPE9，明天怎么练？','我没有明显疲劳，计划睡4小时，今天训练照常吗？','朋友只睡4小时，今天训练照常吗？','我只睡30小时，跑步照常做吗？']){
  assert.equal(answerLocally(assembleCoachBrief(null,q,null)).recoveryDecision,undefined,q);
 }setStoreBackend(null);
})
test('bound evidence stays separate from a new report and all conflicting records are retained',()=>{
 const store=firstWeekMemory();setStoreBackend(store);
 const start=dispatchEvent('TRAINING_STARTED',{sessionId:'synthetic'})!;
 bindTrainingStart({startEventId:start.event_id,startedAt:start.timestamp,sessionId:'synthetic',planSlotId:'synthetic',plan:{id:'synthetic',name:'synthetic',moves:[]}});
 dispatchEvent('SLEEP_RECORDED',{trainingOccurrenceId:start.event_id,hours:8});
 const q='昨晚只睡3小时，今天跑步照常做吗？';const brief=assembleCoachBrief(null,q,start.event_id);
 const a=answerLocally(brief);assert.equal(brief.sleepHours,8);
 assert.ok(a.recoveryDecision?.observations.some(o=>o.origin==='BOUND_FACT'&&o.value===8));
 assert.ok(a.recoveryDecision?.observations.some(o=>o.origin==='USER_REPORT'&&o.value===3));
 assert.match(a.text,/时间.*对应|对应.*时间/);
 dispatchEvent('SLEEP_RECORDED',{trainingOccurrenceId:start.event_id,hours:4});
 const b=answerLocally(assembleCoachBrief(null,'下一课跑步高强度要调整吗？',start.event_id));
 assert.ok(b.recoveryDecision?.conflict);assert.match(b.text,/不平均|不能平均/);
 assert.ok(b.recoveryDecision.observations.filter(o=>o.origin==='BOUND_FACT').length>=2);
 assert.equal(b.recoveryDecision.executable,false);setStoreBackend(null);
})
test('current emergency and existing device conflicts keep priority over recovery decisions',()=>{
 setStoreBackend(firstWeekMemory());
 const a=answerLocally(assembleCoachBrief(null,'只睡3小时，现在胸痛，今天跑步照常做吗？',null));
 assert.equal(a.recoveryDecision,undefined);assert.match(a.text,/急诊/);assert.equal(a.escalationAvailable,false);
 const b=answerLocally(assembleCoachBrief(null,'手表睡眠8小时，健康睡眠4小时，今天跑步照常做吗？',null));
 assert.ok(b.deviceAudit);assert.equal(b.recoveryDecision,undefined);setStoreBackend(null);
})
