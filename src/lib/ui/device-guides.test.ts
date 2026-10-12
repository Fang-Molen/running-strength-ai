import assert from 'node:assert/strict'
import test from 'node:test'
import { DEVICE_GUIDES } from './device-guides.ts'

test('device guide registry has unique ids and truthful nonempty instructions', () => {
  assert.equal(DEVICE_GUIDES.length, 10)
  assert.equal(new Set(DEVICE_GUIDES.map((guide) => guide.id)).size, DEVICE_GUIDES.length)
  for (const guide of DEVICE_GUIDES) {
    assert.ok(guide.brand && guide.route && guide.format && guide.caution)
    assert.ok(guide.steps.length >= 2)
    assert.ok(guide.steps.every(Boolean))
  }
})
