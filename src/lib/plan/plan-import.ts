/** v89.6：导入计划/备份文件 —— 先预览、确认后写入、可撤销。纯逻辑，供界面和测试共用。 */
import type { Mark, Profile } from '../strength/profile'
import { inspectAnyBackup, restoreAnyBackup, backupUndoSnapshot, undoBackupSnapshot, type BackupPreview } from '../ui/backup-center'
import { PLAN_DOC_SCHEMA, validatePlanDoc, type ProfileMarkDefault } from './active-plan'

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export type ImportPreview = { ok: true; kind: 'plan' | 'backup'; preview: BackupPreview & { ok: true }; plan?: { name: string; days: number; first: string; last: string; sample: string[] }; profileChanges: string[] } | { ok: false; reason: string }

/** 只填空项：资料里已有的目标/成绩/日期绝不覆盖。 */
export function mergeProfileDefaults(profile: Profile, defaults: ProfileMarkDefault[] | undefined): { profile: Profile; changes: string[] } {
  if (!defaults?.length) return { profile, changes: [] }
  const marks: Mark[] = profile.marks.map(m => ({ ...m })), changes: string[] = []
  for (const d of defaults) {
    let m = marks.find(x => x.meters === d.meters)
    if (!m) { m = { meters: d.meters, goal: '', recent: '', deadline: '' }; marks.push(m) }
    const label = d.meters >= 1000 ? `${d.meters / 1000}公里` : `${d.meters}米`
    if (d.goal && !m.goal.trim()) { m.goal = d.goal; changes.push(`${label}目标成绩：${d.goal}`) }
    if (d.recent && !m.recent.trim()) { m.recent = d.recent; changes.push(`${label}最近成绩：${d.recent}`) }
    if (d.deadline && !m.deadline.trim() && /^\d{4}-\d{2}-\d{2}$/.test(d.deadline)) { m.deadline = d.deadline; changes.push(`${label}目标日期：${d.deadline}`) }
  }
  return { profile: { ...profile, marks }, changes }
}

export function previewImport(raw: string, storage: Store, profile: Profile): ImportPreview {
  const preview = inspectAnyBackup(raw, storage)
  if (!preview.ok) return preview
  let parsed: Record<string, unknown> | null = null; try { parsed = JSON.parse(raw) } catch { parsed = null }
  if (parsed?.schema === PLAN_DOC_SCHEMA) {
    const v = validatePlanDoc(parsed); if (!v.ok) return v
    const days = v.doc.plan.days, sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
    return { ok: true, kind: 'plan', preview, plan: { name: v.doc.label || v.doc.plan.name, days: days.length, first: sorted[0].date, last: sorted[sorted.length - 1].date, sample: sorted.slice(0, 3).map(d => `${d.date} ${d.title}`) },
      profileChanges: mergeProfileDefaults(profile, v.doc.profileDefaults?.marks).changes }
  }
  return { ok: true, kind: 'backup', preview, profileChanges: [] }
}

export type ImportUndo = { keys: { key: string; previous: string | null }[]; profileBefore: string | null }
/** 确认后调用。返回撤销所需快照；失败时原有数据不变（restoreAnyBackup 会逐项回退）。 */
export function confirmImport(raw: string, storage: Store, profile: Profile, saveProfile: (p: Profile) => void): { ok: true; undo: ImportUndo | null; restored: number } | { ok: false; reason: string } {
  const snap = backupUndoSnapshot(raw, storage), profileBefore = storage.getItem('fr255-profile-v1')
  const r = restoreAnyBackup(raw, storage)
  if (!r.ok) return r
  let parsed: Record<string, unknown> | null = null; try { parsed = JSON.parse(raw) } catch { parsed = null }
  if (parsed?.schema === PLAN_DOC_SCHEMA) {
    const v = validatePlanDoc(parsed)
    if (v.ok) { const m = mergeProfileDefaults(profile, v.doc.profileDefaults?.marks); if (m.changes.length) saveProfile(m.profile) }
  }
  return { ok: true, restored: r.restored, undo: snap ? { keys: snap, profileBefore } : null }
}
export function undoImport(u: ImportUndo, storage: Store): boolean {
  const ok = undoBackupSnapshot(u.keys, storage)
  try { if (u.profileBefore == null) storage.removeItem('fr255-profile-v1'); else storage.setItem('fr255-profile-v1', u.profileBefore) } catch { return false }
  return ok
}
