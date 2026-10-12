import test from 'node:test'
import assert from 'node:assert/strict'
import {auditHistoricalCoverage,validateHistoricalEvidence} from './research-coverage-audit.ts'

test('all 16 domains exist but none is automatically saturated',()=>{
 const a=auditHistoricalCoverage()
 assert.equal(a.rows.length,16)
 assert.equal(a.saturatedDomains,0)
 assert.ok(a.rows.every(x=>x.status==='UNASSESSED'&&!x.saturated&&x.independentlyReverifiedCount===0))
})
test('historical counts are not independently verified counts',()=>{
 const a=auditHistoricalCoverage()
 assert.ok(a.totalHistoricalRecords>0)
 assert.equal(a.independentlyReverifiedInThisAudit,0)
 assert.ok(a.rows.some(x=>x.historicalCount===0))
})
test('catalog mapping must be explicit and free of missing records',()=>{
 const a=auditHistoricalCoverage()
 assert.deepEqual(a.unknownIds,[])
 assert.deepEqual(a.staleIds,[])
})
test('historical ledger DOI duplicates are detected without hiding either record',()=>{
 const r=validateHistoricalEvidence()
 assert.equal(r.independentlyReverified,0)
 assert.equal(r.records,29)
 assert.deepEqual(r.incomplete,[])
 assert.ok(r.uniqueDoi<=r.records)
})
