/** Browser host for coach suggestions: storage, inputs, execution and notifications.
 * Execution only ever happens from the athlete's explicit decision in the UI. */
import { currentAthleteId } from '@/lib/core/events'
import { currentStore } from '@/lib/core/storage'
import { loadSchedule, readRecovery, updateSchedule } from '@/lib/ui/day-schedule'
import type { ScheduleEntry } from '@/lib/ui/day-schedule-rules'
import { r4CourseStarted } from '@/lib/coach/r4/courses'
import { previewR4CourseMove, confirmR4CourseMove, undoR4CourseMove } from '@/lib/coach/r4/course-flow'
import { readAnalysis } from '@/lib/health/analysis-host'
import { localDay } from '@/lib/health/observation'
import { loadProfile } from '@/lib/strength/profile'
import { createPersonalStore } from '@/lib/coach/personal/store'
import {
  applyChange, decide, emptySuggestionDocument, targetBasis, evaluateOutcome, generateSuggestions, mergeSuggestions,
  noteFor, recheckTarget, reviewNotes, sanitizeEdit, visibleSuggestions,
  type CoachSuggestion, type Decision, type GenerationInput, type SuggestionDocument, type ProposedChange,
} from './suggestions'
import { readEffectiveProfile } from './effective-host'

export const SUGGESTIONS_CHANGED = 'fk-coach-suggestions-changed'
const NOTIFY_PREF_KEY = 'fk-coach-notify-v1'
const key = (athleteId: string) => `fk-coach-suggestions-v1:${encodeURIComponent(athleteId)}`

export function readSuggestionDocument(athleteId = currentAthleteId()): SuggestionDocument {
  try {
    const raw = currentStore()?.getItem(key(athleteId))
    if (!raw) return emptySuggestionDocument(athleteId)
    const doc = JSON.parse(raw) as SuggestionDocument
    if (doc?.schema !== 1 || doc.athleteId !== athleteId || !Array.isArray(doc.suggestions) || !Array.isArray(doc.notes)) return emptySuggestionDocument(athleteId)
    return doc
  } catch {
    return emptySuggestionDocument(athleteId)
  }
}

function writeDocument(doc: SuggestionDocument, expectedRevision: number): boolean {
  const store = currentStore()
  if (!store || doc.athleteId !== currentAthleteId()) return false
  // Reject a stale write instead of overwriting another tab's decision.
  if (readSuggestionDocument(doc.athleteId).revision !== expectedRevision) return false
  try {
    store.setItem(key(doc.athleteId), JSON.stringify({ ...doc, revision: expectedRevision + 1 }))
  } catch {
    return false
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SUGGESTIONS_CHANGED))
  return true
}

async function withLock<T>(work: () => Promise<T> | T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request)
    return navigator.locks.request(`fk-coach-suggestions:${currentAthleteId()}`, work) as Promise<T>
  return work()
}

const digest = (value: unknown) => {
  const text = JSON.stringify(value)
  let h = 2166136261
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(16)
}

function ownedEntries(): ScheduleEntry[] {
  const owner = currentAthleteId()
  return loadSchedule().entries.filter(e => (e.athleteId ?? 'local') === owner)
}

/** Everything the rules need, read fresh. Unknown stays null. */
export function readGenerationInput(now = new Date()): GenerationInput & { profileVersion: string } {
  const athleteId = currentAthleteId(), today = localDay(now), entries = ownedEntries()
  let safetyState: string | null = null
  try { safetyState = readAnalysis(today, now.toISOString()).assessment.safetyState } catch { safetyState = null }
  let recovery: GenerationInput['recovery'] = null
  try {
    const r = readRecovery(today)
    if (r) recovery = { readiness: r.readiness, hrvToday: r.hrvToday, hrvBaseline: r.hrvBaseline, sleepLast: r.sleepRecent.at(-1) ?? null, sleepBaseline: r.sleepBaseline }
  } catch { recovery = null }
  const events = loadProfile().marks.filter(m => /^\d{4}-\d{2}-\d{2}$/.test(m.deadline) && m.deadline >= today).map(m => ({ date: m.deadline, label: `${m.meters}米比赛/测试` }))
  let availableMinutes: number | null = null
  try {
    if (typeof window !== 'undefined') availableMinutes = createPersonalStore(window.localStorage, currentAthleteId).read().profile?.minutes ?? null
  } catch { availableMinutes = null }
  const startedIds = new Set(entries.filter(e => r4CourseStarted(e)).map(e => e.id))
  let profileVersion = ''
  try { profileVersion = readEffectiveProfile().version } catch { profileVersion = '' }
  const generationProfileVersion = profileVersion
  const basisVersion = digest([entries.map(e => [e.id, e.date, e.minutes, e.intensity, e.status, e.actual?.outcome ?? null]), safetyState, recovery, events, availableMinutes, profileVersion])
  return { athleteId, today, now: now.toISOString(), entries, safetyState, recovery, events, availableMinutes, startedIds, basisVersion, profileVersion: generationProfileVersion }
}

