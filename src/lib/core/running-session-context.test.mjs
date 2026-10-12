import test from 'node:test';import assert from 'node:assert/strict';import {observeRunningSessionContext} from './running-session-context.ts';
/** @param {number[]} times */
const reps=times=>times.map((seconds,i)=>({ordinal:i+1,distanceMeters:400,seconds,sourceEventId:`e${i+1}`,targetSeconds:65}));
test('same timings different purposes yield different alignment',()=>{const r=reps([65,65,65]);assert.equal(observeRunningSessionContext({purpose:'EVEN_PACE',reps:r}).purposeAlignment,'CONSISTENT');assert.equal(observeRunningSessionContext({purpose:'PROGRESSIVE_FASTER',reps:r}).purposeAlignment,'NOT_CONSISTENT')});
test('faster progression observed without prescription',()=>{const x=observeRunningSessionContext({purpose:'PROGRESSIVE_FASTER',reps:reps([70,68,66])});assert.equal(x.purposeAlignment,'CONSISTENT');assert.equal(x.decision,'NONE')});
test('unspecified purpose cannot be inferred',()=>assert.equal(observeRunningSessionContext({purpose:'UNSPECIFIED',reps:reps([70,68,66])}).purposeAlignment,'UNKNOWN'));
test('target deviation preserves event provenance',()=>{const x=observeRunningSessionContext({purpose:'EVEN_PACE',reps:reps([65,67])});assert.deepEqual(x.targetComparisons[1],{ordinal:2,actualSeconds:67,targetSeconds:65,deltaSeconds:2,sourceEventId:'e2'})});
test('missing rest and followup remain explicit',()=>{const x=observeRunningSessionContext({purpose:'EVEN_PACE',reps:reps([65,65])});assert.equal(x.contextAvailability.restIntervals,0);assert.ok(x.caveats.includes('FOLLOWUP_INCOMPLETE'))});
test('mixed distances prevent purpose alignment',()=>{const r=reps([65,66]);r[1].distanceMeters=200;assert.equal(observeRunningSessionContext({purpose:'EVEN_PACE',reps:r}).purposeAlignment,'UNKNOWN')});
