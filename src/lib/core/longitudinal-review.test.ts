import test from 'node:test'
import assert from 'node:assert/strict'
import {reviewLongitudinalTraining,buildLongitudinalReviewContext} from './longitudinal-review.ts'
import type {AthleteEvidence} from './athlete-evidence-audit.ts'
const s=(id:string,date:string,value:number|null,context='400m interval, 3min rest',source:AthleteEvidence['source']='SELF_REPORT'):AthleteEvidence=>({id,kind:'SESSION',date,value,unit:'s',context,source})
test('two matching sessions are only comparable observations, never a training prescription',()=>{
 const r=reviewLongitudinalTraining([s('a','2026-10-01',78),s('b','2026-10-10',75)])
 assert.equal(r.status,'REVIEWABLE');assert.equal(r.comparison.delta,-3)
 assert.equal(r.trainingAdaptation,'UNKNOWN');assert.equal(r.trainingDecisionAuthorized,false)
})
test('mixed training protocols block direct trend',()=>{
 const r=reviewLongitudinalTraining([s('a','2026-10-01',78),s('b','2026-10-10',75,'800m time trial')])
 assert.equal(r.status,'NEEDS_RECONCILIATION');assert.ok(r.issues.includes('PROTOCOL_CONTEXT_MISMATCH'))
})
test('conflicting corrected records cannot be silently selected',()=>{
 const r=reviewLongitudinalTraining([s('a','2026-10-01',78),s('a','2026-10-01',72),s('b','2026-10-10',75)])
 assert.equal(r.status,'NEEDS_RECONCILIATION');assert.ok(r.issues.includes('QUARANTINED_CONFLICTS'))
})
test('symptoms remain safety review even if performance improves',()=>{
 const symptom:AthleteEvidence={id:'pain',kind:'SYMPTOM',date:'2026-10-10',value:4,unit:'self-report',source:'SELF_REPORT'}
 const r=reviewLongitudinalTraining([s('a','2026-10-01',78),s('b','2026-10-10',75),symptom])
 assert.ok(r.issues.includes('SYMPTOM_REPORTED'));assert.equal(r.clinicalClearance,'UNKNOWN')
})
test('missing recovery is not converted to recovered',()=>{
 const r=reviewLongitudinalTraining([s('a','2026-10-01',78),s('b','2026-10-10',75)])
 assert.ok(r.issues.includes('MISSING_RECOVERY'))
})
test('invalid dates are rejected rather than included',()=>{
 const r=reviewLongitudinalTraining([s('a','2026-02-30',78),s('b','2026-10-10',75)])
 assert.equal(r.status,'NEEDS_RECONCILIATION');assert.ok(r.issues.includes('REJECTED_INVALID_RECORDS'))
})
test('input is not modified and context is bounded',()=>{
 const records=[s('a','2026-10-01',78),s('b','2026-10-10',75)]
 const before=JSON.stringify(records)
 for(const n of [400,650,1200]){const c=buildLongitudinalReviewContext(records,n);assert.ok(c.length<=n);assert.equal(JSON.parse(c).trainingDecisionAuthorized,false)}
 assert.equal(JSON.stringify(records),before)
})
test('no session data is insufficient, not a negative outcome',()=>{
 const r=reviewLongitudinalTraining([])
 assert.equal(r.status,'INSUFFICIENT');assert.equal(r.trainingAdaptation,'UNKNOWN')
})
