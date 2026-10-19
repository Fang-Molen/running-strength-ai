import test from 'node:test'
import assert from 'node:assert/strict'
import { applyEntries, inspectAnyBackup, isCredentialKey, restoreAnyBackup } from './backup-center.ts'
const mem = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } } }
const vault = (data: Record<string, unknown>) => JSON.stringify({ format: 'fangkun-vault-backup', schema: 1, exportedAt: '2026-10-18T10:00:00Z', data })
test('BACKUP-01 old vault backup previews counts and restores; file content unchanged', () => {
  const s = mem({ 'fk-plan400-v4-log': '{"a":1}', 'fk-schedule-v1': 'same' })
  const raw = vault({ 'fk-plan400-v4-log': '{"a":2}', 'fk-schedule-v1': 'same', 'fr255-vitals-v1': '[]' }); const before = raw
  const p = inspectAnyBackup(raw, s); assert.ok(p.ok)
  if (p.ok) { assert.equal(p.format, 'vault'); assert.equal(p.added, 1); assert.equal(p.overwritten, 1); assert.equal(p.unchanged, 1) }
  assert.equal(s.m.get('fk-plan400-v4-log'), '{"a":1}', 'preview never writes')
  assert.deepEqual(restoreAnyBackup(raw, s), { ok: true, restored: 2 }); assert.equal(s.m.get('fk-plan400-v4-log'), '{"a":2}'); assert.equal(raw, before)
})
test('BACKUP-02 malformed / foreign / non-string values → blocked, no writes', () => {
  const s = mem({ x: '1' })
  for (const raw of ['{broken', '[]', '{"hello":1}', JSON.stringify({ format: 'fangkun-vault-backup', data: [] })]) { const p = inspectAnyBackup(raw, s); assert.equal(p.ok, false); assert.equal(restoreAnyBackup(raw, s).ok, false) }
  const p = inspectAnyBackup(vault({ 'fk-a': { obj: 1 }, 'fk-b': 'ok' }), s); assert.ok(p.ok && p.skipped === 1 && p.total === 1)
  assert.deepEqual([...s.m.keys()], ['x'])
})
test('BACKUP-03 restoring same backup twice is idempotent', () => {
  const s = mem(); const raw = vault({ 'fk-a': '1', 'fk-b': '2' })
  restoreAnyBackup(raw, s); const p = inspectAnyBackup(raw, s); assert.ok(p.ok && p.unchanged === 2 && p.added === 0)
  assert.deepEqual(restoreAnyBackup(raw, s), { ok: true, restored: 0 }); assert.equal(s.m.size, 2)
})
test('credentials never restored; failure mid-way rolls back', () => {
  assert.ok(isCredentialKey('grok-auth.bearer-token')); assert.ok(!isCredentialKey('fk-plan400-v4-log'))
  const s = mem(); const p = inspectAnyBackup(vault({ 'grok-auth.bearer-token': 'T', 'fk-a': '1' }), s); assert.ok(p.ok && p.skipped === 1)
  restoreAnyBackup(vault({ 'grok-auth.bearer-token': 'T', 'fk-a': '1' }), s); assert.equal(s.m.has('grok-auth.bearer-token'), false)
  const f = mem({ 'fk-a': 'old' }); let n = 0; const orig = f.setItem; f.setItem = (k, v) => { if (++n === 2) throw Error('Quota'); orig(k, v) }
  const r = applyEntries([{ key: 'fk-a', value: 'new' }, { key: 'fk-b', value: 'x' }], f); assert.equal(r.ok, false); assert.equal(f.m.get('fk-a'), 'old'); assert.equal(f.m.has('fk-b'), false)
})
test('legacy fangkun-data.json (r8 exportAll) is recognised and restorable', () => {
  const s = mem(); const raw = JSON.stringify({ 'fk-schedule-v1': { entries: [] }, 'fk-onboard-v1': null })
  const p = inspectAnyBackup(raw, s); assert.ok(p.ok && p.format === 'legacy-r8' && p.added === 1 && p.skipped === 1)
  restoreAnyBackup(raw, s); assert.equal(s.m.get('fk-schedule-v1'), '{"entries":[]}')
})
test('fr255-local-backup delegates to existing inspect/restore', () => {
  const s = mem(); const raw = JSON.stringify({ kind: 'fr255-local-backup', version: 'x', exportedAt: '2026-10-18T00:00:00Z', keys: { 'fr255-vitals-v1': '[]' } })
  const p = inspectAnyBackup(raw, s); assert.ok(p.ok && p.format === 'local' && p.added === 1)
})
