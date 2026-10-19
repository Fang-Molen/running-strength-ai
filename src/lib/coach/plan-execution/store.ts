import { emptyPlanExecution, type PlanExecutionDocument, type PlanExecutionRepository } from './core.ts'

/** An independent authoritative execution-overlay journal, not the asynchronous core
 * localStorage mirror. One transaction owns source/target day versions, overlays,
 * proposals and append-only receipts. No original plan or actual event is written.
 */
export const PLAN_EXECUTION_DB = 'fangkun-coach-plan-execution-v1'
const STORE = 'athlete-execution'
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export function validatePlanExecutionDocument(value: unknown, athleteId: string): PlanExecutionDocument {
  if (value === undefined) return emptyPlanExecution(athleteId)
  if (!value || typeof value !== 'object') throw new Error('INVALID_EXECUTION_DOCUMENT')
  const doc = value as PlanExecutionDocument
  if (doc.schemaVersion !== 1 || doc.athleteId !== athleteId || !Number.isSafeInteger(doc.revision) || doc.revision < 0 || !doc.proposals || !doc.receipts || !doc.overlays || !doc.dayVersions) throw new Error('INVALID_EXECUTION_DOCUMENT')
  if ([doc.proposals, doc.receipts, doc.overlays, doc.dayVersions].some(v => typeof v !== 'object' || Array.isArray(v))) throw new Error('INVALID_EXECUTION_DOCUMENT')
  const id = (v: unknown) => typeof v === 'string' && !!v.trim() && v.length <= 200
  const day = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
  const version = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  const at = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v))
  const actor = (v: unknown) => !!v && typeof v === 'object' && ['subjectId', 'athleteId', 'deviceId', 'profileVersion'].every(k => id((v as Record<string, unknown>)[k])) && (v as Record<string, unknown>).athleteId === athleteId && (v as Record<string, unknown>).scope === 'LOCAL_DEVICE_ONLY'
  const move = (v: unknown) => !!v && typeof v === 'object' && ['scheduleId', 'componentId'].every(k => id((v as Record<string, unknown>)[k])) && ['fromDate', 'toDate', 'originalDate'].every(k => day((v as Record<string, unknown>)[k])) && (v as Record<string, unknown>).fromDate !== (v as Record<string, unknown>).toDate
  const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
  const dayVersions = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([d, n]) => day(d) && version(n))
  if (!dayVersions(doc.dayVersions)) throw new Error('INVALID_EXECUTION_DAY_VERSIONS')
  for (const [key, proposal] of Object.entries(doc.proposals)) {
    if (!proposal || proposal.id !== key || !id(key) || !actor(proposal.actor) || proposal.kind !== 'MOVE_UNSTARTED_COMPONENT' || !move(proposal.move) || !digest(proposal.diffHash) || typeof proposal.contextSignature !== 'string' || !proposal.contextSignature || !version(proposal.targetVersion) || !dayVersions(proposal.dayVersions) || !at(proposal.createdAt) || !at(proposal.expiresAt) || !['PENDING', 'APPLIED', 'INVALIDATED'].includes(proposal.state) || !['READY_LOCAL', 'BLOCKED_UNCOORDINATED'].includes(proposal.executionEligibility) || proposal.canApplyAutomatically !== false) throw new Error('INVALID_EXECUTION_PROPOSAL')
  }
  for (const [key, receipt] of Object.entries(doc.receipts)) {
    if (!receipt || receipt.id !== key || !id(key) || !actor(receipt.actor) || !id(receipt.proposalId) || !doc.proposals[receipt.proposalId] || !move(receipt.move) || !digest(receipt.diffHash) || !version(receipt.targetVersion) || receipt.targetVersion === 0 || !at(receipt.appliedAt) || !['MOVE', 'UNDO'].includes(receipt.kind) || receipt.persistence !== 'LOCAL_ONLY' || receipt.cloudSynchronized !== false) throw new Error('INVALID_EXECUTION_RECEIPT')
    if (receipt.kind === 'UNDO' && (!receipt.undoOf || doc.receipts[receipt.undoOf]?.kind !== 'MOVE')) throw new Error('INVALID_UNDO_RECEIPT')
  }
  for (const [key, overlay] of Object.entries(doc.overlays)) {
    const receipt = overlay && doc.receipts[overlay.receiptId]
    if (!overlay || !day(overlay.date) || !version(overlay.version) || overlay.version === 0 || !id(overlay.sourceVersion) || !receipt || receipt.targetVersion !== overlay.version || receipt.move.toDate !== overlay.date || JSON.stringify([receipt.move.scheduleId, receipt.move.componentId]) !== key) throw new Error('INVALID_EXECUTION_OVERLAY')
  }
  return doc
}
/** A real IndexedDB implementation. If IndexedDB is missing/blocked/quota-limited,
 * reject: there is intentionally no two-write localStorage fallback.
 */
export function createIndexedDbPlanExecutionRepository(factory: IDBFactory = globalThis.indexedDB): PlanExecutionRepository & { close(): void } {
  let opened: Promise<IDBDatabase> | null = null, database: IDBDatabase | null = null
  function open(): Promise<IDBDatabase> {
    if (!factory) return Promise.reject(new Error('INDEXED_DB_UNAVAILABLE'))
    if (opened) return opened
    opened = new Promise((resolve, reject) => {
      const request = factory.open(PLAN_EXECUTION_DB, 1)
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE) }
      request.onsuccess = () => {
        database = request.result
        database.onversionchange = () => { database?.close(); database = null; opened = null }
        resolve(database)
      }
      request.onerror = () => { opened = null; reject(request.error ?? new Error('INDEXED_DB_OPEN_FAILED')) }
      request.onblocked = () => { opened = null; reject(new Error('INDEXED_DB_BLOCKED')) }
    })
    return opened
  }
  return {
    async read(athleteId) {
      const db = await open()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly'), request = tx.objectStore(STORE).get(athleteId)
        let value: PlanExecutionDocument
        request.onsuccess = () => { try { value = clone(validatePlanExecutionDocument(request.result, athleteId)) } catch (e) { reject(e); tx.abort() } }
        tx.oncomplete = () => resolve(value!)
        tx.onerror = () => reject(tx.error ?? new Error('READ_FAILED'))
        tx.onabort = () => reject(tx.error ?? new Error('READ_ABORTED'))
      })
    },
    async transact<T>(athleteId: string, work: (draft: PlanExecutionDocument) => T): Promise<T> {
      const db = await open()
      return new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), request = store.get(athleteId)
        let result: T, workError: unknown
        request.onsuccess = () => {
          try {
            const before = validatePlanExecutionDocument(request.result, athleteId), draft = clone(before)
            result = work(draft)
            if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('ASYNC_TRANSACTION_CALLBACK_FORBIDDEN')
            validatePlanExecutionDocument(draft, athleteId)
            // Enforce receipt immutability even when a future consumer supplies another reducer.
            for (const [id, receipt] of Object.entries(before.receipts)) if (JSON.stringify(draft.receipts[id]) !== JSON.stringify(receipt)) throw new Error('RECEIPT_HISTORY_OVERWRITE')
            store.put(draft, athleteId)
          } catch (e) { workError = e; tx.abort() }
        }
        tx.oncomplete = () => resolve(result!)
        tx.onerror = () => reject(workError ?? tx.error ?? new Error('WRITE_FAILED'))
        tx.onabort = () => reject(workError ?? tx.error ?? new Error('WRITE_ABORTED'))
      })
    },
    close() { database?.close(); database = null; opened = null },
  }
}
