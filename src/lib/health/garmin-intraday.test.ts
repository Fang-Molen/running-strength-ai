import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIntradayDay, parseBodyBattery, parseHeartRate, summarizeDay, intradayContextLine, clock, minuteOfDay, tidy } from './garmin-intraday'
import { fixtureHeartRate, fixtureStress, fixtureSleep } from './garmin-intraday.fixture'
import { saveIntraday, loadIntraday, intradayComplete, KEEP_DAYS } from './intraday-store'
import { setStoreBackend } from '../core/storage'
import { setEventContext } from '../core/events'
import { runGarminSyncJob, type GarminReply } from './garmin-sync-runner'
import { readRecoveryContext, recoveryContextLines } from '../core/coach-recovery-context'
const ok = (body: unknown): GarminReply => ({ status: 200, body })
const D = '2026-10-20'
function mem() { const m = new Map<string, string>(); return { keys: () => [...m.keys()], getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } } }
test.afterEach(() => { setStoreBackend(null); setEventContext({ athleteId: 'local' }) })

test('heart rate: drops null samples, keeps timestamps, resting HR, device offset', () => {
  const r = parseHeartRate(D, ok(fixtureHeartRate(D)))!
  assert.ok(r.hr.length > 600 && r.hr.length <= 720); assert.ok(r.hr.every(([t, v]) => Number.isFinite(t) && v >= 25))
  assert.equal(r.restingHr, 49); assert.equal(r.offsetMin, 480)
  assert.equal(clock(r.hr[0][0], r.offsetMin), '00:02'); assert.equal(minuteOfDay(r.hr[0][0], D, r.offsetMin), 2) // 00:00 样本为 null，已丢弃
})
test('body battery: level read via descriptor list (index 2), not the status column', () => {
  const r = parseBodyBattery(D, ok(fixtureStress(D)))!
  assert.ok(r.bb.length > 400); assert.ok(r.bb.every(([, v]) => v >= 0 && v <= 100))
  // [ts, level] 两列格式（bodyBattery/reports/daily 形状）也能读
  const two = parseBodyBattery(D, ok({ calendarDate: D, bodyBatteryValuesArray: [[1, 65], [2, 66]] }))!
  assert.deepEqual(two.bb, [[1, 65], [2, 66]])
})
test('single-source date rule: calendarDate mismatch or missing → whole day rejected, reported', () => {
  const f: string[] = []
  assert.equal(parseHeartRate(D, ok({ ...fixtureHeartRate(D), calendarDate: '2026-10-19' }), f), null)
  assert.equal(parseBodyBattery(D, ok({ bodyBatteryValuesArray: [[1, 50, 50]] }), f), null)
  assert.equal(f.length, 2); assert.ok(f.every(x => x.includes('日期')))
  assert.equal(buildIntradayDay({ day: D, now: D + 'T12:00:00Z', hr: { status: 204, body: null }, stress: ok({}) }).day, null)
})
test('day build: sleep span + training shading from activities; summary is not permission', () => {
  const { day } = buildIntradayDay({ day: D, now: D + 'T12:00:00Z', hr: ok(fixtureHeartRate(D)), stress: ok(fixtureStress(D)), sleep: ok(fixtureSleep(D)),
    activities: [{ startIso: '2026-10-20T10:00:00.000Z', durationSec: 2700, sportLabel: '跑步' }, { startIso: '2026-10-10T10:00:00.000Z', durationSec: 600, sportLabel: '跑步' }] })
  assert.ok(day); assert.ok(day!.sleep); assert.equal(day!.training.length, 1)
  const s = summarizeDay(day)!; assert.equal(s.authorizedToTrain, false); assert.ok(s.bb!.max >= s.bb!.min)
  const line = intradayContextLine(s)!; assert.match(line, /身体电量 最低\d+ 最高\d+ 最新\d+/); assert.match(line, /静息心率 49/); assert.match(line, /不是训练许可/)
})
test('tidy is bounded and ordered', () => {
  const rows = Array.from({ length: 3000 }, (_, i) => [3000 - i, i] as [number, number]); const t = tidy(rows)
  assert.ok(t.length <= 720); assert.ok(t.every((p, i) => !i || p[0] > t[i - 1][0]))
})
test('store: per athlete, newest 28 days kept (v89.1), old days compacted, completeness needs samples + local day end', () => {
  setStoreBackend(mem()); setEventContext({ athleteId: 'local' })
  const days = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)
  for (const d of days) saveIntraday([buildIntradayDay({ day: d, now: new Date(Date.parse(d + 'T20:00:00Z') + 864e5).toISOString(), hr: ok(fixtureHeartRate(d)), stress: ok(fixtureStress(d)) }).day!])
  const all = loadIntraday(); assert.equal(Object.keys(all).length, KEEP_DAYS); assert.ok(!all['2026-10-03'] && all['2026-10-04'] && all['2026-10-31'])
  assert.ok(all['2026-10-10'].hr.length <= 288 && all['2026-10-31'].hr.length > 288, 'older days compacted, recent days full')
  assert.equal(intradayComplete('2026-10-30'), true)
  saveIntraday([buildIntradayDay({ day: '2026-10-31', now: '2026-10-31T02:00:00Z', hr: ok(fixtureHeartRate('2026-10-31', 2)), stress: ok(fixtureStress('2026-10-31', 2)) }).day!])
  assert.equal(intradayComplete('2026-10-31'), true, 'late older fetch cannot roll back an already complete day')
  // A genuinely first, unfinished day must still be re-fetched.
  saveIntraday([buildIntradayDay({ day: '2026-11-01', now: '2026-11-01T02:00:00Z', hr: ok(fixtureHeartRate('2026-11-01', 2)), stress: ok(fixtureStress('2026-11-01', 2)) }).day!])
  assert.equal(intradayComplete('2026-11-01'), false, 'first fetch before day end remains incomplete')
  assert.deepEqual(loadIntraday('other'), {})
})
test('sync runner: fetches dailyHeartRate/dailyStress for recent days only, saves after fence, failures non-fatal', async () => {
  const paths: string[] = [], saved: any[] = []
  const api = async (p: string): Promise<GarminReply> => {
    paths.push(p)
    if (p === 'status') return ok({ loggedIn: true, region: 'cn', profile: { displayName: 'synthetic-user' } })
    if (p.includes('activities/search')) return ok([])
    const day = p.match(/\d{4}-\d{2}-\d{2}/)![0]
    if (p.includes('dailyHeartRate')) return day === '2026-10-19' ? { status: 500, body: {} } : ok(fixtureHeartRate(day, 3))
    if (p.includes('dailyStress')) return ok(fixtureStress(day, 3))
    return ok({ calendarDate: day, hrvSummary: { calendarDate: day, lastNightAvg: 60 }, dailySleepDTO: { calendarDate: day, sleepTimeSeconds: 23400 } })
  }
  const r = await runGarminSyncJob({ api, subject: () => 'synthetic', generation: () => 0, bindAccount: () => true, day: D, now: D + 'T12:00:00Z',
    save: (h, a) => ({ saved: h.length + a.length, skipped: 0, errors: [] }), saveView: () => {}, report: () => {}, progress: () => {},
    intraday: { complete: d => d < '2026-10-16', save: days => { saved.push(...days); return days.length } }, sleep: async () => {} })
  assert.equal(r.status, 'ok')
  const hrDays = paths.filter(p => p.includes('dailyHeartRate')).map(p => p.match(/\d{4}-\d{2}-\d{2}/)![0])
  assert.deepEqual(hrDays, ['2026-10-20', '2026-10-19', '2026-10-18', '2026-10-17', '2026-10-16'])
  assert.ok(paths.some(p => p === 'g/wellness-service/wellness/dailyHeartRate/synthetic-user?date=2026-10-20'))
  assert.ok(paths.some(p => p === 'g/wellness-service/wellness/dailyStress/2026-10-20'))
  assert.equal(saved.length, 5); assert.equal(saved.find(d => d.day === '2026-10-19').hr.length, 0)
})
test('no intraday host → no extra Garmin calls (existing sync unchanged)', async () => {
  const paths: string[] = []
  await runGarminSyncJob({ api: async p => { paths.push(p); if (p === 'status') return ok({ loggedIn: true, region: 'cn', profile: { displayName: 'u' } }); if (p.includes('activities')) return ok([]); return ok({}) },
    subject: () => 's', generation: () => 0, bindAccount: () => true, day: D, now: D + 'T12:00:00Z', save: () => ({ saved: 0, skipped: 0, errors: [] }), saveView: () => {}, report: () => {}, progress: () => {} })
  assert.ok(!paths.some(p => /dailyHeartRate|dailyStress/.test(p)))
})
test('local coach recovery context reads intraday summary only after it was synced', () => {
  setStoreBackend(mem()); setEventContext({ athleteId: 'local' })
  saveIntraday([buildIntradayDay({ day: D, now: D + 'T10:00:00Z', hr: ok(fixtureHeartRate(D, 12)), stress: ok(fixtureStress(D, 12)) }).day!])
  const before = readRecoveryContext('local', D, D + 'T09:00:00Z')!, after = readRecoveryContext('local', D, D + 'T11:00:00Z')!
  assert.equal(before.device, undefined)
  assert.ok(recoveryContextLines(after).some(x => x.includes('身体电量') && x.includes('不是训练许可')))
  assert.equal(after.planWrite, false)
})
test('v89 stress: stressValuesArray parsed, negative (no reading) dropped, optional on old days', () => {
  const r = parseBodyBattery(D, ok({ calendarDate: D, bodyBatteryValuesArray: [[1, 'M', 60, 2]], stressValuesArray: [[1, 25], [2, -1], [3, -2], [4, 80]] }))!
  assert.deepEqual(r.st, [[1, 25], [4, 80]])
  assert.equal(summarizeDay({ schemaVersion: 1, day: D, source: 'garmin', fetchedAt: D + 'T12:00:00Z', offsetMin: 480, hr: [], bb: [], restingHr: null, sleep: null, training: [] })!.st, null)
})

