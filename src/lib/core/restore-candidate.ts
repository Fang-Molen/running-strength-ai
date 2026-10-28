import { sha256Hex } from './sha256-sync'

export const RESTORE_CANDIDATE_DB = 'fangkun-restore-candidates-v1'
export type CandidateRepository = { write(id: string, value: string): Promise<void>; read(id: string): Promise<string | null> }
export type CandidateResult = { ok: false; state: 'CANDIDATE_READY' | 'NOT_STARTED' | 'REVIEW_REQUIRED'; reason: string; candidateId?: string }
type Context = { subject: string; currentSubject(): string; readSource(key: string): string | null; repository?: CandidateRepository }

async function candidateDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RESTORE_CANDIDATE_DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('candidates')
    request.onerror = () => reject(request.error ?? Error('CANDIDATE_DB_FAILED'))
    request.onblocked = () => reject(Error('CANDIDATE_DB_BLOCKED'))
    request.onsuccess = () => resolve(request.result)
  })
}
async function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await candidateDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('candidates', mode)
      const request = work(tx.objectStore('candidates'))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error ?? Error('CANDIDATE_TX_FAILED'))
      tx.onabort = () => reject(tx.error ?? Error('CANDIDATE_TX_ABORTED'))
    })
  } finally { db.close() }
}
const repository: CandidateRepository = {
  async write(id, value) { await transact('readwrite', store => store.put(value, id)) },
  async read(id) { return (await transact<string | undefined>('readonly', store => store.get(id))) ?? null },
}

/** Legacy tabs cannot be forcibly stopped by a page-level Web Lock. Never fabricate that guarantee.
 * Stage an immutable copy in a separate database; do not switch active stores or modify source keys. */
export async function stageRestoreCandidate(entries: { key: string; value: string }[], context: Context): Promise<CandidateResult> {
  let candidateId: string | undefined
  try {
    if (!entries.length || context.subject !== context.currentSubject()) throw Error('SUBJECT_CHANGED')
    const keys = new Set<string>()
    const candidate = {
      schema: 1, id: candidateId = crypto.randomUUID(), subject: context.subject, createdAt: new Date().toISOString(),
      active: false, sourceConsistency: 'UNVERIFIED_CROSS_STORE_SNAPSHOT',
      entries: entries.map(entry => {
        if (!entry.key || keys.has(entry.key) || typeof entry.value !== 'string') throw Error('CANDIDATE_INVALID')
        keys.add(entry.key)
        return { key: entry.key, sourceValue: context.readSource(entry.key), target: entry.value }
      }),
    }
    const serialized = JSON.stringify(candidate), digest = sha256Hex(serialized)
    const store = context.repository ?? repository
    await store.write(candidate.id, serialized)
    const persisted = await store.read(candidate.id)
    if (persisted !== serialized || sha256Hex(persisted) !== digest) throw Error('CANDIDATE_VERIFY_FAILED')
    if (context.currentSubject() !== context.subject || candidate.entries.some(entry => context.readSource(entry.key) !== entry.sourceValue)) {
      return { ok: false, state: 'REVIEW_REQUIRED', candidateId, reason: '资料或身份已变化。候选副本已隔离保存，需重新预检；当前记录未修改。' }
    }
    return { ok: false, state: 'CANDIDATE_READY', candidateId, reason: '恢复候选及原值副本已保存并读回校验，当前记录未修改。无法保证旧标签页已停止写入，因此尚未覆盖恢复；需在可保证写入隔离的环境复核后执行。' }
  } catch {
    return { ok: false, state: 'NOT_STARTED', ...(candidateId ? { candidateId } : {}), reason: '恢复备份未能完成或读回校验失败，已停止恢复；当前记录未修改。' }
  }
}

export async function readRestoreCandidate(id: string): Promise<string | null> { return repository.read(id) }
