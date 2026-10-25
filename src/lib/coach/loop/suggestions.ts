/** Coach course-change suggestions, coach notes and the long-term feedback loop.
 *
 * Pure functions only (no storage, no clock unless passed in), so the rules can
 * be tested. Ground rules from the product brief:
 *  - the coach may suggest moving, swapping, replacing, cancelling or reducing a
 *    session, plus matching warm-up, recovery and food advice;
 *  - a suggestion never changes the formal plan by itself: only the athlete's
 *    accept / edit-then-accept does, after the latest basis is re-checked;
 *    no response means nothing happens; nothing ever increases the dose;
 *  - coach notes are stored apart from the athlete's own notes, and completed
 *    training records are never edited;
 *  - outcomes later support, weaken or withdraw the judgement, and a corrected
 *    input marks dependent suggestions and notes for review, keeping history.
 */
import type { ScheduleEntry, Intensity } from '@/lib/ui/day-schedule-rules'

export type SuggestionKind = 'MOVE' | 'SWAP' | 'REPLACE' | 'CANCEL' | 'REDUCE' | 'COMPANION'
export type SuggestionStatus = 'PENDING' | 'DEFERRED' | 'ACCEPTED' | 'EDITED_ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'UNDONE'
export type OutcomeState = 'AWAITING' | 'SUPPORTED' | 'WEAKENED' | 'WITHDRAWN'
export type SuggestionAction = 'CREATED' | 'ACCEPTED' | 'EDITED_ACCEPTED' | 'DEFERRED' | 'REJECTED' | 'EXPIRED' | 'UNDONE' | 'BASIS_CHANGED' | 'OUTCOME'

export type SuggestionTarget = { entryId: string; date: string; title: string; modality: ScheduleEntry['modality']; minutes: number; intensity: Intensity; lowerHeavy: boolean }
export type ProposedChange = {
  toDate?: string
  minutes?: number
  intensity?: Intensity
  /** REPLACE: the session becomes this easier option; the original stays in history. */
  replaceWith?: 'REST' | 'EASY_RUN' | 'MOBILITY'
}
export type Companion = { warmup?: string; recovery?: string; diet?: string }

export type CoachSuggestion = {
  id: string
  athleteId: string
  /** Rule that produced it; with target and basis it de-duplicates suggestions. */
  rule: string
  kind: SuggestionKind
  createdAt: string
  /** After this the suggestion is shown as expired and must be previewed again. */
  expiresAt: string
  target: SuggestionTarget
  second?: SuggestionTarget
  reason: string
  original: string
  proposed: string
  impact: string
  basis: { items: string[]; version: string }
  uncertainty: string
  change: ProposedChange
  companion: Companion
  status: SuggestionStatus
  deferredUntil?: string
  /** Snapshot of the entries before and after an accepted change, for undo. */
  receipt?: { before: ScheduleEntry[]; after: ScheduleEntry[]; courseProposalId?: string; at: string }
  outcome?: { state: OutcomeState; reasons: string[]; checkedAt: string }
  history: { at: string; action: SuggestionAction; note?: string }[]
}

export type CoachNote = {
  id: string
  athleteId: string
  date: string
  entryId?: string
  suggestionId?: string
  text: string
  createdAt: string
  basisVersion: string
  status: 'CURRENT' | 'NEEDS_REVIEW' | 'WITHDRAWN'
  history: { at: string; status: CoachNote['status']; reason: string }[]
}

export type SuggestionDocument = { schema: 1; revision: number; athleteId: string; suggestions: CoachSuggestion[]; notes: CoachNote[] }
export const emptySuggestionDocument = (athleteId: string): SuggestionDocument => ({ schema: 1, revision: 0, athleteId, suggestions: [], notes: [] })

