/**
 * 方坤数据保险箱：把本站全部 localStorage 记录（训练、计划、日志、佳明导入、方坤对话、反馈）
 * 实时镜像到 IndexedDB，并申请持久化存储。schema 带版本号，升级只追加迁移，从不清空。
 */
import { isBulkKey, readBulkPersistentEntries, appStorage } from "@/lib/core/bulk-store";
import { currentAthleteId } from './core/events';
import { createBackupArchive, isBackupArchiveKeyAllowed, BACKUP_ARCHIVE_MAX_JSON_BYTES } from './core/backup-archive';
import { prepareAnyBackup, stagePreparedBackup, type PreparedBackup, type BackupPreparation } from './ui/backup-center';
import { readRestoreCandidate, type CandidateResult } from './core/restore-candidate';
export const VAULT_DB = "fangkun-vault";
export const VAULT_SCHEMA = 1;
/** 迁移只能追加：可以新增键、给旧值补字段；绝不删除或清空用户键。测试 vault-migration.test.ts 会校验。 */
export const MIGRATIONS: Record<number, (kv: Map<string, string>) => void> = {
  // 1: 初始版本（2026-10-16 测试版）。以后新增：2: (kv) => { ... }
};
export function migrateKv(kv: Map<string, string>, from: number, to = VAULT_SCHEMA): Map<string, string> {
  if (!Number.isInteger(from) || from < 0 || from > to) throw new Error("VAULT_SCHEMA_UNSUPPORTED");
  let v = from || 1; while (v < to) { v++; MIGRATIONS[v]?.(kv); } return kv;
}
export const SNAPSHOT_KEEP = 7;
export const SNAPSHOT_EVERY_MS = 24 * 3600e3;
export type Snapshot = { at: string; schema: number; data: Record<string, string>; athleteId?: string };
/** 纯函数：给定已有快照和现在的数据，返回新的快照列表（最多 7 份，至少隔 24 小时） */
export function rotateSnapshots(list: Snapshot[], data: Record<string, string>, now = Date.now(), athleteId?: string): Snapshot[] {
  const last = list[list.length - 1];
  if (last && now - Date.parse(last.at) < SNAPSHOT_EVERY_MS) return list;
  return [...list, { at: new Date(now).toISOString(), schema: VAULT_SCHEMA, data, ...(athleteId ? { athleteId } : {}) }].slice(-SNAPSHOT_KEEP);
}
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(VAULT_DB, 2);
    r.onupgradeneeded = () => { const d = r.result; for (const name of ['kv', 'meta', 'snapshots']) if (!d.objectStoreNames.contains(name)) d.createObjectStore(name); };
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); dbp = null; }; res(r.result); };
    r.onerror = () => rej(r.error ?? Error('VAULT_OPEN_FAILED'));
    r.onblocked = () => rej(Error('VAULT_BLOCKED'));
  }).catch(error => { dbp = null; throw error; }));
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode); let request: IDBRequest<T> | void;
    t.oncomplete = () => resolve(request ? request.result : undefined);
    t.onerror = () => reject(t.error ?? Error('VAULT_TRANSACTION_FAILED'));
    t.onabort = () => reject(t.error ?? Error('VAULT_TRANSACTION_ABORTED'));
    try { request = fn(t); } catch (error) { try { t.abort(); } catch { /* already closed */ } reject(error); }
  });
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return transaction([store], mode, t => fn(t.objectStore(store)));
}
export async function vaultAll(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await tx('kv', 'readonly', store => { const r = store.openCursor(); r.onsuccess = () => { const c = r.result; if (c) { out.set(String(c.key), String(c.value)); c.continue(); } }; });
  return out;
}
const mirrorSkip = (key: string) => !isBackupArchiveKeyAllowed(key) || isBulkKey(key);
let mirrorQueue: Promise<void> = Promise.resolve(), mirrorPending = 0;
let snapshotFailed = false;
const mirrorFailures = new Map<string, unknown>();
export function vaultStatus() { return { pending: mirrorPending, failed: mirrorFailures.size, snapshotFailed, reason: mirrorFailures.size ? 'VAULT_MIRROR_FAILED' : snapshotFailed ? 'VAULT_SNAPSHOT_FAILED' : '' }; }
function publishStatus() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('fk-vault-status')); }
function queueMirror(key: string, write: () => Promise<unknown>): void {
  mirrorPending++;
  mirrorQueue = mirrorQueue.then(async () => { await write(); mirrorFailures.delete(key); }).catch(error => { mirrorFailures.set(key, error); }).finally(() => { mirrorPending--; publishStatus(); });
}
export async function flushVault(): Promise<void> {
  let tail: Promise<void>;
  do { tail = mirrorQueue; await tail; } while (tail !== mirrorQueue);
  if (mirrorFailures.size) throw Error('VAULT_MIRROR_FAILED');
}
let installed = false, initializing: Promise<{ restored: number; persisted: boolean; orphaned: number }> | null = null;
function installMirror(): void {
  if (installed) return;
  const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (key: string, value: string) {
    set.call(this, key, value);
    if (this === localStorage && !mirrorSkip(key)) queueMirror(key, async () => {
      await tx('kv', 'readwrite', s => s.put(String(value), key));
      if (await tx('kv', 'readonly', s => s.get(key)) !== String(value)) throw Error('VAULT_MIRROR_VERIFY_FAILED');
    });
  };
  Storage.prototype.removeItem = function (key: string) {
    remove.call(this, key);
    if (this === localStorage && !mirrorSkip(key)) queueMirror(key, async () => {
      await tx('kv', 'readwrite', s => s.delete(key));
      if (await tx('kv', 'readonly', s => s.get(key)) !== undefined) throw Error('VAULT_MIRROR_VERIFY_FAILED');
    });
  };
  installed = true;
}
/** An absent local key may be a deletion. Keep orphan mirrors for inspection;
 * never silently resurrect them or execute a restore before application boot. */
