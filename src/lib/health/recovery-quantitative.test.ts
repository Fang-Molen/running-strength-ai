import assert from 'node:assert/strict'
import test from 'node:test'
import { quantifyRecoverySnapshot } from './recovery-quantitative'
import type { HealthMetricView, HealthPoint, HealthSnapshot } from './snapshot'

const day = '2026-10-18', asOf = '2026-10-18T12:00:00Z', athleteId = 'synthetic-athlete'
const point = (metric: string, date: string, value: number, changes: Partial<HealthPoint> = {}): HealthPoint => ({
  id: `${metric}:${date}`, metric, day: date, value, source: '合成设备 A', stream: `watch-a|daily|${metric === 'HRV' ? 'RMSSD' : ''}`,
  statistic: 'daily', method: metric === 'HRV' ? 'RMSSD' : '', updatedAt: `${date}T08:00:00Z`, measuredAt: null, legacy: false, ...changes,
})
const view = (metric: string, current: HealthPoint | null, series: HealthPoint[] = [], changes: Partial<HealthMetricView> = {}): HealthMetricView => ({
  metric, label: metric, state: current ? 'AVAILABLE' : 'MISSING', current, candidates: current ? [current] : [],
  series: [...series, ...(current ? [current] : [])], availableSources: [], selectedSource: null, baseline: null, notes: [], ...changes,
})
const history = (metric: string, values: number[], changes: Partial<HealthPoint> = {}) => values.map((value, i) => point(metric, `2026-10-${String(11 + i).padStart(2, '0')}`, value, changes))
const snapshot = (metrics: HealthMetricView[]): HealthSnapshot => ({ asOf: day, metrics, unreadable: false })
const quantify = (snap: HealthSnapshot, time = asOf) => quantifyRecoverySnapshot({ snapshot: snap, athleteId, asOf: time })
const rhrView = () => view('RHR', point('RHR', day, 57), history('RHR', [48, 49, 50, 51, 52, 53, 54]))
const hrvView = () => view('HRV', point('HRV', day, 60), history('HRV', [40, 45, 50, 55, 60, 65, 70]))
const result = (snap: HealthSnapshot, ruleId: string) => quantify(snap).calculations.find(r => r.ruleId === ruleId)!

test('raw sleep and same-source RHR use actual values and the existing median formula', () => {
  const out = quantify(snapshot([view('SLEEP', point('SLEEP', day, 7.5)), rhrView()]))
  assert.equal(out.facts.find(f => f.metric === 'SLEEP')?.value, 7.5)
  assert.equal(out.calculations.find(r => r.ruleId === 'REC_SLEEP')?.value, 7.5)
  const rhr = out.calculations.find(r => r.ruleId === 'FAT_RHR')!
  assert.equal(rhr.status, 'AVAILABLE'); assert.equal(rhr.value, 6)
  assert.equal(rhr.metrics.baselineMedian, 51); assert.equal(rhr.metrics.baselineSamples, 7)
  assert.match(out.facts.find(f => f.metric === 'FAT_RHR')!.text, /51 bpm.*\+6 bpm/)
  assert.equal(out.decisionAuthorized, false)
  assert.ok(out.calculations.every(r => !r.decisionAuthorized && !r.medicalClearance && !r.planWrite))
})

test('lnRMSSD change and sample CV match independently computed synthetic results', () => {
  const out = quantify(snapshot([hrvView()]))
  const logs = [40, 45, 50, 55, 60, 65, 70].map(Math.log), mean = logs.reduce((s, x) => s + x, 0) / 7
  const sampleSd = Math.sqrt(logs.reduce((s, x) => s + (x - mean) ** 2, 0) / 6)
  const delta = out.calculations.find(r => r.ruleId === 'FAT_HRV')!, cv = out.calculations.find(r => r.ruleId === 'FAT_HRV_CV')!
  assert.equal(delta.status, 'AVAILABLE'); assert.ok(Math.abs(delta.value! - (Math.log(60) - mean)) < 1e-12)
  assert.equal(cv.status, 'AVAILABLE'); assert.ok(Math.abs(cv.value! - 100 * sampleSd / mean) < 1e-12)
  assert.equal(cv.validSamples, 7); assert.ok(out.facts.some(f => f.metric === 'FAT_HRV_CV' && f.unit === '%'))
})

