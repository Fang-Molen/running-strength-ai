import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend, type MemoryStore } from '../core/storage'
import { setEventContext } from '../core/events'
import { normalizeFact, type UnifiedFact } from './unified-facts'
import { shortHash } from './observation'
import { readUnifiedFacts, saveReviewedFacts, UNIFIED_FACT_PREFIX } from './unified-fact-store'

const owner = 'synthetic-fact-batch-a', otherOwner = 'synthetic-fact-batch-b'
const at = '2026-10-20T12:00:00Z'
const fact = (recordId = 'record-1', athleteId = owner): UnifiedFact => ({
  athleteId, provider: 'GARMIN', accountRef: 'synthetic-account', deviceId: 'synthetic-device', recordId,
  metric: 'HRV', value: 60, unit: 'ms', protocol: 'NIGHT_RMSSD', start: null, end: null,
  receivedAt: at, day: '2026-10-20', utcOffsetMinutes: 0, quality: 'VALID', revision: 1,
})
class CountingStore implements MemoryStore {
  data = new Map<string, string>()
  factReads = 0
  writes = 0
  failWrites = 0
  hideNextFactReads = 0
  getItem(key: string) {
    if (key.startsWith(UNIFIED_FACT_PREFIX)) {
      this.factReads++
      if (this.hideNextFactReads > 0) { this.hideNextFactReads--; return null }
    }
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.failWrites > 0) { this.failWrites--; throw new Error('synthetic storage failure') }
    this.writes++; this.data.set(key, value)
  }
  keys() { return [...this.data.keys()] }
  resetCounts() { this.factReads = 0; this.writes = 0 }
}
let store: CountingStore
beforeEach(() => { store = new CountingStore(); setStoreBackend(store); setEventContext({ athleteId: owner }) })
afterEach(() => { setStoreBackend(null); setEventContext({ athleteId: 'local' }) })

test('a 20-fact batch reads existing source evidence once and verifies each new write once', () => {
  const rows = Array.from({ length: 20 }, (_, i) => fact(`record-${i}`))
  assert.deepEqual(saveReviewedFacts(rows), { saved: 20, errors: [] })
  assert.equal(store.factReads, 20, 'an empty journal needs only the 20 new-write verification reads, not 210 growing-history reads')
  assert.equal(store.writes, 20)
})

test('a repeated 20-fact batch reads each existing record only once and does not write', () => {
  const rows = Array.from({ length: 20 }, (_, i) => fact(`record-${i}`))
  saveReviewedFacts(rows)
  const before = [...store.data]
  store.resetCounts()
  assert.deepEqual(saveReviewedFacts(rows), { saved: 0, errors: [] })
  assert.equal(store.factReads, 20, 'a repeated batch reads its 20 existing records once, not 400 times')
  assert.equal(store.writes, 0)
  assert.deepEqual([...store.data], before)
})

test('a successful new write immediately participates in same-batch deduplication', () => {
  const row = fact()
  assert.deepEqual(saveReviewedFacts([row, row, row]), { saved: 1, errors: [] })
  assert.equal(store.factReads, 1)
  assert.equal(store.writes, 1)
  assert.equal(readUnifiedFacts().evidence.length, 1)
})

test('a later call reloads evidence after deletion and athlete scope changes', () => {
  assert.equal(saveReviewedFacts([fact()]).saved, 1)
  const firstKey = [...store.data.keys()][0]
  setEventContext({ athleteId: otherOwner })
  assert.equal(saveReviewedFacts([fact('record-1', otherOwner)]).saved, 1)
  assert.deepEqual(saveReviewedFacts([fact()]), { saved: 0, errors: ['无效或非本人证据未保存'] })
  setEventContext({ athleteId: owner })
  assert.equal(saveReviewedFacts([fact()]).saved, 0)
  assert.equal(readUnifiedFacts().evidence.length, 1)
  store.data.delete(firstKey)
  assert.equal(saveReviewedFacts([fact()]).saved, 1)
  assert.equal(readUnifiedFacts().evidence.length, 1)
  setEventContext({ athleteId: otherOwner })
  assert.equal(readUnifiedFacts().evidence.length, 1)
})

test('a failed append is not cached as saved and can succeed later in the same batch', () => {
  store.failWrites = 1
  const row = fact()
  assert.deepEqual(saveReviewedFacts([row, row]), { saved: 1, errors: ['证据保存失败'] })
  assert.equal(store.writes, 1)
  assert.equal(readUnifiedFacts().evidence.length, 1)
})

test('an unconfirmed write reloads the journal before retrying so an actually persisted row is not duplicated', () => {
  store.hideNextFactReads = 1
  const row = fact()
  assert.deepEqual(saveReviewedFacts([row, row]), { saved: 0, errors: ['证据保存失败'] })
  assert.equal(store.writes, 1)
  assert.equal(readUnifiedFacts().evidence.length, 1)
})

test('a content-hash collision retains the existing record and reports a conflict', () => {
  const row = normalizeFact(fact())!, id = shortHash(JSON.stringify(row))
  const key = `${UNIFIED_FACT_PREFIX}${encodeURIComponent(owner)}:${id}:synthetic-collision`
  store.data.set(key, JSON.stringify({ schemaVersion: 1, id, order: 1, recordedAt: at, data: normalizeFact(fact('different-record')) }))
  const before = [...store.data]
  assert.deepEqual(saveReviewedFacts([row]), { saved: 0, errors: ['证据标识冲突，未覆盖'] })
  assert.deepEqual([...store.data], before)
  assert.equal(store.writes, 0)
})

test('duplicate journal IDs retain the existing first-record collision policy', () => {
  const row = normalizeFact(fact())!, id = shortHash(JSON.stringify(row))
  const prefix = `${UNIFIED_FACT_PREFIX}${encodeURIComponent(owner)}:${id}:`
  store.data.set(prefix + 'first', JSON.stringify({ schemaVersion: 1, id, order: 1, recordedAt: at, data: row }))
  store.data.set(prefix + 'later', JSON.stringify({ schemaVersion: 1, id, order: 2, recordedAt: at, data: normalizeFact(fact('different-record')) }))
  const before = [...store.data]
  assert.deepEqual(saveReviewedFacts([row]), { saved: 0, errors: [] })
  assert.deepEqual([...store.data], before)
})

test('a malformed existing entry stays intact and remains visibly unreadable', () => {
  const key = `${UNIFIED_FACT_PREFIX}${encodeURIComponent(owner)}:broken`
  store.data.set(key, '{broken')
  assert.equal(saveReviewedFacts([fact()]).saved, 1)
  assert.equal(store.data.get(key), '{broken')
  assert.ok(readUnifiedFacts().rejected.includes('UNREADABLE_JOURNAL'))
})

test('storage without key enumeration still fails visibly without pretending to save', () => {
  setStoreBackend({ getItem: () => null, setItem: () => { throw new Error('must not reach write') } })
  assert.deepEqual(saveReviewedFacts([fact()]), { saved: 0, errors: ['证据保存失败'] })
})

test('entirely invalid or foreign rows do not require a source-history scan', () => {
  assert.deepEqual(saveReviewedFacts([{ ...fact(), value: 0 }, fact('other', otherOwner)]), { saved: 0, errors: ['无效或非本人证据未保存', '无效或非本人证据未保存'] })
  assert.equal(store.factReads, 0)
  assert.equal(store.writes, 0)
})
