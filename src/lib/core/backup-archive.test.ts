import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

// A missing implementation is an assertion failure during the initial RED run.
const loaded = await import('./backup-archive.ts').catch(() => null)
function library(): typeof import('./backup-archive.ts') {
  assert.ok(loaded, 'the chunked archive library must exist')
  return loaded
}
const metadata = { athleteId: 'synthetic-athlete', exportedAt: '2026-10-28T12:00:00.000Z', included: ['localStorage', 'bulk-kv'], excluded: ['food-photos'] }
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
function fixture() { return library().createBackupArchive({ 'fr255-a': 'Alpha😀中文', 'fk-b': '' }, metadata) }
function rejectMutation(change: (archive: ReturnType<typeof fixture>) => void) {
  const archive = fixture(); change(archive)
  assert.throws(() => library().parseBackupArchive(JSON.stringify(archive)), /ARCHIVE_/)
}
function resignManifest(archive: ReturnType<typeof fixture>) {
  archive.manifestHash = sha(JSON.stringify({ format: archive.format, schema: archive.schema, metadata: archive.metadata, manifest: archive.manifest }))
}

test('archive preserves values and explicit scope; hashes match independent SHA-256', () => {
  const archive = fixture()
  assert.equal(archive.format, 'fangkun-chunked-backup')
  assert.equal(archive.schema, 2)
  assert.deepEqual(library().parseBackupArchive(JSON.stringify(archive, null, 2)), { entries: { 'fr255-a': 'Alpha😀中文', 'fk-b': '' }, metadata })
  const key = archive.manifest.keys.find(row => row.key === 'fr255-a')!
  assert.equal(key.bytes, 15)
  assert.equal(key.sha256, sha('Alpha😀中文'))
  for (const chunk of archive.chunks) {
    assert.equal(chunk.bytes, Buffer.byteLength(chunk.data, 'utf8'))
    assert.equal(chunk.sha256, sha(chunk.data))
  }
  assert.deepEqual(metadata.excluded, ['food-photos'])
})

test('single value exceeding 5,000,001 characters and archive exceeding 30MiB round-trip completely', () => {
  const entries = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`fr255-large-${index}`, String(index).repeat(5_300_002)]))
  const archive = library().createBackupArchive(entries, metadata)
  const raw = JSON.stringify(archive)
  assert.ok(Buffer.byteLength(raw) > 30 * 1024 * 1024)
  assert.equal(archive.manifest.totalBytes, 31_800_012)
  const restored = library().parseBackupArchive(raw)
  assert.deepEqual(Object.keys(restored.entries).sort(), Object.keys(entries).sort())
  for (const [key, value] of Object.entries(entries)) assert.equal(restored.entries[key], value)
})

test('Unicode chunks preserve complete surrogate pairs at every boundary', () => {
  const value = 'a'.repeat(262_143) + '😀' + '中'.repeat(180_000) + '🧑🏽‍💻e\u0301'
  const archive = library().createBackupArchive({ 'fk-unicode': value }, metadata)
  assert.ok(archive.chunks.length > 2)
  for (const chunk of archive.chunks) {
    assert.ok(!/[\uD800-\uDBFF]$/.test(chunk.data), 'chunk must not end with a high surrogate')
    assert.ok(!/^[\uDC00-\uDFFF]/.test(chunk.data), 'chunk must not start with a low surrogate')
    assert.ok(chunk.bytes <= 262_144)
  }
  assert.equal(library().parseBackupArchive(JSON.stringify(archive)).entries['fk-unicode'], value)
})

test('UTF-8 payload capacity rejects 64MiB plus one byte before producing an archive', () => {
  assert.throws(() => library().createBackupArchive({ 'fk-too-large': 'x'.repeat(64 * 1024 * 1024 + 1) }, metadata), /ARCHIVE_CAPACITY/)
})

test('export rejects malformed Unicode rather than hashing replacement characters', () => {
  for (const value of ['\ud800', '\udc00', 'a\ud800b']) assert.throws(() => library().createBackupArchive({ 'fk-invalid': value }, metadata), /ARCHIVE_UNICODE/)
})

test('JSON escape expansion has an explicit container capacity', () => {
  assert.throws(() => library().createBackupArchive({ 'fk-control': '\u0000'.repeat(23 * 1024 * 1024) }, metadata), /ARCHIVE_CAPACITY/)
})

test('credentials and coordination keys are refused without silently dropping data', () => {
  for (const key of ['grok-auth.bearer-token', 'fk-access-token', 'fk-secret', '__restore', '__proto__', 'fk-bulk-store-v1', 'fangkun-core-storage-mode-v1', 'fk-storage-recovery-v1', 'fr255-schedule-write-intent-v2']) {
    assert.equal(library().isBackupArchiveKeyAllowed(key), false, key)
    assert.throws(() => library().createBackupArchive(Object.fromEntries([[key, 'sensitive']]), metadata), /ARCHIVE_KEY/, key)
  }
  assert.equal(library().isBackupArchiveKeyAllowed('fr255-food-log-v1'), true)
  assert.equal(library().isBackupArchiveKeyAllowed('fk-garmin-intraday-v1:athlete'), true)
})

