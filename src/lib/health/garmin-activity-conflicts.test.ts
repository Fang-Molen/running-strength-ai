import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend, type MemoryStore } from '../core/storage'
import { setEventContext } from '../core/events'
import { shortHash } from './observation'
import { saveDeviceRows } from '../ui/device-store'
import type { DeviceActivity } from '../ui/device-parse'

const api = await import('./garmin-activity-conflicts').catch(() => ({})) as typeof import('./garmin-activity-conflicts')
class Store implements MemoryStore {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
  keys() { return [...this.data.keys()] }
}
const scope = 'cn:synthetic-conflicts', hash = shortHash(scope), subject = 'synthetic-conflicts'
const activity: DeviceActivity = { key: '42', sourceIdentity: `garmin:${encodeURIComponent(scope)}:42`, source: '佳明账号同步', sport: 'RUNNING', sportLabel: '跑步', startIso: '2026-10-01T00:00:00Z', durationSec: 1800.1, distanceM: 5000, avgHr: null, maxHr: null, calories: null, avgCadence: null, avgPower: null, verticalOscMm: null, groundContactMs: null, sets: [] }

test('older unresolved source differences remain detectable without fetching 200 activities again', () => {
  assert.equal(typeof api.readGarminActivityConflicts, 'function')
  const store = new Store(); setStoreBackend(store); setEventContext({ athleteId: subject })
  try {
    saveDeviceRows([], [activity])
    const key = `fk-garmin-acts-v1:${encodeURIComponent(subject)}:${hash}`
    store.setItem(key, JSON.stringify({ 42: { id: 42, sourceIdentity: activity.sourceIdentity, dur: 1801.1, dist: 5000 } }))
    assert.equal(api.readGarminActivityConflicts(hash, subject).length, 1)
    // New recent-page results contain none of this old activity; the persisted view still exposes its unresolved mismatch.
    saveDeviceRows([], [])
    assert.equal(api.readGarminActivityConflicts(hash, subject).length, 1)
    store.setItem(key, JSON.stringify({ 42: { id: 42, sourceIdentity: activity.sourceIdentity, dur: 1800.1, dist: 5000 } }))
    assert.deepEqual(api.readGarminActivityConflicts(hash, subject), [])
  } finally { setStoreBackend(null) }
})

test('conflict inspection is athlete and account scoped and does not invent deleted imports', () => {
  assert.equal(typeof api.readGarminActivityConflicts, 'function')
  const store = new Store(); setStoreBackend(store); setEventContext({ athleteId: subject })
  try {
    const key = `fk-garmin-acts-v1:${encodeURIComponent(subject)}:${hash}`
    store.setItem(key, JSON.stringify({ 42: { id: 42, sourceIdentity: activity.sourceIdentity, dur: 1801.1, dist: 5000 } }))
    assert.deepEqual(api.readGarminActivityConflicts(hash, subject), [], 'raw view alone is not evidence of a confirmed training record')
    saveDeviceRows([], [activity])
    assert.deepEqual(api.readGarminActivityConflicts(shortHash('com:other'), subject), [])
    setEventContext({ athleteId: 'another-athlete' })
    assert.deepEqual(api.readGarminActivityConflicts(hash, subject), [])
  } finally { setStoreBackend(null) }
})
