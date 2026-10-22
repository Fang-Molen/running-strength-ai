import test from 'node:test'
import assert from 'node:assert/strict'
import { runGarminSyncJob, type GarminReply, type GarminSyncReport } from './garmin-sync-runner'
import { fixtureHeartRate, fixtureStress } from './garmin-intraday.fixture'
import { shiftDay } from './observation'

const DAY = '2026-10-18', NOW = DAY + 'T12:00:00Z'
const ok = (body: unknown): GarminReply => ({ status: 200, body })
const dayOf = (path: string) => path.match(/\d{4}-\d{2}-\d{2}/)?.[0]
const isDaily = (path: string) => /usersummary|hrv-service|dailySleepData/.test(path)
type Host = Parameters<typeof runGarminSyncJob>[0]

/** In-memory service responses only: no fetch, application stores, or real user data. */
function fixture() {
  let cursor = 14, fullReview: string | null = null, active = 0, peak = 0, subject = 'synthetic'
  const paths: string[] = [], waits: number[] = [], reports: GarminSyncReport[] = []
  const saves: { health: Parameters<Host['save']>[0]; activities: Parameters<Host['save']>[1]; lastPath: string | undefined }[] = []
  const intradaySaved: string[] = [], fullMarks: string[] = []
  const base = (path: string): GarminReply => {
    if (path === 'status') return ok({ loggedIn: true, region: 'cn', profile: { displayName: 'synthetic-user' } })
    if (path.includes('activities/search')) return ok([])
    const day = dayOf(path)!
    if (path.includes('dailyHeartRate')) return ok(fixtureHeartRate(day, 2))
    if (path.includes('dailyStress')) return ok(fixtureStress(day, 2))
    return ok({ calendarDate: day, totalSteps: 0, bodyBatteryHighestValue: 0,
      hrvSummary: { calendarDate: day, lastNightAvg: 60 }, dailySleepDTO: { calendarDate: day, sleepTimeSeconds: 23400 } })
  }
  let reply = base
  const host: Host = {
    api: async path => {
      paths.push(path); active++; peak = Math.max(peak, active)
      await Promise.resolve()
      try { return reply(path) } finally { active-- }
    },
    subject: () => subject, generation: () => 0, day: DAY, now: NOW, bindAccount: () => true,
    save: (health, activities) => { saves.push({ health, activities, lastPath: paths.at(-1) }); return { saved: health.length + activities.length, skipped: 0, errors: [] } },
    saveView: () => {}, report: r => { reports.push(structuredClone(r)) }, progress: () => {},
    sleep: async ms => { waits.push(ms) }, reason: 'AUTO',
    backfill: { get: () => cursor, set: (_scope, upTo) => { cursor = upTo } },
    fullReview: { get: () => fullReview, set: (_scope, at) => { fullReview = at; fullMarks.push(at) } },
    intraday: { complete: () => false, save: days => { intradaySaved.push(...days.map(d => d.day)); return days.length } },
  }
  return { host, paths, waits, reports, saves, intradaySaved, fullMarks, base,
    setReply: (value: typeof base) => { reply = value }, cursor: () => cursor, peak: () => peak,
    setCursor: (value: number) => { cursor = value }, switchSubject: () => { subject = 'other' } }
}

test('initial import keeps all 90 daily and 28 intraday dates, with pauses only for older intraday requests', async () => {
  const f = fixture(), r = await runGarminSyncJob(f.host)
  assert.equal(r.mode, 'INITIAL'); assert.equal(r.status, 'ok')
  assert.equal(r.requests, 329); assert.equal(r.healthDaysRequested, 90); assert.equal(r.coverageDays.length, 90)
  assert.equal(f.paths.filter(p => p.includes('dailyHeartRate')).length, 28)
  assert.equal(f.intradaySaved.length, 28); assert.equal(f.cursor(), 90); assert.equal(f.fullMarks.length, 1)
  assert.equal(f.peak(), 5); assert.equal(f.saves[0].lastPath, 'status')
  assert.equal(f.waits.length, 26); assert.equal(f.waits.reduce((a, b) => a + b, 0), 9100)
  assert.ok(f.waits.every(ms => ms === 350))
})

test('initial import without missing old intraday days adds no artificial delay', async () => {
  const f = fixture(); f.host.intraday!.complete = () => true
  const r = await runGarminSyncJob(f.host)
  assert.equal(r.requests, 277); assert.equal(r.healthDaysRequested, 90)
  assert.deepEqual(f.waits, []); assert.equal(f.cursor(), 90)
})

for (const status of [0, 502, 503, 504]) {
  test(`two wholly unavailable days (HTTP ${status}) stop initial import without a full-review marker`, async () => {
    const f = fixture()
    f.setReply(p => p === 'status' || p.includes('activities/search') ? f.base(p) : { status, body: {} })
    const r = await runGarminSyncJob(f.host)
    assert.equal(r.status, 'fail'); assert.equal(r.healthDaysRequested, 2); assert.equal(r.requests, 13)
    assert.equal(f.paths.filter(isDaily).length, 6); assert.equal(f.paths.filter(p => p === 'status').length, 2)
    assert.deepEqual(r.coverageDays, []); assert.equal(r.saved, 0); assert.equal(f.cursor(), 14)
    assert.deepEqual(f.fullMarks, []); assert.deepEqual(f.intradaySaved, []); assert.deepEqual(f.waits, [])
    assert.ok(r.errors.some(e => /连续.*2.*暂停.*重试/.test(e))); assert.equal(f.reports.length, 1)
  })
}

