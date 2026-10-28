import { setBulkLayer, rawCurrentStore, currentStore, type BulkLayer, type MemoryStore } from './storage.ts'

/** v89.11.13：大块、非关键同步数据搬到 IndexedDB，解决 localStorage ~5M 字符配额写满（E-QUOTA）。
 *
 * 搬哪些：由下面的 BULK_FAMILIES 注册表按键名模式识别——任一手表来源的日内样本及其归档（fk-<来源>-intraday-v1…）、已确认训练导入、COROS 健康缓存。
 * 读取仍是同步的：启动时（渲染前）把这些键从 IndexedDB 一次性加载进内存；写入先进内存（同步，调用方马上读回得到），再异步落盘。
 *
 * 迁移（每个键、逐个进行）：① 原值先完整写入 IndexedDB 的 backup 存储（永久保留，不会自动删）；② 写入 kv 并读回、与原值逐字符比对；
 * ③ 全部一致才删 localStorage 里的旧键；任何一步失败都不删旧键，该键“钉”在 localStorage 里照旧工作，下次启动再试。
 * 规则：localStorage 里还有这个键，说明它比 IndexedDB 新（降级期间写的），以 localStorage 为准（IndexedDB 旧值也先备份）。
 * 降级：已经迁移过（localStorage 有标记）但这次 IndexedDB 打不开 → 这些键读为空、写入被拒绝（绝不拿空数据覆盖），其余数据不受影响。
 */
export const BULK_DB = 'fangkun-bulk-store-v1'
export const BULK_MARKER_KEY = 'fk-bulk-store-v1'
export const CONFIRMED_IMPORTS_KEY = 'fr255-confirmed-training-imports-v1'
/** 注册表：按“键名模式”识别要搬的大键，不写死某个品牌/型号；各来源的键名本来就带来源（garmin / coros / 其他），所以互不混合。
 *  新增手表来源只要沿用 fk-<来源>-intraday-v1… / <前缀>-confirmed-…imports-v1 的命名就自动覆盖。
 *  加入某个家族的前提：该家族的所有读写都已经走 currentStore()（直接读 localStorage 的键不能放进来，否则迁移后读不到）。
 *  暂未加入：fk-garmin-acts-v1 / fk-garmin-laps-v1（garmin-log.tsx、training-read-model.ts 仍直接读 localStorage）。 */
export const BULK_FAMILIES: readonly { id: string; pattern: RegExp }[] = [
  { id: 'watch-intraday', pattern: /^fk-[a-z0-9]+-intraday-v1(?::|$)/ },                              // fk-garmin-intraday-v1:<运动员>[:source-archive]、fk-coros-intraday-v1:…、其他来源同理
  { id: 'watch-confirmed-imports', pattern: /^(?:fr255|fk-[a-z0-9]+)-confirmed-(?:training-)?imports-v1(?::|$)/ }, // 已确认训练导入（含将来的各来源专属版本）
  { id: 'coros-health-cache', pattern: /^fk-coros-mcp-health-v1:/ },                                 // COROS 健康缓存及其 :archive: 旧账号归档
]
export const isBulkKey = (key: string): boolean => BULK_FAMILIES.some(f => f.pattern.test(key))
export type BulkState = 'OFF' | 'READY' | 'DEGRADED'
export type BulkStatus = { state: BulkState; reason: string; migrated: string[]; pinned: string[]; backedUp: string[] }

let state: BulkState = 'OFF', reason = ''
const mem = new Map<string, string>()
const pinned = new Set<string>()      // 迁移失败、仍留在 localStorage 的键
const fallbackDirty = new Set<string>() // 异步写 IndexedDB 失败后暂存在 localStorage 的键
let migrated: string[] = [], backedUp: string[] = []
let database: IDBDatabase | null = null
let queue: Promise<void> = Promise.resolve()
let activating: Promise<BulkStatus> | null = null
let channel: BroadcastChannel | null = null

export const bulkStatus = (): BulkStatus => ({ state, reason, migrated: [...migrated], pinned: [...pinned], backedUp: [...backedUp] })