export type GenerationInput = {
  athleteId: string
  today: string
  now: string
  entries: ScheduleEntry[]
  /** 'HOLD_ACTIVE' / 'ESCALATION_REQUIRED' mean pain or a safety limit is active. */
  safetyState: string | null
  /** Recent recovery signals; null fields are unknown, never zero. */
  recovery: { readiness: number | null; hrvToday: number | null; hrvBaseline: number | null; sleepLast: number | null; sleepBaseline: number | null } | null
  /** Race or test dates from the athlete profile. */
  events: { date: string; label: string }[]
  /** Available minutes per session from the confirmed personal conditions, if any. */
  availableMinutes: number | null
  /** Entry IDs that have already started or finished; these are never touched. */
  startedIds: Set<string>
  /** Digest of the inputs, so a later correction can be detected. */
  basisVersion: string
}

const DAY = 86400000
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY)
const isKey = (e: { intensity: Intensity; lowerHeavy: boolean }) => e.intensity === 'HARD' || e.lowerHeavy
const label = (i: Intensity) => ({ EASY: '轻松', MODERATE: '中等', HARD: '高强度' })[i]
const describe = (t: SuggestionTarget) => `${t.date} ${t.title}（${t.minutes}分钟，${label(t.intensity)}${t.lowerHeavy ? '，下肢负荷大' : ''}）`
const targetOf = (e: ScheduleEntry): SuggestionTarget => ({ entryId: e.id, date: e.date, title: e.title, modality: e.modality, minutes: e.minutes, intensity: e.intensity, lowerHeavy: e.lowerHeavy })

/** Only planned, unstarted, owned, future sessions can receive a plan-changing suggestion. */
export function changeable(e: ScheduleEntry, input: Pick<GenerationInput, 'athleteId' | 'today' | 'startedIds'>) {
  return (e.athleteId ?? 'local') === input.athleteId && e.status === 'planned' && !e.actual && e.date >= input.today
    && e.modality !== 'rest' && !input.startedIds.has(e.id) && Number.isFinite(e.minutes) && e.minutes > 0
}

const COMPANION_BY_KIND: Record<SuggestionKind, Companion> = {
  MOVE: { warmup: '移动后的那天照原课热身，前一天避免额外高强度。', recovery: '原日期改为休息或轻松活动。' },
  SWAP: { warmup: '两节课各自保留原有热身。', recovery: '关键课前一晚保证睡眠。' },
  REPLACE: { recovery: '以轻松活动、拉伸和睡眠为主。', diet: '训练量下降时正餐照常，不必刻意减少。' },
  CANCEL: { recovery: '先休息并观察症状；疼痛持续或加重请就医评估。', diet: '停训期间三餐照常，不以少吃补偿。' },
  REDUCE: { warmup: '热身时间不减，正式部分按减量执行。', recovery: '课后补水，当晚早睡。', diet: '课前2–3小时正常进餐，课后补充含蛋白和主食的一餐。' },
  COMPANION: {},
}

function make(input: GenerationInput, rule: string, kind: SuggestionKind, target: ScheduleEntry, fields: {
  reason: string; proposed: string; impact: string; basis: string[]; uncertainty: string; change: ProposedChange; second?: ScheduleEntry; companion?: Companion
}): CoachSuggestion {
  const t = targetOf(target)
  return {
    id: `${rule}:${t.entryId}:${input.basisVersion}`,
    athleteId: input.athleteId,
    rule,
    kind,
    createdAt: input.now,
    // A suggestion about a session is valid until that day ends.
    expiresAt: `${addDays(t.date, 1)}T00:00:00.000Z`,
    target: t,
    ...(fields.second ? { second: targetOf(fields.second) } : {}),
    reason: fields.reason,
    original: describe(t) + (fields.second ? `；${describe(targetOf(fields.second))}` : ''),
    proposed: fields.proposed,
    impact: fields.impact,
    basis: { items: fields.basis, version: input.basisVersion },
    uncertainty: fields.uncertainty,
    change: fields.change,
    companion: { ...COMPANION_BY_KIND[kind], ...(fields.companion ?? {}) },
    status: 'PENDING',
    history: [{ at: input.now, action: 'CREATED' }],
  }
}

