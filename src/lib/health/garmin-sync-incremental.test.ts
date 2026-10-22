import test from 'node:test'
import assert from 'node:assert/strict'
import { runGarminSyncJob, type GarminReply, type GarminSyncReport } from './garmin-sync-runner'

// Only the remote transport and local persistence boundary are synthetic. The real
// runner selects, parses, fences and checkpoints every requested date.
type Progress = { checkedDays: string[]; pendingDays: string[]; lastSyncAt: string | null; intradayCheckedDays?: string[] }
const account = (name = 'synthetic') => ({ status: 200, body: { loggedIn: true, region: 'cn', profile: { displayName: name } } })
function fixture(options: { cursor?: number; intraday?: boolean } = {}) {
  let progress: Progress | null = null, cursor = options.cursor ?? 14, full: string | null = null, subject = 'synthetic-athlete'
  const paths: string[] = [], writes: any[] = [], reports: GarminSyncReport[] = []
  const failures = new Map<string, number>()
  let activityConflict = false, healthSaveFailure = false, checkpointFailure = false, stale = false
  const activity = { activityId: 123, activityType: { typeKey: 'running' }, startTimeGMT: '2026-10-21 01:02:03', duration: 60.1, distance: 200.25 }
  const api = async (path: string): Promise<GarminReply> => {
    paths.push(path)
    if (path === 'status') return account(stale && paths.filter(p => p === 'status').length % 2 === 0 ? 'other' : 'synthetic')
    if (path.includes('activities/search')) return { status: 200, body: [activity] }
    const d = path.match(/\d{4}-\d{2}-\d{2}/)![0]
    const kind = path.includes('usersummary') ? 'summary' : path.includes('hrv-service') ? 'hrv' : path.includes('dailySleepData') ? 'sleep' : path.includes('dailyHeartRate') ? 'hr' : 'stress'
    const status = failures.get(`${kind}:${d}`)
    if (status !== undefined) return { status, body: {} }
    if (kind === 'hr' || kind === 'stress') return { status: 204, body: null }
    return { status: 200, body: { calendarDate: d, totalSteps: 0, hrvSummary: { calendarDate: d, lastNightAvg: 60 }, dailySleepDTO: { calendarDate: d, sleepTimeSeconds: 23400 } } }
  }
  const host = {
    api, subject: () => subject, generation: () => 0, day: '2026-10-22', now: '2026-10-22T12:02:00Z', reason: 'AUTO' as 'AUTO' | 'MANUAL',
    bindAccount: () => true, progress: (_: string) => {}, saveView: (_: unknown[], __: string) => {}, activitySeen: () => true,
    save: (health: any[], activities: any[]) => { writes.push({ health, activities }); return { saved: healthSaveFailure ? activities.length : health.length + activities.length, skipped: 0,
      errors: [...(healthSaveFailure ? ['健康本机保存失败'] : []), ...(activityConflict ? ['同一来源活动数值已变化，保留原记录等待确认'] : [])], healthErrors: healthSaveFailure ? ['健康本机保存失败'] : [] } },
    report: (r: GarminSyncReport) => { reports.push(structuredClone(r)) }, sleep: async (_: number) => {},
    backfill: { get: () => cursor, set: (_: string, n: number) => { cursor = n } },
    fullReview: { get: () => full, set: (_: string, at: string) => { full = at } },
    dailyProgress: { get: () => progress, set: (_: string, p: Progress) => { if (checkpointFailure) throw Error('disk'); progress = structuredClone(p) } },
    ...(options.intraday ? { intraday: { complete: (_: string) => false, save: (days: any[]) => days.length } } : {}),
  }
  return { host, paths, writes, reports, failures, get progress() { return progress }, get cursor() { return cursor }, get full() { return full },
    seed: (p: Progress) => { progress = structuredClone(p) }, conflict: () => { activityConflict = true }, healthSaveFailure: () => { healthSaveFailure = true },
    checkpointFailure: () => { checkpointFailure = true }, stale: () => { stale = true }, switchSubject: () => { subject = 'other-athlete' },
    days: () => paths.filter(p => p.includes('usersummary')).map(p => p.match(/\d{4}-\d{2}-\d{2}/)![0]), clear: () => { paths.length = 0 },
  }
}