test('five personal record days are sufficient for the original median and ln baseline; four are not', () => {
  for (const metric of ['RHR', 'HRV']) for (const count of [4, 5]) {
    const rule = metric === 'RHR' ? 'FAT_RHR' : 'FAT_HRV'
    const r = result(snapshot([view(metric, point(metric, day, 55), history(metric, [45, 46, 47, 48, 49].slice(0, count)))]), rule)
    assert.equal(r.status, count === 5 ? 'AVAILABLE' : 'UNAVAILABLE')
    if (count === 4) assert.ok(r.missing.includes('BASELINE_INSUFFICIENT_OR_NOT_PRIOR'))
  }
})

test('seven-day CV requires all seven days and never invents missing values', () => {
  const hrv = hrvView(); hrv.series = hrv.series.filter(p => p.day !== '2026-10-14')
  const out = quantify(snapshot([hrv]))
  assert.equal(out.calculations.find(r => r.ruleId === 'FAT_HRV')?.status, 'AVAILABLE')
  assert.equal(out.calculations.find(r => r.ruleId === 'FAT_HRV_CV')?.status, 'UNAVAILABLE')
  assert.equal(out.facts.find(f => f.metric === 'FAT_HRV_CV'), undefined)
})

test('partial data retain available facts and explicitly identify unavailable calculations', () => {
  const out = quantify(snapshot([view('SLEEP', point('SLEEP', day, 6.25))]))
  assert.equal(out.facts.length, 1); assert.equal(out.facts[0].value, 6.25)
  assert.equal(out.calculations.length, 4)
  assert.equal(out.calculations.filter(r => r.status === 'UNAVAILABLE').length, 3)
  assert.ok(out.missing.some(m => m.includes('UNAVAILABLE')))
  assert.ok(out.facts.every(f => f.sourceIds.length > 0 && f.unit))
})

test('unknown HRV algorithm and SDNN retain raw milliseconds without using RMSSD formulas', () => {
  for (const method of ['', 'UNSPECIFIED', 'SDNN']) {
    const current = point('HRV', day, 60, { method })
    const out = quantify(snapshot([view('HRV', current, history('HRV', [45, 46, 47, 48, 49, 50, 51], { method }))]))
    assert.equal(out.facts.find(f => f.metric === 'HRV')?.value, 60)
    assert.ok(out.calculations.filter(r => r.ruleId.startsWith('FAT_HRV')).every(r => r.status === 'UNAVAILABLE'))
  }
})

test('unknown statistic or legacy metadata allows raw display but prevents invented personal comparability', () => {
  for (const changes of [{ statistic: '统计口径未提供' }, { legacy: true }, { statistic: '' }]) {
    const out = quantify(snapshot([view('RHR', point('RHR', day, 60, changes), history('RHR', [45, 46, 47, 48, 49, 50, 51], changes))]))
    assert.equal(out.facts.find(f => f.metric === 'RHR')?.value, 60)
    assert.equal(out.calculations.find(r => r.ruleId === 'FAT_RHR')?.status, 'UNAVAILABLE')
  }
})

test('device stream, statistic and algorithm differences cannot create a five-day baseline', () => {
  for (const changes of [{ stream: 'watch-b|daily|' }, { statistic: 'night-average' }, { method: 'different' }, { source: '合成设备 B' }]) {
    const h = history('RHR', [45, 46, 47, 48], changes)
    h.push(point('RHR', '2026-10-17', 50))
    assert.equal(result(snapshot([view('RHR', point('RHR', day, 60), h)]), 'FAT_RHR').status, 'UNAVAILABLE')
  }
})

test('only previous seven calendar days are used; older history cannot fill missing days', () => {
  const h = history('RHR', [45, 46, 47, 48]); h.push(point('RHR', '2026-10-10', 49))
  assert.equal(result(snapshot([view('RHR', point('RHR', day, 60), h)]), 'FAT_RHR').status, 'UNAVAILABLE')
})

