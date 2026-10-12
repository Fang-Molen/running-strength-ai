import test from 'node:test'
import assert from 'node:assert/strict'
import {compareLongitudinalSessions} from './longitudinal-comparability.ts'
import type {AthleteEvidence} from './athlete-evidence-audit.ts'
const s=(id:string,date:string,value:number|null,unit='s',context='400m track interval / 3min rest',source:AthleteEvidence['source']='SELF_REPORT'):AthleteEvidence=>({id,kind:'SESSION',date,value,unit,context,source})
test('comparable measurements never establish causal adaptation',()=>{
 const r=compareLongitudinalSessions([s('b','2026-10-10',75),s('a','2026-10-01',78)])
 assert.equal(r.status,'COMPARABLE_OBSERVATIONS');assert.equal(r.delta,-3);assert.equal(r.firstId,'a')
 assert.equal(r.causalTrainingEffect,'UNKNOWN');assert.equal(r.performanceImproved,'UNKNOWN');assert.equal(r.trainingDecisionAuthorized,false)
})
test('different workout protocols cannot be compared',()=>{
 const r=compareLongitudinalSessions([s('a','2026-10-01',78),s('b','2026-10-10',74,'s','800m time trial')])
 assert.equal(r.status,'NOT_COMPARABLE');assert.ok(r.reasons.includes('PROTOCOL_CONTEXT_MISMATCH'));assert.equal(r.delta,undefined)
})
test('units and device provenance must match',()=>{
 const r=compareLongitudinalSessions([s('a','2026-10-01',78),s('b','2026-10-10',74000,'ms','400m track interval / 3min rest','DEVICE')])
 assert.ok(r.reasons.includes('UNIT_MISMATCH'));assert.ok(r.reasons.includes('SOURCE_MISMATCH'))
})
test('missing protocol blocks comparisons',()=>{
 const r=compareLongitudinalSessions([s('a','2026-10-01',78,'s',''),s('b','2026-10-10',75)])
 assert.ok(r.reasons.includes('MISSING_PROTOCOL_CONTEXT'))
})
test('conflicting duplicate ids are quarantined',()=>{
 const r=compareLongitudinalSessions([s('a','2026-10-01',78),s('a','2026-10-01',74),s('b','2026-10-10',75)])
 assert.equal(r.status,'INSUFFICIENT_EVIDENCE');assert.ok(r.reasons.includes('QUARANTINED_CONFLICTS'))
})
test('one-day comparison is not longitudinal evidence',()=>{
 const r=compareLongitudinalSessions([s('a','2026-10-10',78),s('b','2026-10-10',75)])
 assert.ok(r.reasons.includes('SAME_DAY_ONLY'))
})
test('input remains unchanged and no training authority granted',()=>{
 const items=[s('a','2026-10-01',78),s('b','2026-10-10',75)],before=JSON.stringify(items)
 const r=compareLongitudinalSessions(items)
 assert.equal(JSON.stringify(items),before);assert.equal(r.trainingDecisionAuthorized,false)
})
