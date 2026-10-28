/**
 * 统一「备份与恢复」预检/恢复（R1 FK-SET-003）。不改任何旧备份文件格式：
 *  - fangkun-vault-backup（lib/vault.ts exportVault，「全部数据备份」，含本机全部键 + IndexedDB 镜像）
 *  - fr255-local-backup（lib/core/trial.ts collectLocalBackup，只含 fr255-* 键）
 *  - 旧版 fangkun-data.json（r8 SettingsHub exportAll，只含 COLLECTED 8 个键，值为已解析 JSON）
 * 规则：先预检（新增/覆盖/相同/跳过），确认后才写；写入失败逐项回退；凭据类键永不导入/导出。
 */
import { currentAthleteId } from '../core/events'
import { COLLECTED } from './app-settings.ts'
import { LOCAL_BACKUP_KIND, inspectLocalBackup, restoreLocalBackup } from '../core/trial.ts'
import { planDocumentKey, PLAN_DOC_SCHEMA, validatePlanDoc } from '../plan/active-plan.ts'
import { BACKUP_ARCHIVE_FORMAT, BACKUP_ARCHIVE_MAX_JSON_BYTES, isBackupArchiveKeyAllowed, parseBackupArchive } from '../core/backup-archive.ts'
import { isPhysicalBackupStore, UNSAFE_BROWSER_RESTORE } from '../core/backup-policy.ts'
import { stageRestoreCandidate, type CandidateRepository, type CandidateResult } from '../core/restore-candidate.ts'
import { sha256Hex } from '../core/sha256-sync.ts'

export type BackupFormat = 'vault' | 'local' | 'legacy-r8' | 'plan' | 'chunked'
export const FORMAT_LABEL: Record<BackupFormat, string> = { chunked: '分块记录备份（范围以文件清单为准）', plan: '训练计划文件（fangkun-plan-v1，只含计划，不含训练记录）', vault: '全部数据备份（fangkun-backup-日期.json）', local: '训练记录备份（running-strength-backup.json，仅 fr255- 开头的数据）', 'legacy-r8': '旧版「导出全部（JSON）」（fangkun-data.json，8 类数据）' }
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export type BackupPreview =
  | { ok: true; format: BackupFormat; label: string; exportedAt: string | null; version: string | null; total: number; added: number; overwritten: number; unchanged: number; skipped: number; skippedReasons: string[]; included?: string[]; excluded?: string[] }
  | { ok: false; reason: string }

/** 登录凭据 / 访问令牌：导出时剔除、导入时忽略。 */
export const isCredentialKey = (k: string) => /^grok-auth\./.test(k) || /(bearer|access)[-_.]?token|secret|password|api[-_]?key/i.test(k)
const MAX_VALUE = 5_000_000
const LEGACY_KEYS = new Set(COLLECTED.map(c => c.key))