test('independent conflict on one historical day is excluded without averaging; duplicate same-value records do not increase samples', () => {
  const v = rhrView()
  v.series.push(point('RHR', '2026-10-12', 100, { id: 'independent-conflict' }))
  v.series.push(point('RHR', '2026-10-13', 50, { id: 'duplicate-value' }))
  const out = quantify(snapshot([v])), r = out.calculations.find(r => r.ruleId === 'FAT_RHR')!
  assert.equal(r.status, 'AVAILABLE'); assert.equal(r.metrics.baselineSamples, 6)
  assert.equal(r.metrics.baselineMedian, 51.5)
  assert.ok(out.missing.some(m => m.includes('2026-10-12') && m.includes('冲突')))
})

test('current-day source conflicts and conflicting reused observation IDs never choose an arbitrary value', () => {
  for (const second of [point('RHR', day, 90, { id: 'independent' }), point('RHR', day, 90)]) {
    const v = rhrView(); v.candidates.push(second)
    const out = quantify(snapshot([v]))
    assert.equal(out.facts.some(f => f.metric === 'RHR'), false)
    assert.equal(out.calculations.find(r => r.ruleId === 'FAT_RHR')?.status, 'UNAVAILABLE')
  }
})

test('an explicit selected source does not switch to another device when the selected source is missing', () => {
  const v = rhrView(); v.selectedSource = 'missing-source'
  assert.equal(quantify(snapshot([v])).facts.length, 0)
})

test('future updates and missing knowledge times cannot enter current facts or a historical baseline', () => {
  for (const updatedAt of ['', '2026-10-18T13:00:00Z']) {
    const v = rhrView(); v.current = { ...v.current!, updatedAt }; v.candidates = [v.current]; v.series = v.series.filter(p => p.day !== day)
    const out = quantify(snapshot([v]))
    assert.equal(out.facts.some(f => f.metric === 'RHR'), false)
    const historical = rhrView(); historical.series = historical.series.map(p => p.day < day ? { ...p, updatedAt } : p)
    assert.equal(result(snapshot([historical]), 'FAT_RHR').status, 'UNAVAILABLE')
  }
})

test('a future correction cannot leak its numeric value through facts, provenance or revision', () => {
  const make = (value: number) => {
    const v = rhrView(); v.series.push(point('RHR', '2026-10-17', value, { id: 'future-secret', updatedAt: '2026-10-18T13:00:00Z' }))
    return quantify(snapshot([v]))
  }
  const a = make(98765), b = make(76543)
  assert.equal(a.revision, b.revision); assert.doesNotMatch(JSON.stringify(a), /98765|future-secret/)
  assert.equal(a.calculations.find(r => r.ruleId === 'FAT_RHR')?.value, 6)
})

test('as-of replay does not reuse a later correction; a known earlier observation remains eligible', () => {
  const v = rhrView()
  v.series.push(point('RHR', day, 99, { updatedAt: '2026-10-18T14:00:00Z' }))
  assert.equal(quantify(snapshot([v])).facts.find(f => f.metric === 'RHR')?.value, 57)
  assert.equal(quantify(snapshot([v]), '2026-10-18T15:00:00Z').facts.find(f => f.metric === 'RHR')?.value, 99)
})

test('revision changes when a known baseline member is corrected even if the median is unchanged', () => {
  const a = rhrView(), b = rhrView(); b.series[0] = { ...b.series[0], value: 47, updatedAt: '2026-10-18T09:00:00Z' }
  const first = quantify(snapshot([a])), second = quantify(snapshot([b]))
  assert.notEqual(first.revision, second.revision)
  assert.equal(first.calculations.find(r => r.ruleId === 'FAT_RHR')?.value, second.calculations.find(r => r.ruleId === 'FAT_RHR')?.value)
  assert.ok(second.sourceIds.includes('RHR:2026-10-11'))
})

test('refreshing analysis time alone does not invalidate an unchanged evidence revision', () => {
  const snap = snapshot([rhrView(), hrvView()])
  const a = quantify(snap), b = quantify(snap, '2026-10-18T12:30:00Z')
  assert.notEqual(a.asOf, b.asOf); assert.equal(a.revision, b.revision)
})