/** Recompute suggestions and the feedback loop. Writes only suggestion/notes state, never the plan. */
export async function refreshSuggestions(now = new Date()): Promise<SuggestionDocument> {
  return withLock(() => {
    const input = readGenerationInput(now), before = readSuggestionDocument(input.athleteId)
    let doc = mergeSuggestions(before, generateSuggestions(input), input.now)
    const targetId = (s: CoachSuggestion) => s.receipt?.after[0]?.id ?? s.target.entryId
    doc = { ...doc, suggestions: doc.suggestions.map(s => evaluateOutcome(s, input.entries, input.safetyState, targetBasis(input, targetId(s)), input.now)) }
    doc = { ...doc, notes: reviewNotes(doc.notes, doc.suggestions, n => targetBasis(input, n.entryId ?? ''), input.now) }
    const fresh = visibleSuggestions(doc, input.now).filter(s => !before.suggestions.some(b => b.id === s.id))
    const comparable = (d: SuggestionDocument) => JSON.stringify([d.suggestions, d.notes])
    if (comparable(doc) !== comparable(before) && writeDocument(doc, before.revision) && fresh.length) notifyNewSuggestions(fresh)
    return readSuggestionDocument(input.athleteId)
  })
}

export type ExecutionResult = { ok: true; message: string } | { ok: false; message: string }

/** Accept / edit-then-accept / defer / reject. Plan changes happen only here, after a fresh recheck. */
export async function decideSuggestion(id: string, decision: Decision): Promise<ExecutionResult> {
  return withLock(async () => {
    const owner = currentAthleteId(), doc = readSuggestionDocument(owner), s = doc.suggestions.find(x => x.id === id)
    if (!s) return { ok: false, message: '建议不存在或已更新，请刷新后再试' }
    if (s.status !== 'PENDING' && s.status !== 'DEFERRED') return { ok: false, message: '这条建议已经处理过' }
    const now = new Date().toISOString()
    if (decision.action === 'DEFER' || decision.action === 'REJECT') {
      const next = decide(s, decision, now)
      return writeDocument({ ...doc, suggestions: doc.suggestions.map(x => x.id === id ? next : x) }, doc.revision)
        ? { ok: true, message: decision.action === 'DEFER' ? '已暂缓，到时会再提醒；计划未改动。' : '已拒绝，计划未改动；会记录这次选择用于以后的判断。' }
        : { ok: false, message: '保存失败，请刷新后重试；计划未改动' }
    }
    if (Date.parse(now) > Date.parse(s.expiresAt)) return { ok: false, message: '建议已过期，请重新预览' }
    // Re-check the latest basis immediately before writing; a changed basis needs a new preview.
    const input = readGenerationInput()
    if (input.basisVersion !== s.basis.version) {
      const expired = { ...s, status: 'EXPIRED' as const, history: [...s.history, { at: now, action: 'BASIS_CHANGED' as const, note: '确认时依据已变化' }] }
      writeDocument({ ...doc, suggestions: doc.suggestions.map(x => x.id === id ? expired : x) }, doc.revision)
      void refreshSuggestions()
      return { ok: false, message: '建议生成后数据已更新，已重新预览；请核对新的建议再确认。计划未改动。' }
    }
    let change: ProposedChange = s.change
    if (decision.action === 'EDIT_ACCEPT') {
      const edited = sanitizeEdit(s, decision.change)
      if (typeof edited === 'string') return { ok: false, message: `${edited}；计划未改动` }
      change = { ...s.change, ...edited }
    }
    if (s.kind === 'COMPANION') {
      const next = decide(s, decision, now)
      const note = noteFor(next, now, change)
      return writeDocument({ ...doc, suggestions: doc.suggestions.map(x => x.id === id ? next : x), notes: [...doc.notes.filter(n => n.id !== note.id), note] }, doc.revision)
        ? { ok: true, message: '已记录，计划未改动。' }
        : { ok: false, message: '保存失败，请刷新后重试' }
    }
    const checked = recheckTarget(s, input.entries, input)
    if (typeof checked === 'string') return { ok: false, message: `${checked}；计划未改动` }
    let receipt: CoachSuggestion['receipt']
    if (s.kind === 'MOVE' || s.kind === 'SWAP') {
      const toDate = change.toDate
      if (!toDate) return { ok: false, message: '缺少目标日期；计划未改动' }
      try {
        // The course-move flow re-checks ownership, conflicts and neighbouring key sessions again.
        const proposal = previewR4CourseMove(`方坤建议：${s.reason}`, checked.id, toDate, s.reason.slice(0, 150), 'COACH_REFERENCE')
        const done = await confirmR4CourseMove(proposal, 'CONFIRM_THIS_CHANGE')
        if (!done.ok) return { ok: false, message: `${done.reason}；计划未改动` }
        receipt = { before: [checked], after: [{ ...checked, date: toDate }], courseProposalId: proposal.id, at: now }
      } catch (e) {
        return { ok: false, message: `${e instanceof Error ? e.message : '无法预览这次调整'}；计划未改动` }
      }
    } else {
      const after = applyChange(checked, s, change)
      const saved = await updateSchedule(store => ({ ...store, entries: store.entries.map(e => e.id === checked.id ? after : e) }), 'plan-execution')
      if (!saved) return { ok: false, message: '日历在确认时发生变化或写入失败，请刷新核对；计划未改动' }
      receipt = { before: [checked], after: [after], at: now }
    }
    // The accepted change becomes the new reference; only later corrections trigger review.
    const acceptedBasis = targetBasis(readGenerationInput(), checked.id)
    const next = { ...decide(s, decision, now), change, receipt, acceptedBasis }
    const note = { ...noteFor(next, now, change), basisVersion: acceptedBasis }
    const latest = readSuggestionDocument(owner)
    writeDocument({ ...latest, suggestions: latest.suggestions.map(x => x.id === id ? next : x), notes: [...latest.notes.filter(n => n.id !== note.id), note] }, latest.revision)
    return { ok: true, message: '已按你的确认修改计划，并保存方坤备注；可以撤销。' }
  })
}

