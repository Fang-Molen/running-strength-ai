import { currentAthleteId } from './events.ts'
import { currentStore } from './storage.ts'
import { readFormalEvidenceRows } from './coach-v4-formal-rows-store.ts'
import { reviewFormalEvidence, strictIso } from './coach-v4-c11-adapter.ts'
import { computeReasoningFacts } from './coach-reasoning.ts'
import { readCoachReviewWorkspace } from './coach-review-workspace.ts'
import { readOfflineProfile } from './coach-offline-loop.ts'
import { loadHealthSnapshot } from '../health/snapshot.ts'
import { shortHash } from '../health/observation.ts'
import { calendarDay } from './coach-calendar.ts'
import { reviewDecisionEvidence, type DecisionEvidenceDraft } from './coach-decision-evidence.ts'

export const EVIDENCE_TOOLS = ['query_training_profile', 'read_confirmed_training_records', 'read_health_observations',
  'read_goal_constraints', 'read_muscle_history', 'preview_segment_correction'] as const
export type EvidenceTool = typeof EVIDENCE_TOOLS[number]
type Failure = { ok: false; code: 'SUBJECT_CHANGED' | 'STALE_SNAPSHOT' | 'HOST_SCOPE_UNAVAILABLE' | 'INVALID_ARGUMENTS' | 'OUTSIDE_SNAPSHOT' | 'SEGMENT_CHANGED' }

/** Private change detector, not an auth token. Includes corrections committed AFTER asOf.
 * Never returned, persisted, or sent to a model. Unknown storage enumeration fails closed. */
function storeRevision(): string {
  const store = currentStore()
  if (!store) throw Error('HOST_SCOPE_UNAVAILABLE')
  const keys = store.keys ? [...store.keys()] : store.key && typeof store.length === 'number'
    ? Array.from({ length: store.length }, (_, i) => store.key!(i)).filter((k): k is string => k !== null) : null
  if (!keys) throw Error('HOST_SCOPE_UNAVAILABLE')
  return JSON.stringify(keys.filter(k => /^(fr255-|fk-)/.test(k)).sort().map(k => [k, store.getItem(k)]))
}

/** Local read-only host adapter. Identity comes from the existing local athlete context,
 * NOT tool arguments. This is not server authentication or authorization for model dispatch. */
