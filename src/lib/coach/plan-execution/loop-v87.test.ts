// v87 改课“预览 → 用户确认 → CAS/幂等写入 → 撤销”闭环，接真实本机日程宿主快照与真实日程写入闸口。
// 闭环只在测试里把宿主条件放开（COORDINATED_LOCAL/COMPLETE/ALLOW_DATE_MOVE）验证逻辑；产品宿主仍固定 BLOCKED_UNCOORDINATED。
import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend } from '../../core/storage'
import { currentAthleteId, setEventContext } from '../../core/events'
import { createLocalPlanExecutor, effectivePlanDate, emptyPlanExecution, PLAN_EXECUTION_LOCK, type PlanExecutionDocument, type PlanExecutionRepository, type PlanHostContext } from './core'
import { readCoachPlanHostSnapshot, createCoachPlanChangeController } from './host'
import { SCHEDULE_KEY, saveSchedule, loadSchedule } from '../../ui/day-schedule'
import { readScheduleRevision, SCHEDULE_WRITE_LOCK, SCHEDULE_REVISION_KEY, withScheduleLock } from '../../ui/schedule-writer'
import type { ScheduleEntry } from '../../ui/day-schedule-rules'

const ATHLETE = 'synthetic-plan-ui-owner', AS_OF = '2026-10-19T12:00:00.000Z'
const entry = (patch: Partial<ScheduleEntry> = {}): ScheduleEntry => ({ id: 'schedule-owned', athleteId: ATHLETE, date: '2026-10-19', kind: 'run', modality: 'run', title: '合成组合课', focus: [], minutes: 30, intensity: 'EASY', lowerHeavy: false, source: 'custom', refId: null, status: 'planned', runComponents: [{ componentId: 'running-source-component', modality: 'RUNNING', purpose: 'UNSPECIFIED', structure: { kind: 'CONTINUOUS', plannedDistanceMeters: 1000, plannedDistanceMaxMeters: null, plannedDurationSeconds: null } }, { componentId: 'strength-source-component', modality: 'STRENGTH', strengthSessionId: 'approved-source-session' }], ...patch })
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
class MemoryRepository implements PlanExecutionRepository {
  docs = new Map<string, PlanExecutionDocument>(); queue: Promise<unknown> = Promise.resolve()
  async read(id: string) { return copy(this.docs.get(id) ?? emptyPlanExecution(id)) }
  transact<T>(id: string, work: (d: PlanExecutionDocument) => T): Promise<T> { const run = this.queue.then(() => { const d = copy(this.docs.get(id) ?? emptyPlanExecution(id)), r = work(d); this.docs.set(id, d); return r }); this.queue = run.catch(() => {}); return run }
}
function fixture(t: test.TestContext) {
  const previous = currentAthleteId(), data = new Map<string, string>()
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) }, keys: () => [...data.keys()] }
  store.setItem(SCHEDULE_KEY, JSON.stringify({ entries: [entry()], acks: [] }))
  setStoreBackend(store); setEventContext({ athleteId: ATHLETE })
  t.after(() => { setStoreBackend(null); setEventContext({ athleteId: previous }) })
  return { data, store }
}
/** 测试专用：把宿主协调前提视为已满足，只为验证闭环逻辑。 */
async function coordinatedExecutor() {
  let snap = await readCoachPlanHostSnapshot(AS_OF)
  const host = (): PlanHostContext => ({ ...snap.host, persistenceBoundary: 'COORDINATED_LOCAL', calendarCoverage: 'COMPLETE', safety: 'ALLOW_DATE_MOVE' })
  const repository = new MemoryRepository()
  const lock = async <T,>(w: () => T | Promise<T>) => (await withScheduleLock(w)).value
  const ex = createLocalPlanExecutor({ repository, readHostContext: host, now: () => new Date(AS_OF), lock })
  return { ex, repository, refresh: async () => { snap = await readCoachPlanHostSnapshot(AS_OF) } }
}

