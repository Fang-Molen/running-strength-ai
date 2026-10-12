import test from 'node:test'
import assert from 'node:assert/strict'
import {HISTORICAL_TOPICS,canonicalDoi,reconcileImportedDoi,auditHistoricalTopicGaps} from './research-history-reconciliation.ts'

test('normalizes DOI identity without claiming verification',()=>{
 assert.equal(canonicalDoi(' HTTPS://DOI.ORG/10.1007/S40279-023-01931-Z '),'10.1007/s40279-023-01931-z')
 assert.equal(canonicalDoi('doi:10.1186/s40798-019-0221-0'),'10.1186/s40798-019-0221-0')
 assert.equal(canonicalDoi('not a doi'),null)
 assert.equal(canonicalDoi(null),null)
})
test('reconciles imported R3 and R4-R7 records without discarding collisions',()=>{
 const x=reconcileImportedDoi()
 assert.equal(x.records,31)
 assert.equal(x.independentlyReverified,0)
 assert.equal(x.historicalSourceCompleteness,'PARTIAL')
 assert.equal(x.uniqueValidDoi+x.missing.length+x.malformed.length+x.duplicates.reduce((s,d)=>s+d.entries.length-1,0),x.records)
})
test('four missing mapped domains are represented as author topics not new papers',()=>{
 const a=auditHistoricalTopicGaps()
 assert.equal(a.domains.length,16)
 assert.deepEqual(HISTORICAL_TOPICS.map(x=>x.domainIndex),[2,4,6,8])
 assert.ok(HISTORICAL_TOPICS.every(x=>!x.independentPaperVerification&&!x.decisionAuthorization&&x.evidenceStatus==='AUTHOR_SYNTHESIS_NOT_PAPER'))
 assert.equal(a.independentlyVerifiedPapersAdded,0)
 assert.equal(a.scientificSaturationAchieved,false)
})
test('historical method coverage never sets domain saturation',()=>{
 const a=auditHistoricalTopicGaps()
 assert.ok(a.domains.every(x=>x.saturated===false&&x.independentlyVerifiedPapersAdded===0))
})