export function openCoachEvidenceTools(endDay: string, days = 7, asOf = new Date().toISOString()) {
  if (!strictIso(asOf) || endDay > calendarDay(asOf)!) throw Error('INVALID_CUTOFF')
  const subject = currentAthleteId(), revision = storeRevision()
  const formal = readFormalEvidenceRows(subject, asOf)
  const audit = reviewFormalEvidence({ athleteId: subject, asOf, question: '只读事实核对', rows: formal.rows })
  const workspace = readCoachReviewWorkspace(subject, endDay, days, asOf)
  const sessions = workspace.period.sessions
  const scope = sessions.map(s => s.occurrenceId)
  const rows = audit.audit.snapshot.active.filter(e => scope.includes(e.occurrenceId) && e.source !== 'PLAN' && e.source !== 'THIRD_PARTY')
  const computed = computeReasoningFacts({ ...audit.audit.snapshot, active: rows }, scope)
  // Same underlying row supplies both protocol distance and time. Never pair separate activities.
  const paired = computed.points.filter(p => p.confirmation === 'CONFIRMED' && p.distanceMeters !== null &&
    rows.filter(r => r.sourceId === p.sourceId && r.occurrenceId === p.occurrenceId && r.metric === 'SPLIT_SECONDS').length === 1)
  const runningSessions = sessions.filter(s => s.runningSegments > 0)
  const profile = {
    subjectId: subject, asOf, start: workspace.period.start, end: endDay, timeZone: 'Asia/Shanghai',
    status: 'PARTIAL' as const, recordedSessions: sessions.length, recordedDays: new Set(sessions.map(s => s.day)).size,
    knownSegmentDistanceM: paired.length ? paired.reduce((sum, p) => sum + p.distanceMeters!, 0) : null,
    distanceCoverage: { known: paired.length, eligible: computed.points.length, basis: '已读取实际分段；不是整课总距离' },
    runningSessions: runningSessions.length, strengthSessions: sessions.filter(s => s.strengthSets > 0).length,
    knownMinutes: sessions.some(s => s.durationMinutes != null) ? sessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0) : null,
    durationCoverage: { known: sessions.filter(s => s.durationMinutes != null).length, eligible: sessions.length },
    unknowns: workspace.period.unknowns, trends: workspace.period.trends,
    sourceIds: workspace.period.sourceIds, abilityScore: null, planChanged: false,
  }
  const health = loadHealthSnapshot(endDay)
  // The health view is a current projection, not a versioned historical database.
  // Future/unknown commit times cannot be upgraded to frozen evaluation evidence.
  const healthView = { ...health, metrics: health.metrics.map(m => {
    const visible = (p: NonNullable<typeof m.current>) => strictIso(p.updatedAt) && Date.parse(p.updatedAt) <= Date.parse(asOf)
    if (m.candidates.some(p => !visible(p))) return { ...m, state: 'MISSING' as const, current: null, candidates: [], series: [], baseline: null,
      notes: [...m.notes, '该快照缺少截止时点可确认的观测版本，未引用后来更新值。'] }
    return { ...m, series: m.series.filter(visible), baseline: null }
  }) }
  const goal = readOfflineProfile(subject, asOf)
  const snapshotId = `local-evidence:${shortHash(revision + JSON.stringify([subject, asOf, endDay, days]))}`
  function check(): Failure | null {
    try {
      if (currentAthleteId() !== subject) return { ok: false, code: 'SUBJECT_CHANGED' }
      if (storeRevision() !== revision) return { ok: false, code: 'STALE_SNAPSHOT' }
      return null
    } catch { return { ok: false, code: 'HOST_SCOPE_UNAVAILABLE' } }
  }
  const initial = check(); if (initial) throw Error(initial.code)
  function invoke(name: string, args: Record<string, unknown> = {}): { ok: true; subjectId: string; snapshotId: string; data: unknown } | Failure {
    const invalid = check(); if (invalid) return invalid
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, code: 'INVALID_ARGUMENTS' }
    let data: unknown
    const keys = Object.keys(args)
    if (name !== 'preview_segment_correction' && name !== 'read_confirmed_training_records' && keys.length) return { ok: false, code: 'INVALID_ARGUMENTS' }
    switch (name as EvidenceTool) {
      case 'query_training_profile': data = profile; break
      case 'read_confirmed_training_records': {
        if (keys.some(k => k !== 'occurrenceId') || keys.length && typeof args.occurrenceId !== 'string') return { ok: false, code: 'INVALID_ARGUMENTS' }
        if (args.occurrenceId && !scope.includes(String(args.occurrenceId))) return { ok: false, code: 'OUTSIDE_SNAPSHOT' }
        const selected = args.occurrenceId ? [String(args.occurrenceId)] : scope
        data = { sessions: sessions.filter(s => selected.includes(s.occurrenceId)), records: rows.filter(r => selected.includes(r.occurrenceId)),
          running: computed.points.filter(p => selected.includes(p.occurrenceId)), status: 'PARTIAL', notes: ['保留来源确认状态；自报或导入不会升级为正式事实。'] }
        break
      }
      case 'read_health_observations': data = healthView; break
      case 'read_goal_constraints': data = goal ? { status: 'AVAILABLE', ...goal } : { status: 'MISSING', profile: null }; break
      case 'read_muscle_history': data = { status: 'BLOCKED', workSets: null, muscleTotals: null,
        reason: '当前正式投影未完整提供准备组/工作组、单双侧总负荷及经专业核对的肌群映射，不能把记录组数冒充正式组归属。',
        recordedStrength: workspace.strength, planChanged: false }; break
      case 'preview_segment_correction': {
        if (keys.sort().join(',') !== 'confirmedDistanceM,expectedDistanceM,expectedSeconds,sourceId' || typeof args.sourceId !== 'string' ||
          typeof args.confirmedDistanceM !== 'number' || !Number.isFinite(args.confirmedDistanceM) || args.confirmedDistanceM <= 0)
          return { ok: false, code: 'INVALID_ARGUMENTS' }
        const matches = paired.filter(p => p.sourceId === args.sourceId)
        if (matches.length !== 1) return { ok: false, code: 'OUTSIDE_SNAPSHOT' }
        const p = matches[0]
        // Use unrounded raw seconds. The UI's rounded display is not a source record.
        const seconds = rows.find(r => r.sourceId === p.sourceId && r.occurrenceId === p.occurrenceId && r.metric === 'SPLIT_SECONDS')!.value!
        if (args.expectedDistanceM !== p.distanceMeters || args.expectedSeconds !== seconds) return { ok: false, code: 'SEGMENT_CHANGED' }
        const after = seconds * 1000 / args.confirmedDistanceM
        if (!Number.isFinite(after)) return { ok: false, code: 'INVALID_ARGUMENTS' }
        data = { sourceId: p.sourceId, occurrenceId: p.occurrenceId, rawDistanceM: p.distanceMeters, durationSeconds: seconds,
          confirmedDistanceM: args.confirmedDistanceM, beforePaceSecondsPerKm: p.paceSecondsPerKm, afterPaceSecondsPerKm: after,
          applied: false, formalCorrectionAvailable: false, note: '只读计算预览，尚未保存或替换正式记录。' }
        break
      }
      default: return { ok: false, code: 'INVALID_ARGUMENTS' }
    }
    const changed = check(); if (changed) return changed
    return { ok: true, subjectId: subject, snapshotId, data: structuredClone(data) }
  }
  return { subjectId: subject, snapshotId, asOf, listTools: () => [...EVIDENCE_TOOLS], invoke,
    readView() {
      const invalid = check(); if (invalid) return invalid
      return { ok: true as const, data: structuredClone({ profile, sessions, rows, running: paired, health: healthView, goal,
        audit: { safety: audit.audit.snapshot.safety, safetyMessage: audit.audit.snapshot.safetyMessage,
          quarantined: audit.audit.snapshot.quarantined, scopeConflictCount: audit.audit.snapshot.scopeConflictCount ?? 0,
          corrections: audit.audit.snapshot.corrections, unknownCommitTime: formal.unknownCommitTime.length } }) }
    },
    reviewDecision(draft: DecisionEvidenceDraft) {
      const invalid = check(); if (invalid) return invalid
      const result = reviewDecisionEvidence(audit.audit.snapshot, scope, draft)
      return check() ?? result
    },
  }
}
