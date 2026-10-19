import type { EvolutionEvidence, EvolutionSnapshot } from '../../core/coach-evolution-v4.ts'
import { reviewDecisionEvidence } from '../../core/coach-decision-evidence.ts'
import { summarizeTimedReps } from '../../core/coach-cognition-tools.ts'
import { strictIso } from '../../core/coach-v4-c11-adapter.ts'

/** C03 adaptation over the App's existing R13 proof, not the research vault.
 * Call only with the host's reconciled formal snapshot. This local read-only
 * projection is neither authentication nor a model-dispatch authorization. */
export type C03SegmentBinding = Readonly<{
  occurrenceId: string; evidenceId: string; sourceId: string
  componentId: string; blockId: string; stepId: string; round: number; order: number
  distanceMeters: number; protocol: string; role: 'WORK' | 'WARMUP' | 'UNKNOWN'
}>
export type C03Number = Readonly<{
  handle: string; metric: string; value: number; unit: string
  kind: 'SOURCE' | 'DERIVED'; basisIds: readonly string[]; sourceIds: readonly string[]
}>
export type C03Group = Readonly<{
  id: string; componentId: string; blockId: string; stepId: string; round: number
  role: C03SegmentBinding['role']; protocol: string; distanceMeters: number
  observedCount: number; durationsSeconds: readonly number[]; orderedEvidenceIds: readonly string[]
  meanSeconds: number; lastMinusFirstSeconds: number | null
  basisIds: readonly string[]; sourceIds: readonly string[]; observedOnly: true
}>
export type C03MetricBrief = Readonly<{
  version: 'FK-APP-C03-1'; state: 'READY' | 'PARTIAL' | 'BLOCKED'
  athleteId: string; asOf: string; observedOccurrenceId: string; targetOccurrenceId: string | null
  /** A local dependency receipt only, never a security signature. */
  revisionReceipt: string; numbers: readonly C03Number[]; groups: readonly C03Group[]
  bindings: readonly C03SegmentBinding[]; reasons: readonly string[]; missing: readonly string[]
  r13Status: string; planMutationAuthorized: false; medicalClearance: 'UNKNOWN'
  semanticCorrectnessEvaluated: false; didWrite: false; didCallModel: false
}>
const repeat = /^running:([^:]+):rep:([^:]+):([^:]+):([1-9]\d*):([1-9]\d*):(\d+(?:\.\d+)?)m$/
const actual = (s: EvolutionSnapshot, occurrenceId: string) => s.active.filter(e =>
  e.athleteId === s.athleteId && e.occurrenceId === occurrenceId && e.source === 'TRAINING_FACT' &&
  e.confirmation === 'CONFIRMED' && strictIso(e.eventAt) && strictIso(e.recordedAt) &&
  Date.parse(e.eventAt) <= Date.parse(s.asOf) && Date.parse(e.recordedAt) <= Date.parse(s.asOf))
const sortedReceipt = (rows: readonly EvolutionEvidence[]) => JSON.stringify(rows.map(r =>
  JSON.stringify([r.id, r.sourceId, r.occurrenceId, r.metric, r.value, r.unit, r.context,
    r.eventAt, r.recordedAt, r.supersedes ?? null])).sort())

/** Stable identities come from the formal protocol, never a display name/date.
 * Role remains UNKNOWN unless the host supplies an original-plan role binding. */
export function deriveC03SegmentBindings(snapshot: EvolutionSnapshot, observedOccurrenceId: string): C03SegmentBinding[] {
  return actual(snapshot, observedOccurrenceId).flatMap(e => {
    const m = e.metric === 'SPLIT_SECONDS' && e.unit === 's' ? e.context.match(repeat) : null
    if (!m || !Number.isSafeInteger(Number(m[4])) || !Number.isSafeInteger(Number(m[5])) ||
      !Number.isFinite(Number(m[6])) || Number(m[6]) <= 0) return []
    return [{ occurrenceId: e.occurrenceId, evidenceId: e.id, sourceId: e.sourceId,
      componentId: m[1], blockId: m[2], stepId: m[3], round: Number(m[4]), order: Number(m[5]),
      distanceMeters: Number(m[6]), protocol: e.context, role: 'UNKNOWN' as const }]
  })
}

