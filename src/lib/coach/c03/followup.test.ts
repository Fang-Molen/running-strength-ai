import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend, type MemoryStore } from '../../core/storage.ts'
import { appendJournal } from '../../core/storage-journal.ts'
import {
  C03_FOLLOWUP_PREFIX, registerCoachHypothesis, registerCoachForecast, recordCoachAdoption,
  recordCoachExecution, recordCoachObservation, withdrawCoachHypothesis, readCoachFollowupHistory,
  compareCoachFollowupDependencies, recheckCoachForecastDependencies, reviewCoachForecast, projectCoachFollowups,
  type C03FollowupContext, type C03HypothesisInput, type C03ForecastInput, type C03QuerySnapshot,
  type C03ExecutionInput, type C03ObservationInput,
} from './followup.ts'

const START = Date.parse('2026-10-19T10:00:00.000Z')
const ctx = (patch: Partial<C03FollowupContext> = {}): C03FollowupContext => ({ actorId: 'account-a', athleteId: 'athlete-a', asOf: Date.now(), ...patch })
const basis = (patch: Partial<C03QuerySnapshot> = {}): C03QuerySnapshot => ({ scopeKey: 'TRAINING:before-registration:splitSeconds', athleteId: 'athlete-a', asOf: START,
  state: 'COMPLETE', dataKey: 'observed:baseline@1=80s', provenanceKey: 'source:baseline@1', completeRead: true, ...patch })
const ref = (sourceId = 'fact-baseline', revision = '1') => ({ sourceId, revision, fieldPaths: ['value', 'protocol'] })
const hypothesis = (patch: Partial<C03HypothesisInput> = {}): C03HypothesisInput => ({ id: 'h1', revision: 1, reviewId: 'review1', observedOccurrenceId: 'previous-occurrence',
  explanation: '后段变化可能涉及前程节奏，也可能受到环境影响；待验证。', supportEvidence: [ref()], counterEvidence: [], missing: ['下一次同协议实际数据'],
  nextObservation: '沿用已有批准课程，记录分段、实际休息与次日感受；不另加负荷。', basis: [basis()], ...patch })
const forecast = (patch: Partial<C03ForecastInput> = {}): C03ForecastInput => ({ id: 'forecast1', revision: 1, hypothesisId: 'h1', hypothesisRevision: 1,
  proposalId: 'approved-observation-proposal', proposalRevision: 1, observationStart: START + 1000, observationEnd: START + 10000,
  metric: 'SPLIT_SECONDS', unit: 's', protocol: '200m/same-rest/same-device', contextId: 'approved-context',
  baseline: { athleteId: 'athlete-a', sourceId: 'fact-baseline', revision: 1, value: 80, metric: 'SPLIT_SECONDS', unit: 's', protocol: '200m/same-rest/same-device', occurredAt: START - 1000, knownAt: START - 500, origin: 'DEVICE' },
  support: { op: 'LT', threshold: 80 }, refute: { op: 'GT', threshold: 80 },
  conditionProvenance: { kind: 'PRE_REGISTERED_OBSERVATION', sourceId: 'athlete-observation-criteria', version: 'v1', note: '合成数据的预注册观察条件，不是生理阈值或训练剂量。' },
  confirmed: true, basis: [basis()], ...patch })
const execution = (patch: Partial<C03ExecutionInput> = {}): C03ExecutionInput => ({ requestId: 'exec1', forecastId: 'forecast1', forecastRevision: 1,
  proposalId: 'approved-observation-proposal', proposalRevision: 1, occurrenceId: 'actual-next-occurrence', status: 'FULL', occurredAt: START + 2000,
  actualEvidence: [ref('fact-execution')], origin: 'TRAINING_FACT', ...patch })
const observation = (patch: Partial<C03ObservationInput> = {}): C03ObservationInput => ({ requestId: 'obs1', forecastId: 'forecast1', forecastRevision: 1,
  measurement: { athleteId: 'athlete-a', sourceId: 'fact-outcome', revision: 1, value: 79, metric: 'SPLIT_SECONDS', unit: 's', protocol: '200m/same-rest/same-device', occurredAt: START + 3000, knownAt: Date.now(), origin: 'DEVICE' },
  executionRequestId: 'exec1', contextId: 'approved-context', episodeId: 'episode1', periodStart: START + 2000, periodEnd: START + 4000, otherChanges: ['天气较热，未确认影响大小'], ...patch })
