import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { preflightDeviceFile, MAX_PREVIEW_FILE_BYTES } from './device-import-contract.ts'
test('accepts only metadata preflight for common formats', () => {
  for (const ext of ['FIT','tcx','gpx','csv','zip']) {
    const x = preflightDeviceFile(`activity.${ext}`, 100)
    assert.equal(x.status, 'requires-parser')
    assert.match(x.message, /尚未解析/)
  }
})
test('rejects unsupported, empty and oversized files', () => {
  assert.equal(preflightDeviceFile('photo.png', 100).status, 'unsupported')
  assert.equal(preflightDeviceFile('run.fit', 0).status, 'empty')
  assert.equal(preflightDeviceFile('run.fit', MAX_PREVIEW_FILE_BYTES + 1).status, 'too-large')
})
test('strips directory from displayed file name', () => {
  assert.equal(preflightDeviceFile('../../sensitive.fit', 20).name, 'sensitive.fit')
})