test('activity conflicts stay visible but cannot make saved health history repeat INITIAL on every sync', async () => {
  const f = fixture(); f.conflict()
  const first = await runGarminSyncJob(f.host)
  assert.equal(first.status, 'partial'); assert.equal(first.healthDaysRequested, 90)
  assert.equal(f.progress?.checkedDays.length, 90); assert.deepEqual(f.progress?.pendingDays, []); assert.equal(f.cursor, 90)
  assert.equal(f.full, null, 'a partial activity import must not be called a complete success')
  f.clear()
  const second = await runGarminSyncJob(f.host)
  assert.equal(second.status, 'partial'); assert.equal(second.mode, 'RECENT'); assert.equal(second.activityLimit, 20)
  assert.deepEqual(f.days(), ['2026-10-22', '2026-10-21', '2026-10-20'])
  assert.equal(second.requests, 12); assert.equal(f.writes.at(-1).activities[0].durationSec, 60.1)
  assert.ok(second.errors.some(e => e.includes('保留原记录')))
})

test('a legacy partial cursor migrates into bounded backfill without one more sixty-two-day reread', async () => {
  const f = fixture({ cursor: 42 }); f.conflict()
  for (const [days, cursor, pending] of [[17, 56, 34], [17, 70, 20], [17, 84, 6], [9, 90, 0], [3, 90, 0]]) {
    f.clear(); const r = await runGarminSyncJob(f.host)
    assert.equal(r.healthDaysRequested, days); assert.equal(r.activityLimit, 20); assert.equal(r.status, 'partial')
    assert.equal(f.cursor, cursor); assert.equal(f.progress?.pendingDays.length, pending)
    assert.equal(r.mode, days > 3 ? 'BACKFILL' : 'RECENT')
    assert.ok(!f.days().includes('2026-10-15'), 'completed legacy history must not be reread to establish receipts')
  }
})

test('ordinary sync across midnight remains three days while explicit manual review reads fourteen days and 200 activities', async () => {
  const f = fixture(); await runGarminSyncJob(f.host); f.clear()
  f.host.day = '2026-10-23'; f.host.now = '2026-10-23T12:02:00Z'
  const ordinary = await runGarminSyncJob(f.host)
  assert.equal(ordinary.mode, 'RECENT'); assert.equal(ordinary.activityLimit, 20)
  assert.deepEqual(f.days(), ['2026-10-23', '2026-10-22', '2026-10-21'])
  f.clear(); f.host.reason = 'MANUAL'
  const review = await runGarminSyncJob(f.host)
  assert.equal(review.mode, 'FULL'); assert.equal(review.activityLimit, 200); assert.equal(f.days().length, 14)
})

test('missed days after a longer pause include the last previously read day without reopening all history', async () => {
  const f = fixture(); await runGarminSyncJob(f.host); f.clear()
  f.host.day = '2026-10-27'; f.host.now = '2026-10-27T12:02:00Z'
  const r = await runGarminSyncJob(f.host)
  assert.equal(r.activityLimit, 20)
  assert.deepEqual(f.days(), ['2026-10-27', '2026-10-26', '2026-10-25', '2026-10-24', '2026-10-23', '2026-10-22'])
})

test('single-metric historical failures remain pending and retry only the missing dates', async () => {
  const f = fixture(); f.failures.set('hrv:2026-09-22', 500); f.failures.set('sleep:2026-09-20', 502)
  const first = await runGarminSyncJob(f.host)
  assert.equal(first.status, 'partial'); assert.equal(f.progress?.checkedDays.length, 88)
  assert.deepEqual(f.progress?.pendingDays, ['2026-09-22', '2026-09-20']); assert.equal(f.cursor, 30); assert.equal(f.full, null)
  f.failures.clear(); f.clear()
  const retry = await runGarminSyncJob(f.host)
  assert.equal(retry.mode, 'BACKFILL'); assert.equal(retry.activityLimit, 20); assert.equal(retry.status, 'ok')
  assert.deepEqual(f.days(), ['2026-10-22', '2026-10-21', '2026-10-20', '2026-09-22', '2026-09-20'])
  assert.deepEqual(f.progress?.pendingDays, []); assert.equal(f.cursor, 90)
})