type Plan = { entries: { key: string; value: string }[]; skipped: string[]; format: BackupFormat; exportedAt: string | null; version: string | null; included?: string[]; excluded?: string[] }
function planOf(raw: string): Plan | { error: string } {
  if (raw.length > BACKUP_ARCHIVE_MAX_JSON_BYTES || new TextEncoder().encode(raw).byteLength > BACKUP_ARCHIVE_MAX_JSON_BYTES) return { error: '文件超过当前支持的 128 MiB 容器上限，未做任何修改。' }
  let b: unknown
  try { b = JSON.parse(raw) } catch { return { error: '文件不是有效的 JSON，未做任何修改。' } }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: '不是方坤备份文件，未做任何修改。' }
  const o = b as Record<string, unknown>
  if (o.format === BACKUP_ARCHIVE_FORMAT) {
    try {
      const archive = parseBackupArchive(raw)
      if (archive.metadata.athleteId !== currentAthleteId()) return { error: '备份人物与当前档案不一致，请切回原档案后核对。' }
      return { entries: Object.entries(archive.entries).map(([key, value]) => ({ key, value })), skipped: [], format: 'chunked', exportedAt: archive.metadata.exportedAt, version: 'schema 2', included: archive.metadata.included, excluded: archive.metadata.excluded }
    } catch { return { error: '分块备份的格式、容量或完整性检查失败，未做任何修改。' } }
  }
  // v89.6：通用计划文件（任何用户都可导入；应用本身不内置任何计划）。只写计划键，不碰训练记录。
  if (o.schema === PLAN_DOC_SCHEMA) {
    const v = validatePlanDoc(o)
    if (!v.ok) return { error: `${v.reason}未做任何修改。` }
    if (v.doc.athleteId && v.doc.athleteId !== currentAthleteId()) return { error: '计划归属与当前档案不一致，未做任何修改。' }
    return { entries: [{ key: planDocumentKey(), value: JSON.stringify({...v.doc, athleteId:currentAthleteId()}) }], skipped: [], format: 'plan', exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : null, version: PLAN_DOC_SCHEMA }
  }
  if (o.kind === LOCAL_BACKUP_KIND) {
    const checked = inspectLocalBackup(raw, { getItem: () => null })
    if (!checked.ok) return { error: checked.reason }
    return { entries: Object.entries(o.keys as Record<string, string>).map(([key, value]) => ({ key, value })), skipped: [], format: 'local', exportedAt: checked.exportedAt, version: typeof o.version === 'string' ? o.version : null }
  }
  if (o.format === 'fangkun-vault-backup') {
    if (o.schema !== undefined && o.schema !== 1) return { error: '不支持此备份版本，未做任何修改。' }
    if (!o.data || typeof o.data !== 'object' || Array.isArray(o.data)) return { error: '备份内容缺失或损坏，未做任何修改。' }
    const entries: Plan['entries'] = [], skipped: string[] = []
    for (const [key, value] of Object.entries(o.data as Record<string, unknown>)) {
      if (key.startsWith('__') || key.length > 512) { skipped.push(`${key.slice(0, 40)}：内部或异常键`); continue }
      if (isCredentialKey(key)) { skipped.push(`${key}：登录凭据，不恢复`); continue }
      if (!isBackupArchiveKeyAllowed(key)) { skipped.push(`${key}：内部协调状态，不恢复`); continue }
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
  const preview = inspectEntries(p.entries, storage, p.format, p.exportedAt, p.version, p.skipped)
  return preview.ok ? { ...preview, ...(p.included ? { included: p.included, excluded: p.excluded } : {}) } : preview
}
export function inspectEntries(entries: { key: string; value: string }[], storage: Pick<Store, 'getItem'>, format: BackupFormat, exportedAt: string | null, version: string | null, skipped: string[] = []): BackupPreview {
  let added = 0, overwritten = 0, unchanged = 0
  for (const { key, value } of entries) { const cur = storage.getItem(key); if (cur === null) added++; else if (cur === value) unchanged++; else overwritten++ }
  if (!entries.length) return { ok: false, reason: '备份里没有可恢复的记录，未做任何修改。' }
  return { ok: true, format, label: FORMAT_LABEL[format], exportedAt, version, total: entries.length, added, overwritten, unchanged, skipped: skipped.length, skippedReasons: skipped.slice(0, 20) }
}
/** 确认后调用。任一写入失败即逐项回退，返回失败原因；不会删除备份里没有的项目。 */
export function restoreAnyBackup(raw: string, storage: Store): { ok: true; restored: number } | { ok: false; reason: string } {
  if (isPhysicalBackupStore(storage)) return { ok: false, reason: UNSAFE_BROWSER_RESTORE }
  const p = planOf(raw)
  if ('error' in p) return { ok: false, reason: p.error }
  if (p.format === 'local') return restoreLocalBackup(raw, storage)
  return applyEntries(p.entries, storage)
}
export function applyEntries(entries: { key: string; value: string }[], storage: Store): { ok: true; restored: number } | { ok: false; reason: string } {
  if (isPhysicalBackupStore(storage)) return { ok: false, reason: UNSAFE_BROWSER_RESTORE }
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

/** v89.6：恢复前记下将被改写的键的旧值，供“撤销导入”。local 格式不支持（返回 null）。 */
export function backupUndoSnapshot(raw: string, storage: Pick<Store, 'getItem'>): { key: string; previous: string | null }[] | null {
  const p = planOf(raw)
  if ('error' in p || p.format === 'local') return null
  return p.entries.map(e => ({ key: e.key, previous: storage.getItem(e.key) }))
}
export function undoBackupSnapshot(snap: { key: string; previous: string | null }[], storage: Store): boolean {
  if (isPhysicalBackupStore(storage)) return false
  try { for (const s of snap) { if (s.previous == null) storage.removeItem(s.key); else storage.setItem(s.key, s.previous) } return true } catch { return false }
}


export type PreparedBackup = { ok: true; integrity: string; subject: string; preview: Extract<BackupPreview, { ok: true }>; entries: { key: string; value: string }[]; before: { key: string; value: string | null }[] }
export type BackupPreparation = PreparedBackup | { ok: false; reason: string }
const preparationHash = (prepared: Omit<PreparedBackup, 'integrity'>) => sha256Hex(JSON.stringify({ subject: prepared.subject, entries: prepared.entries, before: prepared.before }))
export function bindBackupPreparation(prepared: Omit<PreparedBackup, 'integrity'>): PreparedBackup {
  return { ...prepared, integrity: preparationHash(prepared) }
}
/** Browser preflight binds subject and source values. A legacy partial preview
 * may still be displayed, but malformed/oversize items cannot silently stage. */
export function prepareAnyBackup(raw: string, storage: Pick<Store, 'getItem'>): BackupPreparation {
  try {
    const subject = currentAthleteId(), plan = planOf(raw)
    if ('error' in plan) return { ok: false, reason: plan.error }
    if (plan.skipped.some(reason => /值不是文本|单项过大|异常键/.test(reason))) return { ok: false, reason: '备份含无法完整处理的数据项，已停止；请保留文件并核对。' }
    const preview = inspectEntries(plan.entries, storage, plan.format, plan.exportedAt, plan.version, plan.skipped)
    if (!preview.ok) return preview
    if (subject !== currentAthleteId()) return { ok: false, reason: '当前档案已变化，请重新预检。' }
    return bindBackupPreparation({ ok: true, subject, preview: { ...preview, included: plan.included, excluded: plan.excluded }, entries: plan.entries.map(entry => ({ ...entry })), before: plan.entries.map(entry => ({ key: entry.key, value: storage.getItem(entry.key) })) })
  } catch { return { ok: false, reason: '无法读取当前记录或备份，尚未保存候选；当前记录未修改。' } }
}
export async function stagePreparedBackup(prepared: PreparedBackup, storage: Pick<Store, 'getItem'>, repository?: CandidateRepository): Promise<CandidateResult> {
  try {
    if (prepared.integrity !== preparationHash(prepared) || prepared.subject !== currentAthleteId() || prepared.before.some(entry => storage.getItem(entry.key) !== entry.value)) return { ok: false, state: 'REVIEW_REQUIRED', reason: '预检后人物或记录已变化，请重新预检；当前记录未修改。' }
    if (prepared.entries.some(entry => !isBackupArchiveKeyAllowed(entry.key))) return { ok: false, state: 'NOT_STARTED', reason: '备份包含内部状态或凭据，未保存候选。' }
    return await stageRestoreCandidate(prepared.entries, { subject: prepared.subject, currentSubject: currentAthleteId, readSource: key => storage.getItem(key), repository })
  } catch { return { ok: false, state: 'NOT_STARTED', reason: '无法核对当前记录，候选未完成；当前记录未修改。' } }
}
