import test from 'node:test'
import assert from 'node:assert/strict'
import * as format from './activity-format.ts'
import { deviceRunFacts, type DeviceRun } from './plan400-components.ts'

test('activity and lap clocks retain fractional seconds instead of rounding short repetitions to whole seconds', () => {
  const cases: [number, string][] = [[12.34, '0:12.34'], [12.3, '0:12.3'], [45.08, '0:45.08'], [119.6, '1:59.6'], [1897.6, '31:37.6']]
  for (const [seconds, expected] of cases) assert.equal(format.fmtDurationPrecise(seconds), expected)
})

test('fractional clock carry never displays 60 seconds or loses the hour boundary', () => {
  const cases: [number, string][] = [[59.994, '0:59.99'], [59.995, '1:00'], [3599.99, '59:59.99'], [3599.999, '1:00:00'], [3725.12, '1:02:05.12']]
  for (const [seconds, expected] of cases) assert.equal(format.fmtDurationPrecise(seconds), expected)
})

test('whole-second sources and missing measurements do not gain invented fractional precision', () => {
  assert.equal(format.fmtDurationPrecise(12), '0:12')
  assert.equal(format.fmtDurationPrecise(0), '0:00')
  assert.equal(format.fmtDurationPrecise(3725), '1:02:05')
  for (const value of [null, undefined, NaN, Infinity, -1]) assert.equal(format.fmtDurationPrecise(value), '—')
})

test('seconds-labelled interval readouts keep the source fraction and distinguish seconds from minutes', () => {
  const secondsLabel = (format as typeof format & { fmtSeconds?: (value: number | null | undefined) => string }).fmtSeconds
  const cases: [number | null | undefined, string][] = [[12.34, '12.34 秒'], [12.3, '12.3 秒'], [45, '45 秒'], [60.1, '60.1 秒'], [0, '0 秒'], [null, '—'], [undefined, '—'], [-1, '—']]
  for (const [seconds, expected] of cases) assert.equal(secondsLabel?.(seconds), expected)
})

test('pace remains a separate seconds-per-kilometre formatter with proper carry', () => {
  assert.equal(format.fmtPaceSec(299.6), '5\'00"/km')
  assert.equal(format.fmtPace(200, 31.24), '2\'36"/km')
})

test('existing coach and fact format remains unchanged by the UI-specific clock', () => {
  assert.equal(format.fmtDuration(1897.6), '31:38')
  assert.equal(format.fmtDurationPrecise(1897.6), '31:37.6')
})

test('plan device summary opts into precise display without changing its default or source record', () => {
  const run: DeviceRun = { id: 'qa-timing', source: 'garmin', sourceLabel: '佳明账号同步', startedAt: '2026-10-21T04:00:00Z', distanceM: 400, durationSec: 62.345, avgHr: 160, title: '本地测试' }
  const before = JSON.stringify(run)
  assert.ok(deviceRunFacts(run).includes('用时 1:02'))
  assert.ok(deviceRunFacts(run, format.fmtDurationPrecise).includes('用时 1:02.35'))
  assert.equal(JSON.stringify(run), before)
})