function openDb(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BULK_DB, 1)
    request.onupgradeneeded = () => { for (const n of ['kv', 'backup', 'meta']) if (!request.result.objectStoreNames.contains(n)) request.result.createObjectStore(n) }
    request.onsuccess = () => { database = request.result; database.onversionchange = () => { database?.close(); database = null }; resolve(database) }
    request.onerror = () => reject(request.error ?? new Error('OPEN_FAILED'))
    request.onblocked = () => reject(new Error('DATABASE_BLOCKED'))
  })
}
function run<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    let req: IDBRequest<T> | void
    tx.oncomplete = () => resolve(req ? req.result : undefined)
    tx.onerror = () => reject(tx.error ?? new Error('TRANSACTION_FAILED'))
    tx.onabort = () => reject(tx.error ?? new Error('TRANSACTION_ABORTED'))
    try { req = work(tx) } catch (e) { try { tx.abort() } catch { /* already finished */ } reject(e) }
  })
}
function loadAll(db: IDBDatabase): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const out = new Map<string, string>(), tx = db.transaction('kv', 'readonly'), cursor = tx.objectStore('kv').openCursor()
    cursor.onsuccess = () => { const c = cursor.result; if (c) { out.set(String(c.key), String(c.value)); c.continue() } }
    tx.oncomplete = () => resolve(out); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
  })
}
const local = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
function localBulkKeys(ls: Storage): string[] { const out: string[] = []; for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && isBulkKey(k)) out.push(k) } return out }

/** 迁移一个键；返回是否成功（成功才已删除旧键）。 */
async function migrateKey(db: IDBDatabase, ls: Storage, key: string, existing: Map<string, string>): Promise<boolean> {
  const original = ls.getItem(key)
  if (original === null) return true
  const at = new Date().toISOString(), prior = existing.get(key)
  try {
    await run(db, ['kv', 'backup'], 'readwrite', tx => {
      tx.objectStore('backup').put({ schemaVersion: 1, key, value: original, chars: original.length, at, source: 'localStorage' }, `${key}@${at}`)
      if (prior !== undefined && prior !== original) tx.objectStore('backup').put({ schemaVersion: 1, key, value: prior, chars: prior.length, at, source: 'indexedDB-replaced' }, `${key}@${at}@replaced`)
      tx.objectStore('kv').put(original, key)
    })
    backedUp.push(key)
    const back = await run<string>(db, ['kv'], 'readonly', tx => tx.objectStore('kv').get(key))
    if (back !== original || ls.getItem(key) !== original) return false // 读回不一致或迁移期间被改：旧键不动
    ls.removeItem(key)
    mem.set(key, original); existing.set(key, original)
    migrated.push(key)
    return true
  } catch { return false }
}

async function activate(): Promise<BulkStatus> {
  const ls = local()
  if (!ls || typeof indexedDB === 'undefined') { state = 'OFF'; reason = 'INDEXED_DB_UNAVAILABLE'; return bulkStatus() }
  const everMigrated = ls.getItem(BULK_MARKER_KEY) !== null
  let db: IDBDatabase
  try { db = await openDb() } catch (e) {
    if (everMigrated) { setBulkLayer(layer); state = 'DEGRADED'; reason = 'OPEN_FAILED' } else { state = 'OFF'; reason = 'OPEN_FAILED' }
    return bulkStatus()
  }
  try {
    await queue // 重新进入时先等已排队的写入落盘，内存里的新值绝不被旧盘面覆盖
    const stored = await loadAll(db)
    if (state !== 'READY') { mem.clear(); for (const [k, v] of stored) if (isBulkKey(k)) mem.set(k, v) }
    pinned.clear()
    for (const key of localBulkKeys(ls)) { const ok = await migrateKey(db, ls, key, stored); if (!ok) pinned.add(key) }
    if (migrated.length || everMigrated || mem.size) { try { ls.setItem(BULK_MARKER_KEY, JSON.stringify({ v: 1, at: new Date().toISOString() })) } catch { /* 空间满也无妨：下次启动仍会走同样流程 */ } }
    state = 'READY'; reason = pinned.size ? 'SOME_KEYS_PINNED' : ''
    setBulkLayer(layer)
    if (typeof BroadcastChannel !== 'undefined' && !channel) {
      channel = new BroadcastChannel('fangkun-bulk-store')
      channel.onmessage = ev => { const key = ev.data?.key; if (typeof key === 'string' && isBulkKey(key) && database) void run<string>(database, ['kv'], 'readonly', tx => tx.objectStore('kv').get(key)).then(v => { if (typeof v === 'string') mem.set(key, v) }).catch(() => {}) }
    }
  } catch (e) {
    if (everMigrated) { setBulkLayer(layer); state = 'DEGRADED'; reason = 'LOAD_FAILED' } else { state = 'OFF'; reason = 'LOAD_FAILED' }
  }
  return bulkStatus()
}
/** 启动（渲染前）调用；重复调用共用同一次执行。失败时已迁移用户进入降级（不覆盖），未迁移用户保持原样。 */
export function activateBulkStore(): Promise<BulkStatus> {
  if (state === 'READY' && !pinned.size) return Promise.resolve(bulkStatus())
  if (activating) return activating
  const job = async () => (typeof navigator !== 'undefined' && navigator.locks?.request ? await navigator.locks.request('fangkun-bulk-migration', () => activate()) as BulkStatus : await activate())
  activating = job().finally(() => { activating = null })
  return activating
}
/** 等待所有已排队的 IndexedDB 写入落盘（测试、退出前使用）。 */
export async function flushBulkStore(): Promise<void> { await queue }

