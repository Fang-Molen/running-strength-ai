import { sha256Hex } from './sha256-sync.ts'

/** Bounded, synchronous JSON container. This is not a streaming reader/writer:
 * callers must budget for the input, parsed document, chunks and reconstructed
 * values in memory. Scope describes supplied records, not a storage snapshot.
 * Hashes detect corruption; they do not authenticate who created the file.
 */
export const BACKUP_ARCHIVE_FORMAT = 'fangkun-chunked-backup' as const
export const BACKUP_ARCHIVE_SCHEMA = 2 as const
export const BACKUP_ARCHIVE_MAX_PAYLOAD_BYTES = 64 * 1024 * 1024
export const BACKUP_ARCHIVE_MAX_JSON_BYTES = 128 * 1024 * 1024
export const BACKUP_ARCHIVE_CHUNK_BYTES = 256 * 1024
export const BACKUP_ARCHIVE_MAX_KEYS = 10_000
const MAX_CHUNKS = BACKUP_ARCHIVE_MAX_KEYS + Math.ceil(BACKUP_ARCHIVE_MAX_PAYLOAD_BYTES / (BACKUP_ARCHIVE_CHUNK_BYTES - 3))

export type BackupArchiveMetadata = {
  athleteId: string
  exportedAt: string
  included: string[]
  excluded: string[]
}
export type BackupArchiveChunkManifest = { index: number; bytes: number; sha256: string }
export type BackupArchiveKeyManifest = {
  key: string
  bytes: number
  sha256: string
  chunkCount: number
  chunks: BackupArchiveChunkManifest[]
}
export type BackupArchiveManifest = { keyCount: number; totalBytes: number; keys: BackupArchiveKeyManifest[] }
export type BackupArchiveChunk = BackupArchiveChunkManifest & { key: string; count: number; data: string }
export type BackupArchive = {
  format: typeof BACKUP_ARCHIVE_FORMAT
  schema: typeof BACKUP_ARCHIVE_SCHEMA
  metadata: BackupArchiveMetadata
  manifest: BackupArchiveManifest
  manifestHash: string
  chunks: BackupArchiveChunk[]
}

function fail(code: string): never { throw new Error(`ARCHIVE_${code}`) }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max
const hash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
function fields(value: unknown, names: string[], code = 'STRUCTURE'): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) fail(code)
}

/** Consumers may intentionally exclude these keys and declare that scope.
 * create/parse reject them, so no archive ever silently loses supplied records.
 * Persistent transaction state belongs to the source device, not a portable
 * import; restoring it could replay an unrelated pending write on a new device.
 */
export function isBackupArchiveKeyAllowed(key: string): boolean {
  return typeof key === 'string' && key.length > 0 && key.length <= 512 && !/[\u0000-\u001f\u007f]/.test(key)
    && !key.startsWith('__') && !['constructor', 'prototype'].includes(key)
    && !/^grok-auth\./i.test(key)
    && !/(?:bearer|access|refresh|id)[-_.]?token|secret|password|api[-_]?key/i.test(key)
    && !/^(?:fk-bulk-store-v1|fangkun-core-storage-mode-v1|fk-schedule-v1-(?:pending-write|rev))(?::|$)/.test(key)
    && !/^(?:(?:fk|fr255|fangkun)-)?(?:storage-(?:recovery|coordinator|coordination|generation|sentinel)|restore(?:-journal|-state|-marker|-generation|-sentinel|-lock)?)(?:[-:]|$)/i.test(key)
    && !/^fr255-schedule-write-intent(?:[-:]|$)/.test(key)
    && !/^fk-(?:restore|recovery)-/.test(key)
}

/** Valid Unicode is required so distinct JS strings cannot acquire the same
 * replacement-character UTF-8 hash. jsonBytes counts quotes and JSON escapes. */
function textSize(text: string, limit = BACKUP_ARCHIVE_MAX_PAYLOAD_BYTES): { bytes: number; jsonBytes: number } {
  if (text.length > limit) fail('CAPACITY')
  let bytes = 0, jsonBytes = 2
  for (let index = 0; index < text.length; index++) {
    const c = text.charCodeAt(index)
    let size: number
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('UNICODE')
      size = 4
    } else if (c >= 0xdc00 && c <= 0xdfff) fail('UNICODE')
    else size = c < 0x80 ? 1 : c < 0x800 ? 2 : 3
    bytes += size
    jsonBytes += c === 34 || c === 92 || [8, 9, 10, 12, 13].includes(c) ? 2 : c < 32 ? 6 : size
    if (bytes > limit) fail('CAPACITY')
  }
  return { bytes, jsonBytes }
}

