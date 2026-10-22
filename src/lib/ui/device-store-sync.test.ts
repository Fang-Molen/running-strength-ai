import test from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend, type MemoryStore} from '../core/storage'
import {setEventContext} from '../core/events'
import {CONFIRMED_TRAINING_IMPORTS_KEY, loadConfirmedTrainingImports, permanentlyDeleteConfirmedTrainingImport} from '../core/training-import'
import {saveDeviceRows} from './device-store'
import type {DeviceActivity} from './device-parse'

class Store implements MemoryStore {
  data = new Map<string, string>()
  importReads = 0
  writes = 0
  getItem(key: string) { if (key === CONFIRMED_TRAINING_IMPORTS_KEY) this.importReads++; return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.writes++; this.data.set(key, value) }
  keys() { return [...this.data.keys()] }
}
function activity(id: number, scope = 'cn:synthetic-test'): DeviceActivity {
  return {key: String(id), sourceIdentity: `garmin:${encodeURIComponent(scope)}:${id}`, source: '佳明账号同步', sport: 'RUNNING', sportLabel: '跑步', startIso: '2025-01-01T08:00:00Z', durationSec: 1800, distanceM: 5000, avgHr: null, maxHr: null, calories: null, avgCadence: null, avgPower: null, verticalOscMm: null, groundContactMs: null, sets: []}
}
function setup() {
  const store = new Store()
  setStoreBackend(store)
  setEventContext({athleteId: 'synthetic-sync-a'})
  return store
}

test('repeat device import reads its normalized history once for the entire batch', () => {
  const store = setup(), rows = Array.from({length: 20}, (_, i) => activity(i))
  assert.deepEqual(saveDeviceRows([], rows), {saved: 20, skipped: 0, errors: [], healthErrors: []})
  const before = [...store.data]
  store.importReads = 0; store.writes = 0
  assert.deepEqual(saveDeviceRows([], rows), {saved: 0, skipped: 20, errors: [], healthErrors: []})
  assert.equal(store.importReads, 1, 'duplicate count must not multiply full-history parses')
  assert.equal(store.writes, 0)
  assert.deepEqual([...store.data], before)
  setStoreBackend(null)
})

test('same-source changed totals still require review and never overwrite the confirmed record', () => {
  const store = setup(), a = activity(1)
  assert.equal(saveDeviceRows([], [a]).saved, 1)
  const before = [...store.data]
  // v89.10.9 merge: v89.10.8 rejects every conflicting version of one source ID in the same batch (stricter than the package's base); the confirmed record still must stay untouched.
  const result = saveDeviceRows([], [{...a, durationSec: 1801}, {...a, distanceM: 5001}, a])
  assert.equal(result.saved, 0); assert.equal(result.skipped, 0)
  assert.deepEqual(result.errors, Array(3).fill('同一来源活动的多个版本存在冲突；先核对更正，未保存任一冲突版本。'))
  const changed = saveDeviceRows([], [{...a, durationSec: 1801}])
  assert.equal(changed.saved, 0)
  assert.deepEqual(changed.errors, ['同一来源活动数值已变化，需核对原记录与更正；未重复计入或覆盖手填更正。'])
  assert.deepEqual([...store.data], before)
  setStoreBackend(null)
})

test('matching time and distance do not merge different accounts or activity IDs', () => {
  setup()
  const a = activity(1), b = activity(2), other = activity(1, 'com:synthetic-other')
  assert.deepEqual(saveDeviceRows([], [a, b, other, a]), {saved: 3, skipped: 1, errors: [], healthErrors: []})
  assert.equal(loadConfirmedTrainingImports().length, 3)
  setStoreBackend(null)
})

test('a later call reloads source state after deletion and athlete switches', () => {
  setup()
  const a = activity(1)
  assert.equal(saveDeviceRows([], [a]).saved, 1)
  const original = loadConfirmedTrainingImports()[0]
  setEventContext({athleteId: 'synthetic-sync-b'})
  assert.equal(saveDeviceRows([], [a]).saved, 1)
  setEventContext({athleteId: 'synthetic-sync-a'})
  assert.equal(saveDeviceRows([], [a]).skipped, 1)
  assert.equal(permanentlyDeleteConfirmedTrainingImport(original.confirmedImportId), true)
  assert.equal(saveDeviceRows([], [a]).saved, 1)
  assert.equal(loadConfirmedTrainingImports().length, 2)
  setStoreBackend(null)
})

test('duplicate draft IDs retain the existing first-record conflict policy', () => {
  const store = setup(), a = activity(1)
  saveDeviceRows([], [a])
  const raw = JSON.parse(store.data.get(CONFIRMED_TRAINING_IMPORTS_KEY)!)
  const conflicting = structuredClone(raw.data[0])
  conflicting.durationSeconds.value = 1900
  raw.data.push(conflicting)
  store.data.set(CONFIRMED_TRAINING_IMPORTS_KEY, JSON.stringify(raw))
  const before = [...store.data]
  assert.deepEqual(saveDeviceRows([], [a]), {saved: 0, skipped: 1, errors: [], healthErrors: []})
  assert.deepEqual([...store.data], before)
  setStoreBackend(null)
})

test('v89.10.10 a distance-0 strength activity re-synced unchanged is skipped, not reported as changed', () => {
  setup()
  const a = {...activity(7), sport: 'STRENGTH' as const, sportLabel: '力量', distanceM: 0, sets: []}
  assert.equal(saveDeviceRows([], [a]).saved, 1)
  const again = saveDeviceRows([], [a])
  assert.deepEqual(again, {saved: 0, skipped: 1, errors: [], healthErrors: []})
  setStoreBackend(null)
})
