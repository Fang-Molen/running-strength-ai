import test from 'node:test'
import assert from 'node:assert/strict'
import { ACUTE_ALPHA, CHRONIC_ALPHA, calculateLoadTrend, formatLoadTrend, loadDayFingerprint, savedSessionAu, shiftLoadDay, validLoadDay, type SavedSessionLoad } from './coach-load-metrics.ts'

const athleteId = 'athlete-a', endDay = '2026-05-28'
function session(i: number, au = 300): SavedSessionLoad {
  return { id: `session-${i}`, athleteId, day: shiftLoadDay(endDay, i - 27)!, sessionRpe: 5, minutes: au / 5, sourceIds: [`source-${i}`], revision: 'v1' }
}
function confirmations(sessions: SavedSessionLoad[]) {
  return Array.from({ length: 28 }, (_, i) => {
    const day = shiftLoadDay(endDay, i - 27)!
    return { athleteId, day, fingerprint: loadDayFingerprint(sessions, athleteId, day) }
  })
}
function trend(sessions: SavedSessionLoad[]) { return calculateLoadTrend({ athleteId, endDay, sessions, confirmations: confirmations(sessions) }) }

test('EWMA constant daily 300 AU remains 300/300, ratio one after 28 complete days', () => {
  const result = trend(Array.from({ length: 28 }, (_, i) => session(i)))
  assert.equal(result.status, 'AVAILABLE')
  assert.equal(result.acute, 300)
  assert.ok(Math.abs(result.chronic! - 300) < 1e-10)
  assert.ok(Math.abs(result.ratio! - 1) < 1e-10)
})
test('EWMA last-day impulse matches analytical recurrence rather than arithmetic mean', () => {
  const result = trend([session(27, 560)])
  assert.equal(result.acute, 560 * ACUTE_ALPHA)
  assert.equal(result.chronic, 560 * CHRONIC_ALPHA)
  assert.equal(result.ratio, 29 / 8)
})
test('EWMA seed is first observed load with explicit exponential decay and no pre-window zero padding', () => {
  const result = trend([session(0, 100)])
  assert.ok(Math.abs(result.acute! - 100 * (1 - ACUTE_ALPHA) ** 27) < 1e-10)
  assert.ok(Math.abs(result.chronic! - 100 * (1 - CHRONIC_ALPHA) ** 27) < 1e-10)
})
test('EWMA unknown days never become zero and 27 confirmations cannot produce a ratio', () => {
  const sessions = [session(27)]
  const result = calculateLoadTrend({ athleteId, endDay, sessions, confirmations: confirmations(sessions).slice(1) })
  assert.equal(result.status, 'INSUFFICIENT')
  assert.equal(result.knownDays, 27)
  assert.equal(result.days[0].au, null)
  assert.equal(result.ratio, null)
})
test('EWMA explicitly confirmed no-training days have zero AU, zero chronic denominator has no ratio', () => {
  const result = trend([])
  assert.equal(result.status, 'ZERO_BASELINE')
  assert.equal(result.knownDays, 28)
  assert.equal(result.chronic, 0)
  assert.equal(result.ratio, null)
  assert.match(formatLoadTrend(result), /暂不计算比值/)
})
test('EWMA saved missing RPE or duration remains unknown even after completeness confirmation', () => {
  for (const field of ['sessionRpe', 'minutes'] as const) {
    const result = trend([{ ...session(27), [field]: null }])
    assert.equal(result.status, 'INSUFFICIENT')
    assert.deepEqual(result.incompleteSessionIds, ['session-27'])
    assert.equal(result.days[27].au, null)
  }
})
test('EWMA identical session retransmission deduplicates; distinct sessions on the same day sum', () => {
  const a = session(27), b = { ...a, id: 'session-second', sourceIds: ['second'] }
  const result = trend([a, structuredClone(a), b])
  assert.equal(result.days[27].sessionCount, 2)
  assert.equal(result.days[27].au, 600)
})
test('EWMA conflicting same session ID invalidates both dates instead of choosing one', () => {
  const a = session(27), b = { ...a, day: shiftLoadDay(a.day, -1)!, minutes: 90 }
  const result = trend([a, b])
  assert.equal(result.status, 'INSUFFICIENT')
  assert.deepEqual(result.duplicateIds, [a.id])
  assert.equal(result.days[26].au, null)
  assert.equal(result.days[27].au, null)
  assert.equal(result.ratio, null)
})
test('EWMA another athlete cannot contribute load or completeness assertions', () => {
  const a = session(27)
  const other = { ...a, athleteId: 'athlete-b', minutes: 1000 }
  const result = trend([a, other])
  assert.equal(result.days[27].au, 300)
  const unconfirmed = calculateLoadTrend({ athleteId, endDay, sessions: [a], confirmations: confirmations([a]).map(c => ({ ...c, athleteId: 'athlete-b' })) })
  assert.equal(unconfirmed.knownDays, 0)
})
test('EWMA saved source additions, removal, correction and rating changes invalidate prior day confirmation', () => {
  const a = session(27), old = confirmations([a])
  for (const sessions of [[], [{ ...a, minutes: 40 }], [{ ...a, revision: 'corrected' }], [a, { ...a, id: 'second' }]]) {
    const result = calculateLoadTrend({ athleteId, endDay, sessions, confirmations: old })
    assert.equal(result.status, 'INSUFFICIENT')
    assert.equal(result.days[27].confirmed, false)
  }
})
test('EWMA invalid finite, duration, RPE and missing source inputs never produce a load', () => {
  for (const value of [null, NaN, Infinity, -1, 10.1]) assert.equal(savedSessionAu({ ...session(27), sessionRpe: value }), null)
  // An explicitly reported zero on the existing 0—10 scale is known, unlike null.
  assert.equal(savedSessionAu({ ...session(27), sessionRpe: 0 }), 0)
  for (const value of [NaN, Infinity, -1, 0, 1440.1]) assert.equal(savedSessionAu({ ...session(27), minutes: value }), null)
  assert.equal(trend([{ ...session(27), sourceIds: [] }]).status, 'INSUFFICIENT')
})
test('EWMA calendar validates real dates and crosses month/year without timezone drift', () => {
  assert.equal(validLoadDay('2026-02-30'), false)
  assert.equal(shiftLoadDay('2026-01-01', -1), '2025-12-31')
  assert.equal(shiftLoadDay('2024-03-01', -1), '2024-02-29')
  assert.equal(calculateLoadTrend({ athleteId, endDay: 'bad', sessions: [], confirmations: [] }).status, 'INVALID')
})
test('EWMA output gives descriptive values without a sweet zone, percentage or automatic prescription', () => {
  const text = formatLoadTrend(trend([session(27, 560)]))
  assert.match(text, /负荷变化提示/)
  assert.match(text, /不用于医疗判断、恢复结论或自动安排加量/)
  assert.doesNotMatch(text, /%|甜区|0\.8|1\.3|安全区|受伤风险|受伤概率/)
})
