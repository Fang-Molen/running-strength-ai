import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOfflineTrainingEvidence as assess} from './offline-training-evidence.mjs';
/** @param {string} id @param {number} t */
const step=(id,t,d=400)=>({trainingOccurrenceId:'A',sourceEventId:id,distanceMeters:d,durationSeconds:t});
test('unbound health workouts do not become interval facts',()=>{
 const r=assess({workouts:[{duration:30}],records:[{type:'heart-rate'}]});
 assert.equal(r.repAnalysis.status,'UNAVAILABLE');assert.equal(r.causalAttribution,'UNKNOWN');assert.equal(r.writes,0);
});
test('bound 400x6 can be observed but not diagnosed',()=>{
 const r=assess({trainingOccurrenceId:'A',workouts:[{trainingOccurrenceId:'A',steps:[65,64.5,64.8,65.5,67,69].map((t,i)=>step('e'+i,t))}]});
 assert.equal(r.repAnalysis.differenceSeconds,4);assert.equal(r.fatigueDiagnosis,'UNKNOWN');assert.equal(r.recommendedPlanChange,null);
});
test('duplicate events are blocked',()=>{
 const r=assess({trainingOccurrenceId:'A',workouts:[{trainingOccurrenceId:'A',steps:[step('same',65),step('same',68)]}]});
 assert.equal(r.repAnalysis.reason,'DUPLICATE_SOURCE_EVENTS');
});
test('mixed distance is not compared',()=>{
 const r=assess({trainingOccurrenceId:'A',workouts:[{trainingOccurrenceId:'A',steps:[step('a',45,300),step('b',30,200)]}]});
 assert.equal(r.repAnalysis.reason,'MIXED_DISTANCES');
});
test('pain flag preserves safety review',()=>{
 const r=assess({pain:true});assert.equal(r.safety,'SAFETY_REVIEW');assert.equal(r.externalModelCalls,0);
});
test('foreign training steps cannot be bound',()=>{
 const r=assess({trainingOccurrenceId:'A',workouts:[{trainingOccurrenceId:'A',steps:[{...step('x',60),trainingOccurrenceId:'B'}]}]});
 assert.equal(r.repAnalysis.status,'UNAVAILABLE');
});
