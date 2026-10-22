import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePolarExercises, parsePolarDaily, parsePolarNights, parsePolarRecharge, parseSuuntoWorkouts, parseSuuntoSteps, parseSuuntoSleep } from './cloud-parse.ts'

const ACCOUNT = 'a'.repeat(32), AT = '2026-10-22T12:00:00.000Z'

test('Polar keeps the vendor ID, decimal seconds/metres and explicit timezone; missing values remain null', () => {
  const { activities } = parsePolarExercises([{ id: 'run-1', start_time: '2026-10-21T08:01:02.1', start_time_utc_offset: 480, duration: 'PT6M0.1S', distance: 1500.125, calories: 0, sport: 'RUNNING', heart_rate: { average: 151 } }], ACCOUNT, AT)
  assert.equal(activities.length, 1)
  const a = activities[0]
  assert.equal(a.sourceIdentity, `polar:${ACCOUNT}:run-1`)
  assert.equal(a.provenance?.recordId, 'run-1')
  assert.equal(a.startIso, '2026-10-21T00:01:02.100Z')
  assert.equal(a.durationSec, 360.1)
  assert.equal(a.distanceM, 1500.125)
  assert.equal(a.calories, 0)
  assert.equal(a.maxHr, null)
  assert.equal(a.avgPower, null)
  assert.deepEqual(a.sets, [])
})

test('Polar does not infer timezone, null duration, an activity ID, or a numeric zero from missing data', () => {
  const result = parsePolarExercises([{ id: 'unknown', start_time: '2026-10-21T08:00:00', duration: null, distance: null }, { duration: 'PT1S' }], ACCOUNT, AT)
  assert.equal(result.activities.length, 1)
  assert.equal(result.activities[0].startIso, null)
  assert.equal(result.activities[0].durationSec, null)
  assert.equal(result.activities[0].distanceM, null)
  assert.ok(result.issues.length >= 2)
})

test('Polar sleep and recharge retain the exact observation protocol; night HR is never treated as RHR', () => {
  const steps = parsePolarDaily([{ start_time: '2026-10-20T00:00:00', steps: 0 }, { start_time: '2026-10-21T00:00:00', steps: null }], ACCOUNT, AT)
  assert.equal(steps.health.length, 1)
  assert.equal(steps.health[0].value, 0)
  const sleep = parsePolarNights({ nights: [{ date: '2026-10-21', sleep_start_time: '2026-10-20T23:00:00+08:00', light_sleep: 18000.1, deep_sleep: 3600, rem_sleep: 3600, unrecognized_sleep_stage: 0 }] }, ACCOUNT, AT)
  assert.equal(sleep.health[0].value, 25200.1 / 3600)
  assert.equal(sleep.health[0].observation?.rawValue, 25200.1)
  const recharge = parsePolarRecharge({ recharges: [{ date: '2026-10-21', heart_rate_avg: 51, heart_rate_variability_avg: 48.125, breathing_rate_avg: 14.1, ans_charge: 2 }] }, ACCOUNT, AT)
  assert.deepEqual(recharge.health.map(x => x.metric), ['HRV', 'RESP'])
  assert.equal(recharge.health[0].hrvMethod, 'RMSSD')
  assert.equal(recharge.health[0].value, 48.125)
  assert.ok(recharge.health[0].observation?.statistic.includes('4小时'))
})

