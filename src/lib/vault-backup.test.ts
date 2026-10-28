import test from 'node:test'
import assert from 'node:assert/strict'
import * as vault from './vault.ts'

test('backup precedence keeps pinned local values over older durable bulk values', () => {
  assert.equal(typeof vault.mergeVaultBackupSources, 'function')
  const result = vault.mergeVaultBackupSources({ 'fk-garmin-intraday-v1:local': 'older' }, { 'fk-garmin-intraday-v1:local': 'newer', 'fk-a': 'current' })
  assert.deepEqual(result.entries, { 'fk-garmin-intraday-v1:local': 'newer', 'fk-a': 'current' })
})
test('backup intentionally excludes credentials and physical coordinator metadata', () => {
  assert.equal(typeof vault.mergeVaultBackupSources, 'function')
  const result = vault.mergeVaultBackupSources({}, { 'grok-auth.bearer-token': 'synthetic-token', 'fk-bulk-store-v1': 'marker', 'fk-a': 'visible' })
  assert.deepEqual(result.entries, { 'fk-a': 'visible' })
  assert.equal(result.excludedKeys.length, 2)
})
test('future snapshot schema is rejected before any migration', () => {
  assert.throws(() => vault.migrateKv(new Map([['fk-a', 'old']]), 99), /VAULT_SCHEMA/)
})
