import test from 'node:test'
import assert from 'node:assert/strict'
import {auditConflictSourceLinks,retrieveConflictSourceStatus} from './research-conflict-index.ts'
import {buildCurriculumModelContext,CURRICULUM_SYSTEM_BOUNDARY} from './coach-curriculum.ts'
test('all conflict review source identifiers resolve in the historical ledger',()=>{
 const a=auditConflictSourceLinks()
 assert.deepEqual(a.missingSourceIds,[])
 assert.equal(a.uniqueLinkedSourceCount,7)
 assert.equal(a.links.length,7)
 assert.equal(a.independentlyReverified,0)
 assert.equal(a.adjudicationAuthorized,false)
})
test('RED-S response is metadata-only and cannot be promoted to substantive verified evidence',()=>{
 const a=auditConflictSourceLinks()
 assert.ok(a.metadataOnlyIds.includes('R7-008'))
 const status=retrieveConflictSourceStatus('RED-S',4)
 assert.equal(status.length,1)
 assert.ok(status[0].sourceLinks.some(x=>x.sourceId==='R7-008'&&x.metadataOnly&&x.reportedVerification==='METADATA_ONLY_NO_ABSTRACT'))
 assert.equal(status[0].fullySupportedByReverifiedPapers,false)
})
test('source integrity is visible to model context without permitting decision authority',()=>{
 const c=buildCurriculumModelContext('RED-S 能否诊断？',10000)
 assert.ok(c.conflictSourceAudit.metadataOnlyIds.includes('R7-008'))
 assert.equal(c.conflictSourceAudit.adjudicationAuthorized,false)
 assert.match(CURRICULUM_SYSTEM_BOUNDARY,/conflictSourceAudit/)
})
test('source integrity cannot be modified through retrieved status',()=>{
 const a=retrieveConflictSourceStatus('RED-S')
 Reflect.set(a[0].sourceLinks[0],'sourceId','changed')
 assert.notEqual(retrieveConflictSourceStatus('RED-S')[0].sourceLinks[0].sourceId,'changed')
})