function persist(key: string, value: string | null) {
  queue = queue.then(async () => {
    const db = await openDb()
    await run(db, ['kv'], 'readwrite', tx => { if (value === null) tx.objectStore('kv').delete(key); else tx.objectStore('kv').put(value, key) })
    if (fallbackDirty.delete(key)) { try { local()?.removeItem(key) } catch { /* ignore */ } }
    try { channel?.postMessage({ key }) } catch { /* ignore */ }
  }).catch(() => {
    // 落盘失败：把值暂存回 localStorage（下次启动它比 IndexedDB 新，会被迁移回去）。仍写不进就只留内存，并报告。
    try { if (value === null) local()?.removeItem(key); else { local()?.setItem(key, value); fallbackDirty.add(key) } } catch { reason = 'PERSIST_FAILED' }
  })
}

const layer: BulkLayer = {
  isBulk: isBulkKey,
  owns: key => isBulkKey(key) && (state === 'DEGRADED' || (state === 'READY' && !pinned.has(key))),
  get: key => mem.get(key) ?? null,
  set: (key, value) => {
    if (state !== 'READY') { const e = new Error('BULK_STORE_UNAVAILABLE'); e.name = 'BulkStoreUnavailable'; throw e }
    mem.set(key, value); persist(key, value)
  },
  remove: key => {
    if (state !== 'READY') { const e = new Error('BULK_STORE_UNAVAILABLE'); e.name = 'BulkStoreUnavailable'; throw e }
    mem.delete(key); persist(key, null)
  },
  keys: () => [...mem.keys()],
}
/** 备份恢复用的存储入口：大块键走大块层，其余照旧（没挂大块层时就是 localStorage 本身）。 */
export function appStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  return {
    getItem: k => currentStore()?.getItem(k) ?? null,
    setItem: (k, v) => { const s = currentStore(); if (!s) throw new Error('E-NOSTORE'); s.setItem(k, v) },
    removeItem: k => { const s = currentStore() as MemoryStore | null; if (s?.removeItem) s.removeItem(k); else local()?.removeItem(k) },
  }
}
/** 超时仍没加载完时的保护：已迁移过的用户先进入降级（读为空、写入拒绝），绝不让空数据覆盖 IndexedDB 里的数据。 */
export function enterBulkDegradedIfMigrated(): void {
  if (state === 'READY') return
  const ls = local(); if (!ls) return
  try { if (ls.getItem(BULK_MARKER_KEY) !== null) { setBulkLayer(layer); state = 'DEGRADED'; reason = 'LOAD_TIMEOUT' } } catch { /* ignore */ }
}

/** 测试用：回到未启动状态。 */
export function resetBulkStoreForTest() {
  setBulkLayer(null); state = 'OFF'; reason = ''; mem.clear(); pinned.clear(); fallbackDirty.clear(); migrated = []; backedUp = []; queue = Promise.resolve(); activating = null
  try { database?.close() } catch { /* ignore */ } database = null
  try { channel?.close() } catch { /* ignore */ } channel = null
}
/** 备份/导出用：大块层里的全部键值（在内存里，不含 localStorage 里仍钉着的键）。 */
export function bulkEntries(): Record<string, string> { return Object.fromEntries(mem) }
export { rawCurrentStore }
