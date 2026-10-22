/** Post-save C03 observation runtime. Local host context only: no model, plan writer,
 * numeric forecasts or medical clearance. Failures never roll back a training save. */
import { currentAthleteId, loadCommittedEventRecords, onAppEvent } from '../../core/events.ts'
import { currentStore } from '../../core/storage.ts'
import { storeKeys } from '../../core/storage-journal.ts'
import { readFormalEvidenceRows } from '../../core/coach-v4-formal-rows-store.ts'
import { reviewFormalEvidence, strictIso, type FormalEvidenceRow } from '../../core/coach-v4-c11-adapter.ts'
import { comparisonProtocol } from '../../core/coach-evolution-v4.ts'
import { listCorrections } from '../../core/training-correction.ts'
import { loadConfirmedTrainingImports } from '../../core/training-import.ts'
import { compileC03MetricBrief, type C03MetricBrief } from './evidence.ts'
import { registerCoachHypothesis, readCoachFollowupHistory, projectCoachFollowups,
  recheckCoachForecastDependencies, withdrawCoachHypothesis, type C03FollowupContext, type C03QuerySnapshot } from './followup.ts'
import type { LocalCoachAnswer } from '../../core/coach-local-first.ts'

export const C03_FOLLOWUP_CHANGED_EVENT = 'fangkun:c03-followup-changed'
export type C03ActorContext = { actorId: string; athleteId: string }
// This identifies a local profile, not a verified server account.
const localActor = (): C03ActorContext => ({ actorId: `local-profile:${currentAthleteId()}`, athleteId: currentAthleteId() })
function context(actor?: C03ActorContext): C03FollowupContext {
  const c = actor ?? localActor()
  if (!c.actorId || c.athleteId !== currentAthleteId()) throw Error('SUBJECT_CHANGED')
  return { ...c, asOf: Date.now() }
}
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x)
async function digest(v: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(v)))
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('')
}
function notify() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(C03_FOLLOWUP_CHANGED_EVENT)) }
type Scope = { version: 'C03-HOST-QUERY-1'; athleteId: string; observedOccurrenceId: string;
  kind: 'OCCURRENCE' | 'RELATED_PROTOCOL'; protocols: string[]; start: string | null }