test('interrupted initial history resumes in fourteen older dates without replaying its completed range', async () => {
  const f = fixture(); f.failures.set('summary:2026-09-22', 429)
  const first = await runGarminSyncJob(f.host)
  assert.equal(first.healthDaysRequested, 31); assert.equal(f.progress?.checkedDays.length, 30); assert.equal(f.progress?.pendingDays.length, 60)
  f.failures.clear(); f.clear()
  const retry = await runGarminSyncJob(f.host)
  assert.equal(retry.mode, 'BACKFILL'); assert.equal(retry.activityLimit, 20); assert.equal(retry.healthDaysRequested, 17)
  assert.deepEqual(f.days().slice(0, 4), ['2026-10-22', '2026-10-21', '2026-10-20', '2026-09-22'])
  assert.equal(f.days().at(-1), '2026-09-09'); assert.equal(f.progress?.pendingDays.length, 46); assert.equal(f.cursor, 44)
})

test('pending dates survive calendar changes and are not discarded because they have become older than ninety days', async () => {
  const f = fixture(); f.seed({ checkedDays: ['2026-10-22'], pendingDays: ['2026-07-01'], lastSyncAt: '2026-10-22T12:02:00Z' })
  f.host.day = '2026-10-23'; f.host.now = '2026-10-23T12:02:00Z'; f.failures.set('sleep:2026-07-01', 502)
  const r = await runGarminSyncJob(f.host)
  assert.equal(r.mode, 'BACKFILL'); assert.deepEqual(f.days(), ['2026-10-23', '2026-10-22', '2026-10-21', '2026-07-01'])
  assert.deepEqual(f.progress?.pendingDays, ['2026-07-01']); assert.ok(!f.progress?.checkedDays.includes('2026-07-01'))
})

test('health persistence failure cannot create checked receipts or advance the successful-health time', async () => {
  const f = fixture(); f.healthSaveFailure()
  const r = await runGarminSyncJob(f.host)
  assert.equal(r.status, 'partial'); assert.deepEqual(f.progress?.checkedDays, []); assert.equal(f.progress?.pendingDays.length, 90)
  assert.equal(f.progress?.lastSyncAt, null); assert.equal(f.cursor, 14); assert.equal(f.full, null)
})

test('healthErrors omitted by a legacy save adapter conservatively blocks health progress for all save errors', async () => {
  const f = fixture(); const host = { ...f.host, save: () => ({ saved: 1, skipped: 0, errors: ['unknown save failure'] }) }
  await runGarminSyncJob(host)
  assert.deepEqual(f.progress?.checkedDays, []); assert.equal(f.progress?.lastSyncAt, null); assert.equal(f.cursor, 14)
})

test('empty supported daily responses are checked without inventing health values', async () => {
  const f = fixture(); const base = f.host.api
  f.host.api = async p => p === 'status' || p.includes('activities/search') ? base(p) : { status: 204, body: null }
  const r = await runGarminSyncJob(f.host)
  assert.equal(r.healthRows, 0); assert.equal(f.progress?.checkedDays.length, 90); assert.deepEqual(f.progress?.pendingDays, [])
  assert.deepEqual(f.writes[0].health, [])
})

test('an absent daily resource is checked as unavailable data without manufacturing a metric', async () => {
  const f = fixture(); const base = f.host.api
  f.host.api = async p => p === 'status' || p.includes('activities/search') ? base(p) : { status: 404, body: {} }
  const r = await runGarminSyncJob(f.host)
  assert.equal(r.healthRows, 0); assert.equal(f.progress?.checkedDays.length, 90); assert.deepEqual(f.progress?.pendingDays, [])
  assert.equal(r.status, 'ok'); assert.deepEqual(f.writes[0].health, [])
})

test('malformed daily response dates remain pending even if other health metrics were saved', async () => {
  const f = fixture(); const base = f.host.api
  f.host.api = async p => p.includes('hrv-service/hrv/2026-09-22') ? { status: 200, body: { hrvSummary: { calendarDate: '2026-09-21', lastNightAvg: 60 } } } : base(p)
  const r = await runGarminSyncJob(f.host)
  assert.equal(r.status, 'partial'); assert.deepEqual(f.progress?.pendingDays, ['2026-09-22']); assert.equal(f.progress?.checkedDays.length, 89)
})

test('empty old intraday dates get a separate checked receipt and do not cause a repeated twenty-eight-day scan', async () => {
  const f = fixture({ intraday: true }); const first = await runGarminSyncJob(f.host)
  assert.equal(first.intraday?.requested, 28); assert.equal(f.progress?.intradayCheckedDays?.length, 28)
  f.clear(); const second = await runGarminSyncJob(f.host)
  assert.equal(second.intraday?.requested, 2); assert.equal(second.requests, 16)
  assert.equal(f.paths.filter(p => p.includes('dailyHeartRate')).length, 2)
  assert.equal(f.paths.filter(p => p.includes('dailyStress')).length, 2)
})

