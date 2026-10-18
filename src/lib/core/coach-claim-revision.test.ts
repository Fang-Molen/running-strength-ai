import test from 'node:test';
import assert from 'node:assert/strict';
import {auditClaimCorrection,safetyCandidateGate,type AuditedClaim,type VersionedFact,type FieldCorrection} from './coach-claim-revision.ts';
const old:VersionedFact={sourceId:'S-250',revision:1,origin:'DEVICE',fieldPaths:['repsSeconds','recoveryMinutes','completionStatus']};
const change:FieldCorrection={sourceId:'S-250',fromRevision:1,toRevision:2,sourceOrigin:'DEVICE',changedFieldPaths:['repsSeconds[2]']};
const claim:AuditedClaim={claimId:'fatigue',status:'ACTIVE_HYPOTHESIS',dependencies:[{sourceId:'S-250',revision:1,fieldPaths:['repsSeconds']}],candidateIds:['add-intensity']};
test('same-source last rep correction flags dependent hypothesis and its dose candidate only',()=>{
 const r=auditClaimCorrection(claim,old,change);
 assert.equal(r.status,'STALE_NEEDS_REVIEW');assert.equal(r.updateAction,'MARK_STALE');
 assert.deepEqual(r.affectedPaths,['repsSeconds[2]']);assert.deepEqual(r.invalidatedCandidateIds,['add-intensity']);
 assert.equal(r.planWriteAuthorized,false);
});
test('completions and recovery remain valid after last-rep timing correction',()=>{
 for(const path of ['completionStatus','recoveryMinutes']){
  const x=auditClaimCorrection({...claim,claimId:path,status:'SUPPORTED_FACT',dependencies:[{sourceId:'S-250',revision:1,fieldPaths:[path]}],candidateIds:[]},old,change);
  assert.equal(x.updateAction,'KEEP');assert.equal(x.status,'SUPPORTED_FACT');
 }
});
test('new independent race cannot revise old training and unrelated prefix paths do not match',()=>{
 assert.equal(auditClaimCorrection(claim,old,{...change,sourceId:'S-800-NEW'}).updateAction,'REVIEW_REQUIRED');
 const c={...claim,dependencies:[{sourceId:'S-250',revision:1,fieldPaths:['repsSecondsExtra']}]};
 assert.equal(auditClaimCorrection(c,old,change).updateAction,'KEEP');
});
test('orphan correction cannot be promoted to verified device event',()=>{
 assert.equal(auditClaimCorrection(claim,null,change).reason,'SOURCE_CHAIN_NOT_VERIFIED');
 const report:VersionedFact={...old,origin:'USER_REPORT'};
 assert.equal(auditClaimCorrection(claim,report,change).updateAction,'REVIEW_REQUIRED');
});
test('unrelated revision or malformed correction is review required',()=>{
 assert.equal(auditClaimCorrection(claim,old,{...change,fromRevision:0}).updateAction,'REVIEW_REQUIRED');
 assert.equal(auditClaimCorrection(claim,old,{...change,changedFieldPaths:['__proto__.x;y']}).updateAction,'REVIEW_REQUIRED');
});
test('already closed claim is not reactivated and safety never clears plan',()=>{
 assert.equal(auditClaimCorrection({...claim,status:'RETRACTED'},old,change).status,'RETRACTED');
 assert.deepEqual(safetyCandidateGate(true,['c1','c1','c2']).blockedCandidateIds,['c1','c2']);
 assert.equal(safetyCandidateGate(false,['c1']).medicalClearanceProvided,false);
});

test('claims without dependency chains are unresolved; revisions cannot go backwards',()=>{
 assert.equal(auditClaimCorrection({...claim,dependencies:[]},old,change).updateAction,'REVIEW_REQUIRED');
 assert.equal(auditClaimCorrection(claim,old,{...change,toRevision:0}).updateAction,'REVIEW_REQUIRED');
});
