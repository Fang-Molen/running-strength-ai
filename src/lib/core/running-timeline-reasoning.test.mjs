import test from 'node:test';import assert from 'node:assert/strict';
import {reasonTrainingTimeline} from './running-timeline-reasoning.ts';
/** @type {import("./running-context-exam.ts").ExamContext} */
const session={trainingOccurrenceId:'now',goal:'EVEN',reps:[65,65,66,67,68,70].map((seconds,i)=>({trainingOccurrenceId:'now',componentId:'run',blockId:'b',round:1,step:i+1,ordinal:i+1,distanceMeters:400,seconds,sourceEventId:`rep-${i}`}))};
/** @param {string} id @param {string} source @param {number} value */
const item=(id,source,value)=>({trainingOccurrenceId:id,sourceEventId:source,value});
for(let i=0;i<100;i++)test(`timeline case ${i+1}`,()=>{const x={session,previousSessions:i%3===0?[item('prior','p',8)]:[],preRecovery:i%4===0?[item('now','pre',3)]:[],postRpe:i%5===0?[item('now','post',9)]:[],recovery24h:i%6===0?[item('now','h24',2)]:[],recovery48h:i%7===0?[item('now','h48',5)]:[],painFlag:i%11===0};if(i%13===0)x.recovery24h=[item('now','dup',2),item('now','dup',3)];const r=reasonTrainingTimeline(x);assert.equal(r.decision,'NONE');assert.equal(r.writes,0);assert.equal(r.priorSessionCausedCurrentPerformance,'UNKNOWN');assert.equal(r.nextSessionPrescription,null);assert.equal(r.safety,i%11===0?'SAFETY_REVIEW':'NO_PAIN_FLAG_REPORTED');if(i%13===0)assert.equal(r.status,'BLOCKED');else assert.equal(r.status,'OBSERVATION_ONLY');});
