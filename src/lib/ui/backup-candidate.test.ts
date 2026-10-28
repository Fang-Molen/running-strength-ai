import test from 'node:test'
import assert from 'node:assert/strict'
import * as backup from './backup-center.ts'
import { restoreLocalBackup } from '../core/trial.ts'
import { setEventContext } from '../core/events.ts'
import { appStorage } from '../core/bulk-store.ts'
import { setStoreBackend } from '../core/storage.ts'
import { createBackupArchive } from '../core/backup-archive.ts'
import { confirmImport, undoImport, prepareImportCandidate } from '../plan/plan-import.ts'
import { emptyProfile } from '../strength/profile.ts'
import type { CandidateRepository } from '../core/restore-candidate.ts'

const memory = (seed: Record<string, string> = {}) => {
  const data = new Map(Object.entries(seed))
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
const raw = (data: Record<string, unknown>, schema = 1) => JSON.stringify({ format: 'fangkun-vault-backup', schema, data })
const repository = () => { const data = new Map<string, string>(); const repo: CandidateRepository = { async write(id, value) { data.set(id, value) }, async read(id) { return data.get(id) ?? null } }; return { data, repo } }
test.afterEach(() => { delete (globalThis as Record<string, unknown>).localStorage; setStoreBackend(null); setEventContext({ athleteId: 'local' }) })

test('native browser backup/apply/legacy/undo entrypoints refuse synchronous active mutations', () => {
  const storage = memory({ 'fk-a': 'old', 'fr255-a': 'old' })
  Object.assign(globalThis, { localStorage: storage })
  assert.equal(backup.restoreAnyBackup(raw({ 'fk-a': 'new' }), storage).ok, false)
  assert.equal(backup.applyEntries([{ key: 'fk-a', value: 'new' }], storage).ok, false)
  assert.equal(restoreLocalBackup(JSON.stringify({ kind: 'fr255-local-backup', keys: { 'fr255-a': 'new' } }), storage).ok, false)
  assert.equal(backup.undoBackupSnapshot([{ key: 'fk-a', previous: null }], storage), false)
  assert.deepEqual(Object.fromEntries(storage.data), { 'fk-a': 'old', 'fr255-a': 'old' })
})
test('appStorage physical adapter is identified even when its underlying store is injected', () => {
  const storage = memory({ 'fk-a': 'old' }); setStoreBackend(storage)
  assert.equal(backup.applyEntries([{ key: 'fk-a', value: 'new' }], appStorage()).ok, false)
  assert.equal(storage.getItem('fk-a'), 'old')
})
test('pure memory adapter compatibility remains usable', () => {
  const storage = memory({ 'fk-a': 'old' }); setStoreBackend(storage)
  assert.equal(backup.restoreAnyBackup(raw({ 'fk-a': 'new' }), storage).ok, true)
  assert.equal(storage.getItem('fk-a'), 'new')
})
test('confirmed preview saves a verified candidate without active writes or success receipt', async () => {
  assert.equal(typeof backup.prepareAnyBackup, 'function')
  const storage = memory({ 'fk-a': 'old' }), f = repository()
  const prepared = backup.prepareAnyBackup(raw({ 'fk-a': 'new' }), storage)
  assert.ok(prepared.ok); if (!prepared.ok) return
  const result = await backup.stagePreparedBackup(prepared, storage, f.repo)
  assert.equal(result.ok, false); assert.equal(result.state, 'CANDIDATE_READY')
  assert.equal(storage.getItem('fk-a'), 'old')
  assert.equal(JSON.parse([...f.data.values()][0]).entries[0].target, 'new')
})
test('target or athlete changed after preview requires a fresh preview before candidate write', async () => {
  assert.equal(typeof backup.prepareAnyBackup, 'function')
  const storage = memory({ 'fk-a': 'old' }), f = repository()
  const prepared = backup.prepareAnyBackup(raw({ 'fk-a': 'new' }), storage)
  assert.ok(prepared.ok); if (!prepared.ok) return
  storage.setItem('fk-a', 'changed')
  assert.equal((await backup.stagePreparedBackup(prepared, storage, f.repo)).state, 'REVIEW_REQUIRED')
  storage.setItem('fk-a', 'old'); setEventContext({ athleteId: 'other' })
  assert.equal((await backup.stagePreparedBackup(prepared, storage, f.repo)).state, 'REVIEW_REQUIRED')
  assert.equal(f.data.size, 0)
})
test('prepared targets cannot change between preview and confirmation', async () => {
  const storage = memory({ 'fk-a': 'old' }), f = repository()
  const prepared = backup.prepareAnyBackup(raw({ 'fk-a': 'confirmed-target' }), storage)
  assert.ok(prepared.ok); if (!prepared.ok) return
  prepared.entries[0].value = 'different-target'
  assert.equal((await backup.stagePreparedBackup(prepared, storage, f.repo)).state, 'REVIEW_REQUIRED')
  assert.equal(f.data.size, 0)
})
test('new chunked archive enters common preflight with large Unicode and subject binding', () => {
  const value = '中'.repeat(1_700_001)
  const archive = createBackupArchive({ 'fk-large': value }, { athleteId: 'local', exportedAt: '2026-10-28T12:00:00.000Z', included: ['localStorage'], excluded: ['photos'] })
  const storage = memory(), preview = backup.inspectAnyBackup(JSON.stringify(archive), storage)
  assert.ok(preview.ok); if (preview.ok) assert.equal(preview.total, 1)
  setEventContext({ athleteId: 'other' })
  assert.equal(backup.inspectAnyBackup(JSON.stringify(archive), storage).ok, false)
})
test('unsupported future backups and incomplete full backups cannot become candidates', async () => {
  assert.equal(backup.inspectAnyBackup(raw({ 'fk-a': 'a' }, 99), memory()).ok, false)
  assert.equal(typeof backup.prepareAnyBackup, 'function')
  assert.equal(backup.prepareAnyBackup(raw({ 'fk-a': { malformed: true }, 'fk-b': 'valid' }), memory()).ok, false)
})
test('plan and profile defaults stay together in the isolated candidate; native undo cannot alter either', async () => {
  const storage = memory({ 'fr255-profile-v1': JSON.stringify(emptyProfile()) }), f = repository()
  Object.assign(globalThis, { localStorage: storage })
  const file = JSON.stringify({ schema: 'fangkun-plan-v1', plan: { name: 'Synthetic plan', days: [{ date: '2026-10-29', title: 'Synthetic easy run', main: ['Easy'], aux: [], strength: [] }] }, profileDefaults: { marks: [{ meters: 400, goal: 'synthetic' }] } })
  const before = Object.fromEntries(storage.data); let saves = 0
  assert.equal(confirmImport(file, storage, emptyProfile(), () => { saves++ }).ok, false)
  assert.equal(undoImport({ keys: [{ key: 'fr255-profile-v1', previous: null }], profileBefore: null }, storage), false)
  const prepared = prepareImportCandidate(file, storage, emptyProfile())
  assert.ok(prepared.ok); if (!prepared.ok) return
  assert.equal((await backup.stagePreparedBackup(prepared, storage, f.repo)).state, 'CANDIDATE_READY')
  const candidate = JSON.parse([...f.data.values()][0])
  assert.equal(candidate.entries.length, 2)
  assert.ok(candidate.entries.some((entry: { key: string }) => entry.key === 'fr255-profile-v1'))
  assert.deepEqual(Object.fromEntries(storage.data), before); assert.equal(saves, 0)
})
