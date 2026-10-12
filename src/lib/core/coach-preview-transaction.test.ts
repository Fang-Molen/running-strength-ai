import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPreviewPlanChange, rollbackPreviewPlanChange, type PreviewState } from './coach-preview-transaction.ts'
import type { CoachPlanProposalInput } from './coach-plan-governance.ts'
import type { PreviewPermission } from './coach-permission-gate.ts'
const date = '2026-10-10T10:00:00Z'
const state = (): PreviewState => ({ plans: { p1: { id:'p1', revision:1, session:{ repeats:6, distanceMeters:400, intensity:'HARD' }, completed:false } }, audit:[] })
const input = (): CoachPlanProposalInput => ({ planId:'p1', daysAhead:1, expectedRevision:1, actualRevision:1, reason:'减少训练量', evidenceIds:['rpe:1'], nextSessionIntensity:'HARD', proposedAction:'REDUCE', userRequestedChange:true, session:{repeats:6,distanceMeters:400,intensity:'HARD'} })
const permission = (): PreviewPermission => ({ previewMode:true, ownerApprovedUnlock:true, athleteConfirmed:true, confirmationProposalId:'proposal:p1:1', originalPlanPreserved:true, originalPlanRevision:1, planChangeKind:'NEAR_TERM', medicalReviewRequired:false })
const reduced = { repeats:4, distanceMeters:400, intensity:'HARD' as const }
test('confirmed preview edit produces revision and immutable audit snapshot', () => { const s=state(); const r=applyPreviewPlanChange(s,input(),permission(),reduced,date); assert.equal(r.ok,true); if(!r.ok)return; assert.equal(r.state.plans.p1.revision,2); assert.equal(r.state.plans.p1.session.repeats,4); assert.equal(r.state.audit.length,1); assert.equal(s.plans.p1.session.repeats,6) })
test('without confirmation no mutation',()=>{const s=state(); const p=permission(); p.athleteConfirmed=false; const r=applyPreviewPlanChange(s,input(),p,reduced,date); assert.equal(r.ok,false); assert.equal(r.state,s)})
test('without preview unlock no mutation',()=>{const p=permission(); p.previewMode=false; assert.equal(applyPreviewPlanChange(state(),input(),p,reduced,date).ok,false)})
test('completed sessions are immutable',()=>{const s=state(); s.plans.p1.completed=true; assert.equal(applyPreviewPlanChange(s,input(),permission(),reduced,date).ok,false)})
test('reject stale revision',()=>{const s=state(); s.plans.p1.revision=2; assert.equal(applyPreviewPlanChange(s,input(),permission(),reduced,date).ok,false)})
test('reject increased volume even if action labeled REDUCE',()=>{assert.equal(applyPreviewPlanChange(state(),input(),permission(),{repeats:8,distanceMeters:400,intensity:'HARD'},date).ok,false)})
test('reject high volume despite safe original proposal',()=>{assert.equal(applyPreviewPlanChange(state(),input(),permission(),{repeats:200,distanceMeters:400,intensity:'HARD'},date).ok,false)})
test('reject bone pain',()=>{const i=input(); i.injurySignals={focalBonePain:true,alteredGait:false,painDuringRunning:true}; assert.equal(applyPreviewPlanChange(state(),i,permission(),reduced,date).ok,false)})
test('rollback creates new revision without erasing audit',()=>{const r=applyPreviewPlanChange(state(),input(),permission(),reduced,date); assert.equal(r.ok,true); if(!r.ok)return; const undone=rollbackPreviewPlanChange(r.state,r.audit.id,date); assert.equal(undone.ok,true); if(!undone.ok)return; assert.equal(undone.state.plans.p1.revision,3); assert.equal(undone.state.plans.p1.session.repeats,6); assert.equal(undone.state.audit.length,2)})
test('rollback refuses overwrite of newer changes',()=>{const r=applyPreviewPlanChange(state(),input(),permission(),reduced,date); if(!r.ok)throw Error('setup'); const s=r.state; s.plans.p1={...s.plans.p1,revision:3}; assert.equal(rollbackPreviewPlanChange(s,r.audit.id,date).ok,false)})