export async function initVault(): Promise<{ restored: number; persisted: boolean; orphaned: number }> {
  if (typeof window === 'undefined') return { restored: 0, persisted: false, orphaned: 0 };
  if (initializing) return initializing;
  initializing = (async () => {
    const mirrored = await vaultAll();
    const schema = Number(await tx('meta', 'readonly', s => s.get('schema')) ?? VAULT_SCHEMA);
    if (schema > VAULT_SCHEMA) throw Error('VAULT_SCHEMA_UNSUPPORTED');
    const orphaned = [...mirrored.keys()].filter(key => !mirrorSkip(key) && localStorage.getItem(key) === null).length;
    installMirror();
    queueMirror('__initial__', () => transaction(['kv', 'meta'], 'readwrite', t => {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index); if (key && !mirrorSkip(key)) t.objectStore('kv').put(localStorage.getItem(key), key);
      }
      t.objectStore('meta').put(VAULT_SCHEMA, 'schema');
      t.objectStore('meta').put(new Date().toISOString(), 'lastSync');
    }));
    await flushVault();
    let persisted = false;
    try { persisted = await navigator.storage?.persisted?.() || await navigator.storage?.persist?.() || false; } catch { /* optional */ }
    void snapshotNow().catch(() => { snapshotFailed = true; publishStatus(); });
    return { restored: 0, persisted, orphaned };
  })().catch(error => { initializing = null; throw error; });
  return initializing;
}
export async function listSnapshots(): Promise<Snapshot[]> { return await tx<Snapshot[]>('snapshots', 'readonly', s => s.get('list')) ?? []; }