/** Free day for a move: no other active session that day, and at least one day
 * away from any key session if the moved one is a key session. */
function freeDay(input: GenerationInput, moving: ScheduleEntry, from: string, until: string): string | null {
  const active = input.entries.filter(e => e.id !== moving.id && !['rejected', 'skipped'].includes(e.status) && e.modality !== 'rest')
  for (let d = addDays(from, 0); d <= until; d = addDays(d, 1)) {
    if (d === moving.date || d < input.today) continue
    if (active.some(e => e.date === d)) continue
    if (isKey(moving) && active.some(e => isKey(e) && Math.abs(daysBetween(e.date, d)) <= 1)) continue
    if (input.events.some(ev => ev.date === d || daysBetween(d, ev.date) === 1)) continue
    return d
  }
  return null
}

export function generateSuggestions(input: GenerationInput): CoachSuggestion[] {
  const out: CoachSuggestion[] = []
  const upcoming = input.entries.filter(e => changeable(e, input) && daysBetween(input.today, e.date) <= 7).sort((a, b) => a.date.localeCompare(b.date))
  const taken = new Set<string>()
  const add = (s: CoachSuggestion) => { if (!taken.has(s.target.entryId)) { taken.add(s.target.entryId); out.push(s) } }
  const hold = input.safetyState === 'HOLD_ACTIVE' || input.safetyState === 'ESCALATION_REQUIRED'

  // 1. Pain or a safety limit: the next key session within 48 h is suggested for cancellation.
  if (hold) {
    for (const e of upcoming.filter(e => isKey(e) && daysBetween(input.today, e.date) <= 2))
      add(make(input, 'SAFETY_HOLD', 'CANCEL', e, {
        reason: '记录里有疼痛或安全限制仍在生效，按规则先暂停诱发负荷的训练。',
        proposed: `取消 ${e.date} ${e.title}，当天休息；疼痛评估后再重新安排。`,
        impact: '本周训练量下降一节；不影响已完成的训练记录。',
        basis: ['当前疼痛/安全限制状态：生效中', `该课为${label(e.intensity)}${e.lowerHeavy ? '、下肢负荷大' : ''}`],
        uncertainty: '疼痛的原因和严重程度应用无法判断；是否恢复训练需要按实际症状决定。',
        change: {},
      }))
  }

  // 2. Low recovery signals today: today's key session is suggested to be reduced.
  const r = input.recovery
  const lowHrv = r && r.hrvToday !== null && r.hrvBaseline !== null && r.hrvToday < r.hrvBaseline * 0.85
  const shortSleep = r && r.sleepLast !== null && r.sleepBaseline !== null && r.sleepLast < r.sleepBaseline - 1
  if (!hold && (lowHrv || shortSleep)) {
    for (const e of upcoming.filter(e => e.date === input.today && isKey(e))) {
      const minutes = Math.max(15, Math.round(e.minutes * 0.7))
      add(make(input, 'LOW_RECOVERY', 'REDUCE', e, {
        reason: '今天的恢复指标低于你自己的基线，高强度课按原量执行的风险偏高。',
        proposed: `${e.title} 改为 ${minutes} 分钟、强度降为中等；组数或段数按比例减少，配速/重量不加。`,
        impact: '今天训练量约减少30%；后续课程不变。',
        basis: [
          ...(lowHrv ? [`今日HRV ${r!.hrvToday}，低于基线 ${Math.round(r!.hrvBaseline!)} 的85%`] : []),
          ...(shortSleep ? [`最近睡眠 ${r!.sleepLast} 小时，比基线少1小时以上`] : []),
        ],
        uncertainty: '单日指标波动较大，测量条件（时间、设备）未核对；如果主观感觉良好，可以选择拒绝或暂缓。',
        change: { minutes, intensity: 'MODERATE' },
      }))
    }
  }

  // 3. Taper: a key session in the two days before a race or test is reduced.
  for (const ev of input.events) {
    for (const e of upcoming.filter(e => isKey(e) && daysBetween(e.date, ev.date) >= 1 && daysBetween(e.date, ev.date) <= 2)) {
      const minutes = Math.max(15, Math.round(e.minutes * 0.6))
      add(make(input, 'PRE_EVENT', 'REDUCE', e, {
        reason: `距离${ev.label}（${ev.date}）只有${daysBetween(e.date, ev.date)}天，比赛前不宜安排高负荷课。`,
        proposed: `${e.title} 减到 ${minutes} 分钟、强度降为中等，保留几次短促的专项刺激。`,
        impact: '降低比赛前疲劳；当周总量略降。',
        basis: [`比赛/测试日期：${ev.date}`, `该课为${label(e.intensity)}`],
        uncertainty: '赛前减量的合适幅度因人而异；如有教练另行安排，以教练安排为准。',
        change: { minutes, intensity: 'MODERATE' },
      }))
    }
  }

  // 4. Back-to-back key sessions: the strength one is moved to a free day nearby.
  for (const e of upcoming.filter(e => isKey(e) && e.modality === 'strength')) {
    const clash = upcoming.find(o => o.id !== e.id && isKey(o) && o.modality === 'run' && Math.abs(daysBetween(o.date, e.date)) === 1)
    if (!clash) continue
    const to = freeDay(input, e, addDays(e.date, -3), addDays(e.date, 3))
    if (!to) continue
    add(make(input, 'BACK_TO_BACK', 'MOVE', e, {
      reason: `${e.title} 与 ${clash.date} 的 ${clash.title} 相邻，两节关键课之间没有恢复日。`,
      proposed: `把 ${e.title} 从 ${e.date} 移到 ${to}，内容不变。`,
      impact: '两节关键课之间至少隔一天；总量不变。',
      basis: [`${e.date} ${e.title}：${label(e.intensity)}${e.lowerHeavy ? '、下肢负荷大' : ''}`, `${clash.date} ${clash.title}：${label(clash.intensity)}`],
      uncertainty: '只按日期和强度判断，没有考虑你未记录的工作或生活安排。',
      change: { toDate: to },
    }))
  }

  // 5. Available time: a session longer than the confirmed time is suggested to be shortened.
  if (input.availableMinutes !== null) {
    for (const e of upcoming.filter(e => e.minutes > input.availableMinutes! + 10)) {
      const minutes = input.availableMinutes
      add(make(input, 'TIME_LIMIT', 'REDUCE', e, {
        reason: `这节课约 ${e.minutes} 分钟，超过你确认的单次可用时间 ${minutes} 分钟。`,
        proposed: `${e.title} 压缩到 ${minutes} 分钟：保留热身和主要部分，减少辅助内容。`,
        impact: '当次训练量下降；关键刺激保留。',
        basis: [`私人教练条件：单次 ${minutes} 分钟`, `已排课程：${e.minutes} 分钟`],
        uncertainty: '哪些内容属于辅助部分需要你核对；如果当天时间充足可以拒绝。',
        change: { minutes, intensity: e.intensity },
      }))
    }
  }

  // 6. Missed key session: advice only — no stacking a make-up session.
  const missed = input.entries.filter(e => (e.athleteId ?? 'local') === input.athleteId && e.actual?.outcome === 'missed' && isKey(e) && daysBetween(e.date, input.today) >= 0 && daysBetween(e.date, input.today) <= 2)
  for (const e of missed)
    add(make(input, 'MISSED_KEY', 'COMPANION', e, {
      reason: `${e.date} 的 ${e.title} 没有完成。`,
      proposed: '不把漏掉的课叠加到后面；按原计划继续，下一节关键课照常。',
      impact: '计划不改动。',
      basis: [`${e.date} 实际记录：未完成`],
      uncertainty: '没完成的原因未知；如果是因为不适，请先在记录里补充。',
      change: {},
      companion: { recovery: '如果是因为疲劳或不适漏练，今天以轻松活动为主。' },
    }))

  return out
}

