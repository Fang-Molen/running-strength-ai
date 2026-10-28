import test from 'node:test'
import assert from 'node:assert/strict'
import { stageRestoreCandidate, type CandidateRepository } from './restore-candidate'

function repository() {
  const records = new Map<string, string>()
  const repo: CandidateRepository = { async write(id, value) { records.set(id, value) }, async read(id) { return records.get(id) ?? null } }
  return { repo, records }
}

test('unknown old writers produce a durable isolated candidate, never an active restore receipt', async () => {
  const f = repository(), active = new Map([['fk-record', 'original']])
  const result = await stageRestoreCandidate([{ key: 'fk-record', value: 'replacement' }], { subject: 'synthetic-a', currentSubject: () => 'synthetic-a', readSource: key => active.get(key) ?? null, repository: f.repo })
  assert.equal(result.state, 'CANDIDATE_READY')
  assert.equal(result.ok, false)
  assert.equal(active.get('fk-record'), 'original')
  const stored = JSON.parse([...f.records.values()][0])
  assert.equal(stored.entries[0].sourceValue, 'original')
  assert.equal(stored.entries[0].target, 'replacement')
  assert.equal(stored.active, false)
  assert.equal(stored.sourceConsistency, 'UNVERIFIED_CROSS_STORE_SNAPSHOT')
})

test('failed candidate backup/readback is not described as staged or restored', async () => {
  const repo: CandidateRepository = { async write() {}, async read() { return null } }
  const result = await stageRestoreCandidate([{ key: 'fk-record', value: 'replacement' }], { subject: 'synthetic-a', currentSubject: () => 'synthetic-a', readSource: () => 'original', repository: repo })
  assert.equal(result.state, 'NOT_STARTED')
  assert.equal(result.ok, false)
})

test('identity or source changing during backup leaves only an explicitly stale candidate', async () => {
  const f = repository(); let subject = 'synthetic-a'
  const write = f.repo.write
  f.repo.write = async (id, value) => { await write(id, value); subject = 'synthetic-b' }
  const result = await stageRestoreCandidate([{ key: 'fk-record', value: 'replacement' }], { subject: 'synthetic-a', currentSubject: () => subject, readSource: () => 'original', repository: f.repo })
  assert.equal(result.state, 'REVIEW_REQUIRED')
  assert.equal(result.ok, false)
})
