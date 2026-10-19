/**
 * v83（整改包 P0-03 / P0-04）：“+记一笔”保存为训练事实。
 * - 只写“已确认导入”这一条事实（计划外），不再造一个“按计划完成”的日程条目；
 * - 用户没写用时 → 用时未知（null），不补 30 分钟；力量不按组数估分钟；写了公里就存距离；
 * - 笔记里记下它生成的训练事实 id（稳定关联），删除时可选“只删笔记”或“连训练一起撤回”（撤回 = 作废更正，可恢复）；
 * - 旧版本（≤v82）记一笔产生的“按计划 30 分钟”：读的时候核对原文，没写用时的显示为“用时未知”，不改存储。
 */
import type { Parsed } from './quick-log'
import { parseQuickLog } from './quick-log'
import { confirmTrainingImport, createTrainingImportDraft } from '@/lib/core/training-import'
import { appendCorrection, occurrenceVoided } from '@/lib/core/training-correction'

export type QuickRecordRef = { draftId: string; confirmedImportId: string; sport: 'RUNNING' | 'STRENGTH' }
export const QL_PENDING = 'fk-quicklog-pending-v1'
const f = <T,>(v: T | null) => v == null ? { value: null, status: 'ABSENT', sourceIds: [] } : { value: v, status: 'RECORDED', sourceIds: ['user-confirmed'] }
export const quickDraftId = (noteId: string) => `act-q-${noteId}`.replace(/[^0-9A-Za-z-]/g, '').slice(0, 55)

/** 纯函数：一句话 → 导入草稿内容（不含 id）。未知的保持未知。 */
export function quickDraftInput(p: Extract<Parsed, { kind: 'run' | 'strength' }>, at: string, rpe: number | null) {
  const occurredAt = f(at.replace(/\.\d+Z$/, 'Z')), sessionRpe = f(rpe != null && rpe >= 1 ? Math.round(rpe) : null)
  const common = { occurredAt, sessionRpe, subjectiveRecovery: f(null), sleepHours: f(null), pain: f(null), soreness: f(null), uncertainFields: [], conflicts: [] }
  if (p.kind === 'run') return { ...common, sport: 'RUNNING', title: f(`${p.title}${p.km ? ` ${p.km} 公里` : ''}`), durationSeconds: f(p.minutes != null ? p.minutes * 60 : null), totalDistanceMeters: f(p.km != null ? Math.round(p.km * 1000) : null),
    runningStructure: 'UNAVAILABLE', runningSegments: [], strengthSets: [], warnings: ['记一笔（计划外）', ...(p.minutes == null ? ['用时未填'] : []), ...(p.km == null ? ['距离未填'] : [])] }
  return { ...common, sport: 'STRENGTH', title: f(`${p.name} ${p.sets}×${p.reps}${p.kg ? ` ${p.kg}kg` : ''}`), durationSeconds: f(null), totalDistanceMeters: f(null), runningStructure: 'UNAVAILABLE', runningSegments: [],
    strengthSets: Array.from({ length: p.sets }, (_, i) => ({ id: `q${i + 1}`, exerciseName: f(p.name), setOrdinal: f(i + 1), weightKg: f(p.kg), repetitions: f(p.reps), durationSeconds: f(null), recoverySeconds: f(null), completion: 'COMPLETED' })), warnings: ['记一笔（计划外）', '用时未填'] }
}

