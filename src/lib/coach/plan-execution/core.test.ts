import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalPlanExecutor, effectivePlanDate, emptyPlanExecution, planTargetKey, type PlanExecutionDocument, type PlanExecutionRepository, type PlanHostContext, type ExecutionResult, type PlanProposal, type PlanExecutionReceipt } from './core.ts'
import { createIndexedDbPlanExecutionRepository, validatePlanExecutionDocument } from './store.ts'

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
/** Test fixture, not the App storage or authorization implementation. */
class FixtureRepository implements PlanExecutionRepository {
  docs = new Map<string, PlanExecutionDocument>(); queue: Promise<unknown> = Promise.resolve()
  failWrite = false; failRead = false; corruptRead = false
  async read(id: string) { if (this.failRead) throw new Error('read failure'); const doc = copy(this.docs.get(id) ?? emptyPlanExecution(id)); if (this.corruptRead) doc.receipts = {}; return doc }
  transact<T>(id: string, work: (draft: PlanExecutionDocument) => T): Promise<T> {
    const run = this.queue.then(() => {
      const draft = copy(this.docs.get(id) ?? emptyPlanExecution(id)), result = work(draft)
      if (this.failWrite) throw new Error('simulated transaction abort')
      this.docs.set(id, draft); return result
    })
    this.queue = run.catch(() => {}); return run
  }
}
const baseHost = (): PlanHostContext => ({
  actor: { subjectId: 'local-profile-a', athleteId: 'athlete-a', deviceId: 'device-a', profileVersion: 'p1', scope: 'LOCAL_DEVICE_ONLY' },
  authorization: 'LOCAL_DEVICE_OWNER', persistenceBoundary: 'COORDINATED_LOCAL',
  calendarVersion: 'calendar-v1', factsVersion: 'facts-v1', safetyVersion: 'safety-v1',
  calendarCoverage: 'COMPLETE', readState: 'AVAILABLE', safety: 'ALLOW_DATE_MOVE', today: '2026-10-19',
  targets: [
    { scheduleId: 'v4:2026-10-19', componentId: 'running', athleteId: 'athlete-a', originalDate: '2026-10-19', sourceVersion: 'v4-original-immutable', state: 'COMPLETED', identityResolved: true },
    { scheduleId: 'v4:2026-10-19', componentId: 'strength', athleteId: 'athlete-a', originalDate: '2026-10-19', sourceVersion: 'v4-original-immutable', state: 'NOT_STARTED', identityResolved: true },
  ],
})
function fixture() {
  const repository = new FixtureRepository(); let host = baseHost(), clock = new Date('2026-10-19T10:00:00Z')
  // Explicit test coordinator: serialized fixture repo. Does not certify legacy App writers.
  const lock = async <T>(work: () => T | Promise<T>): Promise<T> => work()
  const executor = createLocalPlanExecutor({ repository, readHostContext: () => copy(host), now: () => new Date(clock), lock })
  return { repository, executor, host: () => host, setHost: (value: PlanHostContext) => { host = value }, advance: (ms: number) => { clock = new Date(clock.getTime() + ms) }, lock }
}
function value<T>(result: ExecutionResult<T>): T { if (!result.ok) assert.fail(`${result.code}: ${result.message}`); return result.value }
const moveInput = { scheduleId: 'v4:2026-10-19', componentId: 'strength', toDate: '2026-10-20' }
const confirm = (proposal: PlanProposal) => ({ proposalId: proposal.id, diffHash: proposal.diffHash, confirmation: 'CONFIRM_THIS_CHANGE' as const })
const undo = (receipt: PlanExecutionReceipt) => ({ receiptId: receipt.id, confirmation: 'UNDO_THIS_CHANGE' as const })

