import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSyncRequest, readSyncCallback, DEVICE_PLATFORMS } from './device-sync-navigation'

test('every platform uses one supported navigation target', () => {
  assert.deepEqual(DEVICE_PLATFORMS.map(p => p.id), ['coros', 'garmin', 'polar', 'suunto', 'huawei', 'apple_health', 'health_connect', 'strava'])
  for (const p of DEVICE_PLATFORMS) assert.deepEqual(normalizeSyncRequest({ provider: p.id }), { mode: 'accounts', provider: p.id })
})
test('old generic open and file entry stay in the same surface without arbitrary destinations', () => {
  assert.deepEqual(normalizeSyncRequest(undefined), { mode: 'accounts' })
  assert.deepEqual(normalizeSyncRequest({ mode: 'files', provider: 'coros' }), { mode: 'files', provider: 'coros' })
  assert.deepEqual(normalizeSyncRequest({ provider: 'https://evil.invalid', mode: 'popup' }), { mode: 'accounts' })
})
test('official callback chooses platform and retains unrelated navigation parameters', () => {
  const r = readSyncCallback('?watch_provider=polar&watch_auth=ok&health=hrv')
  assert.equal(r?.provider, 'polar'); assert.equal(r?.result, 'ok')
  assert.equal(r?.cleanSearch, '?health=hrv')
  assert.deepEqual(readSyncCallback('?coros_auth=denied'), { provider: 'coros', result: 'denied', cleanSearch: '' })
})
test('unknown or conflicting callback cannot create a platform or imply a successful connection', () => {
  assert.equal(readSyncCallback('?watch_provider=unknown&watch_auth=ok'), null)
  assert.equal(readSyncCallback('?watch_provider=polar'), null)
  assert.equal(readSyncCallback('?watch_provider=garmin&watch_auth=ok'), null)
  assert.equal(readSyncCallback('?watch_provider=polar&watch_auth=ok&watch_auth=denied'), null)
})
