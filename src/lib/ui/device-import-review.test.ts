import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend, type MemoryStore } from '../core/storage'
import { setEventContext } from '../core/events'
import { readUnifiedFacts, saveReviewedFacts } from '../health/unified-fact-store'
import type { UnifiedFact } from '../health/unified-facts'
import type { DeviceParseResult } from './device-parse'
import { reviewFactKey, reviewStatusFacts, selectReviewedDeviceRows } from './device-import-review'

const original: UnifiedFact = {
  athleteId: 'synthetic-review', provider: 'GARMIN', accountRef: 'test-account', deviceId: 'test-watch',
  recordId: 'rhr-1', metric: 'RHR', value: 60, unit: 'bpm', protocol: 'resting',
  start: null, end: null, receivedAt: '2026-10-20T12:00:00Z', day: '2026-10-20',
  utcOffsetMinutes: 0, quality: 'VALID', revision: 1,
}
const retraction: UnifiedFact = { ...original, value: null, quality: 'RETRACTED', revision: 2 }
function parsed(facts = [original, retraction]): DeviceParseResult {
  return { kind: 'test', brand: 'GARMIN', health: [], activities: [], notes: [], facts }
}
class Store implements MemoryStore {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
  keys() { return [...this.data.keys()] }
}

test('an unselected retraction cannot erase a previously saved health reading', () => {
  setStoreBackend(new Store())
  setEventContext({ athleteId: original.athleteId })
  try {
    assert.equal(saveReviewedFacts([original]).saved, 1)
    const selection = selectReviewedDeviceRows(parsed(), {}, {}, {})
    assert.equal(selection.count, 0)
    assert.equal(saveReviewedFacts(selection.facts).saved, 0)
    assert.equal(readUnifiedFacts().facts[0]?.value, 60)
  } finally { setStoreBackend(null) }
})

test('an explicitly selected retraction is saved and takes effect without inventing zero', () => {
  setStoreBackend(new Store())
  setEventContext({ athleteId: original.athleteId })
  try {
    saveReviewedFacts([original])
    const selection = selectReviewedDeviceRows(parsed(), {}, {}, { [reviewFactKey(retraction)]: true })
    assert.equal(selection.count, 1)
    assert.deepEqual(selection.facts, [retraction])
    assert.equal(saveReviewedFacts(selection.facts).saved, 1)
    const result = readUnifiedFacts()
    assert.equal(result.facts.length, 0)
    assert.equal(result.evidence.length, 2)
    assert.equal(result.evidence.find(f => f.quality === 'RETRACTED')?.value, null)
  } finally { setStoreBackend(null) }
})

test('selecting a corrected reading preserves its history, deduplicates evidence and excludes unrelated status', () => {
  const corrected = { ...original, value: 70, revision: 3 }
  const unrelated = { ...retraction, recordId: 'unrelated', quality: 'NOT_WORN' as const }
  const result = parsed([original, retraction, corrected, unrelated, unrelated])
  result.health = [{ key: 'selected', source: 'GARMIN', metric: 'RHR', day: original.day, value: 70,
    observation: { key: 'test', sourceId: 'garmin:test', statistic: 'resting',
      measuredAt: null, syncedAt: original.receivedAt, facts: [original, retraction, corrected] } }]
  const selection = selectReviewedDeviceRows(result, { selected: true }, {}, { [reviewFactKey(retraction)]: true })
  assert.equal(selection.count, 2)
  assert.deepEqual(selection.facts, [original, retraction, corrected])
  assert.deepEqual(reviewStatusFacts(result), [retraction, unrelated])
})

test('unselected readings do not implicitly select their attached source facts', () => {
  const result = parsed([retraction])
  result.health = [{ key: 'not-selected', source: 'GARMIN', metric: 'RHR', day: original.day, value: 60,
    observation: { key: 'test', sourceId: 'garmin:test', statistic: 'resting',
      syncedAt: original.receivedAt, facts: [original] } }]
  assert.deepEqual(selectReviewedDeviceRows(result, {}, {}, {}), { health: [], activities: [], facts: [], count: 0 })
})
