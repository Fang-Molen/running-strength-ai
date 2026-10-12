import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewAsOf,buildAsOfModelContext } from './prospective-evidence.ts'
import type {AthleteEvidence} from './athlete-evidence-audit.ts'
const s=(id:string,date:string,value:number,kind:AthleteEvidence['kind']='SESSION'):AthleteEvidence=>({id,date,value,kind,unit:'s',source:'SELF_REPORT',context:'400m / rest 3m'})
test('future results cannot change earlier comparison',()=>{
 const earlier=[s('a','2026-09-01',80),s('b','2026-09-08',78)]
 const base=reviewAsOf(earlier,'2026-09-09')
 const later=reviewAsOf([...earlier,s('future','2026-09-12',65)],'2026-09-09')
 assert.equal(base.comparisonStatus,'COMPARABLE_OBSERVATIONS')
 assert.equal(later.comparisonStatus,base.comparisonStatus)
 assert.equal(later.futureRecordsExcluded,1)
 assert.equal(later.visibleRecords,2)
 assert.equal(later.trainingDecisionAuthorized,false)
})
test('model context does not leak future existence or outcome',()=>{
 const earlier=[s('a','2026-09-01',80),s('b','2026-09-08',78)]
 const clean=buildAsOfModelContext(earlier,'2026-09-09')
 const later=buildAsOfModelContext([...earlier,s('SECRET_FUTURE','2026-09-12',65)],'2026-09-09')
 assert.equal(later,clean)
 assert.equal(later.includes('SECRET_FUTURE'),false)
 assert.equal(later.includes('FUTURE_RECORDS_EXCLUDED'),false)
})
test('calendar-invalid dates and invalid cutoff are rejected',()=>{
 const a=reviewAsOf([s('invalid','2026-02-30',80)],'2026-09-09')
 assert.equal(a.invalidRecords,1)
 assert.equal(a.status,'NEEDS_RECONCILIATION')
 assert.equal(reviewAsOf([], '2026-02-30').status,'INVALID_CUTOFF')
})
test('future symptom does not become a past diagnosis',()=>{
 const x=reviewAsOf([s('a','2026-09-01',80),s('b','2026-09-08',78),s('future-symptom','2026-09-20',2,'SYMPTOM')],'2026-09-09')
 assert.equal(x.reasons.includes('SYMPTOM_REPORTED'),false)
 assert.equal(x.clinicalClearance,'UNKNOWN')
})
test('past symptoms require reconciliation regardless of performance',()=>{
 const x=reviewAsOf([s('a','2026-09-01',80),s('b','2026-09-08',78),s('pain','2026-09-07',2,'SYMPTOM')],'2026-09-09')
 assert.equal(x.status,'NEEDS_RECONCILIATION')
 assert.equal(x.trainingDecisionAuthorized,false)
})
test('invalid source record never interpreted as zero or normal',()=>{
 const x=reviewAsOf([s('a','2026-09-01',80),s('b','2026-09-08',78),s('bad','not-a-date',0)],'2026-09-09')
 assert.equal(x.invalidRecords,1)
 assert.equal(x.status,'NEEDS_RECONCILIATION')
})
test('input remains untouched',()=>{
 const items=[s('a','2026-09-01',80),s('b','2026-09-08',78)]
 const old=JSON.stringify(items)
 reviewAsOf(items,'2026-09-09')
 assert.equal(JSON.stringify(items),old)
})