/** Merge newly generated suggestions: never duplicate, never resurrect a decided one. */
export function mergeSuggestions(doc: SuggestionDocument, fresh: CoachSuggestion[], now: string): SuggestionDocument {
  const byKey = new Map(doc.suggestions.map(s => [`${s.rule}:${s.target.entryId}`, s]))
  const suggestions = doc.suggestions.map(s => {
    // A pending suggestion past its date, or whose basis changed, expires and must be re-previewed.
    if ((s.status === 'PENDING' || s.status === 'DEFERRED') && Date.parse(now) > Date.parse(s.expiresAt))
      return { ...s, status: 'EXPIRED' as const, history: [...s.history, { at: now, action: 'EXPIRED' as const, note: '日期已过，未执行' }] }
    return s
  })
  for (const s of fresh) {
    const prior = byKey.get(`${s.rule}:${s.target.entryId}`)
    if (!prior) { suggestions.push(s); continue }
    if (prior.id === s.id) continue
    // Same rule and session, different basis: a decided one stays decided; an undecided one is replaced.
    if (prior.status === 'PENDING' || prior.status === 'DEFERRED' || prior.status === 'EXPIRED') {
      const i = suggestions.findIndex(x => x.id === prior.id)
      suggestions[i] = { ...prior, status: 'EXPIRED', history: [...prior.history, { at: now, action: 'BASIS_CHANGED', note: '依据已更新，已生成新的建议预览' }] }
      suggestions.push(s)
    }
  }
  return { ...doc, revision: doc.revision + 1, suggestions: suggestions.slice(-200) }
}

