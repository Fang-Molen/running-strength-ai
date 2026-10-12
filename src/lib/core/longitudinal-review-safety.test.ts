import test from 'node:test'
import assert from 'node:assert/strict'
import {reviewLongitudinalTraining,buildLongitudinalReviewContext} from './longitudinal-review.ts'
import type {AthleteEvidence} from './athlete-evidence-audit.ts'
const s=(id:string,date:string,value:number):AthleteEvidence=>({id,kind:'SESSION',date,value,unit:'s',context:'400m interval, 3min rest',source:'SELF_REPORT'})
const pair=[s('a','2026-10-01',78),s('b','2026-10-10',75)]
test('symptom overrides a superficially comparable improvement',()=>{
 const r=reviewLongitudinalTraining([...pair,{id:'pain',kind:'SYMPTOM',date:'2026-10-10',value:4,source:'SELF_REPORT'}])
 assert.equal(r.status,'NEEDS_RECONCILIATION');assert.ok(r.issues.includes('SYMPTOM_REPORTED'))
 assert.equal(r.trainingDecisionAuthorized,false)
})
test('missing symptom report is unknown, not a clean bill of health',()=>{
 const r=reviewLongitudinalTraining(pair)
 assert.ok(r.issues.includes('MISSING_SYMPTOM_ASSESSMENT'))
 assert.equal(r.clinicalClearance,'UNKNOWN')
})
test('small context budget preserves all safety issues',()=>{
 const input:AthleteEvidence[]=[...pair,{id:'pain',kind:'SYMPTOM',date:'2026-10-10',value:4,source:'SELF_REPORT'}]
 const x=JSON.parse(buildLongitudinalReviewContext(input,400))
 assert.equal(x.trainingDecisionAuthorized,false)
 assert.equal(x.clinicalClearance,'UNKNOWN')
 assert.ok(x.issues.includes('SYMPTOM_REPORTED')||x.issues.includes('CONTEXT_BUDGET_EXCEEDED'))
})
test('invalid record and conflict are not silently omitted by compression',()=>{
 const input:AthleteEvidence[]=[...pair,s('a','2026-10-01',73),s('bad','2026-02-30',77)]
 const x=JSON.parse(buildLongitudinalReviewContext(input,400))
 assert.equal(x.trainingDecisionAuthorized,false)
 assert.equal(x.status,'NEEDS_RECONCILIATION')
 assert.ok(x.issues.includes('CONTEXT_BUDGET_EXCEEDED')||x.issues.includes('QUARANTINED_CONFLICTS'))
})
test('model context contains no athlete raw IDs, dates, or times',()=>{
 const x=buildLongitudinalReviewContext(pair,1600)
 for(const token of ['2026-10-01','2026-10-10','"a"','"b"'])assert.ok(!x.includes(token))
})
