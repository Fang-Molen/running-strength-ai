/** C03/R14 local follow-up adapter. Reuses the existing append-only journal.
 * This is an observation repository, not a second training brain or a plan writer.
 * Identity and evidence snapshots must come from the current host session/read layer;
 * these browser APIs do not constitute server authentication or source certification.
 */
import { appendJournal, readJournal, storeKeys } from '../../core/storage-journal.ts'
import { currentStore } from '../../core/storage.ts'

export const C03_FOLLOWUP_PREFIX = 'fr255-p7-c03-followup-v1:'
export type C03FollowupContext = { actorId: string; athleteId: string; asOf: number }
export type C03QuerySnapshot = {
  scopeKey: string; athleteId: string; asOf: number;
  state: 'COMPLETE' | 'PARTIAL' | 'PENDING' | 'ERROR' | 'DENIED' | 'STALE' | 'CONFLICT';
  dataKey: string; provenanceKey: string; completeRead: boolean;
}
export type C03EvidenceRef = { sourceId: string; revision: string; fieldPaths: readonly string[] }
export type C03HypothesisInput = {
  id: string; revision: number; reviewId: string; observedOccurrenceId: string | null;
  explanation: string; supportEvidence: readonly C03EvidenceRef[];
  counterEvidence: readonly C03EvidenceRef[]; missing: readonly string[];
  /** Source-qualified text and prospective weakening conditions, not diagnoses. */
  supportingObservations?: readonly string[]; counterConditions?: readonly string[]; alternativeExplanations?: readonly string[];
  nextObservation: string; basis: readonly C03QuerySnapshot[];
}
export type C03Measurement = {
  athleteId: string; sourceId: string; revision: number; metric: string; unit: string; protocol: string;
  value: number; occurredAt: number; knownAt: number;
  origin: 'DEVICE' | 'USER_REPORT' | 'COACH_OBSERVATION';
}
export type C03Predicate = { op: 'LT' | 'LE' | 'EQ' | 'GE' | 'GT'; threshold: number }
export type C03ForecastInput = {
  id: string; revision: number; hypothesisId: string; hypothesisRevision: number;
  proposalId: string; proposalRevision: number; observationStart: number; observationEnd: number;
  metric: string; unit: string; protocol: string; contextId: string;
  baseline: C03Measurement; support: C03Predicate; refute: C03Predicate;
  conditionProvenance: { kind: 'PRE_REGISTERED_OBSERVATION' | 'PROFESSIONALLY_APPROVED_REFERENCE'; sourceId: string; version: string; note: string };
  /** Explicit registration of observational criteria. This is never dose approval. */
  confirmed: true; basis: readonly C03QuerySnapshot[];
}
export type C03ExecutionInput = {
  requestId: string; forecastId: string; forecastRevision: number;
  proposalId: string; proposalRevision: number; occurrenceId: string;
  status: 'FULL' | 'PARTIAL' | 'NONE' | 'UNKNOWN'; occurredAt: number;
  /** Host-resolved actual evidence. A plan/adoption receipt is never execution evidence. */
  actualEvidence: readonly C03EvidenceRef[]; origin: 'TRAINING_FACT' | 'USER_REPORTED_EXECUTION';
}
export type C03ObservationInput = {
  requestId: string; forecastId: string; forecastRevision: number;
  measurement: C03Measurement; executionRequestId: string | null;
  contextId: string; episodeId: string; periodStart: number; periodEnd: number;
  otherChanges: readonly string[];
}
export type C03DependencyReview = {
  state: 'UNCHANGED' | 'PROVENANCE_ONLY' | 'RECHECK_REQUIRED' | 'BLOCKED';
  changedScopes: string[]; reasons: string[]; planWriteAuthorized: false;
}
type Shell = { schemaVersion: 1; actorId: string; athleteId: string; knownAt: number; id: string }
export type C03FollowupRecord = Shell & (
  { kind: 'HYPOTHESIS'; input: C03HypothesisInput; registeredAt: number } |
  { kind: 'FORECAST'; input: C03ForecastInput; registeredAt: number } |
  { kind: 'ADOPTION'; forecastId: string; forecastRevision: number; adopted: boolean; confirmed: true } |
  { kind: 'EXECUTION'; input: C03ExecutionInput } |
  { kind: 'OBSERVATION'; input: C03ObservationInput } |
  { kind: 'WITHDRAWAL'; hypothesisId: string; reason: string; confirmed: true } |
  { kind: 'DEPENDENCY_REVIEW'; hypothesisId: string; hypothesisRevision: number; result: C03DependencyReview; current: readonly C03QuerySnapshot[] }
)
export type C03WriteResult = { ok: true; id: string; duplicate: boolean } | { ok: false; reason: string }
type RecordBody<T = C03FollowupRecord> = T extends Shell ? Omit<T, keyof Shell> & { id: string } : never
const text = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 4000
const id = (x: unknown): x is string => text(x) && x.length <= 240 && !/[\u0000-\u001f]/.test(x)
const time = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
const version = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0
const encode = (x: unknown): string => {
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return '[' + x.map(encode).join(',') + ']'
  return '{' + Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + encode(v)).join(',') + '}'
}
const fail = (reason: string): C03WriteResult => ({ ok: false, reason })
function contextValid(c: C03FollowupContext): boolean {
  return !!c && id(c.actorId) && id(c.athleteId) && time(c.asOf) && c.asOf <= Date.now()
}
function prefix(c: C03FollowupContext): string {
  return C03_FOLLOWUP_PREFIX + encodeURIComponent(c.actorId) + ':' + encodeURIComponent(c.athleteId) + ':'
}
const validRef = (r: C03EvidenceRef) => r && id(r.sourceId) && text(r.revision) && Array.isArray(r.fieldPaths) && r.fieldPaths.length > 0 && r.fieldPaths.every(text)
function basisValid(basis: readonly C03QuerySnapshot[], c: C03FollowupContext, cutoff: number): boolean {
  return Array.isArray(basis) && basis.length > 0 && basis.length <= 64 && new Set(basis.map(b => b.scopeKey)).size === basis.length &&
    basis.every(b => b && text(b.scopeKey) && b.athleteId === c.athleteId && time(b.asOf) && b.asOf <= cutoff &&
      b.state === 'COMPLETE' && b.completeRead === true && text(b.dataKey) && text(b.provenanceKey))
}
function measurementValid(m: C03Measurement, athleteId: string): boolean {
  return !!m && m.athleteId === athleteId && id(m.sourceId) && version(m.revision) && text(m.metric) && text(m.unit) && text(m.protocol) &&
    Number.isFinite(m.value) && time(m.occurredAt) && time(m.knownAt) && m.knownAt >= m.occurredAt &&
    ['DEVICE', 'USER_REPORT', 'COACH_OBSERVATION'].includes(m.origin)
}
function recordBodyValid(r: C03FollowupRecord, c: C03FollowupContext, committedAt: number): boolean {
  switch (r.kind) {
    case 'HYPOTHESIS': return !!r.input && id(r.input.id) && version(r.input.revision) &&
      time(r.registeredAt) && r.registeredAt <= r.knownAt && text(r.input.explanation) &&
      Array.isArray(r.input.supportEvidence) && r.input.supportEvidence.every(validRef) &&
      Array.isArray(r.input.counterEvidence) && r.input.counterEvidence.every(validRef) &&
      Array.isArray(r.input.missing) && basisValid(r.input.basis, c, r.registeredAt)
    case 'FORECAST': return !!r.input && id(r.input.id) && version(r.input.revision) && id(r.input.hypothesisId) &&
      time(r.registeredAt) && r.registeredAt <= r.knownAt && time(r.input.observationStart) &&
      committedAt < r.input.observationStart && r.input.observationStart < r.input.observationEnd &&
      measurementValid(r.input.baseline, c.athleteId) && r.input.baseline.knownAt <= r.registeredAt &&
      predicatesValid(r.input.support, r.input.refute) && basisValid(r.input.basis, c, r.registeredAt)
    case 'ADOPTION': return id(r.forecastId) && version(r.forecastRevision) && typeof r.adopted === 'boolean' && r.confirmed === true
    case 'EXECUTION': return !!r.input && id(r.input.requestId) && id(r.input.forecastId) && version(r.input.forecastRevision) &&
      id(r.input.occurrenceId) && time(r.input.occurredAt) && r.input.occurredAt <= r.knownAt &&
      ['FULL', 'PARTIAL', 'NONE', 'UNKNOWN'].includes(r.input.status) && Array.isArray(r.input.actualEvidence) && r.input.actualEvidence.every(validRef)
    case 'OBSERVATION': return !!r.input && id(r.input.requestId) && id(r.input.forecastId) && version(r.input.forecastRevision) &&
      measurementValid(r.input.measurement, c.athleteId) && r.input.measurement.knownAt <= r.knownAt &&
      id(r.input.episodeId) && id(r.input.contextId) && Array.isArray(r.input.otherChanges)
    case 'WITHDRAWAL': return id(r.hypothesisId) && text(r.reason) && r.confirmed === true
    case 'DEPENDENCY_REVIEW': return id(r.hypothesisId) && version(r.hypothesisRevision) && !!r.result &&
      ['UNCHANGED', 'PROVENANCE_ONLY', 'RECHECK_REQUIRED', 'BLOCKED'].includes(r.result.state) &&
      Array.isArray(r.result.changedScopes) && Array.isArray(r.result.reasons) && Array.isArray(r.current)
  }
}
/** Read failures are not reported as empty history. Legacy unowned rows are never adopted. */
export function readCoachFollowupHistory(c: C03FollowupContext): {
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'CONFLICT'; records: C03FollowupRecord[]; reason: string | null;
} {
  if (!contextValid(c)) return { status: 'UNAVAILABLE', records: [], reason: 'CURRENT_IDENTITY_OR_ASOF_REQUIRED' }
  const box = currentStore()
  if (!box) return { status: 'UNAVAILABLE', records: [], reason: 'STORAGE_UNAVAILABLE' }
  try {
    const p = prefix(c), keys = storeKeys(box).filter(k => k.startsWith(p))
    // readJournal intentionally retains malformed original bytes; this adapter exposes the failure.
    for (const key of keys) {
      const raw = JSON.parse(box.getItem(key) ?? 'null')
      if (!raw || raw.schemaVersion !== 1 || !text(raw.id) || !Number.isFinite(raw.order) || !raw.data ||
        typeof raw.recordedAt !== 'string' || !Number.isFinite(Date.parse(raw.recordedAt)))
        return { status: 'CONFLICT', records: [], reason: 'MALFORMED_FOLLOWUP_JOURNAL' }
    }
    const journal = readJournal<C03FollowupRecord>(p)
    if (journal.length !== keys.length) return { status: 'UNAVAILABLE', records: [], reason: 'INCOMPLETE_JOURNAL_READ' }
    const visible: C03FollowupRecord[] = []
    for (const e of journal) {
      const r = e.data
      if (!r || r.schemaVersion !== 1 || r.actorId !== c.actorId || r.athleteId !== c.athleteId ||
        r.id !== e.id || !time(r.knownAt) || !e.recordedAt || Date.parse(e.recordedAt) < r.knownAt ||
        !['HYPOTHESIS', 'FORECAST', 'ADOPTION', 'EXECUTION', 'OBSERVATION', 'WITHDRAWAL', 'DEPENDENCY_REVIEW'].includes(r.kind) ||
        !recordBodyValid(r, c, Date.parse(e.recordedAt)))
        return { status: 'CONFLICT', records: [], reason: 'INVALID_FOLLOWUP_RECORD' }
      if (r.knownAt <= c.asOf && Date.parse(e.recordedAt) <= c.asOf) visible.push(r)
    }
    const byId = new Map<string, C03FollowupRecord>()
    for (const r of visible) {
      const previous = byId.get(r.id)
      if (previous && encode(previous) !== encode(r)) return { status: 'CONFLICT', records: [], reason: 'CONFLICTING_LOGICAL_RECORD' }
      byId.set(r.id, r)
    }
    return { status: 'AVAILABLE', records: [...byId.values()], reason: null }
  } catch { return { status: 'UNAVAILABLE', records: [], reason: 'FOLLOWUP_READ_FAILED' } }
}
function live(c: C03FollowupContext) { return { ...c, asOf: Date.now() } }
function append(c: C03FollowupContext, body: RecordBody): C03WriteResult {
  if (!contextValid(c)) return fail('CURRENT_IDENTITY_REQUIRED')
  const read = readCoachFollowupHistory(live(c))
  if (read.status !== 'AVAILABLE') return fail(read.reason ?? 'HISTORY_UNAVAILABLE')
  const previous = read.records.find(r => r.id === body.id)
  // Registration time is wall-clock, not part of a caller-controlled idempotency key.
  const comparable = (r: Record<string, unknown>) => { const { knownAt, schemaVersion, actorId, athleteId, registeredAt, ...rest } = r; return rest }
  if (previous) return encode(comparable(previous)) === encode(comparable(body)) ? { ok: true, id: body.id, duplicate: true } : fail('REQUEST_ID_CONFLICT')
  const now = Date.now()
  if (read.records.length >= 10000) return fail('FOLLOWUP_CAPACITY_REACHED')
  if (body.kind === 'FORECAST' && body.input.observationStart <= now) return fail('FORECAST_NOT_COMMITTED_BEFORE_WINDOW')
  const row = { ...body, ...(['HYPOTHESIS', 'FORECAST'].includes(body.kind) ? { registeredAt: now } : {}), schemaVersion: 1, actorId: c.actorId, athleteId: c.athleteId, knownAt: now } as C03FollowupRecord
  if (!appendJournal(prefix(c), row.id, row)) return fail('FOLLOWUP_SAVE_FAILED')
  // Physical commit time, rather than a caller timestamp, determines pre-registration.
  return readCoachFollowupHistory(live(c)).status === 'AVAILABLE' ? { ok: true, id: row.id, duplicate: false } : fail('FOLLOWUP_COMMIT_REQUIRES_REVIEW')
}
function currentRecords(c: C03FollowupContext) { return readCoachFollowupHistory(live(c)) }
function hypothesisRows(records: readonly C03FollowupRecord[], hypothesisId: string) {
  return records.filter((r): r is C03FollowupRecord & { kind: 'HYPOTHESIS' } => r.kind === 'HYPOTHESIS' && r.input.id === hypothesisId)
}
const withdrawn = (records: readonly C03FollowupRecord[], hypothesisId: string) => records.some(r => r.kind === 'WITHDRAWAL' && r.hypothesisId === hypothesisId)
export function registerCoachHypothesis(c: C03FollowupContext, input: C03HypothesisInput): C03WriteResult {
  if (!contextValid(c) || !input || !id(input.id) || !version(input.revision) || !id(input.reviewId) ||
    !(input.observedOccurrenceId === null || id(input.observedOccurrenceId)) || !text(input.explanation) || !text(input.nextObservation) ||
    !Array.isArray(input.supportEvidence) || !input.supportEvidence.length || !input.supportEvidence.every(validRef) ||
    !Array.isArray(input.counterEvidence) || !input.counterEvidence.every(validRef) || !Array.isArray(input.missing) || !input.missing.every(text) ||
    [input.supportingObservations, input.counterConditions, input.alternativeExplanations].some(a => a !== undefined && (!Array.isArray(a) || !a.every(text))) ||
    !basisValid(input.basis, c, c.asOf)) return fail('INVALID_HYPOTHESIS_OR_BASIS')
  const read = currentRecords(c)
  if (read.status !== 'AVAILABLE') return fail(read.reason!)
  if (withdrawn(read.records, input.id)) return fail('WITHDRAWN_HYPOTHESIS_NOT_REACTIVATED')
  const own = hypothesisRows(read.records, input.id), same = own.find(r => r.input.revision === input.revision)
  if (!same && input.revision !== Math.max(0, ...own.map(r => r.input.revision)) + 1) return fail('HYPOTHESIS_VERSION_CONFLICT')
  return append(c, { id: `hypothesis:${input.id}@${input.revision}`, kind: 'HYPOTHESIS', input: structuredClone(input), registeredAt: Date.now() })
}
const matches = (e: C03Predicate, value: number) => e.op === 'LT' ? value < e.threshold : e.op === 'LE' ? value <= e.threshold : e.op === 'EQ' ? value === e.threshold : e.op === 'GE' ? value >= e.threshold : value > e.threshold
function predicatesValid(a: C03Predicate, b: C03Predicate): boolean {
  if (![a, b].every(e => e && ['LT', 'LE', 'EQ', 'GE', 'GT'].includes(e.op) && Number.isFinite(e.threshold))) return false
  const lo = Math.min(a.threshold, b.threshold), hi = Math.max(a.threshold, b.threshold)
  return ![lo - 1, lo, (lo + hi) / 2, hi, hi + 1].some(x => matches(a, x) && matches(b, x))
}
export function registerCoachForecast(c: C03FollowupContext, input: C03ForecastInput): C03WriteResult {
  const now = Date.now(), read = currentRecords(c)
  if (read.status !== 'AVAILABLE') return fail(read.reason!)
  if (!contextValid(c) || !input || !id(input.id) || !version(input.revision) || !id(input.hypothesisId) || !version(input.hypothesisRevision) ||
    !id(input.proposalId) || !version(input.proposalRevision) || !time(input.observationStart) || !time(input.observationEnd) ||
    input.observationStart <= now || input.observationEnd <= input.observationStart || !text(input.metric) || !text(input.unit) || !text(input.protocol) || !id(input.contextId) ||
    !measurementValid(input.baseline, c.athleteId) || input.baseline.knownAt > c.asOf || input.baseline.metric !== input.metric || input.baseline.unit !== input.unit || input.baseline.protocol !== input.protocol ||
    !predicatesValid(input.support, input.refute) || input.confirmed !== true || !input.conditionProvenance ||
    !['PRE_REGISTERED_OBSERVATION', 'PROFESSIONALLY_APPROVED_REFERENCE'].includes(input.conditionProvenance.kind) || !id(input.conditionProvenance.sourceId) || !text(input.conditionProvenance.version) || !text(input.conditionProvenance.note) ||
    !basisValid(input.basis, c, c.asOf)) return fail('INVALID_OR_POSTHOC_FORECAST')
  if (!hypothesisRows(read.records, input.hypothesisId).some(r => r.input.revision === input.hypothesisRevision)) return fail('HYPOTHESIS_VERSION_NOT_FOUND')
  if (withdrawn(read.records, input.hypothesisId)) return fail('WITHDRAWN_HYPOTHESIS_NOT_REACTIVATED')
  const own = read.records.filter((r): r is C03FollowupRecord & { kind: 'FORECAST' } => r.kind === 'FORECAST' && r.input.id === input.id)
  if (!own.some(r => r.input.revision === input.revision) && input.revision !== Math.max(0, ...own.map(r => r.input.revision)) + 1) return fail('FORECAST_VERSION_CONFLICT')
  return append(c, { id: `forecast:${input.id}@${input.revision}`, kind: 'FORECAST', input: structuredClone(input), registeredAt: now })
}
function findForecast(records: readonly C03FollowupRecord[], forecastId: string, revision: number) {
  return records.find((r): r is C03FollowupRecord & { kind: 'FORECAST' } => r.kind === 'FORECAST' && r.input.id === forecastId && r.input.revision === revision)
}
export function recordCoachAdoption(c: C03FollowupContext, input: { requestId: string; forecastId: string; forecastRevision: number; adopted: boolean; confirmed: true }): C03WriteResult {
  const read = currentRecords(c)
  if (read.status !== 'AVAILABLE') return fail(read.reason!)
  if (!input || !id(input.requestId) || !findForecast(read.records, input.forecastId, input.forecastRevision) || typeof input.adopted !== 'boolean' || input.confirmed !== true) return fail('INVALID_ADOPTION')
  return append(c, { id: `adoption:${input.requestId}`, kind: 'ADOPTION', forecastId: input.forecastId, forecastRevision: input.forecastRevision, adopted: input.adopted, confirmed: true })
}
export function recordCoachExecution(c: C03FollowupContext, input: C03ExecutionInput): C03WriteResult {
  const read = currentRecords(c)
  if (read.status !== 'AVAILABLE') return fail(read.reason!)
  const f = input && findForecast(read.records, input.forecastId, input.forecastRevision)
  if (!f || !id(input.requestId) || !id(input.occurrenceId) || input.proposalId !== f.input.proposalId || input.proposalRevision !== f.input.proposalRevision ||
    !['FULL', 'PARTIAL', 'NONE', 'UNKNOWN'].includes(input.status) || !time(input.occurredAt) || input.occurredAt < f.registeredAt || input.occurredAt > c.asOf ||
    !Array.isArray(input.actualEvidence) || !input.actualEvidence.length || !input.actualEvidence.every(validRef) ||
    !['TRAINING_FACT', 'USER_REPORTED_EXECUTION'].includes(input.origin)) return fail('INVALID_EXECUTION_OR_ACTUAL_SOURCE')
  return append(c, { id: `execution:${input.requestId}`, kind: 'EXECUTION', input: structuredClone(input) })
}
export function recordCoachObservation(c: C03FollowupContext, input: C03ObservationInput): C03WriteResult {
  const read = currentRecords(c)
  if (read.status !== 'AVAILABLE') return fail(read.reason!)
  const f = input && findForecast(read.records, input.forecastId, input.forecastRevision)
  if (!f || !id(input.requestId) || !measurementValid(input.measurement, c.athleteId) || input.measurement.knownAt > c.asOf ||
    input.measurement.occurredAt < f.input.observationStart || input.measurement.occurredAt >= f.input.observationEnd ||
    !id(input.contextId) || !id(input.episodeId) || !time(input.periodStart) || !time(input.periodEnd) || input.periodStart >= input.periodEnd ||
    input.measurement.occurredAt < input.periodStart || input.measurement.occurredAt > input.periodEnd || !Array.isArray(input.otherChanges) || !input.otherChanges.every(text) ||
    !(input.executionRequestId === null || read.records.some(r => r.kind === 'EXECUTION' && r.input.requestId === input.executionRequestId && r.input.forecastId === input.forecastId && r.input.forecastRevision === input.forecastRevision)))
    return fail('INVALID_OBSERVATION_OR_LINK')
  return append(c, { id: `observation:${input.requestId}`, kind: 'OBSERVATION', input: structuredClone(input) })
}
export function withdrawCoachHypothesis(c: C03FollowupContext, input: { requestId: string; hypothesisId: string; reason: string; confirmed: true }): C03WriteResult {
  const read = currentRecords(c)
  if (read.status !== 'AVAILABLE') return fail(read.reason!)
  if (!input || !id(input.requestId) || !text(input.reason) || input.confirmed !== true || !hypothesisRows(read.records, input.hypothesisId).length) return fail('INVALID_WITHDRAWAL')
  return append(c, { id: `withdrawal:${input.requestId}`, kind: 'WITHDRAWAL', hypothesisId: input.hypothesisId, reason: input.reason, confirmed: true })
}
/** Includes empty-query dependencies; provenance-only changes do not rewrite a finding. */
export function compareCoachFollowupDependencies(saved: readonly C03QuerySnapshot[], current: readonly C03QuerySnapshot[], asOf: number): C03DependencyReview {
  const result = (state: C03DependencyReview['state'], changedScopes: string[], reasons: string[]): C03DependencyReview => ({ state, changedScopes, reasons, planWriteAuthorized: false })
  if (!saved.length || !time(asOf) || new Set(saved.map(s => s.scopeKey)).size !== saved.length || new Set(current.map(s => s.scopeKey)).size !== current.length ||
    new Set(saved.map(s => s.athleteId)).size !== 1) return result('BLOCKED', [], ['INVALID_DEPENDENCIES'])
  const currentByKey = new Map(current.map(s => [s.scopeKey, s])), changed: string[] = [], reasons: string[] = []
  let blocked = false, provenanceOnly = false
  for (const previous of saved) {
    const fresh = currentByKey.get(previous.scopeKey)
    if (!fresh || fresh.athleteId !== previous.athleteId || !time(fresh.asOf) || fresh.asOf < previous.asOf || fresh.asOf > asOf || fresh.state !== 'COMPLETE' || fresh.completeRead !== true) {
      blocked = true; changed.push(previous.scopeKey); reasons.push('MISSING_INCOMPLETE_OR_FUTURE_DEPENDENCY'); continue
    }
    if (fresh.dataKey !== previous.dataKey) { changed.push(previous.scopeKey); reasons.push('RELATED_CONTENT_OR_COVERAGE_CHANGED') }
    else if (fresh.provenanceKey !== previous.provenanceKey) provenanceOnly = true
  }
  return result(blocked ? 'BLOCKED' : changed.length ? 'RECHECK_REQUIRED' : provenanceOnly ? 'PROVENANCE_ONLY' : 'UNCHANGED', changed, reasons)
}
export function recheckCoachForecastDependencies(c: C03FollowupContext, current: readonly C03QuerySnapshot[]): { ok: boolean; reviewed: string[]; unchanged: string[]; reason?: string } {
  const read = readCoachFollowupHistory(c)
  if (read.status !== 'AVAILABLE') return { ok: false, reviewed: [], unchanged: [], reason: read.reason! }
  const latest = new Map<string, C03FollowupRecord & { kind: 'HYPOTHESIS' }>()
  for (const r of read.records) if (r.kind === 'HYPOTHESIS' && (!latest.has(r.input.id) || latest.get(r.input.id)!.input.revision < r.input.revision)) latest.set(r.input.id, r)
  const reviewed: string[] = [], unchanged: string[] = []
  for (const h of latest.values()) {
    if (withdrawn(read.records, h.input.id)) { unchanged.push(h.input.id); continue }
    const result = compareCoachFollowupDependencies(h.input.basis, current, c.asOf)
    if (result.state === 'UNCHANGED' || result.state === 'PROVENANCE_ONLY') { unchanged.push(h.input.id); continue }
    // Repeated rechecks compare their immutable result before committing. The actual
    // journal ID is bounded and does not embed a potentially large source snapshot.
    const related = current.filter(b => h.input.basis.some(s => s.scopeKey === b.scopeKey))
    const duplicate = read.records.some(r => r.kind === 'DEPENDENCY_REVIEW' && r.hypothesisId === h.input.id && r.hypothesisRevision === h.input.revision && encode(r.result) === encode(result) && encode(r.current.map(b => [b.scopeKey, b.dataKey, b.provenanceKey, b.state])) === encode(related.map(b => [b.scopeKey, b.dataKey, b.provenanceKey, b.state])))
    if (!duplicate) {
      const saved = append(c, { id: `dependency:${crypto.randomUUID()}`, kind: 'DEPENDENCY_REVIEW', hypothesisId: h.input.id, hypothesisRevision: h.input.revision, result, current: structuredClone(related) })
      if (!saved.ok) return { ok: false, reviewed, unchanged, reason: saved.reason }
    }
    reviewed.push(h.input.id)
  }
  return { ok: true, reviewed, unchanged }
}
export type C03ForecastReview = {
  state: 'UNAVAILABLE' | 'WITHDRAWN' | 'STALE_BASIS' | 'WAIT_FOR_DATA' | 'UNTESTABLE' | 'OBSERVED_SUPPORT' | 'OBSERVED_COUNTER' | 'MIXED_OBSERVATIONS' | 'INCONCLUSIVE';
  adoption: boolean | null; executionState: 'NO_EXECUTION_EVIDENCE' | 'FULL' | 'PARTIAL' | 'NONE' | 'UNKNOWN';
  results: { sourceRef: string; result: 'SUPPORT' | 'COUNTER' | 'NEUTRAL' | 'UNTESTABLE'; reasons: string[] }[];
  nonOverlappingEpisodeGroups: number; supportGroups: number; counterGroups: number; mixedGroups: number;
  independenceEstablished: false; causalConclusion: 'NOT_ESTABLISHED'; planWriteAuthorized: false; reasons: string[];
}
export function reviewCoachForecast(c: C03FollowupContext, forecastId: string, forecastRevision: number, current: readonly C03QuerySnapshot[]): C03ForecastReview {
  const read = readCoachFollowupHistory(c)
  const shell = (state: C03ForecastReview['state'], reasons: string[] = []): C03ForecastReview => ({ state, adoption: null, executionState: 'NO_EXECUTION_EVIDENCE', results: [], nonOverlappingEpisodeGroups: 0, supportGroups: 0, counterGroups: 0, mixedGroups: 0, independenceEstablished: false, causalConclusion: 'NOT_ESTABLISHED', planWriteAuthorized: false, reasons })
  if (read.status !== 'AVAILABLE') return shell('UNAVAILABLE', [read.reason!])
  const f = findForecast(read.records, forecastId, forecastRevision)
  if (!f) return shell('UNAVAILABLE', ['FORECAST_VERSION_NOT_FOUND'])
  if (withdrawn(read.records, f.input.hypothesisId)) return shell('WITHDRAWN', ['EXPLICIT_WITHDRAWAL_RETAINED'])
  const dependencies = compareCoachFollowupDependencies(f.input.basis, current, c.asOf)
  if (dependencies.state === 'BLOCKED' || dependencies.state === 'RECHECK_REQUIRED') return shell('STALE_BASIS', dependencies.reasons)
  const adoption = read.records.filter(r => r.kind === 'ADOPTION' && r.forecastId === forecastId && r.forecastRevision === forecastRevision).at(-1)
  const execution = read.records.filter((r): r is C03FollowupRecord & { kind: 'EXECUTION' } => r.kind === 'EXECUTION' && r.input.forecastId === forecastId && r.input.forecastRevision === forecastRevision)
  const observations = read.records.filter((r): r is C03FollowupRecord & { kind: 'OBSERVATION' } => r.kind === 'OBSERVATION' && r.input.forecastId === forecastId && r.input.forecastRevision === forecastRevision)
  const latest = new Map<string, C03ObservationInput>(), conflicts = new Set<string>()
  for (const r of observations) {
    const m = r.input.measurement, previous = latest.get(m.sourceId)
    if (!previous || previous.measurement.revision < m.revision) { latest.set(m.sourceId, r.input); conflicts.delete(m.sourceId) }
    else if (previous.measurement.revision === m.revision && encode(previous) !== encode(r.input)) conflicts.add(m.sourceId)
  }
  const results: C03ForecastReview['results'] = [], valid: { observation: C03ObservationInput; result: 'SUPPORT' | 'COUNTER' | 'NEUTRAL' }[] = []
  for (const o of latest.values()) {
    const m = o.measurement, e = execution.find(e => e.input.requestId === o.executionRequestId)?.input
    const reasons: string[] = []
    if (conflicts.has(m.sourceId)) reasons.push('CONFLICTING_OBSERVATION_REVISION')
    if (!e || e.status !== 'FULL') reasons.push(e ? `EXECUTION_${e.status}` : 'NO_EXECUTION_EVIDENCE')
    if (e && (m.occurredAt < e.occurredAt || e.origin !== 'TRAINING_FACT')) reasons.push('EXECUTION_NOT_HOST_FACT_OR_OUTCOME_TOO_EARLY')
    if (o.contextId !== f.input.contextId || m.metric !== f.input.metric || m.unit !== f.input.unit || m.protocol !== f.input.protocol || m.sourceId === f.input.baseline.sourceId) reasons.push('INCOMPARABLE_CONTEXT_PROTOCOL_OR_SOURCE')
    const result = reasons.length ? 'UNTESTABLE' : matches(f.input.support, m.value) ? 'SUPPORT' : matches(f.input.refute, m.value) ? 'COUNTER' : 'NEUTRAL'
    results.push({ sourceRef: `${m.sourceId}@${m.revision}`, result, reasons })
    if (result !== 'UNTESTABLE') valid.push({ observation: o, result })
  }
  const parent = valid.map((_, i) => i)
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  for (let i = 0; i < valid.length; i++) for (let j = i + 1; j < valid.length; j++) {
    const a = valid[i].observation, b = valid[j].observation
    if (a.episodeId === b.episodeId || Math.max(a.periodStart, b.periodStart) < Math.min(a.periodEnd, b.periodEnd)) parent[find(j)] = find(i)
  }
  const groups = new Map<number, Set<string>>()
  valid.forEach((v, i) => { const key = find(i), group = groups.get(key) ?? new Set(); group.add(v.result); groups.set(key, group) })
  let support = 0, counter = 0, mixed = 0
  for (const g of groups.values()) { if (g.has('SUPPORT') && g.has('COUNTER')) mixed++; else if (g.has('SUPPORT')) support++; else if (g.has('COUNTER')) counter++ }
  const state: C03ForecastReview['state'] = !latest.size ? 'WAIT_FOR_DATA' : !valid.length ? 'UNTESTABLE' : mixed || support && counter ? 'MIXED_OBSERVATIONS' : support ? 'OBSERVED_SUPPORT' : counter ? 'OBSERVED_COUNTER' : 'INCONCLUSIVE'
  return { ...shell(state, ['DESCRIPTIVE_ONLY', 'NO_ABILITY_SCORE_OR_AUTOMATIC_PLAN_UPDATE']), adoption: adoption?.kind === 'ADOPTION' ? adoption.adopted : null, executionState: execution.at(-1)?.input.status ?? 'NO_EXECUTION_EVIDENCE', results, nonOverlappingEpisodeGroups: groups.size, supportGroups: support, counterGroups: counter, mixedGroups: mixed }
}
/** Current status never erases prior versions, counter-evidence or withdrawal reasons. */
export function projectCoachFollowups(c: C03FollowupContext, current?: readonly C03QuerySnapshot[]) {
  const read = readCoachFollowupHistory(c)
  const hypotheses = read.records.filter((r): r is C03FollowupRecord & { kind: 'HYPOTHESIS' } => r.kind === 'HYPOTHESIS')
  return { status: read.status, reason: read.reason, hypotheses: hypotheses.map(h => {
    const forecasts = current ? read.records.filter((r): r is C03FollowupRecord & { kind: 'FORECAST' } => r.kind === 'FORECAST' && r.input.hypothesisId === h.input.id && r.input.hypothesisRevision === h.input.revision)
      .map(f => ({ forecastId: f.input.id, revision: f.input.revision, result: reviewCoachForecast(c, f.input.id, f.input.revision, current) })) : []
    const status = withdrawn(read.records, h.input.id) ? 'WITHDRAWN' as const : read.records.some(r => r.kind === 'DEPENDENCY_REVIEW' && r.hypothesisId === h.input.id && r.hypothesisRevision === h.input.revision) || forecasts.some(f => f.result.state === 'STALE_BASIS') ? 'STALE_NEEDS_REVIEW' as const
      : forecasts.some(f => ['OBSERVED_COUNTER', 'MIXED_OBSERVATIONS'].includes(f.result.state)) ? 'WEAKENED' as const : forecasts.some(f => f.result.state === 'OBSERVED_SUPPORT') ? 'SUPPORTED_OBSERVATION' as const : 'PENDING' as const
    return { ...h.input, registeredAt: h.registeredAt, status, forecasts }
  }),
    forecastVersions: read.records.filter(r => r.kind === 'FORECAST').length, planWriteAuthorized: false as const, abilityScoreChange: 0 as const }
}