/** Suggestions to show now: pending, or deferred and due again. */
export function visibleSuggestions(doc: SuggestionDocument, now: string): CoachSuggestion[] {
  return doc.suggestions.filter(s => s.status === 'PENDING' || (s.status === 'DEFERRED' && (!s.deferredUntil || Date.parse(now) >= Date.parse(s.deferredUntil))))
}

export type Decision =
  | { action: 'ACCEPT' }
  | { action: 'EDIT_ACCEPT'; change: ProposedChange }
  | { action: 'DEFER'; until: string }
  | { action: 'REJECT'; note?: string }

/** Edits may lower the dose or pick another date, never raise the dose. */
export function sanitizeEdit(s: CoachSuggestion, change: ProposedChange): ProposedChange | string {
  const out: ProposedChange = {}
  if (change.minutes !== undefined) {
    if (!Number.isInteger(change.minutes) || change.minutes < 10) return '时长至少10分钟'
    if (change.minutes > s.target.minutes) return '编辑后的时长不能超过原安排，不自动加量'
    out.minutes = change.minutes
  }
  if (change.intensity !== undefined) {
    const rank = { EASY: 0, MODERATE: 1, HARD: 2 }
    if (rank[change.intensity] > rank[s.target.intensity]) return '编辑后的强度不能高于原安排'
    out.intensity = change.intensity
  }
  if (change.toDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(change.toDate)) return '日期无效'
    out.toDate = change.toDate
  }
  if (change.replaceWith !== undefined) out.replaceWith = change.replaceWith
  return out
}

/** Re-check before writing: the target must still exist unchanged and unstarted. */
export function recheckTarget(s: CoachSuggestion, entries: ScheduleEntry[], input: Pick<GenerationInput, 'athleteId' | 'today' | 'startedIds'>): ScheduleEntry | string {
  const e = entries.find(x => x.id === s.target.entryId)
  if (!e) return '这节课已不在日历里，建议已失效'
  if (!changeable(e, input)) return '这节课已开始、完成、取消或已过日期，建议不能执行'
  if (e.date !== s.target.date || e.minutes !== s.target.minutes || e.intensity !== s.target.intensity) return '这节课在建议生成后被改过，请重新预览'
  return e
}