const receiptContents = new WeakMap<C03QuerySnapshot, string>()
const scopeKey = (s: Scope) => canonical(s)
function parseScope(key: string): Scope {
  const s = JSON.parse(key) as Scope
  if (s?.version !== 'C03-HOST-QUERY-1' || !s.athleteId || !s.observedOccurrenceId ||
    !['OCCURRENCE', 'RELATED_PROTOCOL'].includes(s.kind) || !Array.isArray(s.protocols) ||
    !s.protocols.every(p => typeof p === 'string' && !!p) || s.start !== null && !strictIso(s.start)) throw Error('UNSUPPORTED_QUERY_SCOPE')
  return s
}
function protocol(r: FormalEvidenceRow) { return comparisonProtocol(r.protocol) }
function selected(r: FormalEvidenceRow, s: Scope) {
  if (r.athleteId !== s.athleteId) return false
  if (s.kind === 'OCCURRENCE') return r.trainingOccurrenceId === s.observedOccurrenceId
  // An initially empty related-source query remains a dependency. No promise of
  // comparability or physiological independence is inferred from this filter.
  return r.trainingOccurrenceId !== s.observedOccurrenceId && s.protocols.includes(protocol(r) ?? '') &&
    (s.start === null || r.occurredAt >= s.start)
}
function assertReadableStore() {
  const box = currentStore(); if (!box) throw Error('STORAGE_UNAVAILABLE')
  for (const key of storeKeys(box)) {
    const array = ['fr255-events-v1', 'fr255-training-correction-v1', 'fr255-confirmed-training-imports-v1', 'fangkun-import-session-ratings-v1'].includes(key)
    const journal = key.startsWith('fr255-event-journal-v2:') || key.startsWith('fr255-running-tx-r3:')
    if (!array && !journal) continue
    const raw = JSON.parse(box.getItem(key) ?? 'null')
    if (!raw || array && !Array.isArray(raw.data) || journal && (!raw.data || !strictIso(raw.recordedAt))) throw Error('FORMAL_STORAGE_INCOMPLETE')
    if (key === 'fr255-confirmed-training-imports-v1' && raw.data.filter((r: {schemaVersion?:number;userConfirmed?:boolean}) => r?.schemaVersion === 1 && r.userConfirmed === true).length > loadConfirmedTrainingImports().length)
      throw Error('FORMAL_IMPORT_READER_TRUNCATES_HISTORY')
  }
}
async function readReceipts(scopes: readonly Scope[], asOf: number): Promise<C03QuerySnapshot[]> {
  if (!Number.isSafeInteger(asOf) || asOf > Date.now() || scopes.some(s => s.athleteId !== currentAthleteId())) throw Error('SUBJECT_OR_CUTOFF_CHANGED')
  assertReadableStore()
  const iso = new Date(asOf).toISOString(), athleteId = currentAthleteId()
  const formal = readFormalEvidenceRows(athleteId, iso)
  const committed = loadCommittedEventRecords()
  const receipts = await Promise.all(scopes.map(async s => {
    const rows = formal.rows.filter(r => selected(r, s)).sort((a, b) => a.recordId.localeCompare(b.recordId))
    const ids = new Set(rows.map(r => r.sourceEventId))
    const comparableIds = new Set(rows.map(r => r.trainingOccurrenceId))
    const relatedEvent = (e: typeof committed[number]['event']) => {
      if (e.athlete_id !== s.athleteId) return false
      const occ = e.event_type === 'TRAINING_STARTED' ? e.event_id : e.payload.trainingOccurrenceId
      if (s.kind === 'OCCURRENCE') return occ === s.observedOccurrenceId
      if (occ === s.observedOccurrenceId) return false
      if (typeof occ === 'string' && comparableIds.has(occ)) return true
      const p = e.payload
      if (e.event_type.startsWith('RUNNING_') && typeof p.componentId === 'string' && typeof p.blockId === 'string' && typeof p.stepId === 'string'
        && typeof p.actualDistanceMeters === 'number' && typeof p.roundOrdinal === 'number')
        return s.protocols.includes(`running:${p.componentId}:rep:${p.blockId}:${p.stepId}:${p.roundOrdinal}:${p.actualDistanceMeters}m`)
      // A discarded own source with insufficient binding cannot certify an empty related query.
      return e.event_type === 'TRAINING_STARTED' || e.event_type.startsWith('RUNNING_')
    }
    const ownUnknown = formal.unknownCommitTime.some(id => committed.some(e => e.event.event_id === id && relatedEvent(e.event)))
    const excluded = formal.excluded.filter(e => ids.has(e.id) || e.id.includes(s.observedOccurrenceId) ||
      committed.some(c => (e.id === c.event.event_id || e.id.startsWith(`${c.event.event_id}:`)) && relatedEvent(c.event)))
    const badCorrections = new Set([...formal.corrections.unknownCommitTime, ...formal.corrections.unmapped])
    const correctionUnknown = listCorrections().some(c => badCorrections.has(c.correctionId) &&
      (c.trainingOccurrenceId === s.observedOccurrenceId || s.kind === 'RELATED_PROTOCOL' &&
        (comparableIds.has(c.trainingOccurrenceId) || committed.some(r => r.event.payload.trainingOccurrenceId === c.trainingOccurrenceId && relatedEvent(r.event)))))
    const partial = ownUnknown || excluded.length > 0 || correctionUnknown
    const receipt = { scopeKey: scopeKey(s), athleteId, asOf, state: partial ? 'PARTIAL' : 'COMPLETE', completeRead: !partial,
      // Full rows and source-version metadata are hashed, with no sampling or tail limit.
      dataKey: await digest(rows.map(r => ({ ...r, knownAt: undefined }))),
      provenanceKey: await digest(rows.map(r => [r.recordId, r.sourceEventId, r.knownAt, r.supersedesRecordId ?? null])) } as C03QuerySnapshot
    receiptContents.set(receipt, canonical(rows))
    return receipt
  }))
  if (currentAthleteId() !== athleteId) throw Error('SUBJECT_CHANGED')
  return receipts
}
function scopesFor(b: C03MetricBrief): Scope[] {
  const events = b.numbers.filter(n => n.kind === 'SOURCE').map(n => n.handle)
  if (!events.length || !b.bindings.length) throw Error('NO_STABLE_FORMAL_BINDING')
  const protocols = [...new Set(b.bindings.map(b => comparisonProtocol(b.protocol)).filter((p): p is string => p !== null))].sort()
  if (!protocols.length) throw Error('NO_COMPARABLE_PROTOCOL_SCOPE')
  return [
    { version: 'C03-HOST-QUERY-1', athleteId: b.athleteId, observedOccurrenceId: b.observedOccurrenceId, kind: 'OCCURRENCE', protocols: [], start: null },
    { version: 'C03-HOST-QUERY-1', athleteId: b.athleteId, observedOccurrenceId: b.observedOccurrenceId, kind: 'RELATED_PROTOCOL', protocols, start: null },
  ]
}
/** Register only the exact displayed formal review, after the original answer/save.
 * The context is supplied by the host; it is not an HTTP authentication API. */