/** Undo an accepted change only if the session is still exactly as the change left it. */
export async function undoSuggestion(id: string): Promise<ExecutionResult> {
  return withLock(async () => {
    const owner = currentAthleteId(), doc = readSuggestionDocument(owner), s = doc.suggestions.find(x => x.id === id)
    if (!s || !s.receipt || (s.status !== 'ACCEPTED' && s.status !== 'EDITED_ACCEPTED')) return { ok: false, message: '没有可撤销的调整' }
    const now = new Date().toISOString()
    if (s.receipt.courseProposalId) {
      const r = await undoR4CourseMove(s.receipt.courseProposalId, 'UNDO_THIS_CHANGE')
      if (!r.ok) return { ok: false, message: r.reason }
    } else {
      const after = s.receipt.after[0], before = s.receipt.before[0]
      const current = ownedEntries().find(e => e.id === after.id)
      const fields = (e: ScheduleEntry) => [e.date, e.title, e.minutes, e.intensity, e.status, e.modality, e.actual ?? null]
      if (!current || digest(fields(current)) !== digest(fields(after)) || r4CourseStarted(current))
        return { ok: false, message: '这节课在调整后又被修改或已经开始，不能覆盖新记录' }
      const saved = await updateSchedule(store => ({ ...store, entries: store.entries.map(e => e.id === after.id ? { ...before, athleteId: e.athleteId } : e) }), 'plan-execution')
      if (!saved) return { ok: false, message: '撤销保存未核实，请刷新核对' }
    }
    const next = { ...s, status: 'UNDONE' as const, history: [...s.history, { at: now, action: 'UNDONE' as const }] }
    const latest = readSuggestionDocument(owner)
    const suggestions = latest.suggestions.map(x => x.id === id ? next : x)
    const input = readGenerationInput()
    writeDocument({ ...latest, suggestions, notes: reviewNotes(latest.notes, suggestions, n => targetBasis(input, n.entryId ?? ''), now) }, latest.revision)
    return { ok: true, message: '已撤销，恢复原安排；建议和撤销记录都保留。' }
  })
}

/** In-app notification is always on; system notifications only after the athlete allows them. */
export function systemNotifyEnabled(): boolean {
  try {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted' && currentStore()?.getItem(NOTIFY_PREF_KEY) === 'on'
  } catch {
    return false
  }
}

export async function enableSystemNotify(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  try { currentStore()?.setItem(NOTIFY_PREF_KEY, permission === 'granted' ? 'on' : 'off') } catch { /* preference stays off */ }
  return permission === 'granted'
}

export function disableSystemNotify() {
  try { currentStore()?.setItem(NOTIFY_PREF_KEY, 'off') } catch { /* nothing to undo */ }
}

function notifyNewSuggestions(fresh: CoachSuggestion[]) {
  if (!systemNotifyEnabled()) return
  try {
    const first = fresh[0]
    new Notification('方坤有新的训练建议', { body: `${first.proposed}${fresh.length > 1 ? `（另有 ${fresh.length - 1} 条）` : ''}\n需要你确认后才会修改计划。`, tag: 'fk-coach-suggestion' })
  } catch {
    // Some platforms only allow notifications from a service worker; in-app cards still show.
  }
}