/** Apply a dose/replace/cancel change to one entry. MOVE/SWAP go through the course-move flow. */
export function applyChange(e: ScheduleEntry, s: CoachSuggestion, change: ProposedChange): ScheduleEntry {
  const note = `方坤建议（已由你确认）：${s.reason}`
  if (s.kind === 'CANCEL') return { ...e, status: 'skipped', overrideNote: note }
  if (s.kind === 'REPLACE') {
    const r = change.replaceWith ?? 'MOBILITY'
    return { ...e, title: r === 'REST' ? '休息' : r === 'EASY_RUN' ? '轻松跑' : '活动度与拉伸', modality: r === 'REST' ? 'rest' : e.modality, intensity: 'EASY', lowerHeavy: false, minutes: r === 'REST' ? 0 : Math.min(e.minutes, 30), edited: true, swapReason: s.reason, overrideNote: note }
  }
  // REDUCE: never above the original.
  return { ...e, minutes: Math.min(e.minutes, change.minutes ?? e.minutes), intensity: change.intensity ?? e.intensity, reduced: true, edited: true, overrideNote: note }
}

export function decide(s: CoachSuggestion, d: Decision, now: string): CoachSuggestion {
  if (d.action === 'DEFER') return { ...s, status: 'DEFERRED', deferredUntil: d.until, history: [...s.history, { at: now, action: 'DEFERRED', note: `暂缓到 ${d.until.slice(0, 10)}` }] }
  if (d.action === 'REJECT') return { ...s, status: 'REJECTED', history: [...s.history, { at: now, action: 'REJECTED', ...(d.note ? { note: d.note } : {}) }] }
  if (d.action === 'EDIT_ACCEPT') return { ...s, status: 'EDITED_ACCEPTED', change: { ...s.change, ...d.change }, history: [...s.history, { at: now, action: 'EDITED_ACCEPTED' }] }
  return { ...s, status: 'ACCEPTED', history: [...s.history, { at: now, action: 'ACCEPTED' }] }
}

/** Long-term loop: after the session date, compare what actually happened. */
export function evaluateOutcome(s: CoachSuggestion, entries: ScheduleEntry[], safetyState: string | null, currentBasis: string, now: string): CoachSuggestion {
  const accepted = s.status === 'ACCEPTED' || s.status === 'EDITED_ACCEPTED'
  if (!accepted && s.status !== 'REJECTED') return s
  const reasons: string[] = []
  let state: OutcomeState = 'AWAITING'
  const id = s.receipt?.after[0]?.id ?? s.target.entryId
  const e = entries.find(x => x.id === id)
  const day = e?.date ?? s.target.date
  if (s.basis.version !== currentBasis && s.outcome?.state !== 'WITHDRAWN' && s.history.every(h => h.action !== 'BASIS_CHANGED')) {
    reasons.push('建议依据的数据之后被更正或补充，原判断需要复核')
  }
  if (Date.parse(now) >= Date.parse(`${day}T23:59:59Z`)) {
    const a = e?.actual
    if (accepted) {
      if (safetyState === 'HOLD_ACTIVE' || safetyState === 'ESCALATION_REQUIRED' || a?.reasons?.includes('pain')) { state = 'WITHDRAWN'; reasons.push('调整后仍出现疼痛或安全限制，这条判断不再支持，需要重新评估') }
      else if (a && (a.outcome === 'as_planned' || a.outcome === 'different') && (a.rpe == null || a.rpe <= 8)) { state = 'SUPPORTED'; reasons.push(`调整后的课已完成${a.rpe != null ? `，RPE ${a.rpe}` : ''}，没有新的不适记录`) }
      else if (a?.outcome === 'missed' || (a?.rpe != null && a.rpe > 8)) { state = 'WEAKENED'; reasons.push(a?.outcome === 'missed' ? '调整后的课没有完成' : `调整后的课仍然很吃力（RPE ${a!.rpe}）`) }
      else if (s.kind === 'CANCEL' || s.kind === 'COMPANION') { state = 'SUPPORTED'; reasons.push('按建议没有安排这节课，之后未见新的不适记录') }
    } else if (a && a.outcome === 'as_planned' && (a.rpe == null || a.rpe <= 7) && !a.reasons?.includes('pain')) {
      state = 'WEAKENED'; reasons.push('你没有采纳，原安排也顺利完成：同类情况下这条规则的依据偏弱')
    }
  }
  if (!reasons.length) return s
  const changed = !s.outcome || s.outcome.state !== state || s.outcome.reasons.join('|') !== reasons.join('|')
  if (!changed) return s
  return { ...s, outcome: { state, reasons, checkedAt: now }, history: [...s.history, { at: now, action: 'OUTCOME', note: reasons.join('；') }] }
}