export const VAULT_BACKUP_EXCLUSIONS = [
  '登录凭据和本机协调状态', '拍照原图与附件（fangkun-food-photos）',
  '设备证据与原图（fr255-device-evidence-v1；需单独导出）',
  '计划执行覆盖与回执（fangkun-coach-plan-execution-v1）',
  '训练模型导出回执（fangkun-training-model-exports-v1）',
  '旧保险箱孤立镜像、历史快照及核心存储镜像',
  '隔离恢复候选（fangkun-restore-candidates-v1；需单独下载）',
  '跨标签页原子快照保证（来源仅经两次读取核对）',
];
export function mergeVaultBackupSources(bulk: Record<string, string>, local: Record<string, string>): { entries: Record<string, string>; excludedKeys: string[] } {
  const entries: Record<string, string> = {}, excludedKeys: string[] = [];
  for (const [key, value] of Object.entries({ ...bulk, ...local })) {
    if (!isBackupArchiveKeyAllowed(key)) { excludedKeys.push(key); continue; }
    Object.defineProperty(entries, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return { entries, excludedKeys };
}
function localEntries(): Record<string, string> {
  const entries: [string, string][] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index); if (!key) continue;
    const value = localStorage.getItem(key); if (value !== null) entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}
const sameEntries = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
export async function collectVaultBackupEntries(): Promise<Record<string, string>> {
  await flushVault();
  const bulk = await readBulkPersistentEntries(), local = localEntries();
  const secondBulk = await readBulkPersistentEntries(), secondLocal = localEntries();
  if (!sameEntries(bulk, secondBulk) || !sameEntries(local, secondLocal)) throw Error('BACKUP_SOURCE_CHANGED');
  // vaultAll is intentionally not merged: absent active keys may be deletions.
  return mergeVaultBackupSources(bulk, local).entries;
}
export async function snapshotNow(): Promise<void> {
  const subject = currentAthleteId(), data = await collectVaultBackupEntries();
  createBackupArchive(data, { athleteId: subject, exportedAt: new Date().toISOString(), included: ['本机文本与大块记录'], excluded: [...VAULT_BACKUP_EXCLUSIONS] });
  if (subject !== currentAthleteId()) throw Error('BACKUP_SUBJECT_CHANGED');
  const list = await listSnapshots(), next = rotateSnapshots(list, data, Date.now(), subject);
  if (next !== list) await tx('snapshots', 'readwrite', s => s.put(next, 'list'));
  snapshotFailed = false; publishStatus();
}
export function prepareSnapshot(snapshot: Snapshot): BackupPreparation {
  try {
    const entries = Object.fromEntries(migrateKv(new Map(Object.entries(snapshot.data)), snapshot.schema));
    const safe = mergeVaultBackupSources({}, entries);
    const archive = createBackupArchive(safe.entries, { athleteId: snapshot.athleteId ?? currentAthleteId(), exportedAt: new Date(snapshot.at).toISOString(), included: ['自动快照的可处理文本记录'], excluded: [...VAULT_BACKUP_EXCLUSIONS] });
    const prepared = prepareAnyBackup(JSON.stringify(archive), appStorage());
    if (prepared.ok) prepared.preview.label = snapshot.athleteId ? '自动快照（本机）' : '旧自动快照（人物归属未记录，仅作待核副本）';
    return prepared;
  } catch { return { ok: false, reason: '快照版本、内容或容量无法完整处理，未做任何修改。' }; }
}
function confirmCandidate(prepared: PreparedBackup): boolean {
  const p = prepared.preview;
  return window.confirm(`备份预检：${p.total} 项；新增 ${p.added}、与当前不同 ${p.overwritten}、相同 ${p.unchanged}、排除 ${p.skipped}。\n确认后只保存待核副本，当前记录不会改变。网页不能保证旧标签页停写，因此尚不执行覆盖恢复。`);
}
const notStarted = (reason: string): CandidateResult => ({ ok: false, state: 'NOT_STARTED', reason });
export async function restoreSnapshot(at: string): Promise<CandidateResult> {
  const subject = currentAthleteId(), snapshot = (await listSnapshots()).find(item => item.at === at);
  if (!snapshot || subject !== currentAthleteId()) return notStarted('快照未找到或当前档案已变化，当前记录未修改。');
  const prepared = prepareSnapshot(snapshot);
  if (!prepared.ok) return notStarted(prepared.reason);
  if (!confirmCandidate(prepared)) return notStarted('已取消，当前记录未修改。');
  return stagePreparedBackup(prepared, appStorage());
}
export const APP_MAJOR = 'beta-1';
export function needsBackupReminder(): boolean {
  const seen = localStorage.getItem('fk-app-major'); if (seen === null) { localStorage.setItem('fk-app-major', APP_MAJOR); return false; }
  return seen !== APP_MAJOR;
}
export function markBackedUp(): void { localStorage.setItem('fk-app-major', APP_MAJOR); localStorage.setItem('fk-last-export', new Date().toISOString()); }
function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function exportVault(): Promise<'shared' | 'download' | 'cancelled'> {
  const subject = currentAthleteId(), entries = await collectVaultBackupEntries();
  if (subject !== currentAthleteId()) throw Error('BACKUP_SUBJECT_CHANGED');
  const archive = createBackupArchive(entries, { athleteId: subject, exportedAt: new Date().toISOString(), included: ['当前本机文本记录（包含本机各档案）', '大块记录权威持久值；本地保留副本优先'], excluded: [...VAULT_BACKUP_EXCLUSIONS] });
  const blob = new Blob([JSON.stringify(archive)], { type: 'application/json' }), name = `fangkun-records-${new Date().toISOString().slice(0, 10)}.json`;
  const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: '方坤记录备份（范围见清单）' }); markBackedUp(); return 'shared'; }
    catch (error) { if ((error as Error).name === 'AbortError') return 'cancelled'; }
  }
  downloadBlob(blob, name); markBackedUp(); return 'download';
}
export async function importVault(file: File): Promise<CandidateResult> {
  const subject = currentAthleteId();
  if (file.size > BACKUP_ARCHIVE_MAX_JSON_BYTES) return notStarted('文件超过 128 MiB 容器上限，未做任何修改。');
  const raw = await file.text();
  if (subject !== currentAthleteId()) return notStarted('当前档案已切换，请重新选择文件。');
  const prepared = prepareAnyBackup(raw, appStorage());
  if (!prepared.ok) return notStarted(prepared.reason);
  if (!confirmCandidate(prepared)) return notStarted('已取消，当前记录未修改。');
  return stagePreparedBackup(prepared, appStorage());
}
export async function downloadRestoreCandidate(id: string): Promise<void> {
  const subject = currentAthleteId(), raw = await readRestoreCandidate(id);
  if (!raw) throw Error('候选副本无法读取，请保留原始备份文件。');
  const candidate = JSON.parse(raw);
  if (candidate.subject !== subject || currentAthleteId() !== subject || candidate.active !== false) throw Error('候选不属于当前档案，未下载。');
  downloadBlob(new Blob([raw], { type: 'application/json' }), `fangkun-restore-candidate-${id}.json`);
}