test('preview stores exact diff without moving or starting either component', async () => {
  const f = fixture(), before = copy(f.host()); const p = value(await f.executor.previewMove(moveInput))
  assert.deepEqual(p.move, { ...moveInput, fromDate: '2026-10-19', originalDate: '2026-10-19' })
  assert.match(p.diffHash, /^[a-f0-9]{64}$/); assert.equal(p.canApplyAutomatically, false)
  const doc = value(await f.executor.read()); assert.equal(doc.revision, 0); assert.deepEqual(doc.overlays, {}); assert.deepEqual(doc.receipts, {}); assert.deepEqual(f.host(), before)
})
test('uncoordinated App may preview but cannot announce a saved change', async () => {
  const f = fixture(); f.host().persistenceBoundary = 'UNCOORDINATED'
  const p = value(await f.executor.previewMove(moveInput)); assert.equal(p.executionEligibility, 'BLOCKED_UNCOORDINATED')
  const result = await f.executor.confirm(confirm(p)); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, 'BLOCKED_UNCOORDINATED')
  assert.deepEqual(value(await f.executor.read()).receipts, {})
})
test('synthetic coordinated host commits both dates/overlay/audit once and rereads receipt', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)), receipt = value(await f.executor.confirm(confirm(p)))
  assert.equal(receipt.persistence, 'LOCAL_ONLY'); assert.equal(receipt.cloudSynchronized, false)
  const doc = value(await f.executor.read()); assert.equal(doc.revision, 1); assert.equal(doc.dayVersions['2026-10-19'], 1); assert.equal(doc.dayVersions['2026-10-20'], 1)
  assert.equal(effectivePlanDate(doc, moveInput.scheduleId, 'strength', '2026-10-19'), '2026-10-20')
  assert.equal(effectivePlanDate(doc, moveInput.scheduleId, 'running', '2026-10-19'), '2026-10-19')
  assert.equal(f.host().targets[0]?.state, 'COMPLETED'); assert.equal(f.host().targets[1]?.state, 'NOT_STARTED')
})
test('double-click confirmation returns same receipt and never writes another revision', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput))
  const results = await Promise.all([f.executor.confirm(confirm(p)), f.executor.confirm(confirm(p))])
  assert.equal(value(results[0]!).id, value(results[1]!).id); assert.equal(value(await f.executor.read()).revision, 1)
})
test('two competing proposals cannot overwrite each other under repository CAS', async () => {
  const f = fixture(), a = value(await f.executor.previewMove(moveInput)), b = value(await f.executor.previewMove({ ...moveInput, toDate: '2026-10-21' }))
  const results = await Promise.all([f.executor.confirm(confirm(a)), f.executor.confirm(confirm(b))]); assert.equal(results.filter(x => x.ok).length, 1)
  assert.equal(value(await f.executor.read()).revision, 1)
})
test('new executor restores persisted proposal and confirmed schedule view', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)); value(await f.executor.confirm(confirm(p)))
  const refreshed = createLocalPlanExecutor({ repository: f.repository, readHostContext: f.host, lock: f.lock })
  assert.equal(effectivePlanDate(value(await refreshed.read()), moveInput.scheduleId, 'strength', '2026-10-19'), '2026-10-20')
})
test('explicit undo appends a receipt without altering old receipt or original V4', async () => {
  const f = fixture(), original = copy(f.host()), p = value(await f.executor.previewMove(moveInput)), receipt = value(await f.executor.confirm(confirm(p)))
  const firstReceipt = JSON.stringify(value(await f.executor.read()).receipts[receipt.id]), reversed = value(await f.executor.undo(undo(receipt)))
  const doc = value(await f.executor.read()); assert.equal(reversed.kind, 'UNDO'); assert.equal(reversed.undoOf, receipt.id); assert.equal(doc.revision, 2)
  assert.equal(JSON.stringify(doc.receipts[receipt.id]), firstReceipt); assert.equal(Object.keys(doc.receipts).length, 2)
  assert.equal(effectivePlanDate(doc, moveInput.scheduleId, 'strength', '2026-10-19'), '2026-10-19'); assert.deepEqual(f.host(), original)
})
test('undo double-click is idempotent', async () => {
  const f = fixture(), receipt = value(await f.executor.confirm(confirm(value(await f.executor.previewMove(moveInput)))))
  const a = value(await f.executor.undo(undo(receipt))), b = value(await f.executor.undo(undo(receipt)))
  assert.equal(a.id, b.id); assert.equal(value(await f.executor.read()).revision, 2)
})
for (const field of ['calendarVersion', 'factsVersion', 'safetyVersion'] as const) test(`changed ${field} invalidates confirmation`, async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)); f.host()[field] = 'new-version'
  const result = await f.executor.confirm(confirm(p)); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, 'STALE_CONTEXT')
  assert.equal(value(await f.executor.read()).revision, 0)
})
test('started after preview cannot move', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)); f.host().targets[1]!.state = 'STARTED'
  assert.equal((await f.executor.confirm(confirm(p))).ok, false)
})
test('completed running sibling does not move and is not copied into strength', async () => {
  const f = fixture(); assert.equal((await f.executor.previewMove({ ...moveInput, componentId: 'running' })).ok, false)
  assert.equal((await f.executor.previewMove(moveInput)).ok, true)
})
test('unknown or unbound component is blocked rather than guessed from name', async () => {
  const f = fixture(); f.host().targets[1]!.identityResolved = false
  assert.equal((await f.executor.previewMove(moveInput)).ok, false)
  f.host().targets[1]!.identityResolved = true; f.host().targets[1]!.state = 'UNKNOWN'
  assert.equal((await f.executor.previewMove(moveInput)).ok, false)
})
test('duplicate target identity is rejected', async () => {
  const f = fixture(); f.host().targets.push(copy(f.host().targets[1]!)); assert.equal((await f.executor.previewMove(moveInput)).ok, false)
})
test('cross-athlete target and actor switch cannot execute old proposal', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)); f.host().targets[1]!.athleteId = 'athlete-b'
  assert.equal((await f.executor.confirm(confirm(p))).ok, false)
  f.host().actor!.athleteId = 'athlete-b'; assert.equal((await f.executor.confirm(confirm(p))).ok, false)
  assert.equal((f.repository.docs.get('athlete-a')!).revision, 0)
})
test('same athlete with a changed profile/device/subject requires new preview', async () => {
  for (const field of ['profileVersion', 'deviceId', 'subjectId'] as const) {
    const f = fixture(), p = value(await f.executor.previewMove(moveInput)); f.host().actor![field] = 'changed'
    assert.equal((await f.executor.confirm(confirm(p))).ok, false)
  }
})
test('revoked or unverified local authorization blocks reads and writes', async () => {
  for (const authorization of ['REVOKED', 'UNVERIFIED'] as const) {
    const f = fixture(); f.host().authorization = authorization
    assert.equal((await f.executor.read()).ok, false); assert.equal((await f.executor.previewMove(moveInput)).ok, false)
  }
})
test('proposal expires and cannot become permanent plan-write permission', async () => {
  const f = fixture(), p = value(await f.executor.previewMove({ ...moveInput, validForMs: 100 })); f.advance(100)
  const result = await f.executor.confirm(confirm(p)); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, 'EXPIRED_PROPOSAL')
})
test('midnight rollover or newly coordinated host requires a fresh preview', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)); f.host().today = '2026-10-20'
  assert.equal((await f.executor.confirm(confirm(p))).ok, false)
  const other = fixture(); other.host().persistenceBoundary = 'UNCOORDINATED'; const blocked = value(await other.executor.previewMove(moveInput))
  other.host().persistenceBoundary = 'COORDINATED_LOCAL'; const result = await other.executor.confirm(confirm(blocked))
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, 'BLOCKED_UNCOORDINATED')
})
test('tampered confirmation diff or non-explicit confirmation is rejected', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput))
  assert.equal((await f.executor.confirm({ ...confirm(p), diffHash: 'different' })).ok, false)
  assert.equal((await f.executor.confirm({ ...confirm(p), confirmation: 'okay' as 'CONFIRM_THIS_CHANGE' })).ok, false)
})
test('invalid/past/same dates never create a change', async () => {
  const f = fixture()
  for (const toDate of ['2026-02-30', '2026-10-18', '2026-10-19', 'tomorrow']) assert.equal((await f.executor.previewMove({ ...moveInput, toDate })).ok, false)
})
test('failed or incomplete calendar is not interpreted as an empty conflict-free calendar', async () => {
  const f = fixture(); f.host().calendarCoverage = 'UNKNOWN'; assert.equal((await f.executor.previewMove(moveInput)).ok, false)
  f.host().calendarCoverage = 'COMPLETE'; f.host().readState = 'FAILED'; assert.equal((await f.executor.previewMove(moveInput)).ok, false)
})
test('medical/safety status cannot be cleared by explicit confirmation', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)); f.host().safety = 'REVIEW_REQUIRED'
  assert.equal((await f.executor.confirm(confirm(p))).ok, false); assert.equal(value(await f.executor.read()).revision, 0)
})
test('atomic write failure leaves original source/target and no success receipt', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)); f.repository.failWrite = true
  assert.equal((await f.executor.confirm(confirm(p))).ok, false)
  const doc = value(await f.executor.read()); assert.equal(doc.revision, 0); assert.deepEqual(doc.overlays, {}); assert.deepEqual(doc.receipts, {})
})
test('readback mismatch is not success even after repository commit', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)); f.repository.corruptRead = true
  const result = await f.executor.confirm(confirm(p)); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, 'READBACK_FAILED')
  assert.equal(f.repository.docs.get('athlete-a')!.revision, 1)
})
test('original source hand-edit or later move prevents destructive undo', async () => {
  const f = fixture(), r = value(await f.executor.confirm(confirm(value(await f.executor.previewMove(moveInput)))))
  f.host().targets[1]!.sourceVersion = 'later-manual-edit'
  assert.equal((await f.executor.undo(undo(r))).ok, false)
  f.host().targets[1]!.sourceVersion = 'v4-original-immutable'
  const p2 = value(await f.executor.previewMove({ ...moveInput, toDate: '2026-10-21' })); value(await f.executor.confirm(confirm(p2)))
  assert.equal((await f.executor.undo(undo(r))).ok, false)
})
test('new source/target day schedule invalidates undo rather than overwriting it', async () => {
  const f = fixture(), r = value(await f.executor.confirm(confirm(value(await f.executor.previewMove(moveInput)))))
  await f.repository.transact('athlete-a', draft => { draft.dayVersions['2026-10-20']! += 1 })
  assert.equal((await f.executor.undo(undo(r))).ok, false)
})
test('IndexedDB-unavailable implementation has no unsafe localStorage fallback', async () => {
  const repository = createIndexedDbPlanExecutionRepository(undefined as unknown as IDBFactory)
  await assert.rejects(repository.read('athlete-a'), /INDEXED_DB_UNAVAILABLE/)
})
test('stable schedule/component key does not collapse components or parse display labels', () => {
  assert.notEqual(planTargetKey('a:b', 'c'), planTargetKey('a', 'b:c'))
  assert.notEqual(planTargetKey('same-day', 'run'), planTargetKey('same-day', 'strength'))
})
test('actual generated proposal/receipt and append-only undo satisfy production schema validation', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)), receipt = value(await f.executor.confirm(confirm(p)))
  const committed = value(await f.executor.read()); assert.deepEqual(validatePlanExecutionDocument(copy(committed), 'athlete-a'), committed)
  value(await f.executor.undo(undo(receipt)))
  assert.equal(validatePlanExecutionDocument(value(await f.executor.read()), 'athlete-a').revision, 2)
})
test('unknown schema/athlete and malformed overlay are rejected without resetting storage', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)); value(await f.executor.confirm(confirm(p)))
  const baseline = value(await f.executor.read()), key = planTargetKey(moveInput.scheduleId, moveInput.componentId)
  const corruptions: ((doc: PlanExecutionDocument) => void)[] = [
    d => { d.schemaVersion = 99 as 1 }, d => { d.athleteId = 'athlete-b' }, d => { d.revision = -1 },
    d => { d.overlays[key]!.date = '2026-02-30' }, d => { d.overlays[key]!.version = 9 },
    d => { d.overlays[key]!.receiptId = 'missing' }, d => { d.dayVersions['2026-10-19'] = -1 },
    d => { d.proposals[p.id]!.canApplyAutomatically = true as false },
    d => { d.receipts[Object.keys(d.receipts)[0]!]!.cloudSynchronized = true as false },
  ]
  for (const corrupt of corruptions) { const doc = copy(baseline); corrupt(doc); assert.throws(() => validatePlanExecutionDocument(doc, 'athlete-a')) }
  assert.deepEqual(value(await f.executor.read()), baseline)
})
test('persistent proposal tampering cannot reuse the formerly confirmed diff hash', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)), doc = f.repository.docs.get('athlete-a')!
  doc.proposals[p.id]!.move.toDate = '2026-10-21'
  doc.proposals[p.id]!.dayVersions = { '2026-10-19': 0, '2026-10-21': 0 }
  // Still schema-valid: integrity must bind the actual content, not the hash format.
  validatePlanExecutionDocument(doc, 'athlete-a')
  const result = await f.executor.confirm(confirm(p)); assert.equal(result.ok, false)
  assert.equal(f.repository.docs.get('athlete-a')!.revision, 0)
})
test('queued undo rechecks revoked authorization within the transaction', async () => {
  const f = fixture(), r = value(await f.executor.confirm(confirm(value(await f.executor.previewMove(moveInput)))))
  let release!: () => void; f.repository.queue = new Promise<void>(resolve => { release = resolve })
  const pending = f.executor.undo(undo(r)); f.host().authorization = 'REVOKED'; release()
  assert.equal((await pending).ok, false); assert.equal(f.repository.docs.get('athlete-a')!.revision, 1)
})
test('queued undo rechecks an athlete switch within the transaction', async () => {
  const f = fixture(), r = value(await f.executor.confirm(confirm(value(await f.executor.previewMove(moveInput)))))
  let release!: () => void; f.repository.queue = new Promise<void>(resolve => { release = resolve })
  const pending = f.executor.undo(undo(r)); f.host().actor!.athleteId = 'athlete-b'; release()
  assert.equal((await pending).ok, false); assert.equal(f.repository.docs.get('athlete-a')!.revision, 1)
})
test('queued idempotent confirmation must not return the previous account receipt', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)); value(await f.executor.confirm(confirm(p)))
  let release!: () => void; f.repository.queue = new Promise<void>(resolve => { release = resolve })
  const pending = f.executor.confirm(confirm(p)); f.host().actor!.profileVersion = 'switched-profile'; release()
  assert.equal((await pending).ok, false); assert.equal(f.repository.docs.get('athlete-a')!.revision, 1)
})
test('async read drops data when the active actor changes before resolution', async () => {
  const f = fixture(); value(await f.executor.previewMove(moveInput))
  const originalRead = f.repository.read.bind(f.repository)
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve })
  f.repository.read = async id => { const doc = await originalRead(id); await barrier; return doc }
  const pending = f.executor.read(); f.host().actor!.athleteId = 'athlete-b'; release()
  assert.equal((await pending).ok, false)
})
test('async read drops data when authorization is revoked before resolution', async () => {
  const f = fixture(); value(await f.executor.previewMove(moveInput))
  const originalRead = f.repository.read.bind(f.repository)
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve })
  f.repository.read = async id => { const doc = await originalRead(id); await barrier; return doc }
  const pending = f.executor.read(); f.host().authorization = 'REVOKED'; release()
  assert.equal((await pending).ok, false)
})
test('proposal replacement after hash review is rejected inside the transaction', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)), originalTransact = f.repository.transact.bind(f.repository)
  f.repository.transact = async (id, work) => {
    const persisted = f.repository.docs.get(id)!.proposals[p.id]!
    persisted.move.toDate = '2026-10-21'; persisted.dayVersions = { '2026-10-19': 0, '2026-10-21': 0 }
    return originalTransact(id, work)
  }
  assert.equal((await f.executor.confirm(confirm(p))).ok, false)
  assert.equal(f.repository.docs.get('athlete-a')!.revision, 0)
})
test('confirmation readback suppresses a receipt after account authorization changes', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)), originalRead = f.repository.read.bind(f.repository)
  let reads = 0
  f.repository.read = async id => { const doc = await originalRead(id); if (++reads === 2) f.host().authorization = 'REVOKED'; return doc }
  const result = await f.executor.confirm(confirm(p)); assert.equal(result.ok, false)
  // The commit itself happened under the original identity; never return its private receipt to the new scope.
  assert.equal(f.repository.docs.get('athlete-a')!.revision, 1)
})
test('undo readback suppresses the old athlete receipt after an account switch', async () => {
  const f = fixture(), receipt = value(await f.executor.confirm(confirm(value(await f.executor.previewMove(moveInput))))), originalRead = f.repository.read.bind(f.repository)
  let reads = 0
  f.repository.read = async id => { const doc = await originalRead(id); if (++reads === 2) f.host().actor!.athleteId = 'athlete-b'; return doc }
  assert.equal((await f.executor.undo(undo(receipt))).ok, false)
  assert.equal(f.repository.docs.get('athlete-a')!.revision, 2)
})
test('preview does not return its persisted card after its actor changes during commit', async () => {
  const f = fixture(), originalTransact = f.repository.transact.bind(f.repository)
  f.repository.transact = async (id, work) => { const result = await originalTransact(id, work); f.host().authorization = 'REVOKED'; return result }
  assert.equal((await f.executor.previewMove(moveInput)).ok, false)
})
test('undo cannot use tampered proposal versions to conceal later calendar changes', async () => {
  const f = fixture(), p = value(await f.executor.previewMove(moveInput)), receipt = value(await f.executor.confirm(confirm(p))), doc = f.repository.docs.get('athlete-a')!
  for (const day of ['2026-10-19', '2026-10-20']) { doc.dayVersions[day] = 2; doc.proposals[p.id]!.dayVersions[day] = 1 }
  validatePlanExecutionDocument(doc, 'athlete-a')
  assert.equal((await f.executor.undo(undo(receipt))).ok, false)
  assert.equal(f.repository.docs.get('athlete-a')!.revision, 1)
})
