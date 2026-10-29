import {notifyStorageChange} from './storage-changes'
export type MemoryStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
  /** Durable key enumeration is required by the append-only journal. */
  keys?(): readonly string[]
  key?(index: number): string | null
  readonly length?: number
}

export type Envelope<T> = {
  schemaVersion: number
  revision: number
  updatedAt: string
  data: T
}

const SCHEMA = 1

let backend: MemoryStore | null = null

export function setStoreBackend(store: MemoryStore | null) {
  backend = store
  notifyStorageChange("BACKEND_CHANGED")
}

/** v89.11.13：大块、非关键同步数据（佳明日内样本、已确认训练导入）改放 IndexedDB（见 bulk-store.ts）。
 * 只有浏览器里启动加载完成后才会挂上这一层；单测/服务端永远不会挂，行为与以前完全一致。 */
export type BulkLayer = {
  isBulk(key: string): boolean
  /** true：该键当前由这一层负责（已迁移、或层处于降级状态不允许写 localStorage）。 */
  owns(key: string): boolean
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
  keys(): readonly string[]
}
let bulk: BulkLayer | null = null
export function setBulkLayer(layer: BulkLayer | null) { bulk = layer; notifyStorageChange("BULK_CHANGED") }
export function bulkLayerActive(): boolean { return bulk !== null }
const wrappers = new WeakMap<object, { layer: BulkLayer; wrapped: MemoryStore }>()
function rawStore(): MemoryStore | null {
  if (backend) return backend
  if (typeof localStorage === "undefined") return null
  return localStorage
}
function baseKeys(box: MemoryStore): string[] {
  if (box.keys) return [...box.keys()]
  if (box.key && typeof box.length === "number") { const out: string[] = []; for (let i = 0; i < box.length; i++) { const k = box.key(i); if (k != null) out.push(k) } return out }
  return []
}
function store(): MemoryStore | null {
  const base = rawStore()
  if (!base || !bulk) return base
  const layer = bulk
  const hit = wrappers.get(base)
  if (hit && hit.layer === layer) return hit.wrapped
  const wrapped: MemoryStore = {
    getItem: key => layer.owns(key) ? layer.get(key) : base.getItem(key),
    setItem: (key, value) => { if (layer.owns(key)) layer.set(key, value); else base.setItem(key, value) },
    removeItem: key => { if (layer.owns(key)) layer.remove(key); else base.removeItem?.(key) },
    keys: () => [...new Set([...baseKeys(base), ...layer.keys()])],
  }
  wrappers.set(base, { layer, wrapped })
  return wrapped
}
/** 绕过大块层的原始存储（只给大块层自己和测试用）。 */
export function rawCurrentStore(): MemoryStore | null { return rawStore() }

export function currentStore(): MemoryStore | null {
  return store()
}

export function readEnvelope<T>(key: string, fallback: T): Envelope<T> {
  const empty: Envelope<T> = { schemaVersion: SCHEMA, revision: 0, updatedAt: "", data: fallback }
  const box = store()
  if (!box) return empty
  try {
    const raw = box.getItem(key)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<Envelope<T>>
    if (!parsed || typeof parsed !== "object" || !("data" in parsed)) return empty
    return {
      schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : SCHEMA,
      revision: typeof parsed.revision === "number" ? parsed.revision : 0,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      data: parsed.data === undefined ? fallback : parsed.data,
    }
  } catch {
    return empty
  }
}

export function writeEnvelope<T>(key: string, data: T, revision?: number): Envelope<T> | null {
  const box = store()
  if (!box) return null
  const prev = readEnvelope<T>(key, data)
  const next: Envelope<T> = {
    schemaVersion: SCHEMA,
    revision: revision ?? prev.revision + 1,
    updatedAt: new Date().toISOString(),
    data,
  }
  try {
    box.setItem(key, JSON.stringify(next))
    notifyStorageChange(key)
    return next
  } catch {
    notifyStorageChange(key) // A failed acknowledgement may follow a completed write.
    return null
  }
}