test('Suunto uses v3 summary keys and measured workout HR, not the account maximum; time remains fractional', () => {
  const result = parseSuuntoWorkouts({ error: null, payload: [{ workoutKey: '5b190f5c52ce7b316acbd520', activityId: 1, startTime: Date.parse('2026-10-21T08:00:00.100Z'), totalTime: 360.1, totalDistance: 1500.125, energyConsumption: 180, hrdata: { userMaxHR: 205, workoutAvgHR: 151, workoutMaxHR: 175 } }] }, ACCOUNT, AT)
  assert.equal(result.activities.length, 1)
  const a = result.activities[0]
  assert.equal(a.sport, 'RUNNING')
  assert.equal(a.durationSec, 360.1)
  assert.equal(a.distanceM, 1500.125)
  assert.equal(a.calories, 180)
  assert.equal(a.maxHr, 175)
  assert.equal(a.provenance?.provider, 'SUUNTO')
  const missing = parseSuuntoWorkouts({ payload: [{ workoutKey: 'unmeasured', hrdata: { userMaxHR: 205 } }] }, ACCOUNT, AT).activities[0]
  assert.equal(missing.maxHr, null)
  assert.equal(missing.durationSec, null)
  assert.equal(missing.sport, 'UNKNOWN')
})

test('Suunto preserves separate watch sources, actual zero steps, and no null-to-zero conversion', () => {
  const result = parseSuuntoSteps([{ Name: 'stepcount', Aggregation: 'sum', Sources: [{ Name: 'watch-a', Samples: [{ TimeISO8601: '2026-10-20T00:00:00.000', Value: null }, { TimeISO8601: '2026-10-21T00:00:00.000', Value: 0 }] }, { Name: 'watch-b', Samples: [{ TimeISO8601: '2026-10-21T00:00:00.000Z', Value: '12' }] }] }], ACCOUNT, AT)
  assert.deepEqual(result.health.map(x => x.value), [0, 12])
  assert.notEqual(result.health[0].observation?.sourceId, result.health[1].observation?.sourceId)
  assert.equal(result.health[0].observation?.measuredAt, '2026-10-21T00:00:00.000Z')
})

test('Suunto sleep segments retain separate identities and the documented possibly-awake protocol', () => {
  const result = parseSuuntoSleep([{ timestamp: '2026-10-20T22:00:00Z', entryData: { BedtimeStart: '2026-10-20T22:00:00Z', BedtimeEnd: '2026-10-21T06:00:00Z', Duration: 28800.1, AvgHRV: 48.125, HRAvg: 52, HRMin: 44, IsNap: false } }, { timestamp: '2026-10-21T13:00:00Z', entryData: { BedtimeStart: '2026-10-21T13:00:00Z', BedtimeEnd: '2026-10-21T14:00:00Z', Duration: 3600, IsNap: true } }], ACCOUNT, AT)
  assert.equal(result.health.filter(x => x.metric === 'SLEEP').length, 2)
  assert.equal(result.health.find(x => x.metric === 'HRV')?.value, 48.125)
  assert.equal(result.health.find(x => x.metric === 'HRV')?.hrvMethod, 'UNSPECIFIED')
  assert.ok(result.health.filter(x => x.metric === 'SLEEP').every(x => x.observation?.statistic.includes('含清醒')))
  assert.ok(!result.health.some(x => x.metric === 'RHR' || x.metric === 'READINESS'))
  assert.notEqual(result.health[0].key, result.health.at(-1)?.key)
})

test('unknown payload shapes are marked incomplete and never silently represented as an empty success', () => {
  assert.ok(parseSuuntoWorkouts({ success: true, items: [] }, ACCOUNT, AT).issues.length)
  assert.ok(parsePolarExercises({ error: 'oops' }, ACCOUNT, AT).issues.length)
  assert.ok(parsePolarNights({}, ACCOUNT, AT).issues.length)
  assert.ok(parseSuuntoSteps({ result: [] }, ACCOUNT, AT).issues.length)
})

test('Suunto supplied SleepId is retained instead of merging different source records with the same time', () => {
  const segment = { BedtimeStart: '2026-10-20T22:00:00Z', BedtimeEnd: '2026-10-21T06:00:00Z', Duration: 28800, IsNap: false }
  const result = parseSuuntoSleep([{ entryData: { ...segment, SleepId: 123 } }, { entryData: { ...segment, SleepId: '124' } }], ACCOUNT, AT)
  assert.equal(result.health.length, 2)
  assert.ok(result.health[0].key.endsWith(':123'))
  assert.ok(result.health[1].key.endsWith(':124'))
})
