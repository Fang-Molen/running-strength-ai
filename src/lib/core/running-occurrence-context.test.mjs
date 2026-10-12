import test from 'node:test';import assert from 'node:assert/strict';
import {observeOccurrenceContext} from './running-occurrence-context.ts';
/** @param {number} ordinal @param {number} seconds */
const r=(ordinal,seconds,id='s1',event=`e${ordinal}`)=>({ordinal,distanceMeters:400,seconds,sourceEventId:event,trainingOccurrenceId:id});
test('same occurrence six reps retain order and observe slowing without diagnosing',()=>{const x=observeOccurrenceContext({trainingOccurrenceId:'s1',purpose:'EVEN_PACE',reps:[r(1,65),r(2,64.5),r(3,64.8),r(4,65.5),r(5,67),r(6,69)]});assert.equal(x.observation?.sequence.transitions.length,5);assert.equal(x.observation?.sequence.firstLastDeltaSeconds,4);assert.equal(x.observation.decision,'NONE')});
test('foreign occurrence excluded',()=>{const x=observeOccurrenceContext({trainingOccurrenceId:'s1',purpose:'UNSPECIFIED',reps:[r(1,65),r(2,66,'s2')]});assert.equal(x.rejectedCount,1);assert.equal(x.observation?.sequence.status,'UNAVAILABLE')});
test('duplicate event id blocked',()=>{const x=observeOccurrenceContext({trainingOccurrenceId:'s1',purpose:'UNSPECIFIED',reps:[r(1,65),r(2,66,'s1','e1')]});assert.equal(x.status,'BLOCKED')});
test('missing id rejected',()=>assert.throws(()=>observeOccurrenceContext({trainingOccurrenceId:'',purpose:'UNSPECIFIED',reps:[]})));
test('different distances not compared',()=>{const a=r(1,65),b={...r(2,90),distanceMeters:600};const x=observeOccurrenceContext({trainingOccurrenceId:'s1',purpose:'UNSPECIFIED',reps:[a,b]});assert.equal(x.observation?.sequence.status,'UNAVAILABLE')});