test('failed old intraday metrics remain retryable instead of becoming empty checked receipts', async () => {
  const f = fixture({ intraday: true }); f.failures.set('hr:2026-10-12', 500)
  const first = await runGarminSyncJob(f.host)
  assert.equal(first.status, 'partial'); assert.ok(first.errors.some(e => e.includes('2026-10-12')))
  assert.equal(f.progress?.intradayCheckedDays?.length, 27); assert.ok(!f.progress?.intradayCheckedDays?.includes('2026-10-12'))
  f.failures.clear(); f.clear(); const retry = await runGarminSyncJob(f.host)
  assert.equal(retry.intraday?.requested, 3); assert.ok(f.progress?.intradayCheckedDays?.includes('2026-10-12'))
  assert.deepEqual(f.paths.filter(p => p.includes('dailyHeartRate')).map(p => p.match(/\d{4}-\d{2}-\d{2}/)![0]), ['2026-10-22', '2026-10-21', '2026-10-12'])
})

test('intraday auth expiry blocks all writes while malformed replies and persistence failure retain retryable dates', async () => {
  const auth = fixture({ intraday: true }); auth.failures.set('hr:2026-10-22', 401)
  const expired = await runGarminSyncJob(auth.host)
  assert.equal(expired.status, 'auth'); assert.equal(auth.writes.length, 0); assert.equal(auth.progress, null)

  const malformed = fixture({ intraday: true }); const base = malformed.host.api
  malformed.host.api = async p => p.includes('dailyHeartRate') && p.includes('2026-10-12') ? { status: 200, body: { calendarDate: '2026-10-12', ok: false, error: 'unavailable' } } : base(p)
  const invalid = await runGarminSyncJob(malformed.host)
  assert.equal(invalid.status, 'partial'); assert.ok(!malformed.progress?.intradayCheckedDays?.includes('2026-10-12'))
  assert.equal(malformed.progress?.checkedDays.length, 90, 'daily progress is independent of a failed intraday metric')

  const disk = fixture({ intraday: true }); disk.host.intraday!.save = () => 0
  const failed = await runGarminSyncJob(disk.host)
  assert.equal(failed.status, 'partial'); assert.equal(disk.full, null); assert.deepEqual(disk.progress?.intradayCheckedDays, [])
})

test('a long pause queues all outstanding dates but each automatic pass reads at most fourteen older dates', async () => {
  const f = fixture({ cursor: 90 }); f.seed({ checkedDays: ['2026-09-01'], pendingDays: ['2026-08-01'], lastSyncAt: '2026-09-01T12:02:00Z' })
  const first = await runGarminSyncJob(f.host)
  assert.equal(first.mode, 'BACKFILL'); assert.equal(first.healthDaysRequested, 17); assert.equal(first.activityLimit, 20)
  assert.ok(f.days().includes('2026-08-01')); assert.ok(f.progress!.pendingDays.length > 14)
  f.clear(); const second = await runGarminSyncJob(f.host)
  assert.equal(second.healthDaysRequested, 17); assert.equal(second.activityLimit, 20)
  assert.ok(!f.days().includes('2026-08-01'), 'a checked pending date is not reread on the next continuation')
})

test('changing account or athlete during a request prevents every progress and data write', async () => {
  for (const kind of ['account', 'athlete']) {
    const f = fixture({ intraday: true }); if (kind === 'account') f.stale()
    else { const base = f.host.api; f.host.api = async p => { const r = await base(p); if (p.includes('dailySleepData')) f.switchSubject(); return r } }
    const r = await runGarminSyncJob(f.host)
    assert.equal(r.status, 'stale', kind); assert.equal(f.writes.length, 0, kind); assert.equal(f.progress, null, kind); assert.equal(f.cursor, 14, kind)
  }
})

test('a failed progress write reports partial and cannot manufacture a complete-success timestamp', async () => {
  const f = fixture(); f.checkpointFailure()
  const r = await runGarminSyncJob(f.host)
  assert.equal(r.status, 'partial'); assert.equal(f.progress, null); assert.equal(f.full, null)
  assert.ok(r.errors.length > 0); assert.ok(f.writes[0].health.length > 0)
})