test('a later cutoff changes revision only when a new observation actually becomes known', () => {
  const v = rhrView(); v.series.push(point('RHR', day, 61, { updatedAt: '2026-10-18T14:00:00Z' }))
  const snap = snapshot([v])
  const a = quantify(snap), b = quantify(snap, '2026-10-18T13:00:00Z'), c = quantify(snap, '2026-10-18T15:00:00Z')
  assert.equal(a.revision, b.revision); assert.notEqual(b.revision, c.revision)
  assert.equal(c.facts.find(f => f.metric === 'RHR')?.value, 61)
})

test('explicit device and measurement-method metadata remain separate even with a reused source stream', () => {
  for (const changes of [{ deviceLabel: 'watch-b' }, { measurementMethod: 'night' }]) {
    const current = { ...point('RHR', day, 60), deviceLabel: 'watch-a', measurementMethod: 'morning' }
    const prior = history('RHR', [45, 46, 47, 48, 49, 50, 51]).map(p => ({ ...p, deviceLabel: 'watch-a', measurementMethod: 'morning', ...changes }))
    const out = quantify(snapshot([view('RHR', current, prior)]))
    assert.equal(out.facts.find(f => f.metric === 'RHR')?.value, 60)
    assert.equal(out.calculations.find(r => r.ruleId === 'FAT_RHR')?.status, 'UNAVAILABLE')
  }
})

test('stale current values and future-day entries cannot masquerade as same-day recovery', () => {
  for (const date of ['2026-10-17', '2026-10-19']) {
    const out = quantify(snapshot([view('RHR', point('RHR', date, 55))]))
    assert.equal(out.facts.length, 0)
  }
})

test('measurement time after analysis or after recorded-at is rejected rather than replaced by import time', () => {
  for (const measuredAt of ['2026-10-18T13:00:00Z', '2026-10-18T09:00:00Z', 'bad-time']) {
    const out = quantify(snapshot([view('RHR', point('RHR', day, 55, { measuredAt }))]))
    assert.equal(out.facts.length, 0)
  }
})

test('a day-boundary timestamp is explicitly non-measurement precision and respects the analysis timezone', () => {
  const p = point('RHR', day, 55, { updatedAt: '2026-10-18T00:30:00+08:00' })
  const out = quantify(snapshot([view('RHR', p)]), '2026-10-18T01:00:00+08:00')
  assert.equal(out.facts.find(f => f.metric === 'RHR')?.value, 55)
  assert.ok(out.limitations.some(l => l.includes('不代表实际测量时刻')))
})

test('explicit UTC+8 calendar accepts morning data while the asOf ISO instant is still on the previous UTC day', () => {
  const p = point('SLEEP', day, 7.5, { updatedAt: '2026-10-17T22:00:00Z' })
  const snap = snapshot([view('SLEEP', p)]), instant = '2026-10-17T23:00:00Z'
  const out = quantifyRecoverySnapshot({ snapshot: snap, athleteId, asOf: instant, calendarOffsetMinutes: 480 })
  assert.equal(out.asOf, instant); assert.equal(out.day, day)
  assert.equal(out.calculations.find(r => r.ruleId === 'REC_SLEEP')?.value, 7.5)
  assert.equal(out.facts.find(f => f.metric === 'SLEEP')?.value, 7.5)
  const equivalent = quantify(snap, '2026-10-18T07:00:00+08:00')
  assert.equal(out.revision, equivalent.revision)
  assert.equal(quantify(snap, instant).facts.length, 0)
})

test('explicit negative calendar offset keeps the previous local day and rejects the next local day', () => {
  const instant = '2026-10-18T02:00:00Z', previous = '2026-10-17'
  const p = point('SLEEP', previous, 8, { updatedAt: '2026-10-18T01:00:00Z' })
  const snap = { ...snapshot([view('SLEEP', p)]), asOf: previous }
  const out = quantifyRecoverySnapshot({ snapshot: snap, athleteId, asOf: instant, calendarOffsetMinutes: -300 })
  assert.equal(out.asOf, instant); assert.equal(out.day, previous)
  assert.equal(out.calculations.find(r => r.ruleId === 'REC_SLEEP')?.value, 8)
  const future = quantifyRecoverySnapshot({ snapshot: snapshot([view('SLEEP', point('SLEEP', day, 8, { updatedAt: '2026-10-18T01:00:00Z' }))]), athleteId, asOf: instant, calendarOffsetMinutes: -300 })
  assert.equal(future.facts.length, 0)
  assert.match(future.missing.join(''), /ASOF_OR_ATHLETE_INVALID/)
})

