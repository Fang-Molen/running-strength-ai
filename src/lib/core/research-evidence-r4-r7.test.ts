import assert from 'node:assert/strict'
import test from 'node:test'
import { ARCHIVED_RESEARCH, selectArchivedResearch } from './research-evidence-r4-r7.ts'
import { retrieveCognitionKnowledge } from './coach-cognition-knowledge.ts'

test('R4–R7 archive imports 29 unique research records without granting prescriptions', () => {
  assert.equal(ARCHIVED_RESEARCH.length, 29)
  assert.equal(new Set(ARCHIVED_RESEARCH.map(r=>r.id)).size, 29)
  const dois=ARCHIVED_RESEARCH.map(r=>r.doi.toLowerCase()).filter(Boolean)
  assert.equal(new Set(dois).size, dois.length)
  assert.ok(ARCHIVED_RESEARCH.every(r=>r.status==='ARCHIVE_REPORTED' && r.prescriptionApproved===false))
})

test('400m hurdles evidence does not leak into 400m sprint', () => {
  assert.equal(selectArchivedResearch(['400米'], '').length, 0)
  assert.ok(selectArchivedResearch(['400米栏'], '').some(r=>r.id==='R5-001'))
  assert.equal(selectArchivedResearch(['800米'], '').length, 0)
})

test('wearable and REDs evidence are candidates and remain source-qualified', () => {
  assert.ok(selectArchivedResearch([], '手表睡眠分期').some(r=>r.id==='R7-003'))
  assert.ok(selectArchivedResearch([], 'RED-S营养').some(r=>r.id==='R7-007'))
  const retrieved=retrieveCognitionKnowledge(['800米'], '手表睡眠分期')
  const archive=retrieved.filter(r=>r.id.startsWith('archive:'))
  assert.ok(archive.length>0 && archive.length<=2)
  assert.ok(archive.every(r=>r.verification==='CANDIDATE' && r.prescriptionApproved===false && r.checkedAt===null))
  assert.ok(archive.every(r=>r.limitations.includes('本次接入未独立重核原文')))
})

test('research selection is bounded and rejects invalid limit',()=>{
  assert.ok(selectArchivedResearch([], '伤病', 5).length<=5)
  assert.throws(()=>selectArchivedResearch([], '伤病', 6))
})
