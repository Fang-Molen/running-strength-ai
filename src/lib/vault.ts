/**
 * 方坤数据保险箱：把本站全部 localStorage 记录（训练、计划、日志、佳明导入、方坤对话、反馈）
 * 实时镜像到 IndexedDB，并申请持久化存储。schema 带版本号，升级只追加迁移，从不清空。
 */
export const VAULT_DB = "fangkun-vault";
export const VAULT_SCHEMA = 1;
/** 迁移只能追加：可以新增键、给旧值补字段；绝不删除或清空用户键。测试 vault-migration.test.ts 会校验。 */
export const MIGRATIONS: Record<number, (kv: Map<string, string>) => void> = {
  // 1: 初始版本（2026-10-16 测试版）。以后新增：2: (kv) => { ... }
};
export function migrateKv(kv: Map<string, string>, from: number, to = VAULT_SCHEMA): Map<string, string> {
  let v = from || 1; while (v < to) { v++; MIGRATIONS[v]?.(kv); } return kv;
}
export const SNAPSHOT_KEEP = 7;
export const SNAPSHOT_EVERY_MS = 24 * 3600e3;
export type Snapshot = { at: string; schema: number; data: Record<string, string> };
/** 纯函数：给定已有快照和现在的数据，返回新的快照列表（最多 7 份，至少隔 24 小时） */
export function rotateSnapshots(list: Snapshot[], data: Record<string, string>, now = Date.now()): Snapshot[] {
  const last = list[list.length - 1];
  if (last && now - Date.parse(last.at) < SNAPSHOT_EVERY_MS) return list;
  return [...list, { at: new Date(now).toISOString(), schema: VAULT_SCHEMA, data }].slice(-SNAPSHOT_KEEP);
}
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(VAULT_DB, 2);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv"); if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta"); if (!d.objectStoreNames.contains("snapshots")) d.createObjectStore("snapshots"); };
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
  if (ver < VAULT_SCHEMA) migrateKv(kv, ver);
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
  void snapshotNow().catch(() => {});
  return { restored, persisted };
}
export async function listSnapshots(): Promise<Snapshot[]> { return ((await tx<Snapshot[]>("snapshots", "readonly", (s) => s.get("list"))) ?? []) as Snapshot[]; }
export async function snapshotNow(): Promise<void> {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (!skip(k)) data[k] = localStorage.getItem(k)!; }
  const list = await listSnapshots(); const next = rotateSnapshots(list, data);
  if (next !== list) await tx("snapshots", "readwrite", (s) => { s.put(next, "list"); });
}
export async function restoreSnapshot(at: string): Promise<number> {
  const snap = (await listSnapshots()).find((x) => x.at === at); if (!snap) return 0;
  const kv = migrateKv(new Map(Object.entries(snap.data)), snap.schema);
  for (const [k, v] of kv) localStorage.setItem(k, v); return kv.size;
}
/** 大版本更新前提醒导出：APP_MAJOR 变化时返回 true（直到用户导出一次） */
export const APP_MAJOR = "beta-1";
export function needsBackupReminder(): boolean {
  const seen = localStorage.getItem("fk-app-major"); if (seen === null) { localStorage.setItem("fk-app-major", APP_MAJOR); return false; }
  return seen !== APP_MAJOR;
}
export function markBackedUp(): void { localStorage.setItem("fk-app-major", APP_MAJOR); localStorage.setItem("fk-last-export", new Date().toISOString()); }
export async function exportVault(): Promise<void> {
  const kv = await vaultAll();
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (!skip(k)) kv.set(k, localStorage.getItem(k)!); }
  const blob = new Blob([JSON.stringify({ format: "fangkun-vault-backup", schema: VAULT_SCHEMA, exportedAt: new Date().toISOString(), data: Object.fromEntries(kv) })], { type: "application/json" });
  const name = `fangkun-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = typeof File === "function" ? new File([blob], name, { type: "application/json" }) : null;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (file && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: "方坤全部数据备份" }); markBackedUp(); return; } catch (e) { if ((e as Error).name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); markBackedUp();
}
export async function importVault(file: File): Promise<number> {
  const b = JSON.parse(await file.text());
  if (b?.format !== "fangkun-vault-backup" || typeof b.data !== "object") throw new Error("不是方坤备份文件");
  const kv = new Map<string, string>(Object.entries(b.data).map(([k, v]) => [k, String(v)]));
  migrateKv(kv, Number(b.schema) || 1);
  let n = 0; for (const [k, v] of kv) { localStorage.setItem(k, v); n++; }
  return n;
}
