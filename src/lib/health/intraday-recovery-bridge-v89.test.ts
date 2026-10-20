import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIntradayDay } from './garmin-intraday'
import { fixtureHeartRate, fixtureStress, fixtureSleep } from './garmin-intraday.fixture'
import { intradayRecoveryFromStore, intradayInput } from './intraday-recovery-bridge-v89'
import type { IntradayDay } from './garmin-intraday'
const ok = (body: unknown) => ({ status: 200, body })
const day = (d: string) => buildIntradayDay({ day: d, now: d + 'T20:00:00Z', hr: ok(fixtureHeartRate(d)), stress: ok(fixtureStress(d)), sleep: ok(fixtureSleep(d)), activities: [{ startIso: d + 'T10:00:00.000Z', durationSec: 2400, sportLabel: '跑步' }] }).day!
const store = (n: number): Record<string, IntradayDay> => Object.fromEntries(Array.from({ length: n }, (_, i) => { const d = `2026-10-${String(20 - i).padStart(2, '0')}`; return [d, day(d)] }))
test('one data source → U10 curve: HR/BB available; sleep + training events from the same stored day', () => {
  const v = intradayRecoveryFromStore(store(1), 'local', '2026-10-20', '2026-10-20T23:00:00Z')!
  assert.equal(v.metrics.HEART_RATE.status, 'AVAILABLE'); assert.equal(v.metrics.BODY_BATTERY.status, 'AVAILABLE')
  assert.ok(v.events.some(e => e.kind === 'RUN')); assert.equal(v.metrics.HEART_RATE.reference.length, 0, 'no reference band without ≥7 comparable days')
})
test('reference band appears only with ≥7 prior comparable days; samples carry device context', () => {
  const s = store(10), input = intradayInput(s, 'local', '2026-10-20', '2026-10-20T23:00:00Z')
  assert.ok(input.samples.some(x => x.context === 'TRAINING') && input.samples.some(x => x.context === 'AWAKE'))
  const v = intradayRecoveryFromStore(s, 'local', '2026-10-20', '2026-10-20T23:00:00Z')!
  assert.ok(v.metrics.HEART_RATE.reference.length > 0 && v.metrics.HEART_RATE.reference.every(r => r.days >= 7 && r.p25 <= r.median && r.median <= r.p75))
  assert.equal(new Set(v.events.map(e => e.eventId)).size, v.events.length)
})
test('no stored day → null (UI shows 暂无, never stitches daily summaries)', () => {
  assert.equal(intradayRecoveryFromStore(store(3), 'local', '2026-10-01', '2026-10-20T23:00:00Z'), null)
})
