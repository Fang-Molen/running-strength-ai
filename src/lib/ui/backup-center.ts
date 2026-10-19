/**
 * 统一「备份与恢复」预检/恢复（R1 FK-SET-003）。不改任何旧备份文件格式：
 *  - fangkun-vault-backup（lib/vault.ts exportVault，「全部数据备份」，含本机全部键 + IndexedDB 镜像）
 *  - fr255-local-backup（lib/core/trial.ts collectLocalBackup，只含 fr255-* 键）
 *  - 旧版 fangkun-data.json（r8 SettingsHub exportAll，只含 COLLECTED 8 个键，值为已解析 JSON）
 * 规则：先预检（新增/覆盖/相同/跳过），确认后才写；写入失败逐项回退；凭据类键永不导入/导出。
 */
import { COLLECTED } from './app-settings.ts'
import { LOCAL_BACKUP_KIND, inspectLocalBackup, restoreLocalBackup } from '../core/trial.ts'

export type BackupFormat = 'vault' | 'local' | 'legacy-r8'
export const FORMAT_LABEL: Record<BackupFormat, string> = { vault: '全部数据备份（fangkun-backup-日期.json）', local: '训练记录备份（running-strength-backup.json，仅 fr255- 开头的数据）', 'legacy-r8': '旧版「导出全部（JSON）」（fangkun-data.json，8 类数据）' }
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export type BackupPreview =
  | { ok: true; format: BackupFormat; label: string; exportedAt: string | null; version: string | null; total: number; added: number; overwritten: number; unchanged: number; skipped: number; skippedReasons: string[] }
  | { ok: false; reason: string }

/** 登录凭据 / 访问令牌：导出时剔除、导入时忽略。 */
export const isCredentialKey = (k: string) => /^grok-auth\./.test(k) || /(bearer|access)[-_.]?token|secret|password|api[-_]?key/i.test(k)
const MAX_VALUE = 5_000_000
const LEGACY_KEYS = new Set(COLLECTED.map(c => c.key))

type Plan = { entries: { key: string; value: string }[]; skipped: string[]; format: BackupFormat; exportedAt: string | null; version: string | null }
function planOf(raw: string): Plan | { error: string } {
  let b: unknown
  try { b = JSON.parse(raw) } catch { return { error: '文件不是有效的 JSON，未做任何修改。' } }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: '不是方坤备份文件，未做任何修改。' }
  const o = b as Record<string, unknown>
  if (o.kind === LOCAL_BACKUP_KIND) return { entries: [], skipped: [], format: 'local', exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : null, version: typeof o.version === 'string' ? o.version : null }
  if (o.format === 'fangkun-vault-backup') {
    if (!o.data || typeof o.data !== 'object' || Array.isArray(o.data)) return { error: '备份内容缺失或损坏，未做任何修改。' }
    const entries: Plan['entries'] = [], skipped: string[] = []
    for (const [key, value] of Object.entries(o.data as Record<string, unknown>)) {
      if (key.startsWith('__') || key.length > 512) { skipped.push(`${key.slice(0, 40)}：内部或异常键`); continue }
      if (isCredentialKey(key)) { skipped.push(`${key}：登录凭据，不恢复`); continue }
      if (typeof value !== 'string') { skipped.push(`${key}：值不是文本，已跳过`); continue }
      if (value.length > MAX_VALUE) { skipped.push(`${key}：单项过大，已跳过`); continue }
      entries.push({ key, value })
    }
    return { entries, skipped, format: 'vault', exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : null, version: o.schema != null ? `schema ${String(o.schema)}` : null }
  }
  const keys = Object.keys(o)
  if (keys.length && keys.every(k => LEGACY_KEYS.has(k))) {
    const entries: Plan['entries'] = [], skipped: string[] = []
    for (const k of keys) { const v = o[k]; if (v == null) { skipped.push(`${k}：备份里为空`); continue } const s = JSON.stringify(v); if (s.length > MAX_VALUE) { skipped.push(`${k}：单项过大`); continue } entries.push({ key: k, value: s }) }
    return { entries, skipped, format: 'legacy-r8', exportedAt: null, version: null }
  }
  return { error: '不是方坤备份文件，未做任何修改。' }
}
export function inspectAnyBackup(raw: string, storage: Pick<Store, 'getItem'>): BackupPreview {
  const p = planOf(raw)
  if ('error' in p) return { ok: false, reason: p.error }
  if (p.format === 'local') {
    const r = inspectLocalBackup(raw, storage)
    return r.ok ? { ok: true, format: 'local', label: FORMAT_LABEL.local, exportedAt: r.exportedAt, version: p.version, total: r.total, added: r.added, overwritten: r.overwritten, unchanged: r.unchanged, skipped: 0, skippedReasons: [] } : r
  }
  return inspectEntries(p.entries, storage, p.format, p.exportedAt, p.version, p.skipped)
}
export function inspectEntries(entries: { key: string; value: string }[], storage: Pick<Store, 'getItem'>, format: BackupFormat, exportedAt: string | null, version: string | null, skipped: string[] = []): BackupPreview {
  let added = 0, overwritten = 0, unchanged = 0
  for (const { key, value } of entries) { const cur = storage.getItem(key); if (cur === null) added++; else if (cur === value) unchanged++; else overwritten++ }
  if (!entries.length) return { ok: false, reason: '备份里没有可恢复的记录，未做任何修改。' }
  return { ok: true, format, label: FORMAT_LABEL[format], exportedAt, version, total: entries.length, added, overwritten, unchanged, skipped: skipped.length, skippedReasons: skipped.slice(0, 20) }
}
/** 确认后调用。任一写入失败即逐项回退，返回失败原因；不会删除备份里没有的项目。 */
export function restoreAnyBackup(raw: string, storage: Store): { ok: true; restored: number } | { ok: false; reason: string } {
  const p = planOf(raw)
  if ('error' in p) return { ok: false, reason: p.error }
  if (p.format === 'local') return restoreLocalBackup(raw, storage)
  return applyEntries(p.entries, storage)
}
export function applyEntries(entries: { key: string; value: string }[], storage: Store): { ok: true; restored: number } | { ok: false; reason: string } {
  const applied: { key: string; previous: string | null }[] = []
  try {
    for (const { key, value } of entries) {
      const previous = storage.getItem(key)
      if (previous === value) continue
      storage.setItem(key, value); applied.push({ key, previous })
      if (storage.getItem(key) !== value) throw Error('VERIFY')
    }
  } catch {
    for (const a of applied.reverse()) { try { if (a.previous == null) storage.removeItem(a.key); else storage.setItem(a.key, a.previous) } catch { return { ok: false, reason: '恢复中断，而且没能完全退回。请先下载一份当前备份再检查。' } } }
    return { ok: false, reason: '恢复失败（可能是存储空间不足），已退回，原有记录还在。' }
  }
  return { ok: true, restored: applied.length }
}
