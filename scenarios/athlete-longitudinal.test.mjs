import test from 'node:test'; import assert from 'node:assert/strict';
import {emptyAthleteDialogueState,advanceAthleteDialogue} from '../src/lib/core/coach-athlete-dialogue.ts';
test('multi-turn profile retains athlete type and PB with no invented current prediction',()=>{
 let s=emptyAthleteDialogueState();s=advanceAthleteDialogue(s,'我是中长跑选手').state;
 let r=advanceAthleteDialogue(s,'我5000米PB是16分00秒，预测3000米');
 assert.equal(r.state.athleteType,'MIDDLE_LONG_DISTANCE');assert.equal(r.state.personalBests[0].seconds,960);
 assert.ok(r.historical3000EquivalentSeconds>=555 && r.historical3000EquivalentSeconds<=565);
 assert.equal(r.predictionStatus,'HISTORICAL_EQUIVALENT_ONLY');
});
test('stale PB and interrupted training must not become current performance',()=>{
 let s=advanceAthleteDialogue(emptyAthleteDialogueState(),'我两年前5000米PB是16分00秒').state;
 let r=advanceAthleteDialogue(s,'我停训半年，现在3000米能跑多少');
 assert.equal(r.state.personalBests[0].age,'HISTORICAL');assert.equal(r.state.recentTrainingStatus,'INTERRUPTED');
 assert.ok(r.safeguards.some(x=>x.includes('不等于当前')));
});
test('does not hallucinate PB from workout splits',()=>{
 let r=advanceAthleteDialogue(emptyAthleteDialogueState(),'今天5000米训练目标16分00秒');
 assert.equal(r.state.personalBests.length,0);assert.equal(r.historical3000EquivalentSeconds,null);
});
test('emergency blocks equivalent output even with prior PB',()=>{
 let s=advanceAthleteDialogue(emptyAthleteDialogueState(),'5000米PB是16分00秒').state;
 let r=advanceAthleteDialogue(s,'今天运动时胸痛，我能继续吗');
 assert.equal(r.assessment.safety,'EMERGENCY');assert.equal(r.historical3000EquivalentSeconds,null);
});
test('deterministic replay and immutable input',()=>{
 let s=emptyAthleteDialogueState();let before=JSON.stringify(s);
 let a=advanceAthleteDialogue(s,'我是中长跑选手');let b=advanceAthleteDialogue(s,'我是中长跑选手');
 assert.deepEqual(a,b);assert.equal(JSON.stringify(s),before);
});