function metadataOf(input: unknown): BackupArchiveMetadata {
  fields(input, ['athleteId', 'exportedAt', 'included', 'excluded'], 'METADATA')
  const { athleteId, exportedAt, included, excluded } = input
  if (typeof athleteId !== 'string' || !athleteId.trim() || athleteId.length > 200
    || typeof exportedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(exportedAt)
    || !Number.isFinite(Date.parse(exportedAt))) fail('METADATA')
  const scope = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 64
    && value.every(label => typeof label === 'string' && !!label.trim() && label.length <= 512)
    && new Set(value).size === value.length
  if (!scope(included) || !included.length || !scope(excluded) || excluded.some(label => included.includes(label))) fail('METADATA')
  for (const value of [athleteId, exportedAt, ...included, ...excluded]) textSize(value)
  return { athleteId, exportedAt, included: [...included], excluded: [...excluded] }
}

function splitValue(value: string): string[] {
  if (!value.length) return ['']
  const chunks: string[] = []
  let start = 0, bytes = 0
  for (let index = 0; index < value.length; index++) {
    const c = value.charCodeAt(index), pair = c >= 0xd800 && c <= 0xdbff
    const size = pair ? 4 : c < 0x80 ? 1 : c < 0x800 ? 2 : 3
    if (bytes + size > BACKUP_ARCHIVE_CHUNK_BYTES) { chunks.push(value.slice(start, index)); start = index; bytes = 0 }
    bytes += size
    if (pair) index++
  }
  chunks.push(value.slice(start))
  return chunks
}

/** Fixed field order makes the manifest digest independent of JSON whitespace
 * and object member order. Array order is part of the manifest contract. */
function manifestHash(metadata: BackupArchiveMetadata, manifest: BackupArchiveManifest): string {
  return sha256Hex(JSON.stringify({ format: BACKUP_ARCHIVE_FORMAT, schema: BACKUP_ARCHIVE_SCHEMA, metadata, manifest }))
}

export function createBackupArchive(entries: Record<string, string>, metadata: BackupArchiveMetadata): BackupArchive {
  const scope = metadataOf(metadata)
  if (!object(entries)) fail('ENTRIES')
  const keys = Object.keys(entries).sort()
  if (keys.length > BACKUP_ARCHIVE_MAX_KEYS) fail('CAPACITY')
  let totalBytes = 0, escapedBytes = 0
  const sizes = new Map<string, number>()
  // Check the entire payload before building any apparently complete artifact.
  for (const key of keys) {
    if (!isBackupArchiveKeyAllowed(key)) fail('KEY')
    textSize(key)
    const value = entries[key]
    if (typeof value !== 'string') fail('VALUE')
    const size = textSize(value, BACKUP_ARCHIVE_MAX_PAYLOAD_BYTES - totalBytes)
    totalBytes += size.bytes; escapedBytes += size.jsonBytes; sizes.set(key, size.bytes)
    if (escapedBytes > BACKUP_ARCHIVE_MAX_JSON_BYTES) fail('CAPACITY')
  }
  const manifest: BackupArchiveManifest = { keyCount: keys.length, totalBytes, keys: [] }
  const chunks: BackupArchiveChunk[] = []
  let dataJsonBytes = 0
  for (const key of keys) {
    const value = entries[key], values = splitValue(value)
    const parts = values.map((data, index): BackupArchiveChunk => {
      const size = textSize(data, BACKUP_ARCHIVE_CHUNK_BYTES)
      dataJsonBytes += size.jsonBytes - 2
      return { key, index, count: values.length, bytes: size.bytes, sha256: sha256Hex(data), data }
    })
    manifest.keys.push({ key, bytes: sizes.get(key)!, sha256: sha256Hex(value), chunkCount: parts.length,
      chunks: parts.map(({ index, bytes, sha256 }) => ({ index, bytes, sha256 })) })
    chunks.push(...parts)
  }
  const archive: BackupArchive = { format: BACKUP_ARCHIVE_FORMAT, schema: BACKUP_ARCHIVE_SCHEMA,
    metadata: scope, manifest, manifestHash: manifestHash(scope, manifest), chunks }
  const skeleton = { ...archive, chunks: chunks.map(chunk => ({ ...chunk, data: '' })) }
  if (textSize(JSON.stringify(skeleton), BACKUP_ARCHIVE_MAX_JSON_BYTES).bytes + dataJsonBytes > BACKUP_ARCHIVE_MAX_JSON_BYTES) fail('CAPACITY')
  return archive
}

/** JSON.parse otherwise silently accepts duplicate object members. This scanner
 * only collects keys; JSON.parse remains responsible for the JSON grammar. */
function rejectDuplicateMembers(raw: string): void {
  const stack: { keys: Set<string> | null; expectsKey: boolean }[] = []
  for (let index = 0; index < raw.length; index++) {
    const c = raw[index]
    if (c === '{' || c === '[') {
      if (stack.length > 16) fail('STRUCTURE')
      stack.push({ keys: c === '{' ? new Set() : null, expectsKey: c === '{' })
    } else if (c === '}' || c === ']') stack.pop()
    else if (c === ',') { const top = stack.at(-1); if (top?.keys) top.expectsKey = true }
    else if (c === '"') {
      const start = index++
      while (index < raw.length && raw[index] !== '"') { if (raw[index] === '\\') index++; index++ }
      const top = stack.at(-1)
      if (top?.keys && top.expectsKey) {
        const key: string = JSON.parse(raw.slice(start, index + 1))
        if (top.keys.has(key)) fail('DUPLICATE')
        top.keys.add(key); top.expectsKey = false
      }
    }
  }
}

