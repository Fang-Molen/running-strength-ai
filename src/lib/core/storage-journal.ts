import { currentStore, type MemoryStore } from "./storage.ts";

/** recordedAt (ported additively from K20): wall-clock commit time. Absent on legacy entries = unknown, never inferred from order. */
type Entry<T> = { schemaVersion: 1; id: string; order: number; data: T; recordedAt?: string };
const clocks = new WeakMap<MemoryStore, number>();
export function storeKeys(box: MemoryStore): string[] {
  if (box.keys) return [...box.keys()];
  if (box.key && typeof box.length === "number") {
    const result: string[] = [];
    for (let i = 0; i < box.length; i++) {
      const key = box.key(i);
      if (key != null) result.push(key);
    }
    return result;
  }
  throw new Error("KEY_ENUMERATION_REQUIRED");
}
export type JournalEntry<T> = Entry<T>;
export function readJournal<T>(prefix: string): Entry<T>[] {
  const box = currentStore();
  if (!box) return [];
  let keys: string[];
  try {
    keys = storeKeys(box);
  } catch {
    return [];
  }
  const records: Entry<T>[] = [];
  for (const key of keys.filter((k) => k.startsWith(prefix))) {
    try {
      const x = JSON.parse(box.getItem(key) ?? "null") as Entry<T> | null;
      if (
        x?.schemaVersion === 1 &&
        typeof x.id === "string" &&
        Number.isFinite(x.order) &&
        x.data != null
      )
        records.push(x);
    } catch {
      /* malformed entry retained in storage, never silently deleted */
    }
  }
  return records.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
/** One localStorage setItem commits one immutable physical record. No shared array or mutable index. */
export function appendJournal<T>(prefix: string, id: string, data: T): boolean {
  const box = currentStore();
  if (!box) return false;
  try {
    storeKeys(box); // Unsupported adapters fail visibly instead of pretending to persist unreadable records.
    const latest = readJournal<unknown>("fr255-").at(-1)?.order ?? 0;
    const order = Math.max(Date.now(), latest + 1, (clocks.get(box) ?? 0) + 1);
    clocks.set(box, order);
    const nonce = crypto.randomUUID();
    const key = prefix + id + ":" + nonce;
    const serialized = JSON.stringify({ schemaVersion: 1, id, order, data, recordedAt: new Date().toISOString() });
    box.setItem(key, serialized);
    return box.getItem(key) === serialized;
  } catch {
    return false;
  }
}
