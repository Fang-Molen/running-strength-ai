import test from 'node:test'
import assert from 'node:assert/strict'
import {RESEARCH_DOMAINS,RESEARCH_SEED,auditResearchEntries,researchCoverage,retrieveResearchCandidates} from './research-knowledge-registry.ts'
test('16 domains are enumerated without claiming saturation',()=>{
  assert.equal(RESEARCH_DOMAINS.length,16)
  assert.equal(new Set(RESEARCH_DOMAINS).size,16)
  const coverage=researchCoverage(RESEARCH_SEED)
  assert.equal(coverage.length,16)
  assert.ok(coverage.every(x=>x.saturated===false && x.status==='NOT_ASSESSED'))
})
test('research seeds preserve source provenance and cannot authorize training',()=>{
  assert.equal(auditResearchEntries(RESEARCH_SEED).ok,true)
  assert.ok(RESEARCH_SEED.every(e=>e.decisionAuthorized===false && e.sourceProvenance.includes('继承R3')))
})
test('duplicate DOI is rejected regardless of URL form',()=>{
  const duplicate={...RESEARCH_SEED[0],id:'copy',doi:'https://doi.org/10.1186/s40798-019-0221-0'}
  assert.ok(auditResearchEntries([...RESEARCH_SEED,duplicate]).issues.includes('copy:DUPLICATE_DOI'))
})
test('source candidates are not user facts or prescriptions',()=>{
  const candidates=retrieveResearchCandidates('400米掉速')
  assert.equal(candidates.length,1)
  assert.equal(candidates[0].decisionAuthorized,false)
  assert.equal(retrieveResearchCandidates('未匹配的主题').length,0)
})
