import test from 'node:test'
import assert from 'node:assert/strict'
import {request} from '../../../evaluation/r6/fixtures.ts'
import {reviewWithOneRepair} from './coach-output-retry'
test('R11 mock repair has at most one attempt, retains failure and safe fallback',async()=>{
 let count=0;const result=await reviewWithOneRepair(request([],undefined,undefined,'训练原则'),'not json',async()=>{count++;return 'still invalid'})
 assert.equal(count,1);assert.equal(result.repair.attempts,1);assert.equal(result.repair.failed,true);assert.ok(result.turn.text.length>30)
})
test('R11 emergency bypasses even the repair callback',async()=>{
 const result=await reviewWithOneRepair(request([],undefined,undefined,'队友刚跑完胸口痛还晕倒'),'not json',async()=>{throw Error('MUST_NOT_CALL')})
 assert.equal(result.repair.attempts,0);assert.match(result.turn.text,/120/);assert.equal(result.turn.nextStep,null)
})
