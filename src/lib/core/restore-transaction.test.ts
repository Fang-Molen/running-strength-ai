import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeRestore, recoverRestore, type RestoreOperation, type RestoreContext } from './restore-transaction'

async function fixture(run: (f: { context: RestoreContext; values: Map<string, string>; writes: string[]; saved: () => Promise<RestoreOperation | null>; journalFault: (f: (op: RestoreOperation) => 'before' | 'after' | null) => void; readFault: (on: boolean) => void; backendFault: (f: (key: string, value: string | null) => boolean) => void }) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'fk-synthetic-restore-'))
  const path = join(dir, 'operation.json')
  const values = new Map([['local:a', 'old'], ['mirror:a', 'mirror-old']])
  const writes: string[] = []
  let journalFault = (_: RestoreOperation): 'before' | 'after' | null => null
  let readFault = false
  let backendFault = (_key: string, _value: string | null) => false
  const context: RestoreContext = {
    subject: () => 'synthetic-a', isolation: async () => true,
    journal: {
      async load() { if (readFault) throw Error('LOG_UNREADABLE'); try { return JSON.parse(await readFile(path, 'utf8')) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e } },
      async save(op) { const fault = journalFault(op); if (fault === 'before') throw Error('LOG_FAILED'); await writeFile(path, JSON.stringify(op)); if (fault === 'after') throw Error('ACK_LOST') },
    },
    backends: Object.fromEntries(['local', 'mirror'].map(id => [id, {
      async read(key: string) { return values.get(id + ':' + key) ?? null },
      async write(key: string, value: string | null) { const address = id + ':' + key; writes.push(address); if (backendFault(address, value)) throw Error('QUOTA'); if (value === null) values.delete(address); else values.set(address, value) },
    }])),
  }
  try { await run({ context, values, writes, saved: () => context.journal.load('op'), journalFault: f => { journalFault = f }, readFault: on => { readFault = on }, backendFault: f => { backendFault = f } }) }
  finally { await rm(dir, { recursive: true, force: true }) }
}
const request = () => ({ id: 'op', subject: 'synthetic-a', entries: [{ backend: 'local', key: 'a', target: 'new', expected: 'old' }, { backend: 'mirror', key: 'a', target: 'new', expected: 'mirror-old' }] })

test('B05 persists verified before-images for each physical backend before touching targets', () => fixture(async f => {
  const phases: string[] = []
  f.journalFault(op => { phases.push(op.phase); if (op.phase === 'PREPARED') assert.equal(f.writes.length, 0); return null })
  const result = await executeRestore(request(), f.context)
  assert.equal(result.state, 'COMMITTED')
  assert.deepEqual([...f.values.values()], ['new', 'new'])
  const saved = await f.saved()
  assert.deepEqual(saved?.entries.map(e => e.before), ['old', 'mirror-old'])
  assert.ok(phases.includes('PREPARED') && phases.includes('APPLYING'))
  assert.equal(saved?.phase, 'COMMITTED')
}))

test('B05 backup/log failure before PREPARED never modifies either target', () => fixture(async f => {
  f.journalFault(() => 'before')
  const result = await executeRestore(request(), f.context)
  assert.equal(result.state, 'NOT_STARTED')
  assert.deepEqual(f.writes, [])
  assert.deepEqual([...f.values.values()], ['old', 'mirror-old'])
}))

test('B05 write failure restores each backend to its own old value and verifies rollback', () => fixture(async f => {
  f.backendFault((key, value) => key === 'mirror:a' && value === 'new')
  const result = await executeRestore(request(), f.context)
  assert.equal(result.state, 'ROLLED_BACK')
  assert.deepEqual([...f.values.values()], ['old', 'mirror-old'])
  assert.equal((await f.saved())?.phase, 'ROLLED_BACK')
}))

test('B05 committed transaction survives a lost commit acknowledgement without rollback', () => fixture(async f => {
  f.journalFault(op => op.phase === 'COMMITTED' ? 'after' : null)
  const result = await executeRestore(request(), f.context)
  assert.equal(result.state, 'COMMITTED')
  assert.deepEqual([...f.values.values()], ['new', 'new'])
}))

test('B05 unknown commit outcome stays restricted, restart resolves authoritative COMMITTED', () => fixture(async f => {
  f.journalFault(op => { if (op.phase === 'COMMITTED') { f.readFault(true); return 'after' } return null })
  const result = await executeRestore(request(), f.context)
  assert.equal(result.state, 'RECOVERY_REQUIRED')
  assert.deepEqual([...f.values.values()], ['new', 'new'])
  f.readFault(false); f.journalFault(() => null)
  const resumed = await recoverRestore('op', f.context)
  assert.equal(resumed.state, 'COMMITTED')
  assert.deepEqual([...f.values.values()], ['new', 'new'])
}))

test('B05 target written before receipt failure is rolled back after a journal restart', () => fixture(async f => {
  let interrupted = false
  f.journalFault(op => {
    if (op.entries.some(e => e.written)) interrupted = true
    return interrupted ? 'before' : null
  })
  const result = await executeRestore(request(), f.context)
  assert.equal(result.state, 'RECOVERY_REQUIRED')
  assert.equal(f.values.get('local:a'), 'new')
  f.journalFault(() => null)
  const resumed = await recoverRestore('op', f.context)
  assert.equal(resumed.state, 'ROLLED_BACK')
  assert.deepEqual([...f.values.values()], ['old', 'mirror-old'])
}))

test('B05 external modification blocks rollback instead of overwriting the independent change', () => fixture(async f => {
  f.backendFault((key, value) => { if (key === 'mirror:a' && value === 'new') { f.values.set('local:a', 'independent'); return true } return false })
  const result = await executeRestore(request(), f.context)
  assert.equal(result.state, 'RECOVERY_REQUIRED')
  assert.equal(f.values.get('local:a'), 'independent')
}))

test('B05 cache notification failure after COMMITTED never reverts persisted values', () => fixture(async f => {
  f.context.afterCommit = async () => { throw Error('CACHE_FAILED') }
  const result = await executeRestore(request(), f.context)
  assert.equal(result.state, 'COMMITTED')
  assert.equal(result.cacheRepairRequired, true)
  assert.deepEqual([...f.values.values()], ['new', 'new'])
}))

test('B05 unknown legacy-writer isolation and changed preview both reject before writes', () => fixture(async f => {
  f.context.isolation = async () => false
  assert.equal((await executeRestore(request(), f.context)).state, 'NOT_STARTED')
  assert.deepEqual(f.writes, [])
  f.context.isolation = async () => true
  f.values.set('local:a', 'later')
  assert.equal((await executeRestore(request(), f.context)).state, 'NOT_STARTED')
  assert.deepEqual(f.writes, [])
}))