test('metadata must carry valid athlete, timestamp and nonoverlapping explicit scope', () => {
  for (const invalid of [
    { ...metadata, athleteId: '' }, { ...metadata, exportedAt: 'yesterday' },
    { ...metadata, included: [] }, { ...metadata, included: ['kv', 'kv'] },
    { ...metadata, included: ['kv'], excluded: ['kv'] },
  ]) assert.throws(() => library().createBackupArchive({ 'fk-a': 'a' }, invalid), /ARCHIVE_METADATA/)
})

test('future format versions are rejected', () => rejectMutation(archive => { (archive as { schema: number }).schema = 3 }))
test('different container formats are rejected', () => rejectMutation(archive => { (archive as { format: string }).format = 'unknown' }))
test('tampered data is rejected', () => rejectMutation(archive => { archive.chunks[0].data += 'changed' }))
test('tampered chunk hash is rejected', () => rejectMutation(archive => { archive.chunks[0].sha256 = '0'.repeat(64) }))
test('tampered per-key bytes are rejected', () => rejectMutation(archive => { archive.manifest.keys[0].bytes++ }))
test('tampered metadata is covered by manifest hash', () => rejectMutation(archive => { archive.metadata.athleteId = 'different-athlete' }))
test('tampered manifest hash is rejected', () => rejectMutation(archive => { archive.manifestHash = '0'.repeat(64) }))
test('omitted chunk is rejected', () => rejectMutation(archive => { archive.chunks.pop() }))
test('extra or duplicate chunk is rejected', () => rejectMutation(archive => { archive.chunks.push(clone(archive.chunks[0])) }))
test('reordered chunks are rejected', () => rejectMutation(archive => { archive.chunks.reverse() }))
test('incorrect chunk count and index are rejected', () => {
  rejectMutation(archive => { archive.chunks[0].count++ })
  rejectMutation(archive => { archive.chunks[0].index++ })
})
test('duplicate manifest keys and omitted manifest entries are rejected', () => {
  rejectMutation(archive => { archive.manifest.keys.push(clone(archive.manifest.keys[0])) })
  rejectMutation(archive => { archive.manifest.keys.pop() })
})
test('duplicate JSON members are rejected even when their parsed values would match', () => {
  const raw = JSON.stringify(fixture()).replace('"schema":2', '"schema":2,"schema":2')
  assert.throws(() => library().parseBackupArchive(raw), /ARCHIVE_DUPLICATE/)
})
test('escaped duplicate JSON member names are rejected', () => {
  const raw = JSON.stringify(fixture()).replace('"schema":2', '"schema":2,"\\u0073chema":2')
  assert.throws(() => library().parseBackupArchive(raw), /ARCHIVE_DUPLICATE/)
})
test('valid manifest hash cannot admit duplicate keys or duplicate chunk indices', () => {
  const duplicateKey = fixture()
  duplicateKey.manifest.keys[1].key = duplicateKey.manifest.keys[0].key
  resignManifest(duplicateKey)
  assert.throws(() => library().parseBackupArchive(JSON.stringify(duplicateKey)), /ARCHIVE_DUPLICATE_OR_ORDER/)
  const badIndex = fixture()
  badIndex.manifest.keys[0].chunks[0].index = 4
  resignManifest(badIndex)
  assert.throws(() => library().parseBackupArchive(JSON.stringify(badIndex)), /ARCHIVE_CHUNK/)
})
test('valid manifest hash cannot admit omitted, extra or inconsistent chunks', () => {
  const changed = fixture()
  changed.manifest.keys[1].bytes++
  changed.manifest.totalBytes++
  resignManifest(changed)
  assert.throws(() => library().parseBackupArchive(JSON.stringify(changed)), /ARCHIVE_MANIFEST/)
  const wrongKeyHash = fixture()
  wrongKeyHash.manifest.keys[1].sha256 = '0'.repeat(64)
  resignManifest(wrongKeyHash)
  assert.throws(() => library().parseBackupArchive(JSON.stringify(wrongKeyHash)), /ARCHIVE_KEY_HASH/)
})
test('valid manifest hash cannot admit forbidden keys', () => {
  const archive = library().createBackupArchive({ 'fk-safe': 'value' }, metadata)
  archive.manifest.keys[0].key = 'fk-access-token'
  archive.chunks[0].key = 'fk-access-token'
  resignManifest(archive)
  assert.throws(() => library().parseBackupArchive(JSON.stringify(archive)), /ARCHIVE_KEY/)
})
test('invalid JSON, arrays and missing manifests are rejected', () => {
  for (const raw of ['{', '[]', 'null', '{}']) assert.throws(() => library().parseBackupArchive(raw), /ARCHIVE_/)
})
test('unknown fields cannot hide undeclared backup payloads', () => {
  const archive = { ...fixture(), extra: { 'fk-extra': 'unlisted' } }
  assert.throws(() => library().parseBackupArchive(JSON.stringify(archive)), /ARCHIVE_/)
})
test('empty values and empty record collection round-trip without omitted chunks', () => {
  const archive = library().createBackupArchive({}, metadata)
  assert.deepEqual(library().parseBackupArchive(JSON.stringify(archive)), { entries: {}, metadata })
})
