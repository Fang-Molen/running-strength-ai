/**
 * 方坤数据保险箱：把本站全部 localStorage 记录（训练、计划、日志、佳明导入、方坤对话、反馈）
 * 实时镜像到 IndexedDB，并申请持久化存储。schema 带版本号，升级只追加迁移，从不清空。
 */
export const VAULT_DB = "fangkun-vault";
export const VAULT_SCHEMA = 1;
const MIGRATIONS: Record<number, (kv: Map<string, string>) => void> = {
  // 1: 初始版本。以后新增：2: (kv) => { ...只改写/补字段，不删除用户数据... }
};
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(VAULT_DB, 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv"); if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(store, mode); const q = fn(t.objectStore(store)); t.oncomplete = () => res(q ? (q as IDBRequest<T>).result : undefined); t.onerror = () => rej(t.error); });
}
export async function vaultAll(): Promise<Map<string, string>> {
  const d = await db();
  return new Promise((res, rej) => { const out = new Map<string, string>(); const t = d.transaction("kv", "readonly"); const c = t.objectStore("kv").openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { out.set(String(cur.key), String(cur.value)); cur.continue(); } }; t.oncomplete = () => res(out); t.onerror = () => rej(t.error); });
}
const skip = (k: string) => k.startsWith("__") ;
let installed = false;
export async function initVault(): Promise<{ restored: number; persisted: boolean }> {
  if (typeof window === "undefined" || installed) return { restored: 0, persisted: false };
  installed = true;
  let persisted = false;
  try { persisted = (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false; } catch { /* ignore */ }
  const kv = await vaultAll();
  // 迁移
  let ver = Number((await tx<number>("meta", "readonly", (s) => s.get("schema"))) ?? 0);
  if (ver === 0 && kv.size === 0) ver = VAULT_SCHEMA;
  while (ver < VAULT_SCHEMA) { ver++; MIGRATIONS[ver]?.(kv); }
  // 恢复：localStorage 被系统清掉的键从 IndexedDB 找回（不覆盖已有值）
  let restored = 0;
  for (const [k, v] of kv) if (localStorage.getItem(k) === null) { try { localStorage.setItem(k, v); restored++; } catch { /* full */ } }
  // 反向：把 localStorage 现有全部写入
  const d = await db(); const t = d.transaction(["kv", "meta"], "readwrite");
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (!skip(k)) t.objectStore("kv").put(localStorage.getItem(k), k); }
  t.objectStore("meta").put(VAULT_SCHEMA, "schema"); t.objectStore("meta").put(new Date().toISOString(), "lastSync");
  // 之后每次写入都镜像
  const set = Storage.prototype.setItem, rem = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k: string, v: string) { set.call(this, k, v); if (this === localStorage && !skip(k)) void tx("kv", "readwrite", (s) => { s.put(String(v), k); }).catch(() => {}); };
  Storage.prototype.removeItem = function (k: string) { rem.call(this, k); if (this === localStorage) void tx("kv", "readwrite", (s) => { s.delete(k); }).catch(() => {}); };
  return { restored, persisted };
}
export async function exportVault(): Promise<void> {
  const kv = await vaultAll();
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (!skip(k)) kv.set(k, localStorage.getItem(k)!); }
  const blob = new Blob([JSON.stringify({ format: "fangkun-vault-backup", schema: VAULT_SCHEMA, exportedAt: new Date().toISOString(), data: Object.fromEntries(kv) })], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `方坤全部数据备份-${new Date().toISOString().slice(0, 10)}.json`; a.click();
}
export async function importVault(file: File): Promise<number> {
  const b = JSON.parse(await file.text());
  if (b?.format !== "fangkun-vault-backup" || typeof b.data !== "object") throw new Error("不是方坤备份文件");
  const kv = new Map<string, string>(Object.entries(b.data).map(([k, v]) => [k, String(v)]));
  let ver = Number(b.schema) || 1; while (ver < VAULT_SCHEMA) { ver++; MIGRATIONS[ver]?.(kv); }
  let n = 0; for (const [k, v] of kv) { localStorage.setItem(k, v); n++; }
  return n;
}
