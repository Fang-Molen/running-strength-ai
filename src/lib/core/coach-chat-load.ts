import { calculateSessionLoad } from './coach-session-load.ts'
import { detectRedFlags } from './coach-red-flags.ts'
import { temporalContextClauses } from '../../safety/redflag/context.ts'
import { createTrainingImportDraft, confirmTrainingImport, loadConfirmedTrainingImports, type ImportSport } from './training-import.ts'
import { strictIso } from './coach-v4-c11-adapter.ts'

/** The preview is an unsaved user statement, never an automatic fact commit. */
export function chatLoadPreview(question: string) {
  if (detectRedFlags(question).level !== 'NONE' || /朋友|同伴|队友|他人|学员|假设|假如|例如|假定/.test(question)) return null
  const actual = temporalContextClauses(question).filter(c => c.temporal === 'CURRENT').map(c => c.text).join('，')
  const load = calculateSessionLoad(actual)
  return load.status === 'CALCULATED' && load.rpeOrigin === 'SELF_REPORT' && load.durationOrigin === 'SELF_REPORT' && Number.isInteger(load.rpe) ? load : null
}
/** Reuse the existing confirmed-import path; no parallel AU store and no overwriting a selected workout. */
export function saveChatSessionLoad(input: { question: string; draftId: string; occurredAt: string; sport: ImportSport; confirmedNewSession: boolean; selectedOccurrenceId: string | null }) {
  const load = chatLoadPreview(input.question), now = new Date().toISOString()
  if (!load || !input.confirmedNewSession || input.selectedOccurrenceId) return { ok: false as const, reason: '请确认这是尚未记录的新训练；已关联的训练请使用原记录的补充或更正入口，避免重复计入。' }
  if (!strictIso(input.occurredAt) || Date.parse(input.occurredAt) > Date.parse(now)) return { ok: false as const, reason: '请确认实际训练时间，不能保存未来训练。' }
  if (!['RUNNING', 'STRENGTH'].includes(input.sport)) return { ok: false as const, reason: '请选择跑步或力量；混合训练请使用完整导入入口核对各部分。' }
  if (!/^[\w-]{1,55}$/.test(input.draftId)) return { ok: false as const, reason: '确认标识无效，请重新生成预览。' }
  const existing = loadConfirmedTrainingImports()
  if (existing.length >= 100 && !existing.some(r => r.draftId === input.draftId)) return { ok: false as const, reason: '记录已达到本机容量上限，请先备份并整理；没有覆盖旧训练。' }
  const field = <T>(value: T) => ({ value, status: 'RECORDED', sourceIds: ['user-confirmed'] })
  const draft = createTrainingImportDraft({ sport: input.sport, occurredAt: field(input.occurredAt), title: field('聊天确认的整课负荷'), durationSeconds: field(load.minutes! * 60), sessionRpe: field(load.rpe!), warnings: ['仅确认整课时长及整课RPE；未确认组数、分段、动作质量或达标。'] }, 'TEXT', ['user-confirmed'])
  return confirmTrainingImport({ ...draft, draftId: input.draftId })
}
