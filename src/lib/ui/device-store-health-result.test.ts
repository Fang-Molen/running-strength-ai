import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend, type MemoryStore } from '../core/storage'
import { setEventContext } from '../core/events'
import * as deviceStore from './device-store'
import type { DeviceActivity, DeviceHealthRow } from './device-parse'

class Store implements MemoryStore {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
  keys() { return [...this.data.keys()] }
}
const activity: DeviceActivity = { key: '1', sourceIdentity: 'garmin:cn%3Asynthetic:1', source: '佳明账号同步', sport: 'RUNNING', sportLabel: '跑步', startIso: '2026-10-22T00:00:00Z', durationSec: 1800.1, distanceM: 5000, avgHr: null, maxHr: null, calories: null, avgCadence: null, avgPower: null, verticalOscMm: null, groundContactMs: null, sets: [] }
const health: DeviceHealthRow = { key: 'synthetic-rhr', source: '佳明账号同步', metric: 'RHR', day: '2026-10-22', value: 52 }

test('activity conflicts stay visible while separately confirming successful health storage', () => {
  setStoreBackend(new Store()); setEventContext({ athleteId: 'synthetic-health-split' })
  try {
    assert.equal(deviceStore.saveDeviceRows([], [activity]).saved, 1)
    const save = (deviceStore as typeof deviceStore & { saveDeviceRowsWithHealthResult?: typeof deviceStore.saveDeviceRows }).saveDeviceRowsWithHealthResult ?? deviceStore.saveDeviceRows
    const result = save([health], [{ ...activity, durationSec: 1801.1 }]) as ReturnType<typeof save> & { healthErrors?: string[] }
    assert.equal(result.saved, 1)
    assert.equal(result.errors.length, 1)
    assert.deepEqual(result.healthErrors, [])
    assert.match(result.errors[0], /需核对原记录/)
    const failed = save([{ ...health, value: -2 }], []) as typeof result
    assert.equal(failed.saved, 0)
    assert.ok(failed.healthErrors?.length)
    assert.deepEqual(failed.healthErrors, failed.errors)
  } finally { setStoreBackend(null) }
})
