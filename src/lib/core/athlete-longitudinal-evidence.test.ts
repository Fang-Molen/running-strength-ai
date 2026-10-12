import test from 'node:test'
import assert from 'node:assert/strict'
import {projectAthleteEvidence} from './athlete-longitudinal-evidence.ts'
import type {AthleteEvidence} from './athlete-evidence-audit.ts'
const record=(id:string,kind:AthleteEvidence['kind'],date:string,value:number|null):AthleteEvidence=>({id,kind,date,value,source:'SELF_REPORT',unit:'s'})
test('sorts records by date without changing caller data',()=>{
 const input=[record('b','SESSION','2026-10-09',120),record('a','SESSION','2026-10-01',140)]
 const out=projectAthleteEvidence(input)
 assert.deepEqual(out.ordered.map(x=>x.id),['a','b']);assert.equal(input[0].id,'b');assert.equal(out.latestByKind.SESSION?.id,'b')
})
test('conflicting same-id records are quarantined',()=>{
 const out=projectAthleteEvidence([record('x','SESSION','2026-10-09',120),record('x','SESSION','2026-10-09',130)])
 assert.deepEqual(out.quarantinedIds,['x']);assert.equal(out.latestByKind.SESSION,undefined);assert.equal(out.conflicts[0].reason,'SAME_ID_DIFFERENT_FACT')
})
test('conflicting same-date PB cannot silently determine current performance',()=>{
 const out=projectAthleteEvidence([record('p1','PB','2026-09-01',960),record('p2','PB','2026-09-01',970)])
 assert.equal(out.ordered.length,0);assert.equal(out.currentPerformanceKnown,false);assert.equal(out.trainingDecisionAuthorized,false)
})
test('invalid calendar dates rejected, including February 30',()=>{
 const out=projectAthleteEvidence([record('bad','SESSION','2026-02-30',100),record('good','SESSION','2026-02-28',100)])
 assert.deepEqual(out.ordered.map(x=>x.id),['good']);assert.equal(out.rejected[0].id,'bad')
})
test('unknown recovery is not inferred from fast intervals',()=>{
 const out=projectAthleteEvidence([record('run','SESSION','2026-10-10',142)])
 assert.ok(out.missing.includes('NO_UNCONFLICTED_RECOVERY'));assert.equal(out.currentPerformanceKnown,false)
})
test('duplicate identical evidence is idempotent',()=>{
 const x=record('a','SESSION','2026-10-10',100)
 const out=projectAthleteEvidence([x,x]);assert.equal(out.ordered.length,1);assert.equal(out.conflicts.length,0)
})
