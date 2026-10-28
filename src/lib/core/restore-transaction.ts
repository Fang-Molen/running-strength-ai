import { sha256Hex } from './sha256-sync'

export type RestorePhase = 'PREPARED' | 'APPLYING' | 'COMMITTED' | 'ROLLING_BACK' | 'ROLLED_BACK' | 'RECOVERY_REQUIRED'
export type RestoreEntry = { backend: string; key: string; before: string | null; target: string | null; beforeHash: string; targetHash: string; intent: boolean; written: boolean; rolledBack: boolean }
export type RestoreOperation = { schema: 1; id: string; subject: string; phase: RestorePhase; createdAt: string; entries: RestoreEntry[]; checksum: string }
export type RestoreResult = { state: 'NOT_STARTED' | 'COMMITTED' | 'ROLLED_BACK' | 'RECOVERY_REQUIRED'; operationId: string; reason?: string; cacheRepairRequired?: boolean }
export type RestoreContext = {
  subject(): string
  /** Host must actually enforce isolation; a boolean from an uploaded file or UI is not evidence. */
  isolation(): Promise<boolean>
  journal: { load(id: string): Promise<RestoreOperation | null>; save(operation: RestoreOperation): Promise<void> }
  backends: Record<string, { read(key: string): Promise<string | null>; write(key: string, value: string | null): Promise<void> }>
  afterCommit?(operation: RestoreOperation): Promise<void>
}
type RestoreRequest = { id: string; subject: string; entries: { backend: string; key: string; target: string | null; expected: string | null }[] }
const phases: RestorePhase[] = ['PREPARED', 'APPLYING', 'COMMITTED', 'ROLLING_BACK', 'ROLLED_BACK', 'RECOVERY_REQUIRED']
const hash = (value: string | null) => sha256Hex(JSON.stringify(value))
const checksum = (op: RestoreOperation) => sha256Hex(JSON.stringify({ ...op, checksum: '' }))
const result = (op: Pick<RestoreOperation, 'id'>, state: RestoreResult['state'], reason?: string): RestoreResult => ({ operationId: op.id, state, ...(reason ? { reason } : {}) })
const message = (e: unknown) => e instanceof Error ? e.message : 'RESTORE_FAILED'

function validate(op: RestoreOperation, id: string): void {
  if (!op || op.schema !== 1 || op.id !== id || !phases.includes(op.phase) || !Array.isArray(op.entries) || !op.entries.length || op.checksum !== checksum(op)) throw Error('JOURNAL_INVALID')
  const addresses = new Set<string>()
  for (const entry of op.entries) {
    const address = JSON.stringify([entry.backend, entry.key])
    if (addresses.has(address) || typeof entry.backend !== 'string' || typeof entry.key !== 'string' || !entry.key || entry.beforeHash !== hash(entry.before) || entry.targetHash !== hash(entry.target)) throw Error('JOURNAL_INVALID')
    addresses.add(address)
  }
}
async function load(ctx: RestoreContext, id: string): Promise<RestoreOperation> {
  const op = await ctx.journal.load(id)
  if (!op) throw Error('JOURNAL_MISSING')
  validate(op, id)
  return op
}
async function save(ctx: RestoreContext, op: RestoreOperation): Promise<void> {
  op.checksum = checksum(op)
  // Adapters receive a detached value, as IDB does. A later mutation cannot alter a saved intent.
  await ctx.journal.save(structuredClone(op))
  const saved = await load(ctx, op.id)
  if (JSON.stringify(saved) !== JSON.stringify(op)) throw Error('JOURNAL_VERIFY_FAILED')
}
async function isolated(ctx: RestoreContext, op: Pick<RestoreOperation, 'subject'>): Promise<void> {
  if (ctx.subject() !== op.subject) throw Error('SUBJECT_CHANGED')
  if (!await ctx.isolation()) throw Error('WRITER_ISOLATION_UNPROVEN')
}
async function committed(ctx: RestoreContext, op: RestoreOperation): Promise<RestoreResult> {
  try { await ctx.afterCommit?.(structuredClone(op)); return result(op, 'COMMITTED') }
  catch { return { ...result(op, 'COMMITTED'), cacheRepairRequired: true } }
}

