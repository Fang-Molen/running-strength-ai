import test from 'node:test'
import assert from 'node:assert/strict'
import {reviewFormalEvidence,strictIso,type FormalEvidenceRow} from './coach-v4-c11-adapter.ts'
import {guardV4Turn} from './coach-v4-c14-guard.ts'

const snapshot=()=>reviewFormalEvidence({athleteId:'work-synthetic',asOf:'2026-10-05T12:00:00Z',question:'一般训练知识',rows:[]}).audit.snapshot
for(const [label,nextStep,flag] of [
 ['saved','我已经为你保存了训练计划。','POSSIBLE_UNAUTHORIZED_WRITE'],
 ['referral','无需就医，也不用找医生评估。','NEGATED_REFERRAL'],
 ['internal','sourceId 是 internal-123','INTERNAL_FIELD_LEAK'],
] as const)test(`Work guard audits nextStep ${label}`,()=>{
 const out=guardV4Turn(snapshot(),'一般训练知识',{mode:'answer',text:'资料不足，需要核对。',citations:[],nextStep,medicalReferral:false})
 assert.equal(out.status,'SAFE_FALLBACK_REQUIRES_REVIEW');assert.ok(out.flags.includes(flag));assert.equal(out.nextStep,null)
})
test('Work valid referral nextStep remains visible and retains referral status',()=>{
 const nextStep='请咨询运动医学医生进行专业评估。'
 const out=guardV4Turn(snapshot(),'一般训练知识',{mode:'ask',text:'请先核对情况。',citations:[],nextStep,medicalReferral:true})
 assert.equal(out.status,'PASSED_STRUCTURAL_GUARD');assert.equal(out.nextStep,nextStep);assert.equal(out.medicalReferral,true)
})
test('Work third-party symptom does not become personal risk',()=>{
 const row:FormalEvidenceRow={recordId:'third-party',athleteId:'work-synthetic',trainingOccurrenceId:'s',sourceEventId:'e',source:'THIRD_PARTY',status:'OBSERVED',metric:'PAIN_SCORE',value:4,unit:'score',protocol:'pain',occurredAt:'2026-10-01T09:00:00Z',knownAt:'2026-10-01T10:00:00Z',verifiedByFormalProjection:false}
 const out=reviewFormalEvidence({athleteId:'work-synthetic',asOf:'2026-10-05T12:00:00Z',question:'一般训练知识',rows:[row]})
 assert.equal(out.safety,'NONE');assert.deepEqual(out.adapter.unverifiedRiskHints,[]);assert.equal(out.audit.snapshot.active.length,0)
})
test('Work ISO timestamp rejects rollover hours and invalid offsets',()=>{
 for(const s of ['2026-10-01T24:00:00Z','2026-10-01T24:00:00.000Z','2026-10-01T12:00:00+24:00','2026-10-01T12:00:00+08:60'])assert.equal(strictIso(s),false,s)
 assert.equal(strictIso('2026-10-01T23:59:59+08:00'),true)
})