export async function registerDisplayedC03Review(answer: LocalCoachAnswer, actor?: C03ActorContext): Promise<{ ok: boolean; ids: string[]; reason?: string }> {
  const ids: string[] = []
  try {
    const c = context(actor), data = answer.c03
    if (!data || data.brief.athleteId !== c.athleteId || data.brief.state === 'BLOCKED' || !data.review.explanations.length ||
      answer.dialogue?.emergency || answer.dialogue?.medicalHold || !strictIso(data.brief.asOf) || Date.parse(data.brief.asOf) > c.asOf) throw Error('NO_SAFE_DISPLAYED_C03_REVIEW')
    const scopes = scopesFor(data.brief), baseline = await readReceipts(scopes, Date.parse(data.brief.asOf))
    const current = await readReceipts(scopes, Date.now())
    if (baseline.some((b, i) => !b.completeRead || !current[i].completeRead || b.dataKey !== current[i].dataKey || b.provenanceKey !== current[i].provenanceKey)) throw Error('DISPLAYED_EVIDENCE_CHANGED_OR_INCOMPLETE')
    const formal = readFormalEvidenceRows(c.athleteId, new Date(c.asOf).toISOString())
    const snap = reviewFormalEvidence({ athleteId: c.athleteId, asOf: new Date(c.asOf).toISOString(), question: '正式来源复核', rows: formal.rows }).audit.snapshot
    const fresh = compileC03MetricBrief(snap, data.brief.observedOccurrenceId)
    if (fresh.state === 'BLOCKED' || canonical(fresh.numbers) !== canonical(data.brief.numbers) || canonical(fresh.bindings) !== canonical(data.brief.bindings)) throw Error('DISPLAYED_FACTS_NO_LONGER_CURRENT')
    const reviewId = `c03-review:${await digest([c.actorId, c.athleteId, data.brief.observedOccurrenceId, baseline.map(b => [b.scopeKey, b.dataKey, b.provenanceKey])])}`
    for (const h of data.review.explanations) {
      if (currentAthleteId() !== c.athleteId) throw Error('SUBJECT_CHANGED')
      const sources = [...new Set(h.basisIds.flatMap(id => snap.active.filter(r => r.id === id && r.occurrenceId === data.brief.observedOccurrenceId).map(r => r.sourceId)))]
      const supportEvidence = await Promise.all(sources.map(async sourceId => ({ sourceId,
        revision: await digest(snap.active.filter(r => r.sourceId === sourceId)), fieldPaths: ['value', 'unit', 'context', 'eventAt', 'recordedAt'] })))
      if (!supportEvidence.length) throw Error('MISSING_FORMAL_SUPPORT')
      if (currentAthleteId() !== c.athleteId) throw Error('SUBJECT_CHANGED')
      // No await between the final live fact check and the immutable journal write.
      const latestAt = new Date().toISOString(), latestRows = readFormalEvidenceRows(c.athleteId, latestAt)
      if (current.some(b => canonical(latestRows.rows.filter(r => selected(r, parseScope(b.scopeKey)))
        .sort((a, b) => a.recordId.localeCompare(b.recordId))) !== receiptContents.get(b))) throw Error('RELATED_EVIDENCE_CHANGED_DURING_REGISTRATION')
      const latest = compileC03MetricBrief(reviewFormalEvidence({ athleteId: c.athleteId, asOf: latestAt,
        question: '正式来源复核', rows: latestRows.rows }).audit.snapshot, data.brief.observedOccurrenceId)
      if (latest.state === 'BLOCKED' || canonical(latest.numbers) !== canonical(data.brief.numbers)) throw Error('DISPLAYED_FACTS_NO_LONGER_CURRENT')
      const id = `${reviewId}:${h.id}`
      const saved = registerCoachHypothesis({ ...c, asOf: Date.now() }, { id, revision: 1, reviewId,
        observedOccurrenceId: data.brief.observedOccurrenceId, explanation: h.explanation,
        supportEvidence, counterEvidence: [], missing: [...data.review.missing, ...h.missing],
        supportingObservations: h.support, counterConditions: h.against,
        alternativeExplanations: data.review.explanations.filter(other => other.id !== h.id).map(other => other.explanation),
        nextObservation: `${h.observation.metric}；${h.observation.protocol}；支持：${h.observation.supportOutcome}；削弱：${h.observation.refuteOutcome}`,
        basis: baseline })
      if (!saved.ok) return { ok: false, ids, reason: saved.reason }
      ids.push(id)
    }
    notify(); return { ok: true, ids }
  } catch (e) { return { ok: false, ids, reason: e instanceof Error ? e.message : 'C03_REGISTRATION_FAILED' } }
}
/** Re-read the exact persisted dependency scopes, including empty queries. */
export async function recheckC03Followups(actor?: C03ActorContext) {
  try {
    const c = context(actor), history = readCoachFollowupHistory(c)
    if (history.status !== 'AVAILABLE') return { ok: false, reviewed: [], unchanged: [], reason: history.reason ?? 'HISTORY_UNAVAILABLE' }
    const keys = [...new Set(history.records.flatMap(r => r.kind === 'HYPOTHESIS' ? r.input.basis.map(b => b.scopeKey).filter(k=>!k.startsWith('batch99:')) : []))]
    if (!keys.length) return { ok: true, reviewed: [], unchanged: [] }
    let current: C03QuerySnapshot[]
    try { current = await readReceipts(keys.map(parseScope), Date.now()) }
    catch {
      if (currentAthleteId() !== c.athleteId) throw Error('SUBJECT_CHANGED')
      // Reading failure is a dependency failure, not an empty successful query.
      current = keys.map(scopeKey => ({ scopeKey, athleteId: c.athleteId, asOf: Date.now(),
        state: 'ERROR', completeRead: false, dataKey: 'UNAVAILABLE', provenanceKey: 'UNAVAILABLE' }))
    }
    if (currentAthleteId() !== c.athleteId) throw Error('SUBJECT_CHANGED')
    const result = recheckCoachForecastDependencies({ ...c, asOf: Date.now() }, current,key=>!key.startsWith('batch99:'))
    if (result.reviewed.length) notify()
    return result
  } catch (e) { return { ok: false, reviewed: [], unchanged: [], reason: e instanceof Error ? e.message : 'C03_RECHECK_FAILED' } }
}
export function readC03FollowupView(actor?: C03ActorContext) {
  return projectCoachFollowups(context(actor))
}
export function withdrawDisplayedC03Hypothesis(hypothesisId: string, actor?: C03ActorContext) {
  try {
    const result = withdrawCoachHypothesis(context(actor), { requestId: crypto.randomUUID(), hypothesisId,
      reason: '用户在长期跟进中明确撤回这项判断；原依据和历史版本保留。', confirmed: true })
    if (result.ok) notify()
    return result
  } catch { return { ok: false as const, reason: 'SUBJECT_OR_STORAGE_UNAVAILABLE' } }
}
/** One App-level listener. Deferred work cannot affect the synchronous save result.
 * No page interval is claimed to be a background OS notification. */
export function startC03FollowupRuntime(): () => void {
  let stopped = false, timer: ReturnType<typeof setTimeout> | null = null
  const enqueue = () => { if (stopped || timer !== null) return; const athlete = currentAthleteId()
    timer = setTimeout(() => { timer = null; if (!stopped && currentAthleteId() === athlete) void recheckC03Followups().then(async()=>{if(!stopped&&currentAthleteId()===athlete){const {refreshEvidenceDecisions}=await import('../../health/evidence-history.ts');if(!stopped&&currentAthleteId()===athlete)await refreshEvidenceDecisions()}}).catch(() => {}) }, 0) }
  const unsubscribe = onAppEvent(event => { if (event.athlete_id === currentAthleteId()) enqueue() })
  const changes = ['fk-training-activities-changed', 'fk-plan400-components', 'fk-run-links', 'fk-training-corrected', 'fk-health-changed', 'fk-athlete-scope-changed', 'storage', 'pageshow']
  if (typeof window !== 'undefined') changes.forEach(name => window.addEventListener(name, enqueue))
  enqueue()
  return () => { stopped = true; if (timer !== null) clearTimeout(timer); unsubscribe();
    if (typeof window !== 'undefined') changes.forEach(name => window.removeEventListener(name, enqueue)) }
}
