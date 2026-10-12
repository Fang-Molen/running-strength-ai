import test from 'node:test'
import assert from 'node:assert/strict'
import {snapshotKnownEvents,buildKnownAtModelContext,type KnownEvent} from './asof-event-ledger.ts'
const event=(eventId:string,observedAt:string,date:string,value:number,operation:KnownEvent['operation']='ASSERT',replacesEventId?:string):KnownEvent=>({eventId,observedAt,operation,replacesEventId,fact:{id:'session-1',kind:'SESSION',date,value,unit:'s',context:'400m rest 3m',source:'SELF_REPORT'}})
const before='2026-09-05T12:00:00+08:00'
test('backdated records not available at historical cutoff are excluded',()=>{
 const e=event('later-upload','2026-09-10T10:00:00+08:00','2026-09-01',65)
 const snap=snapshotKnownEvents([e],before)
 assert.equal(snap.facts.length,0)
 assert.equal(snap.hiddenFutureEventCount,1)
 assert.equal(buildKnownAtModelContext([e],before),buildKnownAtModelContext([],before))
})
test('late correction cannot rewrite earlier known facts',()=>{
 const old=event('v1','2026-09-02T09:00:00+08:00','2026-09-01',78)
 const newer=event('v2','2026-09-10T10:00:00+08:00','2026-09-01',75,'CORRECT','v1')
 assert.equal(snapshotKnownEvents([old,newer],before).facts[0].value,78)
 assert.equal(snapshotKnownEvents([old,newer],'2026-09-11T12:00:00+08:00').facts[0].value,75)
})
test('retraction applies only after recorded',()=>{
 const old=event('v1','2026-09-02T09:00:00+08:00','2026-09-01',78)
 const remove=event('v2','2026-09-10T10:00:00+08:00','2026-09-01',78,'RETRACT','v1')
 assert.equal(snapshotKnownEvents([old,remove],before).facts.length,1)
 assert.equal(snapshotKnownEvents([old,remove],'2026-09-11T12:00:00+08:00').facts.length,0)
})
test('orphan correction quarantined, no silent overwrite',()=>{
 const correction=event('v2','2026-09-03T09:00:00+08:00','2026-09-01',75,'CORRECT','missing')
 const snap=snapshotKnownEvents([correction],before)
 assert.equal(snap.facts.length,0)
 assert.equal(snap.status,'NEEDS_RECONCILIATION')
 assert.ok(snap.issues.includes('INVALID_REVISION_CHAIN'))
})
test('conflicting corrections quarantined',()=>{
 const old=event('v1','2026-09-02T09:00:00+08:00','2026-09-01',78)
 const a=event('v2','2026-09-03T09:00:00+08:00','2026-09-01',75,'CORRECT','v1')
 const b=event('v3','2026-09-03T10:00:00+08:00','2026-09-01',74,'CORRECT','v1')
 const snap=snapshotKnownEvents([old,a,b],before)
 assert.equal(snap.facts.length,0)
 assert.ok(snap.issues.includes('CONFLICTING_REVISIONS'))
})
test('no future symptom, record ID or future event count in model context',()=>{
 const future=event('FUTURE_SECRET','2026-09-10T10:00:00+08:00','2026-09-01',65)
 const context=buildKnownAtModelContext([future],before)
 assert.equal(context.includes('FUTURE_SECRET'),false)
 assert.equal(context.includes('hiddenFutureEventCount'),false)
 assert.equal(context.includes('65'),false)
})
test('invalid cutoff and invalid date are quarantined',()=>{
 assert.equal(snapshotKnownEvents([], 'not-a-date').status,'INVALID_CUTOFF')
 const bad=event('bad','2026-09-02T09:00:00+08:00','2026-02-30',75)
 assert.ok(snapshotKnownEvents([bad],before).issues.includes('INVALID_EVENT_QUARANTINED'))
})
test('input not mutated and never authorizes clinical or training action',()=>{
 const items=[event('v1','2026-09-02T09:00:00+08:00','2026-09-01',78)]
 const original=JSON.stringify(items)
 const snap=snapshotKnownEvents(items,before)
 assert.equal(JSON.stringify(items),original)
 assert.equal(snap.trainingDecisionAuthorized,false)
 assert.equal(snap.clinicalClearance,'UNKNOWN')
})
