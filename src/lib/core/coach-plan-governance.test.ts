import assert from 'node:assert/strict'
import test from 'node:test'
import { proposeCoachPlanChange } from './coach-plan-governance.ts'
const base = { planId:'cycle-A', daysAhead:1, expectedRevision:2, actualRevision:2, reason:'coach review', evidenceIds:['session-1'], nextSessionIntensity:'HARD' as const, proposedAction:'REPLACE' as const, userRequestedChange:true }
test('200 x 400 hard repeats are flagged (80km)',()=>{ const p=proposeCoachPlanChange({...base,session:{repeats:200,distanceMeters:400,intensity:'HARD'}}); assert.equal(p.plannedFastMeters,80000); assert.equal(p.status,'CLARIFY_EXTREME_SESSION'); assert.equal(p.canApplyAutomatically,false) })
test('injury risk blocks high intensity even with consent',()=>{ const p=proposeCoachPlanChange({...base,injurySignals:{painDuringRunning:true,focalBonePain:false,alteredGait:false}}); assert.equal(p.status,'BLOCK_FOR_SAFETY') })
test('focal bone pain blocks',()=>{ assert.equal(proposeCoachPlanChange({...base,injurySignals:{painDuringRunning:false,focalBonePain:true,alteredGait:false}}).status,'BLOCK_FOR_SAFETY') })
test('normal changes require confirmation',()=>{ assert.equal(proposeCoachPlanChange({...base,session:{repeats:6,distanceMeters:400,intensity:'HARD'}}).status,'AWAIT_USER_CONFIRMATION') })
test('stale revision cannot overwrite newer plan',()=>{ assert.equal(proposeCoachPlanChange({...base,actualRevision:3}).status,'REJECT_CONFLICT') })
test('future cycle requires review',()=>{ assert.equal(proposeCoachPlanChange({...base,daysAhead:12}).status,'REPLAN_REVIEW') })
test('invalid workout rejected',()=>{ assert.throws(()=>proposeCoachPlanChange({...base,session:{repeats:-2,distanceMeters:400,intensity:'HARD'}})) })
test('deduplicates evidence and does not write',()=>{ const p=proposeCoachPlanChange({...base,evidenceIds:['a','a']}); assert.deepEqual(p.evidenceIds,['a']); assert.equal(p.requiresUserConfirmation,true) })