/** Coach notes follow their suggestion: a weakened/withdrawn judgement or a corrected
 * basis marks the note for review instead of deleting it. */
export function reviewNotes(notes: CoachNote[], suggestions: CoachSuggestion[], currentBasis: string, now: string): CoachNote[] {
  return notes.map(n => {
    const s = suggestions.find(x => x.id === n.suggestionId)
    let next: CoachNote['status'] = n.status, reason = ''
    if (s?.status === 'UNDONE') { next = 'WITHDRAWN'; reason = '对应调整已撤销' }
    else if (s?.outcome?.state === 'WITHDRAWN') { next = 'WITHDRAWN'; reason = s.outcome.reasons.join('；') }
    else if (n.basisVersion !== currentBasis && n.status === 'CURRENT') { next = 'NEEDS_REVIEW'; reason = '依据的数据已更正或补充' }
    if (next === n.status) return n
    return { ...n, status: next, history: [...n.history, { at: now, status: next, reason }] }
  })
}

export function noteFor(s: CoachSuggestion, now: string, change: ProposedChange): CoachNote {
  const what = s.kind === 'MOVE' ? `已移到 ${change.toDate ?? s.change.toDate}` : s.kind === 'SWAP' ? '已与另一节课对调' : s.kind === 'CANCEL' ? '已取消' : s.kind === 'REPLACE' ? '已替换为更轻松的内容' : s.kind === 'REDUCE' ? `已减为 ${change.minutes ?? s.change.minutes} 分钟${change.intensity ? `、${label(change.intensity)}` : ''}` : '计划未改动'
  const extra = [s.companion.warmup, s.companion.recovery, s.companion.diet].filter(Boolean).join(' ')
  return {
    id: `note:${s.id}`,
    athleteId: s.athleteId,
    date: change.toDate ?? s.target.date,
    entryId: s.target.entryId,
    suggestionId: s.id,
    text: `方坤：${s.target.title}${what}。原因：${s.reason}${extra ? ` 配套：${extra}` : ''}`,
    createdAt: now,
    basisVersion: s.basis.version,
    status: 'CURRENT',
    history: [{ at: now, status: 'CURRENT', reason: '建议被确认' }],
  }
}

/** Short summary of open suggestions and the current judgement, for the coach's facts. */
export function suggestionFacts(doc: SuggestionDocument, now: string): string[] {
  const open = visibleSuggestions(doc, now).map(s => `待你确认的建议：${s.proposed}（原因：${s.reason}）`)
  const judged = doc.suggestions.filter(s => s.outcome && s.outcome.state !== 'AWAITING').slice(-3).map(s => `此前建议「${s.proposed}」的跟踪：${s.outcome!.reasons.join('；')}`)
  return [...open.slice(0, 3), ...judged]
}