function stored(fn: (box: MemoryStore & { data: Map<string, string> }) => void) {
  const data = new Map<string, string>(), box = { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, keys: () => [...data.keys()] }
  mock.timers.enable({ apis: ['Date'], now: START }); setStoreBackend(box)
  try { fn(box) } finally { setStoreBackend(null); mock.timers.reset() }
}
function prepare() { assert.equal(registerCoachHypothesis(ctx(), hypothesis()).ok, true); assert.equal(registerCoachForecast(ctx(), forecast()).ok, true) }
function fullOutcome(value = 79) {
  mock.timers.tick(3000)
  assert.equal(recordCoachExecution(ctx(), execution()).ok, true)
  const o = observation(); o.measurement.value = value
  assert.equal(recordCoachObservation(ctx(), o).ok, true)
}
const review = () => reviewCoachForecast(ctx(), 'forecast1', 1, [basis({ asOf: Date.now() })])

test('hypothesis and forecast use existing durable journal and survive backend re-instantiation', () => stored(box => {
  box.setItem('fr255-existing-training', 'unchanged'); prepare()
  const before = [...box.data]
  setStoreBackend({ getItem: box.getItem, setItem: box.setItem, keys: box.keys })
  assert.equal(readCoachFollowupHistory(ctx()).records.length, 2)
  assert.equal(projectCoachFollowups(ctx()).hypotheses[0].status, 'PENDING')
  assert.deepEqual([...box.data], before); assert.equal(box.getItem('fr255-existing-training'), 'unchanged')
}))
test('same logical hypothesis/forecast registration is idempotent and conflicting bodies cannot overwrite', () => stored(() => {
  prepare(); assert.deepEqual(registerCoachHypothesis(ctx(), hypothesis()), { ok: true, id: 'hypothesis:h1@1', duplicate: true })
  assert.deepEqual(registerCoachForecast(ctx(), forecast()), { ok: true, id: 'forecast:forecast1@1', duplicate: true })
  assert.deepEqual(registerCoachHypothesis(ctx(), hypothesis({ explanation: '偷改旧判断' })), { ok: false, reason: 'REQUEST_ID_CONFLICT' })
  assert.equal(readCoachFollowupHistory(ctx()).records.length, 2)
}))
test('append-only versions retain original explanation, supporting and contrary sources', () => stored(() => {
  prepare(); mock.timers.tick(100)
  assert.equal(registerCoachHypothesis(ctx(), hypothesis({ revision: 2, explanation: '加入反证后保留不确定解释', counterEvidence: [ref('contrary')], missing: ['环境核对'] })).ok, true)
  const rows = projectCoachFollowups(ctx()).hypotheses
  assert.equal(rows.length, 2); assert.equal(rows[0].counterEvidence.length, 0); assert.equal(rows[1].counterEvidence[0].sourceId, 'contrary')
  assert.equal(registerCoachHypothesis(ctx(), hypothesis({ revision: 4 })).ok, false)
}))
test('unknown athlete, other actor and other athlete cannot read or claim history', () => stored(box => {
  box.setItem(C03_FOLLOWUP_PREFIX + 'unowned', 'legacy-kept'); prepare()
  assert.equal(readCoachFollowupHistory(ctx({ actorId: '' })).status, 'UNAVAILABLE')
  assert.equal(readCoachFollowupHistory(ctx({ actorId: 'account-b' })).records.length, 0)
  assert.equal(readCoachFollowupHistory(ctx({ athleteId: 'athlete-b' })).records.length, 0)
  assert.equal(box.getItem(C03_FOLLOWUP_PREFIX + 'unowned'), 'legacy-kept')
}))
test('unavailable and malformed stores remain explicit errors rather than empty success', () => stored(box => {
  prepare(); setStoreBackend({ getItem: () => { throw Error('read') }, setItem: box.setItem, keys: box.keys })
  assert.equal(readCoachFollowupHistory(ctx()).status, 'UNAVAILABLE'); setStoreBackend(box)
  const key = [...box.data.keys()].find(k => k.startsWith(C03_FOLLOWUP_PREFIX))!
  box.data.set(key, '{broken'); assert.equal(readCoachFollowupHistory(ctx()).status, 'UNAVAILABLE')
}))
test('persistence quota failure does not remove facts or report successful registration', () => stored(box => {
  box.setItem('training', 'retained'); setStoreBackend({ getItem: box.getItem, setItem: () => { throw Error('quota') }, keys: box.keys })
  assert.equal(registerCoachHypothesis(ctx(), hypothesis()).ok, false); assert.equal(box.getItem('training'), 'retained')
}))
test('forecasts cannot be post-hoc, future baseline or lack provenance/confirmation', () => stored(() => {
  assert.equal(registerCoachHypothesis(ctx(), hypothesis()).ok, true)
  for (const f of [forecast({ observationStart: START }), forecast({ baseline: { ...forecast().baseline, knownAt: START + 1 } }), forecast({ conditionProvenance: { ...forecast().conditionProvenance, sourceId: '' } }), forecast({ confirmed: false as true })])
    assert.equal(registerCoachForecast(ctx(), f).ok, false)
  assert.equal(readCoachFollowupHistory(ctx()).records.length, 1)
}))
test('overlapping or non-finite support and refute criteria are rejected', () => stored(() => {
  assert.equal(registerCoachHypothesis(ctx(), hypothesis()).ok, true)
  assert.equal(registerCoachForecast(ctx(), forecast({ support: { op: 'LE', threshold: 80 }, refute: { op: 'GE', threshold: 80 } })).ok, false)
  assert.equal(registerCoachForecast(ctx(), forecast({ support: { op: 'LT', threshold: Infinity } })).ok, false)
}))
test('incomplete or future receipt blocks hypothesis registration; missing measurements are never filled with zero', () => stored(() => {
  assert.equal(registerCoachHypothesis(ctx(), hypothesis({ basis: [basis({ state: 'PARTIAL', completeRead: false })] })).ok, false)
  assert.equal(registerCoachHypothesis(ctx(), hypothesis({ basis: [basis({ asOf: START + 1 })] })).ok, false)
  assert.equal(registerCoachHypothesis(ctx(), hypothesis()).ok, true)
  assert.equal(registerCoachForecast(ctx(), forecast({ baseline: { ...forecast().baseline, value: null as unknown as number } })).ok, false)
}))
test('adoption is not execution or observation and does not change a plan', () => stored(box => {
  box.setItem('official-plan', 'v4-original'); prepare()
  assert.equal(recordCoachAdoption(ctx(), { requestId: 'adopt1', forecastId: 'forecast1', forecastRevision: 1, adopted: true, confirmed: true }).ok, true)
  const r = review(); assert.equal(r.adoption, true); assert.equal(r.executionState, 'NO_EXECUTION_EVIDENCE'); assert.equal(r.state, 'WAIT_FOR_DATA')
  assert.equal(r.planWriteAuthorized, false); assert.equal(box.getItem('official-plan'), 'v4-original')
}))
test('explicit refusal is recorded independently and cannot create execution', () => stored(() => {
  prepare(); assert.equal(recordCoachAdoption(ctx(), { requestId: 'refuse1', forecastId: 'forecast1', forecastRevision: 1, adopted: false, confirmed: true }).ok, true)
  assert.equal(review().adoption, false); assert.equal(review().executionState, 'NO_EXECUTION_EVIDENCE')
}))
test('full host execution plus protocol-matched outcome produces descriptive support, never causality', () => stored(() => {
  prepare(); fullOutcome()
  const r = review(); assert.equal(r.state, 'OBSERVED_SUPPORT'); assert.equal(r.supportGroups, 1); assert.equal(r.independenceEstablished, false); assert.equal(r.causalConclusion, 'NOT_ESTABLISHED')
  assert.equal(projectCoachFollowups(ctx(), [basis({ asOf: Date.now() })]).hypotheses[0].status, 'SUPPORTED_OBSERVATION')
  assert.equal(projectCoachFollowups(ctx()).abilityScoreChange, 0)
}))
test('contrary evidence weakens the hypothesis while old hypothesis and support conditions remain', () => stored(() => {
  prepare(); fullOutcome(82)
  assert.equal(review().state, 'OBSERVED_COUNTER')
  const p = projectCoachFollowups(ctx(), [basis({ asOf: Date.now() })]); assert.equal(p.hypotheses[0].status, 'WEAKENED'); assert.equal(p.hypotheses[0].supportEvidence[0].sourceId, 'fact-baseline')
  assert.equal(p.planWriteAuthorized, false)
}))
test('adopted proposal with observation but no execution remains untestable', () => stored(() => {
  prepare(); mock.timers.tick(3000)
  assert.equal(recordCoachObservation(ctx(), observation({ executionRequestId: null })).ok, true)
  assert.equal(review().state, 'UNTESTABLE'); assert.equal(review().results[0].result, 'UNTESTABLE')
}))
for (const status of ['PARTIAL', 'NONE', 'UNKNOWN'] as const) test('execution '+status+' is retained and cannot pass as a full experimental exposure', () => stored(() => {
  prepare(); mock.timers.tick(3000); assert.equal(recordCoachExecution(ctx(), execution({ status })).ok, true)
  assert.equal(recordCoachObservation(ctx(), observation()).ok, true)
  assert.equal(review().executionState, status); assert.equal(review().state, 'UNTESTABLE')
}))
test('self-report execution stays visible without becoming host-verified execution', () => stored(() => {
  prepare(); mock.timers.tick(3000); assert.equal(recordCoachExecution(ctx(), execution({ origin: 'USER_REPORTED_EXECUTION' })).ok, true)
  assert.equal(recordCoachObservation(ctx(), observation()).ok, true); assert.equal(review().state, 'UNTESTABLE')
}))
test('execution requires actual source, correct proposal revision and current occurrence, never a planned source', () => stored(() => {
  prepare(); mock.timers.tick(3000)
  for (const e of [execution({ actualEvidence: [] }), execution({ proposalRevision: 2 }), execution({ occurrenceId: '' }), execution({ origin: 'PLAN' as 'TRAINING_FACT' })]) assert.equal(recordCoachExecution(ctx(), e).ok, false)
}))
test('different protocol and measurement unit remain untestable and are not silently merged', () => stored(() => {
  prepare(); mock.timers.tick(3000); assert.equal(recordCoachExecution(ctx(), execution()).ok, true)
  const o = observation(); o.measurement.protocol = 'different-device'; o.measurement.unit = 'min'
  assert.equal(recordCoachObservation(ctx(), o).ok, true); assert.equal(review().state, 'UNTESTABLE'); assert.match(review().results[0].reasons.join(), /INCOMPARABLE/)
}))
test('observation owner/window/known-time and execution references are checked', () => stored(() => {
  prepare(); mock.timers.tick(3000)
  const wrongOwner = observation({ executionRequestId: null }); wrongOwner.measurement.athleteId = 'athlete-b'
  const future = observation({ executionRequestId: null }); future.measurement.knownAt = Date.now() + 1
  const out = observation({ executionRequestId: null }); out.measurement.occurredAt = START + 10000
  for (const o of [wrongOwner, future, out, observation({ executionRequestId: 'nonexistent' })]) assert.equal(recordCoachObservation(ctx(), o).ok, false)
}))
test('late correction changes current review but cannot rewrite what was known before its commit', () => stored(() => {
  prepare(); fullOutcome(79); const oldCutoff = Date.now(); assert.equal(review().state, 'OBSERVED_SUPPORT')
  mock.timers.tick(2000); const correction = observation({ requestId: 'obs2' }); correction.measurement.revision = 2; correction.measurement.value = 84
  assert.equal(recordCoachObservation(ctx(), correction).ok, true); assert.equal(review().state, 'OBSERVED_COUNTER')
  assert.equal(reviewCoachForecast(ctx({ asOf: oldCutoff }), 'forecast1', 1, [basis({ asOf: oldCutoff })]).state, 'OBSERVED_SUPPORT')
  assert.equal(readCoachFollowupHistory(ctx()).records.filter(r => r.kind === 'OBSERVATION').length, 2)
}))
test('a same-revision contradictory observation is quarantined rather than cherry-picked', () => stored(() => {
  prepare(); fullOutcome(79); const contradictory = observation({ requestId: 'obs-conflict' }); contradictory.measurement.value = 82
  assert.equal(recordCoachObservation(ctx(), contradictory).ok, true); assert.equal(review().state, 'UNTESTABLE')
  assert.match(review().results[0].reasons.join(), /CONFLICTING_OBSERVATION_REVISION/)
}))
test('overlapping windows and shared episode are grouped, never counted as independent experiments', () => stored(() => {
  prepare(); fullOutcome(79); mock.timers.tick(1000)
  const o = observation({ requestId: 'obs2', episodeId: 'another-episode', periodStart: START + 3000, periodEnd: START + 5000 }); o.measurement.sourceId = 'fact-outcome-2'; o.measurement.value = 81; o.measurement.occurredAt = START + 4000
  assert.equal(recordCoachObservation(ctx(), o).ok, true)
  const r = review(); assert.equal(r.nonOverlappingEpisodeGroups, 1); assert.equal(r.mixedGroups, 1); assert.equal(r.state, 'MIXED_OBSERVATIONS'); assert.equal(r.independenceEstablished, false)
}))
test('disjoint windows remain descriptive groups and do not establish statistical independence', () => stored(() => {
  prepare(); fullOutcome(79); mock.timers.tick(3000)
  const o = observation({ requestId: 'obs2', episodeId: 'episode2', periodStart: START + 5000, periodEnd: START + 7000 }); o.measurement.sourceId = 'fact-outcome-2'; o.measurement.occurredAt = START + 6000
  assert.equal(recordCoachObservation(ctx(), o).ok, true); assert.equal(review().nonOverlappingEpisodeGroups, 2); assert.equal(review().independenceEstablished, false)
}))
test('only related scope content changes invalidate basis; new unrelated source does not', () => stored(() => {
  prepare(); const unrelated = basis({ scopeKey: 'RECOVERY:unrelated', dataKey: 'new sleep fact' })
  assert.equal(compareCoachFollowupDependencies([basis()], [basis(), unrelated], Date.now()).state, 'UNCHANGED')
  assert.deepEqual(recheckCoachForecastDependencies(ctx(), [basis(), unrelated]), { ok: true, reviewed: [], unchanged: ['h1'] })
  assert.equal(readCoachFollowupHistory(ctx()).records.length, 2)
}))
test('late entry into a previously empty complete query requests recheck without rewriting history', () => stored(() => {
  const empty = basis({ scopeKey: 'RECOVERY:empty-range', dataKey: '[]', provenanceKey: '[]' })
  assert.equal(registerCoachHypothesis(ctx(), hypothesis({ basis: [empty] })).ok, true); const before = Date.now()
  mock.timers.tick(1000); const fresh = { ...empty, asOf: Date.now(), dataKey: '[late-recovery]' }
  assert.deepEqual(recheckCoachForecastDependencies(ctx(), [fresh]).reviewed, ['h1'])
  assert.equal(projectCoachFollowups(ctx()).hypotheses[0].status, 'STALE_NEEDS_REVIEW')
  assert.equal(projectCoachFollowups(ctx({ asOf: before })).hypotheses[0].status, 'PENDING')
  assert.equal(recheckCoachForecastDependencies(ctx(), [fresh]).ok, true)
  assert.equal(readCoachFollowupHistory(ctx()).records.filter(r => r.kind === 'DEPENDENCY_REVIEW').length, 1)
}))
test('distinct related corrections retain separate recheck receipts even for the same changed scope', () => stored(() => {
  prepare(); mock.timers.tick(1000); assert.equal(recheckCoachForecastDependencies(ctx(), [basis({ asOf: Date.now(), dataKey: 'correction-2' })]).ok, true)
  mock.timers.tick(1000); assert.equal(recheckCoachForecastDependencies(ctx(), [basis({ asOf: Date.now(), dataKey: 'correction-3' })]).ok, true)
  assert.equal(readCoachFollowupHistory(ctx()).records.filter(r => r.kind === 'DEPENDENCY_REVIEW').length, 2)
}))
test('provenance-only change does not weaken or withdraw a hypothesis', () => stored(() => {
  prepare(); const changed = basis({ provenanceKey: 'new-source-revision-same-value' })
  assert.equal(compareCoachFollowupDependencies([basis()], [changed], Date.now()).state, 'PROVENANCE_ONLY')
  assert.equal(recheckCoachForecastDependencies(ctx(), [changed]).reviewed.length, 0); assert.equal(projectCoachFollowups(ctx()).hypotheses[0].status, 'PENDING')
}))
test('missing, stale, denied or future dependencies block review instead of assuming complete empty data', () => stored(() => {
  prepare()
  for (const snapshots of [[], [basis({ state: 'DENIED', completeRead: false })], [basis({ state: 'STALE', completeRead: false })], [basis({ asOf: START + 1 })]]) {
    assert.equal(compareCoachFollowupDependencies([basis()], snapshots, Date.now()).state, 'BLOCKED')
    assert.equal(reviewCoachForecast(ctx(), 'forecast1', 1, snapshots).state, 'STALE_BASIS')
  }
}))
test('explicit withdrawal persists, cannot reactivate and does not delete measurements or the original hypothesis', () => stored(() => {
  prepare(); fullOutcome()
  assert.equal(withdrawCoachHypothesis(ctx(), { requestId: 'withdraw1', hypothesisId: 'h1', reason: '新反证使原解释不再成立，保留历史。', confirmed: true }).ok, true)
  assert.equal(review().state, 'WITHDRAWN'); assert.equal(projectCoachFollowups(ctx()).hypotheses[0].status, 'WITHDRAWN')
  assert.equal(registerCoachHypothesis(ctx(), hypothesis({ revision: 2 })).ok, false)
  assert.equal(readCoachFollowupHistory(ctx()).records.filter(r => r.kind === 'OBSERVATION').length, 1)
}))
test('logical record collision in an append-only journal is exposed as conflict', () => stored(() => {
  prepare(); const record = readCoachFollowupHistory(ctx()).records[0]
  appendJournal(C03_FOLLOWUP_PREFIX + 'account-a:athlete-a:', record.id, { ...record, knownAt: Date.now(), input: hypothesis({ explanation: 'conflicting body' }) })
  assert.equal(readCoachFollowupHistory(ctx()).status, 'CONFLICT')
}))
test('read-only review, historical projection and dependency comparison never call network', () => stored(() => {
  prepare(); const original = globalThis.fetch; let attempts = 0
  globalThis.fetch = async () => { attempts++; throw Error('network prohibited') }
  try { review(); projectCoachFollowups(ctx()); compareCoachFollowupDependencies([basis()], [basis()], Date.now()); assert.equal(attempts, 0) }
  finally { globalThis.fetch = original }
}))
test('counter-conditions, alternative explanations and source-qualified observation wording survive revisions', () => stored(() => {
  const input = hypothesis({ supportingObservations: ['同协议实际分段来源 fact-baseline，不能证明因果。'], counterConditions: ['如果前程节奏相同且环境一致而差异消失，则削弱解释。'], alternativeExplanations: ['计时条件可能不同，需要先核对。'] })
  assert.equal(registerCoachHypothesis(ctx(), input).ok, true)
  const saved = projectCoachFollowups(ctx()).hypotheses[0]
  assert.deepEqual(saved.counterConditions, input.counterConditions); assert.deepEqual(saved.alternativeExplanations, input.alternativeExplanations)
  assert.deepEqual(saved.supportingObservations, input.supportingObservations)
}))
test('a backdated timestamp cannot turn a physically late journal write into a pre-registered forecast', () => stored(() => {
  prepare(); const original = readCoachFollowupHistory(ctx()).records.find(r => r.kind === 'FORECAST')!
  mock.timers.tick(2000)
  appendJournal(C03_FOLLOWUP_PREFIX + 'account-a:athlete-a:', 'forecast:counterfeit@1', { ...original, id: 'forecast:counterfeit@1', input: { ...forecast(), id: 'counterfeit' }, registeredAt: START, knownAt: START })
  assert.equal(readCoachFollowupHistory(ctx()).status, 'CONFLICT')
  assert.equal(review().state, 'UNAVAILABLE')
}))