export function parseBackupArchive(raw: string): { entries: Record<string, string>; metadata: BackupArchiveMetadata } {
  if (typeof raw !== 'string') fail('JSON')
  textSize(raw, BACKUP_ARCHIVE_MAX_JSON_BYTES)
  let input: unknown
  try { input = JSON.parse(raw) } catch { return fail('JSON') }
  rejectDuplicateMembers(raw)
  fields(input, ['format', 'schema', 'metadata', 'manifest', 'manifestHash', 'chunks'])
  if (input.format !== BACKUP_ARCHIVE_FORMAT || input.schema !== BACKUP_ARCHIVE_SCHEMA) fail('VERSION')
  const metadata = metadataOf(input.metadata)
  fields(input.manifest, ['keyCount', 'totalBytes', 'keys'])
  const source = input.manifest
  if (!integer(source.keyCount, BACKUP_ARCHIVE_MAX_KEYS) || !integer(source.totalBytes, BACKUP_ARCHIVE_MAX_PAYLOAD_BYTES)
    || !Array.isArray(source.keys) || source.keys.length !== source.keyCount
    || !Array.isArray(input.chunks) || input.chunks.length > MAX_CHUNKS || !hash(input.manifestHash)) fail('MANIFEST')
  const manifest: BackupArchiveManifest = { keyCount: source.keyCount, totalBytes: source.totalBytes, keys: [] }
  let lastKey: string | null = null, declaredBytes = 0, declaredChunks = 0
  for (const row of source.keys) {
    fields(row, ['key', 'bytes', 'sha256', 'chunkCount', 'chunks'])
    if (typeof row.key !== 'string' || !isBackupArchiveKeyAllowed(row.key)) fail('KEY')
    textSize(row.key)
    if (lastKey !== null && row.key <= lastKey) fail('DUPLICATE_OR_ORDER')
    lastKey = row.key
    if (!integer(row.bytes, BACKUP_ARCHIVE_MAX_PAYLOAD_BYTES) || !hash(row.sha256)
      || !integer(row.chunkCount, MAX_CHUNKS) || row.chunkCount < 1 || !Array.isArray(row.chunks)
      || row.chunks.length !== row.chunkCount) fail('MANIFEST')
    const parts: BackupArchiveChunkManifest[] = []
    let keyBytes = 0
    for (const [index, part] of row.chunks.entries()) {
      fields(part, ['index', 'bytes', 'sha256'])
      if (part.index !== index || !integer(part.bytes, BACKUP_ARCHIVE_CHUNK_BYTES) || !hash(part.sha256)
        || (part.bytes === 0 && (row.bytes !== 0 || row.chunkCount !== 1))) fail('CHUNK')
      keyBytes += part.bytes; parts.push({ index, bytes: part.bytes, sha256: part.sha256 })
    }
    if (keyBytes !== row.bytes) fail('MANIFEST')
    declaredBytes += row.bytes; declaredChunks += row.chunkCount
    if (declaredBytes > BACKUP_ARCHIVE_MAX_PAYLOAD_BYTES || declaredChunks > MAX_CHUNKS) fail('CAPACITY')
    manifest.keys.push({ key: row.key, bytes: row.bytes, sha256: row.sha256, chunkCount: row.chunkCount, chunks: parts })
  }
  if (declaredBytes !== manifest.totalBytes || declaredChunks !== input.chunks.length
    || manifestHash(metadata, manifest) !== input.manifestHash) fail('MANIFEST')
  const entries: Record<string, string> = {}
  let cursor = 0
  for (const row of manifest.keys) {
    const values: string[] = []
    for (const expected of row.chunks) {
      const chunk: unknown = input.chunks[cursor++]
      fields(chunk, ['key', 'index', 'count', 'bytes', 'sha256', 'data'])
      if (chunk.key !== row.key || chunk.index !== expected.index || chunk.count !== row.chunkCount
        || chunk.bytes !== expected.bytes || chunk.sha256 !== expected.sha256 || typeof chunk.data !== 'string') fail('CHUNK')
      if (textSize(chunk.data, BACKUP_ARCHIVE_CHUNK_BYTES).bytes !== expected.bytes || sha256Hex(chunk.data) !== expected.sha256) fail('CHUNK_HASH')
      values.push(chunk.data)
    }
    const value = values.join('')
    if (textSize(value).bytes !== row.bytes || sha256Hex(value) !== row.sha256) fail('KEY_HASH')
    Object.defineProperty(entries, row.key, { value, enumerable: true, writable: true, configurable: true })
  }
  return { entries, metadata }
}