test('one shared lock name for schedule writers and the plan executor', () => {
  assert.equal(SCHEDULE_WRITE_LOCK, PLAN_EXECUTION_LOCK)
})
test('every schedule write bumps one revision with the writer label; no change = no bump', t => {
  const f = fixture(t), s = loadSchedule()
  assert.equal(readScheduleRevision(f.store).rev, 0)
  assert.ok(saveSchedule(s, 'today-board-sync')); const r1 = readScheduleRevision(f.store).rev // first save normalises the document (acksByAthlete)
  assert.ok(saveSchedule(loadSchedule(), 'today-board')); assert.equal(readScheduleRevision(f.store).rev, r1, 'identical content is not a new revision')
  assert.ok(saveSchedule({ ...s, entries: s.entries.map(e => ({ ...e, minutes: 35 })) }, 'unmarked-plans'))
  assert.deepEqual([readScheduleRevision(f.store).rev, readScheduleRevision(f.store).writer], [r1 + 1, 'unmarked-plans'])
  f.store.setItem(SCHEDULE_REVISION_KEY, '{bad'); assert.equal(readScheduleRevision(f.store).rev, 0, 'corrupt revision never blocks or wipes the schedule')
})
test('preview → confirm → idempotent re-confirm → undo, without touching or duplicating fk-schedule-v1 rows', async t => {
  const f = fixture(t), rawBefore = f.store.getItem(SCHEDULE_KEY)
  const { ex, repository } = await coordinatedExecutor()
  const p = await ex.previewMove({ scheduleId: 'schedule-owned', componentId: 'strength-source-component', toDate: '2026-10-21' })
  assert.ok(p.ok, JSON.stringify(p)); if (!p.ok) return
  assert.equal(p.value.canApplyAutomatically, false); assert.equal(p.value.state, 'PENDING')
  const doc0 = await repository.read(ATHLETE); assert.equal(effectivePlanDate(doc0, 'schedule-owned', 'strength-source-component', '2026-10-19'), '2026-10-19', 'preview alone changes nothing')
  const c1 = await ex.confirm({ proposalId: p.value.id, diffHash: p.value.diffHash, confirmation: 'CONFIRM_THIS_CHANGE' })
  assert.ok(c1.ok, JSON.stringify(c1)); if (!c1.ok) return
  const c2 = await ex.confirm({ proposalId: p.value.id, diffHash: p.value.diffHash, confirmation: 'CONFIRM_THIS_CHANGE' })
  assert.ok(c2.ok); if (c2.ok) assert.equal(c2.value.id, c1.value.id, 'idempotent: second confirm returns the same receipt')
  const doc1 = await repository.read(ATHLETE)
  assert.equal(Object.values(doc1.receipts).filter(r => r.kind === 'MOVE').length, 1)
  assert.equal(effectivePlanDate(doc1, 'schedule-owned', 'strength-source-component', '2026-10-19'), '2026-10-21')
  assert.equal(effectivePlanDate(doc1, 'schedule-owned', 'running-source-component', '2026-10-19'), '2026-10-19', 'only the confirmed component moves')
  assert.equal(f.store.getItem(SCHEDULE_KEY), rawBefore, 'original schedule kept byte-for-byte; the move is a revision overlay, not a duplicated row')
  const u = await ex.undo({ receiptId: c1.value.id, confirmation: 'UNDO_THIS_CHANGE' })
  assert.ok(u.ok, JSON.stringify(u)); const u2 = await ex.undo({ receiptId: c1.value.id, confirmation: 'UNDO_THIS_CHANGE' })
  assert.ok(u.ok && u2.ok && u2.value.id === u.value.id, 'idempotent undo')
  const doc2 = await repository.read(ATHLETE)
  assert.equal(effectivePlanDate(doc2, 'schedule-owned', 'strength-source-component', '2026-10-19'), '2026-10-19')
  assert.ok(doc2.receipts[c1.value.id], 'original receipt preserved; undo is another receipt')
})
test('CAS: another writer changing the schedule between preview and confirm blocks the write', async t => {
  fixture(t)
  const { ex, repository, refresh } = await coordinatedExecutor()
  const p = await ex.previewMove({ scheduleId: 'schedule-owned', componentId: 'strength-source-component', toDate: '2026-10-21' })
  assert.ok(p.ok); if (!p.ok) return
  const s = loadSchedule(); assert.ok(saveSchedule({ ...s, entries: s.entries.map(e => ({ ...e, title: '用户在首页改了标题' })) }, 'today-board'))
  await refresh()
  const c = await ex.confirm({ proposalId: p.value.id, diffHash: p.value.diffHash, confirmation: 'CONFIRM_THIS_CHANGE' })
  assert.equal(c.ok, false); if (!c.ok) assert.equal(c.code, 'STALE_CONTEXT')
  assert.equal(Object.keys((await repository.read(ATHLETE)).receipts).length, 0)
})
test('confirm requires the explicit confirmation token and the exact reviewed diff', async t => {
  fixture(t)
  const { ex } = await coordinatedExecutor()
  const p = await ex.previewMove({ scheduleId: 'schedule-owned', componentId: 'strength-source-component', toDate: '2026-10-21' })
  assert.ok(p.ok); if (!p.ok) return
  const bad = await ex.confirm({ proposalId: p.value.id, diffHash: '0'.repeat(64), confirmation: 'CONFIRM_THIS_CHANGE' })
  assert.equal(bad.ok, false); if (!bad.ok) assert.equal(bad.code, 'PROPOSAL_MISMATCH')
  const noToken = await ex.confirm({ proposalId: p.value.id, diffHash: p.value.diffHash, confirmation: 'yes' as never })
  assert.equal(noToken.ok, false)
})
test('production host stays BLOCKED_UNCOORDINATED: the app controller cannot confirm', async t => {
  fixture(t)
  const snap = await readCoachPlanHostSnapshot(AS_OF)
  assert.equal(snap.host.persistenceBoundary, 'UNCOORDINATED'); assert.equal(snap.host.calendarCoverage, 'UNKNOWN'); assert.equal(snap.host.safety, 'UNKNOWN')
  const controller = createCoachPlanChangeController({ repository: new MemoryRepository(), now: () => new Date(AS_OF), lock: async w => (await withScheduleLock(w)).value })
  const c = await controller.confirm({ id: 'x', diffHash: 'y' })
  assert.equal(c.ok, false); if (!c.ok) assert.equal(c.code, 'BLOCKED_UNCOORDINATED')
})
