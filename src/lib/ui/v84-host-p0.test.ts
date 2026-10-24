import '../../../test-fixtures/synthetic/install-plan.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import planJson from '../../../test-fixtures/synthetic/plan400-v4.json' with { type: 'json' }
import { dayStatus, type V4Plan } from './plan400-view'
import { currentAthleteId, setEventContext, EVENTS_KEY } from '../core/events'
import { writeEnvelope, setStoreBackend } from '../core/storage'
import { TRAINING_OCCURRENCE_KEY, type TrainingOccurrence } from '../core/occurrence'
import { guidedLive, latestOccurrence } from './guided-discard'
/* C03/R14 合并说明：原包这里还有 5 个用例测试它重写的读模型（v4ExecutionParts / componentFacts / 读模型按运动员过滤）。
 * live-v84 保留 v83 的分项投影（同一问题已在 v83 P0-01/02 修过，见 plan400-view / training-read-model 测试），
 * 未采用那套重写，所以那 5 个用例不适用、未计入；下面保留与 v84 口径一致的用例，并按 v84 的 DayParts 改写了“只做完力量”那条。 */
const plan = planJson as V4Plan, date = '2026-10-19', d = plan.days.find(x => x.date === date)!

test('HOST-01 current live execution cannot fall back to historical whole-session done', () => {
  assert.equal(dayStatus(d, { done: 'done' }, date, true), 'in_progress')
})
test('HOST-01/02 (v84 projection) only strength executed + old whole-session done stays in_progress', () => {
  assert.equal(dayStatus(d, { done: 'done' }, date, false, { strengthExec: 'COMPLETED' }), 'in_progress')
  assert.notEqual(dayStatus(d, { done: 'done' }, date, false, { strengthExec: 'COMPLETED', parts: { running: { status: 'not_recorded' } } } as never), 'done')
})
test('HOST-03 live/latest occurrence read paths require current athlete start-event ownership', () => {
  const data = new Map<string, string>(), box = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, keys: () => [...data.keys()] }
  const prior = currentAthleteId(); setStoreBackend(box); setEventContext({ athleteId: 'synthetic-A' })
  const sessionId = 'scheduled:plan400:2026-10-19:strength:strength'
  try {
    const occurrence = (id: string): TrainingOccurrence => ({ trainingOccurrenceId: id, planSlotId: 'slot', sessionId, startEventId: id, trainingPlanSnapshotId: null, planKnowledge: 'UNKNOWN', lifecycle: 'IN_PROGRESS', outcome: 'UNKNOWN', reason: 'UNKNOWN', startedAt: `${date}T10:00:00Z`, endedAt: null, closeEventId: null, duplicateCloseEventIds: [], duplicateStartEventIds: [], futureLinks: { strengthRpeEventId: null, painEventIds: [], injuryEventId: null } })
    writeEnvelope(TRAINING_OCCURRENCE_KEY, { occurrences: [occurrence('owned'), occurrence('foreign')], trainingPlans: [] })
    writeEnvelope(EVENTS_KEY, [{ event_id: 'owned', athlete_id: 'synthetic-A', event_type: 'TRAINING_STARTED' }, { event_id: 'foreign', athlete_id: 'synthetic-B', event_type: 'TRAINING_STARTED' }])
    const snapshot = JSON.stringify([...data])
    assert.equal(latestOccurrence(sessionId)?.trainingOccurrenceId, 'owned')
    assert.equal(guidedLive(sessionId), true)
    setEventContext({ athleteId: 'synthetic-C' })
    assert.equal(latestOccurrence(sessionId), null)
    assert.equal(guidedLive(sessionId), false)
    assert.equal(JSON.stringify([...data]), snapshot)
  } finally { setStoreBackend(null); setEventContext({ athleteId: prior }) }
})
