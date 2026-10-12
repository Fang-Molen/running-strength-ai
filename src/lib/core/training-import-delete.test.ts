import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend } from './storage.ts'
import { loadConfirmedTrainingImports, permanentlyDeleteConfirmedTrainingImport } from './training-import.ts'

const KEY = 'fr255-confirmed-training-imports-v1'
// Locate the actual exported storage key in the implementation before running this test.
test('deletion refuses empty and unknown ids', () => {
  const data = new Map<string,string>()
  setStoreBackend({ keys:()=>[...data.keys()], getItem: k => data.get(k) ?? null, setItem: (k,v) => {data.set(k,v)} })
  assert.equal(permanentlyDeleteConfirmedTrainingImport(''), false)
  assert.equal(permanentlyDeleteConfirmedTrainingImport('unknown'), false)
  setStoreBackend(null)
})
test('permanently removes only selected confirmed import', () => {
  const data = new Map<string,string>()
  setStoreBackend({ keys:()=>[...data.keys()], getItem: k => data.get(k) ?? null, setItem: (k,v) => {data.set(k,v)} })
  const records = ['a','b'].map(confirmedImportId => ({confirmedImportId, schemaVersion:1, userConfirmed:true}))
  data.set(KEY, JSON.stringify({schemaVersion:1,revision:1,data:records}))
  assert.equal(permanentlyDeleteConfirmedTrainingImport('a'),true)
  assert.deepEqual(loadConfirmedTrainingImports().map(x=>x.confirmedImportId),['b'])
  assert.equal(permanentlyDeleteConfirmedTrainingImport('a'),false)
  setStoreBackend(null)
})