export function compileC03MetricBrief(snapshot: EvolutionSnapshot, observedOccurrenceId: string,
  targetOccurrenceId: string | null = null, bindings?: readonly C03SegmentBinding[]): C03MetricBrief {
  const rows = strictIso(snapshot.asOf) ? actual(snapshot, observedOccurrenceId) : []
  const base = { version: 'FK-APP-C03-1', athleteId: snapshot.athleteId, asOf: snapshot.asOf,
    observedOccurrenceId, targetOccurrenceId, revisionReceipt: JSON.stringify({ athleteId: snapshot.athleteId,
      asOf: snapshot.asOf, observedOccurrenceId, targetOccurrenceId, rows: sortedReceipt(rows) }),
    planMutationAuthorized: false, medicalClearance: 'UNKNOWN', semanticCorrectnessEvaluated: false,
    didWrite: false, didCallModel: false } as const
  const blocked = (reason: string): C03MetricBrief => ({ ...base, state: 'BLOCKED', numbers: [], groups: [],
    bindings: [], reasons: [reason], missing: [], r13Status: 'BLOCKED' })
  if (!snapshot.athleteId || !observedOccurrenceId || !strictIso(snapshot.asOf)) return blocked('INVALID_HOST_SCOPE')
  if (targetOccurrenceId !== null && (!targetOccurrenceId || targetOccurrenceId === observedOccurrenceId))
    return blocked('OBSERVED_AND_TARGET_OCCURRENCE_MUST_DIFFER')
  if (snapshot.safety !== 'NONE' || snapshot.quarantined.length || snapshot.scopeConflictCount)
    return blocked('SAFETY_OR_EVIDENCE_CONFLICT')
  // A caller cannot resurrect a superseded row by constructing an ad-hoc snapshot.
  if (rows.some(r => snapshot.corrections.some(c => c.replacedId === r.id))) return blocked('SUPERSEDED_ROW_ACTIVE')
  const units: Record<EvolutionEvidence['metric'], string> = { SPLIT_SECONDS: 's', REST_SECONDS: 's',
    GOAL_SECONDS: 's', SLEEP_HOURS: 'h', SESSION_RPE: 'score', PAIN_SCORE: 'score', SUBJECTIVE_RECOVERY: 'score',
    SORENESS: 'score', STRENGTH_REPS: 'reps', STRENGTH_KG: 'kg', STRENGTH_SECONDS: 's', HR_AVG_BPM: 'bpm' }
  if (rows.some(r => r.unit !== units[r.metric] || r.value !== null && (!Number.isFinite(r.value) || r.value < 0)))
    return blocked('SOURCE_VALUE_OR_UNIT_INVALID')
  if (rows.length > 80) return blocked('R13_NUMERIC_PROOF_LIMIT')
  const eligible = rows.filter((r): r is EvolutionEvidence & { value: number } => r.value !== null && Number.isFinite(r.value))
  const r13 = reviewDecisionEvidence(snapshot, [observedOccurrenceId], { selectedOption: 'HOLD',
    numericReasons: eligible.map(r => ({ evidenceId: r.id, value: r.value, unit: r.unit, role: 'SUPPORT' })), hypotheses: [] })
  if (r13.status === 'BLOCKED') return blocked(r13.findings.join('|'))
  const numbers: C03Number[] = eligible.map(r => ({ handle: r.id, metric: r.metric, value: r.value,
    unit: r.unit, kind: 'SOURCE', basisIds: [r.id], sourceIds: [r.sourceId] }))
  for (const p of r13.metrics) {
    const source = rows.filter(r => r.sourceId === p.sourceId && r.metric === 'SPLIT_SECONDS')
    if (source.length !== 1) return blocked('AMBIGUOUS_PACE_SOURCE')
    numbers.push({ handle: `C03:PACE:${source[0].id}`, metric: 'PACE_SECONDS_PER_KM', value: p.paceSecondsPerKm!,
      unit: 's/km', kind: 'DERIVED', basisIds: [source[0].id], sourceIds: [source[0].sourceId] })
  }
  const canonicalBindings = deriveC03SegmentBindings(snapshot, observedOccurrenceId)
  const selectedBindings = bindings === undefined ? canonicalBindings : [...bindings]
  if (selectedBindings.length > 512) return blocked('BINDING_LIMIT')
  const seen = new Set<string>(), grouped = new Map<string, { b: C03SegmentBinding; seconds: number }[]>()
  for (const b of selectedBindings) {
    const c = canonicalBindings.find(c => c.evidenceId === b.evidenceId)
    if (!c || !['WORK', 'WARMUP', 'UNKNOWN'].includes(b.role) ||
      Object.keys(c).some(k => k !== 'role' && c[k as keyof C03SegmentBinding] !== b[k as keyof C03SegmentBinding]))
      return blocked('BINDING_SCOPE_SOURCE_OR_STRUCTURE_MISMATCH')
    if (seen.has(b.evidenceId)) return blocked('EVIDENCE_BOUND_TWICE')
    seen.add(b.evidenceId)
    const source = rows.find(r => r.id === b.evidenceId)!
    if (source.value === null) continue
    // Warm-up and work never share a key. Unknown roles are described as recorded
    // segments, never promoted to formal work or a statement of task completion.
    const key = JSON.stringify([b.occurrenceId, b.componentId, b.blockId, b.stepId, b.round, b.distanceMeters, b.role])
    grouped.set(key, [...grouped.get(key) ?? [], { b, seconds: source.value }])
  }
  const groups: C03Group[] = []
  for (const [key, entries] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    if (new Set(entries.map(x => x.b.order)).size !== entries.length) return blocked('AMBIGUOUS_SEGMENT_ORDER')
    entries.sort((a, b) => a.b.order - b.b.order)
    const first = entries[0].b
    const reps = entries.map(x => ({ distanceMeters: x.b.distanceMeters, actualSeconds: x.seconds,
      plannedSeconds: null, sourceIds: [x.b.sourceId], position: x.b.protocol }))
    const summary = summarizeTimedReps(reps)
    const edge = reps.length >= 2 ? summarizeTimedReps([reps[0], reps.at(-1)!]) : null
    if (!summary) return blocked('INVALID_SEGMENT_VALUE')
    const id = `C03:GROUP:${key}`, basisIds = entries.map(x => x.b.evidenceId), sourceIds = entries.map(x => x.b.sourceId)
    groups.push({ id, componentId: first.componentId, blockId: first.blockId, stepId: first.stepId,
      round: first.round, role: first.role, protocol: key, distanceMeters: first.distanceMeters,
      observedCount: entries.length, durationsSeconds: entries.map(x => x.seconds), orderedEvidenceIds: basisIds,
      meanSeconds: summary.meanSeconds, lastMinusFirstSeconds: edge?.timeIncreaseSeconds ?? null,
      basisIds, sourceIds, observedOnly: true })
    numbers.push({ handle: `${id}:MEAN`, metric: 'OBSERVED_SEGMENT_MEAN', value: summary.meanSeconds, unit: 's',
      kind: 'DERIVED', basisIds, sourceIds })
    if (edge?.timeIncreaseSeconds !== null && edge?.timeIncreaseSeconds !== undefined)
      numbers.push({ handle: `${id}:LAST_FIRST`, metric: 'LAST_MINUS_FIRST_SECONDS', value: edge.timeIncreaseSeconds,
        unit: 's', kind: 'DERIVED', basisIds: [basisIds[0], basisIds.at(-1)!], sourceIds: [sourceIds[0], sourceIds.at(-1)!] })
  }
  groups.sort((a, b) => a.componentId.localeCompare(b.componentId) || a.blockId.localeCompare(b.blockId) ||
    a.stepId.localeCompare(b.stepId) || a.round - b.round || a.distanceMeters - b.distanceMeters || a.role.localeCompare(b.role))
  if (new Set(numbers.map(n => n.handle)).size !== numbers.length) return blocked('NUMBER_HANDLE_COLLISION')
  const missing = [...new Set([...rows.filter(r => r.value === null).map(r => `${r.metric}:${r.id}:UNKNOWN`),
    ...rows.filter(r => r.metric === 'SPLIT_SECONDS' && !canonicalBindings.some(b => b.evidenceId === r.id)).map(r => `SEGMENT_BINDING:${r.id}:UNKNOWN`),
    ...canonicalBindings.filter(b => !selectedBindings.some(s => s.evidenceId === b.evidenceId)).map(b => `UNBOUND_SEGMENT:${b.evidenceId}:UNKNOWN`),
    ...(selectedBindings.some(b => b.role === 'UNKNOWN') ? ['WORK_ROLE_UNKNOWN'] : []),
    ...(!eligible.length ? ['NO_CONFIRMED_NUMERIC_FACT'] : [])])]
  return { ...base, state: missing.length || r13.status !== 'READY_FOR_QUALIFIED_COACH_REVIEW' ? 'PARTIAL' : 'READY',
    numbers, groups, bindings: selectedBindings.map(b => ({ ...b })), missing,
    r13Status: r13.status, reasons: ['ARITHMETIC_ONLY_NOT_PHYSIOLOGICAL_DIAGNOSIS', 'NOT_FULL_SESSION_COMPLETION'] }
}

const number = (n: number) => String(Number(n.toFixed(3)))
export function describeC03Group(group: C03Group): string {
  const delta = group.lastMinusFirstSeconds
  const change = delta === null ? '只有一条有效记录，首末变化 UNKNOWN' : delta === 0 ? '首末用时相同' :
    `末段比首段${delta > 0 ? '慢' : '快'}${number(Math.abs(delta))}秒`
  const role = group.role === 'WORK' ? '工作段' : group.role === 'WARMUP' ? '热身段' : '已记录段（工作角色待核对）'
  return `第${group.round}轮${role}${group.observedCount}个${number(group.distanceMeters)}米，` +
    `用时${group.durationsSeconds.map(number).join(' / ')}秒，均值${number(group.meanSeconds)}秒；${change}。` +
    '仅描述这些记录，不能据此宣称整课完成或确定变化原因。'
}
