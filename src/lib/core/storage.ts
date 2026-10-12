export type MemoryStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
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
}

function store(): MemoryStore | null {
  if (backend) return backend
  if (typeof localStorage === "undefined") return null
  return localStorage
}

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
    return next
  } catch {
    return null
  }
}