/** 保存一条训练事实；同一 noteId 重试不会重复（confirmTrainingImport 按 draftId 幂等）。 */
export function saveQuickTraining(p: Parsed, noteId: string, at: string, rpe: number | null): { ok: true; ref: QuickRecordRef; msg: string } | { ok: false; soft?: boolean; msg: string } {
  if (p.kind !== 'run' && p.kind !== 'strength') return { ok: false, msg: '没认出来' }
  if (p.kind === 'run' && p.km == null && p.minutes == null) return { ok: false, soft: true, msg: '没写距离或用时，先只存为笔记（没有记成训练）' }
  const draft = createTrainingImportDraft(quickDraftInput(p, at, rpe) as never, 'TEXT', ['user-confirmed'])
  draft.draftId = quickDraftId(noteId)
  const r = confirmTrainingImport(draft)
  if (!r.ok) return { ok: false, msg: `日志未同步：${r.reason}` }
  const sport = p.kind === 'run' ? 'RUNNING' : 'STRENGTH'
  return { ok: true, ref: { draftId: r.record.draftId, confirmedImportId: r.record.confirmedImportId, sport }, msg: p.kind === 'run' && p.minutes == null ? '已记入训练日志（用时未填，显示为未知）' : '已记入训练日志' }
}

/** 撤回 / 恢复笔记生成的训练（作废更正，不物理删除，可恢复）。返回实际改动的条数。 */
export function withdrawQuickRecords(refs: QuickRecordRef[] | undefined, restore = false): number {
  let n = 0
  for (const r of refs ?? []) {
    const v = occurrenceVoided(r.confirmedImportId)
    if (restore ? !v : v) continue
    if (appendCorrection({ trainingOccurrenceId: r.confirmedImportId, kind: restore ? 'RESTORE' : 'VOID', reason: restore ? '撤销删除（记一笔）' : '随笔记一起删除（记一笔）' })) n++
  }
  return n
}

type LegacyEntry = { id?: string; date?: string; minutes?: number; unplanned?: boolean; modality?: string; title?: string; actual?: { note?: string; minutes?: number | null; km?: number | null; at?: string } | null }
type LegacyNote = { at?: string; text?: string }
export type LegacyQuickAudit = { durationSec: number | null; distanceM: number | null; title: string; note: string }
/**
 * 旧版本“记一笔”（日程条目 q-xxx，outcome=as_planned，minutes 可能是默认 30 / 组数×3）读时核对：
 * 找到同一时刻保存的笔记原文 → 重新识别；原文写了用时才用，否则用时未知；原文没找到且分钟数正好是旧默认值 → 用时未知（可能是默认值）。
 * 结果按导入 draftId（act-q-xxx）给出；不修改任何存储。
 */
export function legacyQuickAudit(entries: LegacyEntry[], notes: LegacyNote[]): Map<string, LegacyQuickAudit> {
  const out = new Map<string, LegacyQuickAudit>()
  for (const e of entries ?? []) {
    if (!e || typeof e.id !== 'string' || !/^q-/.test(e.id) || !e.unplanned || e.actual?.note !== '记一笔') continue
    const at = Date.parse(e.actual?.at ?? '')
    const note = Number.isFinite(at) ? (notes ?? []).find(n => Math.abs(Date.parse(n?.at ?? '') - at) < 10_000 && typeof n?.text === 'string') : undefined
    const parsed = note ? note.text!.split(/\n|；|;/).map(l => parseQuickLog(l.trim())).find(x => x.kind === 'run' || x.kind === 'strength') : undefined
    const m = e.actual?.minutes ?? e.minutes ?? null
    let minutes: number | null = null, why = ''
    if (parsed?.kind === 'run') { minutes = parsed.minutes; why = minutes == null ? '原文没写用时' : '' }
    else if (parsed?.kind === 'strength') { minutes = null; why = '原文没写用时' }
    else if (e.modality !== 'run') { minutes = null; why = '旧版本按组数估的，不是实际用时' }
    else { const isDefault = m === 30; minutes = isDefault ? null : m; why = isDefault ? '旧版本可能填了默认 30 分钟' : '' }
    const km = e.actual?.km ?? (parsed?.kind === 'run' ? parsed.km : null)
    out.set(`act-${e.id}`.replace(/[^0-9A-Za-z-]/g, '').slice(0, 55), { durationSec: minutes != null ? minutes * 60 : null, distanceM: km != null ? Math.round(km * 1000) : null, title: `${e.title ?? '训练'}（记一笔·计划外）`, note: why ? `用时未知（${why}）` : '' })
  }
  return out
}
