import test from 'node:test'
import assert from 'node:assert/strict'
import { versionAction, VERSION_RE } from './app-version-check.ts'

test('v89.10.12 resume version check: reload once when the deployed SW version changed', () => {
  assert.equal(VERSION_RE.exec('const CACHE = "fr255-shell-v89-10-12"\n')?.[1], 'fr255-shell-v89-10-12')
  assert.equal(versionAction({ boot: null, latest: 'v12', trainingOpen: false, reloadedFor: null }), 'remember')
  assert.equal(versionAction({ boot: 'v12', latest: 'v12', trainingOpen: false, reloadedFor: null }), 'keep')
  assert.equal(versionAction({ boot: 'v2', latest: 'v12', trainingOpen: false, reloadedFor: null }), 'reload')
  assert.equal(versionAction({ boot: 'v2', latest: 'v12', trainingOpen: true, reloadedFor: null }), 'keep')
  assert.equal(versionAction({ boot: 'v2', latest: 'v12', trainingOpen: false, reloadedFor: 'v12' }), 'keep')
  assert.equal(versionAction({ boot: 'v2', latest: null, trainingOpen: false, reloadedFor: null }), 'keep')
})