async function rollback(ctx: RestoreContext, op: RestoreOperation): Promise<RestoreResult> {
  try {
    await isolated(ctx, op)
    op.phase = 'ROLLING_BACK'; await save(ctx, op)
    for (const entry of [...op.entries].reverse()) {
      if (!entry.intent) continue
      await isolated(ctx, op)
      const backend = ctx.backends[entry.backend]
      if (!backend) throw Error('BACKEND_UNAVAILABLE')
      const current = await backend.read(entry.key)
      if (current !== entry.before) {
        if (current !== entry.target) throw Error('ROLLBACK_CONFLICT')
        await backend.write(entry.key, entry.before)
      }
      if (await backend.read(entry.key) !== entry.before) throw Error('ROLLBACK_VERIFY_FAILED')
      entry.rolledBack = true; await save(ctx, op)
    }
    // Unwritten locations are checked too: old main value never proves the mirror's value.
    for (const entry of op.entries) if (await ctx.backends[entry.backend].read(entry.key) !== entry.before) throw Error('ROLLBACK_CONFLICT')
    op.phase = 'ROLLED_BACK'; await save(ctx, op)
    return result(op, 'ROLLED_BACK')
  } catch (error) {
    // Never replace an unreadable log or guess that a failed commit did not happen.
    try {
      const authoritative = await load(ctx, op.id)
      if (authoritative.phase === 'COMMITTED') return committed(ctx, authoritative)
      if (authoritative.phase === 'ROLLED_BACK') return result(op, 'ROLLED_BACK')
      authoritative.phase = 'RECOVERY_REQUIRED'; await save(ctx, authoritative)
    } catch { /* retain last durable nonterminal log and all before-images */ }
    return result(op, 'RECOVERY_REQUIRED', message(error))
  }
}

/** Restart recovery uses the journal's authority, never the last in-memory phase. */
export async function recoverRestore(id: string, ctx: RestoreContext): Promise<RestoreResult> {
  let op: RestoreOperation
  try {
    op = await load(ctx, id)
    if (ctx.subject() !== op.subject) throw Error('SUBJECT_CHANGED')
  } catch (error) { return result({ id }, 'RECOVERY_REQUIRED', message(error)) }
  if (op.phase === 'COMMITTED') return committed(ctx, op)
  if (op.phase === 'ROLLED_BACK') return result(op, 'ROLLED_BACK')
  return rollback(ctx, op)
}

/** Writes only after complete verified before-images; every physical address has its own receipt. */
export async function executeRestore(request: RestoreRequest, ctx: RestoreContext): Promise<RestoreResult> {
  let op: RestoreOperation
  try {
    await isolated(ctx, request)
    if (!request.id || !request.subject || !request.entries.length) throw Error('REQUEST_INVALID')
    const previous = await ctx.journal.load(request.id)
    if (previous) {
      validate(previous, request.id)
      if (previous.subject !== request.subject || JSON.stringify(previous.entries.map(e => [e.backend, e.key, e.target])) !== JSON.stringify(request.entries.map(e => [e.backend, e.key, e.target]))) throw Error('REQUEST_ID_CONFLICT')
      return recoverRestore(request.id, ctx)
    }
    const entries: RestoreEntry[] = [], addresses = new Set<string>()
    for (const entry of request.entries) {
      const address = JSON.stringify([entry.backend, entry.key]), backend = ctx.backends[entry.backend]
      if (!backend || !entry.key || addresses.has(address)) throw Error('REQUEST_INVALID')
      addresses.add(address)
      const before = await backend.read(entry.key)
      if (before !== entry.expected) throw Error('PREVIEW_CHANGED')
      entries.push({ backend: entry.backend, key: entry.key, before, target: entry.target, beforeHash: hash(before), targetHash: hash(entry.target), intent: false, written: false, rolledBack: false })
    }
    op = { schema: 1, id: request.id, subject: request.subject, phase: 'PREPARED', createdAt: new Date().toISOString(), entries, checksum: '' }
    await save(ctx, op)
  } catch (error) { return result(request, 'NOT_STARTED', message(error)) }
  try {
    op.phase = 'APPLYING'; await save(ctx, op)
    for (const entry of op.entries) {
      await isolated(ctx, op)
      const backend = ctx.backends[entry.backend]
      if (await backend.read(entry.key) !== entry.before) throw Error('PREVIEW_CHANGED')
      entry.intent = true; await save(ctx, op)
      await backend.write(entry.key, entry.target)
      if (await backend.read(entry.key) !== entry.target) throw Error('TARGET_VERIFY_FAILED')
      entry.written = true; await save(ctx, op)
    }
    await isolated(ctx, op)
    for (const entry of op.entries) if (await ctx.backends[entry.backend].read(entry.key) !== entry.target) throw Error('TARGET_VERIFY_FAILED')
    op.phase = 'COMMITTED'; await save(ctx, op)
    return committed(ctx, op)
  } catch {
    // save(COMMITTED) may have succeeded while its acknowledgement failed.
    // A fresh authoritative read is mandatory before any rollback.
    return recoverRestore(op.id, ctx)
  }
}
