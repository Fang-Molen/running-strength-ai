import test from 'node:test';
import assert from 'node:assert/strict';
import {answerRunningQuestion} from './running-reasoning-audit.ts';
/** @type {import("./running-reasoning-audit.ts").ReasoningQuestion["question"][]} */
const questions=['PERFORMANCE','FATIGUE_CAUSE','NEXT_SESSION','PAIN_SAFETY','GOAL_FIT'];
for(let i=0;i<100;i++){
 const type=i%4;const q=questions[i%5];const pain=i%11===0;
 const distances=type===2?[300,200,300,200,300,200]:Array(type===1?8:6).fill(type===1?200:400);
/** @type {import("./running-structured-context.ts").StructuredRep[]} */
 const reps=distances.map((d,j)=>({trainingOccurrenceId:'a',componentId:'run',blockId:'b',ordinal:j+1,round:type===1?Math.floor(j/4)+1:type===2?Math.floor(j/2)+1:1,step:type===1?j%4+1:type===2?j%2+1:j+1,sourceEventId:`${i}-${j}`,distanceMeters:d,seconds:65+j,restAfterSeconds:90}));
 if(type===3)reps[0].seconds=null;
 const result=answerRunningQuestion({question:q,context:{trainingOccurrenceId:'a',reps,goal:'EVEN',pain}});
 test(`NATURAL-LIKE-${String(i+1).padStart(3,'0')} ${q}`,()=>{
  assert.equal(result.writes,0);assert.equal(result.decision,'NONE');
  const expected=((type===2||type===3)&&(q==='PERFORMANCE'||q==='GOAL_FIT'))?'INSUFFICIENT_EVIDENCE':pain?'SAFETY_REVIEW':q==='FATIGUE_CAUSE'||q==='NEXT_SESSION'?'INSUFFICIENT_EVIDENCE':q==='PAIN_SAFETY'?'NO_REPORTED_PAIN':q==='GOAL_FIT'?type===2?'UNKNOWN':'ENDPOINTS_DIFFER':type===2?'UNKNOWN':'SLOWER_FINISH';
  assert.equal(result.answer,expected);
 });
}