test('v89.1 runner: empty intraday history → 28 days requested (incl. days outside the 14-day daily window); 429 stops intraday only', async () => {
  const mk = (limitAfter: number) => { const paths: string[] = []; let hr = 0
    const api = async (p: string): Promise<GarminReply> => { paths.push(p)
      if (p === 'status') return ok({ loggedIn: true, region: 'cn', profile: { displayName: 'synthetic-user' } })
      if (p.includes('activities/search')) return ok([])
      const day = p.match(/\d{4}-\d{2}-\d{2}/)![0]
      if (p.includes('dailyHeartRate')) { hr++; return hr > limitAfter ? { status: 429, body: {} } : ok(fixtureHeartRate(day, 2)) }
      if (p.includes('dailyStress')) return ok(fixtureStress(day, 2))
      return ok({ calendarDate: day, hrvSummary: { calendarDate: day, lastNightAvg: 60 }, dailySleepDTO: { calendarDate: day, sleepTimeSeconds: 23400 } }) }
    return { paths, api } }
  const run = (api: (p: string) => Promise<GarminReply>, saved: any[]) => runGarminSyncJob({ api, subject: () => 'synthetic', generation: () => 0, bindAccount: () => true, day: D, now: D + 'T12:00:00Z',
    save: (h, a) => ({ saved: h.length + a.length, skipped: 0, errors: [] }), saveView: () => {}, report: () => {}, progress: () => {},
    backfill: { get: () => 90, set: () => {} }, sleep: async () => {}, intraday: { complete: () => false, save: days => { saved.push(...days); return days.length } } })
  const a = mk(1e9), sa: any[] = [], r = await run(a.api, sa)
  assert.equal(r.status, 'ok'); assert.equal(new Set(a.paths.filter(p => p.includes('dailyHeartRate')).map(p => p.match(/\d{4}-\d{2}-\d{2}/)![0])).size, 28)
  assert.equal(sa.length, 28); assert.equal(r.intraday!.saved, 28); assert.deepEqual(r.intraday!.failed, [])
  const b = mk(3), sb: any[] = [], r2 = await run(b.api, sb)
  assert.equal(r2.status, 'ok', 'daily summaries unaffected'); assert.equal(r2.intraday!.throttled, true); assert.ok(r2.intraday!.failed.some(f => /429/.test(f)))
  assert.ok(b.paths.filter(p => p.includes('dailyHeartRate')).length <= 5)
})