test('outage after useful history saves only after the fence and resumes from the first unavailable day', async () => {
  const f = fixture(), firstMissing = shiftDay(DAY, -30)
  f.setReply(p => isDaily(p) && dayOf(p)! <= firstMissing ? { status: 503, body: {} } : f.base(p))
  const first = await runGarminSyncJob(f.host)
  assert.equal(first.status, 'partial'); assert.equal(first.healthDaysRequested, 32); assert.equal(first.requests, 155)
  assert.equal(first.coverageDays.length, 30); assert.equal(f.cursor(), 30); assert.deepEqual(f.fullMarks, [])
  assert.equal(f.saves.length, 1); assert.equal(f.saves[0].lastPath, 'status')
  assert.ok(f.saves[0].health.every(row => row.day > firstMissing))
  assert.equal(f.saves[0].health.find(row => row.metric === 'SLEEP')!.value, 6.5)
  assert.equal(f.saves[0].health.find(row => row.metric === 'BODY_BATTERY')!.value, 0)
  f.paths.length = 0; f.setReply(f.base)
  const retry = await runGarminSyncJob(f.host)
  const dailyDays = f.paths.filter(p => p.includes('usersummary')).map(dayOf)
  assert.equal(retry.status, 'ok'); assert.equal(retry.mode, 'INITIAL'); assert.equal(retry.healthDaysRequested, 74)
  assert.ok(dailyDays.includes(firstMissing)); assert.ok(!dailyDays.includes(shiftDay(DAY, -29)))
  assert.equal(f.cursor(), 90); assert.equal(f.fullMarks.length, 1)
})

test('an isolated unavailable day resets the consecutive counter but remains eligible for history retry', async () => {
  const f = fixture(), missing = new Set([shiftDay(DAY, -30), shiftDay(DAY, -32)])
  f.setReply(p => isDaily(p) && missing.has(dayOf(p)!) ? { status: 504, body: {} } : f.base(p))
  const r = await runGarminSyncJob(f.host)
  assert.equal(r.healthDaysRequested, 90); assert.equal(r.requests, 329); assert.equal(r.status, 'partial')
  assert.equal(f.cursor(), 30); assert.deepEqual(f.fullMarks, [])
  assert.ok(!r.errors.some(e => /连续.*2.*暂停/.test(e)))
})

test('an isolated recent-day outage keeps saved historical coverage and retries only the FULL recent window', async () => {
  const f = fixture()
  f.setReply(p => isDaily(p) && dayOf(p) === DAY ? { status: 503, body: {} } : f.base(p))
  const first = await runGarminSyncJob(f.host)
  assert.equal(first.mode, 'INITIAL'); assert.equal(first.status, 'partial'); assert.equal(first.healthDaysRequested, 90)
  assert.equal(first.coverageDays.length, 89); assert.equal(f.cursor(), 90); assert.deepEqual(f.fullMarks, [])
  f.paths.length = 0; f.setReply(f.base)
  const retry = await runGarminSyncJob(f.host)
  const dailyDays = f.paths.filter(p => p.includes('usersummary')).map(dayOf)
  assert.equal(retry.mode, 'FULL'); assert.equal(retry.status, 'ok'); assert.equal(retry.healthDaysRequested, 14)
  assert.ok(dailyDays.includes(DAY)); assert.ok(!dailyDays.includes(shiftDay(DAY, -14)))
  assert.equal(f.cursor(), 90); assert.equal(f.fullMarks.length, 1)
})

test('empty data, unsupported endpoints, and one unavailable metric do not stop history coverage', async () => {
  for (const kind of ['empty', '204', '404', 'single-timeout'] as const) {
    const f = fixture()
    f.setReply(p => !isDaily(p) ? f.base(p) : kind === 'single-timeout'
      ? p.includes('hrv-service') ? { status: 0, body: {} } : f.base(p)
      : kind === 'empty' ? ok({}) : { status: Number(kind), body: {} })
    const r = await runGarminSyncJob(f.host)
    assert.equal(r.healthDaysRequested, 90, kind); assert.equal(r.requests, 329, kind)
    assert.equal(f.cursor(), 90, kind); assert.equal(f.fullMarks.length, 1, kind)
    assert.ok(!r.errors.some(e => /连续.*2.*暂停/.test(e)), kind)
  }
})

test('daily outage skips extra intraday backfill outside the FULL daily window', async () => {
  const f = fixture(); f.setCursor(90)
  f.setReply(p => isDaily(p) ? { status: 0, body: {} } : f.base(p))
  const r = await runGarminSyncJob(f.host)
  assert.equal(r.mode, 'FULL'); assert.equal(r.status, 'fail'); assert.equal(r.requests, 13)
  assert.equal(r.healthDaysRequested, 2); assert.equal(f.paths.filter(p => p.includes('dailyHeartRate')).length, 2)
  assert.deepEqual(f.fullMarks, [])
})

test('outage does not bypass the final account and subject fence', async () => {
  for (const change of ['account', 'subject'] as const) {
    const f = fixture(); let statusCalls = 0
    f.setReply(p => {
      if (p === 'status' && ++statusCalls === 2) {
        if (change === 'subject') f.switchSubject()
        else return ok({ loggedIn: true, region: 'cn', profile: { displayName: 'another' } })
      }
      return isDaily(p) && dayOf(p)! < DAY ? { status: 502, body: {} } : f.base(p)
    })
    const r = await runGarminSyncJob(f.host)
    assert.equal(r.status, 'stale'); assert.equal(r.healthDaysRequested, 3)
    assert.deepEqual(f.saves, []); assert.deepEqual(f.intradaySaved, []); assert.equal(f.cursor(), 14); assert.deepEqual(f.fullMarks, [])
    assert.equal(f.reports.length, change === 'subject' ? 0 : 1)
  }
})
