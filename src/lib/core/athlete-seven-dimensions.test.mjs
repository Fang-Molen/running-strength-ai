import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSevenDimensions as assess} from './athlete-seven-dimensions.mjs';
/** @param {string} id @param {number|null} sec */
const s=(id,sec,dist=400,round=1)=>({eventId:id,stepId:id,trainingOccurrenceId:'run1',distanceM:dist,seconds:sec,round});
test('400x6 preserves change without fatigue diagnosis',()=>{const r=assess({occurrenceId:'run1',steps:[65,64.5,64.8,65.5,67,69].map((v,i)=>s('e'+i,v))});assert.equal(r.dimensions.splitPerformance.comparisons[0].deltaSeconds,4);assert.equal(r.dimensions.fatigueRecovery.status,'UNKNOWN');assert.equal(r.writes,0);});
test('mixed distances stay separated',()=>{const r=assess({occurrenceId:'run1',steps:[s('a',42,300),s('b',28,200),s('c',43,300),s('d',27,200)]});assert.equal(r.dimensions.splitPerformance.comparisons.length,2);});
test('cross session rejected',()=>{const r=assess({occurrenceId:'run1',steps:[{...s('a',65),trainingOccurrenceId:'other'}]});assert.equal(r.status,'REJECTED');});
test('duplicate events rejected',()=>{const r=assess({occurrenceId:'run1',steps:[s('a',65),s('a',66)]});assert.ok(r.errors.includes('DUPLICATE_EVENT_ID'));});
test('missing splits not fabricated',()=>{const r=assess({occurrenceId:'run1',steps:[s('a',65),s('b',null)]});assert.equal(r.status,'REJECTED');});
test('pain demands safety review',()=>{const r=assess({occurrenceId:'run1',steps:[s('a',65)],safety:{pain:true}});assert.equal(r.dimensions.evidenceSafety.status,'SAFETY_REVIEW_REQUIRED');});
test('baseline does not become recovery score',()=>{const r=assess({occurrenceId:'run1',baseline:{metrics:{resting_hr_mean:{status:'DESCRIPTIVE_ONLY'}}},steps:[s('a',65)]});assert.equal(r.dimensions.personalBaseline.status,'DESCRIPTIVE_ONLY');assert.equal(r.dimensions.fatigueRecovery.status,'UNKNOWN');});
test('context records presence without inventing causal inference',()=>{const r=assess({occurrenceId:'run1',steps:[s('a',65)],context:{preRecovery:3,sessionRpe:9}});assert.equal(r.dimensions.fatigueRecovery.signals.sessionRpeRecorded,true);assert.equal(r.dimensions.eventSpecificCapacity.status,'UNKNOWN');});