test('explicit calendar offsets validate finite whole minutes and support half-hour timezones', () => {
  for (const calendarOffsetMinutes of [NaN, Infinity, -841, 841, 480.5]) {
    const out = quantifyRecoverySnapshot({ snapshot: snapshot([rhrView()]), athleteId, asOf, calendarOffsetMinutes })
    assert.equal(out.facts.length, 0)
    assert.match(out.missing.join(''), /ASOF_OR_ATHLETE_INVALID/)
  }
  const p = point('SLEEP', day, 8, { updatedAt: '2026-10-17T19:00:00Z' })
  const out = quantifyRecoverySnapshot({ snapshot: snapshot([view('SLEEP', p)]), athleteId, asOf: '2026-10-17T20:00:00Z', calendarOffsetMinutes: 330 })
  assert.equal(out.calculations.find(r => r.ruleId === 'REC_SLEEP')?.value, 8)
  assert.ok(out.limitations.some(l => l.includes('夏令时')))
})

test('a positive calendar offset never admits knowledge after the actual asOf instant', () => {
  const p = point('SLEEP', day, 8, { updatedAt: '2026-10-17T23:30:00Z' })
  const out = quantifyRecoverySnapshot({ snapshot: snapshot([view('SLEEP', p)]), athleteId, asOf: '2026-10-17T23:00:00Z', calendarOffsetMinutes: 480 })
  assert.equal(out.facts.length, 0)
  assert.ok(out.missing.some(m => m.includes('之后录入')))
})

test('self-reported sleep range stays labelled as a representative value and cannot become exact sleep hours', () => {
  const p = point('SLEEP', day, 7, { stream: 'self:sleep-range', source: '主观打卡', statistic: '自报睡眠区间代表值（非精确测量）' })
  const out = quantify(snapshot([view('SLEEP', p)]))
  assert.equal(out.facts[0].quality, 'SELF_REPORT_RANGE'); assert.match(out.facts[0].text, /非精确测量/)
  assert.equal(out.calculations.find(r => r.ruleId === 'REC_SLEEP')?.status, 'UNAVAILABLE')
})

test('unreadable snapshots fail closed instead of deriving a conclusion from readable fragments', () => {
  const out = quantify({ ...snapshot([rhrView(), hrvView()]), unreadable: true })
  assert.equal(out.facts.length, 0); assert.equal(out.sourceIds.length, 0)
  assert.ok(out.calculations.every(r => r.status === 'UNAVAILABLE'))
  assert.match(out.missing[0], /UNREADABLE/)
})

test('invalid analysis dates and values do not manufacture zero-valued measurements', () => {
  for (const time of ['invalid', '2026-10-17T12:00:00Z', '2026-10-18']) assert.equal(quantify(snapshot([rhrView()]), time).facts.length, 0)
  for (const value of [NaN, Infinity, -1, 25]) assert.equal(quantify(snapshot([view('SLEEP', point('SLEEP', day, value))])).facts.length, 0)
  assert.equal(quantify(snapshot([view('RHR', point('RHR', day, 0))])).facts.length, 0)
})

test('the adapter is deterministic and does not mutate frozen inputs, access storage or request network', () => {
  const snap = snapshot([rhrView(), hrvView()])
  const freeze = (value: unknown) => { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child) } }
  freeze(snap)
  const oldFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  try {
    globalThis.fetch = (() => { throw Error('network forbidden') }) as typeof fetch
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw Error('storage forbidden') } })
    assert.deepEqual(quantify(snap), quantify(snap))
  } finally {
    globalThis.fetch = oldFetch
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})
