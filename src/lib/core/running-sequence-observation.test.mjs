import test from 'node:test'; import assert from 'node:assert/strict';
import {observeRunningSequence} from './running-sequence-observation.ts';
/** @param {number} n @param {number|null} s */
const rep=(n,s,d=400)=>({ordinal:n,seconds:s,distanceMeters:d,sourceEventId:`e${n}`});
test('400 x 6 preserves order and detects slowing without fatigue inference',()=>{const x=observeRunningSequence([65,64.5,64.8,65.5,67,69].map((s,i)=>rep(i+1,s)));assert.equal(x.status,'AVAILABLE');assert.equal(x.transitions.length,5);assert.equal(x.firstLastDeltaSeconds,4);assert.equal(x.pattern,'MIXED');assert.equal(x.interpretation,'OBSERVATION_ONLY')});
test('progressive acceleration is observed, not penalized',()=>assert.equal(observeRunningSequence([70,69,68].map((s,i)=>rep(i+1,s))).pattern,'FASTER'));
test('missing evidence never becomes zero',()=>{const x=observeRunningSequence([rep(1,65),{...rep(2,66),seconds:null},rep(3,67)]);assert.equal(x.status,'UNAVAILABLE');assert.equal(x.firstLastDeltaSeconds,2)});
test('different distances are not compared',()=>assert.equal(observeRunningSequence([rep(1,65),rep(2,35,200)]).status,'UNAVAILABLE'));
test('duplicate ordinal is rejected',()=>assert.equal(observeRunningSequence([rep(1,65),rep(1,66)]).status,'UNAVAILABLE'));
test('stable timings respect explicit tolerance',()=>assert.equal(observeRunningSequence([rep(1,65),rep(2,65.1)],.2).pattern,'STABLE'));
