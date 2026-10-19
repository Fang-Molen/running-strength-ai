import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { comboView, deviceRunFacts, deviceRunsOn, recoveryTiming, sharedSleepFor } from './plan400-components.ts'
import { dayOf, dayStatus, type V4Plan } from './plan400-view.ts'

process.env.TZ = 'Asia/Shanghai'
const plan = JSON.parse(readFileSync(new URL('../plan400-v4.json', import.meta.url), 'utf8')) as V4Plan
const d1019 = dayOf(plan, '2026-10-19')!   // 速度耐力＋力量A
const d1020 = dayOf(plan, '2026-10-20')!   // 低强度恢复
const garmin = { id: 'garmin:cn%3At:1', source: 'garmin', sport: 'RUNNING', startedAt: '2026-10-19T09:05:00.000Z', date: '2026-10-19', distanceM: 5230, durationSec: 1932, avgHr: 156, title: '跑步' }
const noEntry = { deviceRuns: [], strengthEntry: undefined, strengthLive: false }

test('W01/W02: same-day watch run is a candidate for Running only; Strength stays 尚未记录; overall never 整课完成', () => {
  const runs = deviceRunsOn('2026-10-19', [garmin])
  const v = comboView(d1019, undefined, { ...noEntry, deviceRuns: runs })
  assert.equal(v.combo, true)
  assert.equal(v.running.tone, 'candidate')
  assert.equal(v.strength?.label, '尚未记录')
  assert.match(v.overall, /两项都还没有记录/)
  assert.doesNotMatch(v.overall, /完成/)
  // the whole-day status is not changed by a watch run (no auto-complete)
  assert.equal(dayStatus(d1019, undefined, '2026-10-19'), 'not_started')
})
test('W06: summary-only device run shows only real fields; never invents laps or zeros', () => {
  const [r] = deviceRunsOn('2026-10-19', [garmin])
  const facts = deviceRunFacts(r).join(' · ')
  assert.match(facts, /5\.23 km/); assert.match(facts, /用时 32:12/); assert.match(facts, /平均心率 156/)
  assert.doesNotMatch(facts, /150m|组间/)
  const [bare] = deviceRunsOn('2026-10-19', [{ ...garmin, distanceM: null, durationSec: null, avgHr: null }])
  const f2 = deviceRunFacts(bare).join(' · ')
  assert.doesNotMatch(f2, /\b0(\.0+)? ?km|用时|配速|心率/)
})
test('W09: several same-day runs are all listed, none is picked silently; other days/sports ignored', () => {
  const rows = [garmin, { ...garmin, id: 'imp-2', source: 'import', startedAt: '2026-10-19T11:00:00.000Z' }, { ...garmin, id: 'x', startedAt: '2026-10-18T09:00:00.000Z', date: '2026-10-18' }, { ...garmin, id: 's', sport: 'STRENGTH' }, { ...garmin, id: 'p', source: 'phone' }]
  const runs = deviceRunsOn('2026-10-19', rows)
  assert.deepEqual(runs.map(r => r.id), ['garmin:cn%3At:1', 'imp-2'])
  assert.match(comboView(d1019, undefined, { ...noEntry, deviceRuns: runs }).running.label, /2 条/)
})
test('Asia/Shanghai day attribution: 23:30 local on 10/18 (UTC 15:30) is not 10/19', () => {
  assert.equal(deviceRunsOn('2026-10-19', [{ ...garmin, startedAt: '2026-10-18T15:30:00.000Z' }]).length, 0)
  assert.equal(deviceRunsOn('2026-10-19', [{ ...garmin, startedAt: '2026-10-18T16:30:00.000Z' }]).length, 1)
})
test('W04/W05: running and strength states are independent', () => {
  const liftDone = comboView(d1019, {}, { ...noEntry, strengthEntry: { id: 'plan400:2026-10-19:strength', actual: { outcome: 'as_planned', executionState: 'COMPLETED' } } })
  assert.equal(liftDone.strength?.tone, 'done'); assert.equal(liftDone.running.tone, 'none'); assert.match(liftDone.overall, /只有力量/)
  const runHand = comboView(d1019, { reps: '21.3/21.0/21.6' }, noEntry)
  assert.equal(runHand.running.tone, 'partial'); assert.equal(runHand.strength?.tone, 'none')
  const live = comboView(d1019, {}, { ...noEntry, strengthLive: true })
  assert.equal(live.strength?.tone, 'live')
  const partial = comboView(d1019, {}, { ...noEntry, strengthEntry: { id: 'x', actual: { executionState: 'PARTIAL' } } })
  assert.equal(partial.strength?.label, '逐组记录未做完')
})
test('W13: legacy whole-session done/RPE stays 整课（旧口径）and is never split into two component scores', () => {
  const v = comboView(d1019, { done: 'done', rpe: '7', pain: '跟腱 2' }, noEntry)
  assert.deepEqual(v.legacy, { done: 'done', rpe: '7', pain: '跟腱 2' })
  assert.equal(v.running.tone, 'none'); assert.equal(v.strength?.tone, 'none')
  assert.equal(JSON.stringify(v).match(/"7"/g)?.length, 1)
})
test('non-combo day (恢复) shows no component split', () => {
  assert.equal(comboView(d1020, undefined, noEntry).combo, false)
  assert.equal(comboView(d1020, undefined, noEntry).strength, null)
})
test('W11: shared sleep is referenced once (night after = next day record), per athlete, newest wins', () => {
  const recs = [{ kind: 'SLEEP', value: 6.5, observedOn: '2026-10-20', source: 'DEVICE_CONFIRMED', note: '佳明账号同步', createdAt: '2026-10-20T01:00:00Z' }, { kind: 'SLEEP', value: 7.1, observedOn: '2026-10-20', source: 'MANUAL', createdAt: '2026-10-20T03:00:00Z', athleteId: 'other' }, { kind: 'HRV', value: 60, observedOn: '2026-10-20' }]
  assert.deepEqual(sharedSleepFor('2026-10-19', recs), { hours: 6.5, day: '2026-10-20', source: '佳明账号同步' })
  assert.equal(sharedSleepFor('2026-10-18', recs), null)
})
test('W10/W19: recovery timing — no early answers, late fill is flagged', () => {
  assert.equal(recoveryTiming('2026-10-19', '2026-10-19'), 'too_early')
  assert.equal(recoveryTiming('2026-10-19', '2026-10-21'), 'window')
  assert.equal(recoveryTiming('2026-10-19', '2026-10-26'), 'late')
})
test('W10: 24–72h placeholders no longer look like pre-filled answers', () => {
  const src = readFileSync(new URL('../../components/plan400.tsx', import.meta.url), 'utf8')
  const later = src.slice(src.indexOf('const LATER'), src.indexOf('\n', src.indexOf('const LATER')))
  assert.doesNotMatch(later, /6\.5h|恢复好/)
})
