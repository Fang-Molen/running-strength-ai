import test from 'node:test'
import assert from 'node:assert/strict'
import { garminActivity, runGarminSyncJob, type GarminReply, type GarminSyncReport } from './garmin-sync-runner'
import { saveDeviceRows, activityDraftId } from '../ui/device-store'
import { loadConfirmedTrainingImports } from '../core/training-import'
import { setStoreBackend } from '../core/storage'
import { setEventContext } from '../core/events'
import { loadTrainingActivities } from '../ui/training-read-model'
import { garminScopeKey, garminViewKey } from './garmin-view-scope'
import { bindGarminAccount } from './garmin-account-owner'

const activity = { activityId: 123, activityType: { typeKey: 'running' }, startTimeGMT: '2026-10-17 01:02:03', duration: 1234.5, distance: 5000.25, calories: 0 }
const status = (name = 'synthetic-user'): GarminReply => ({ status: 200, body: { loggedIn: true, region: 'cn', profile: { displayName: name } } })
function fixture() {
  let subject = 'synthetic', generation = 0, calls = 0
  const saved: any[] = [], views: unknown[] = [], reports: GarminSyncReport[] = []
  const api = async (path: string): Promise<GarminReply> => {
    calls++
    if (path === 'status') return status()
    if (path.includes('activities/search')) return { status: 200, body: [activity] }
    const day = path.match(/\d{4}-\d{2}-\d{2}/)![0]
    return { status: 200, body: { calendarDate: day, totalSteps: 0, averageStressLevel: 0, bodyBatteryHighestValue: 0,
      hrvSummary: { calendarDate: day, lastNightAvg: 60 }, dailySleepDTO: { calendarDate: day, sleepTimeSeconds: 23400 } } }
  }
  const host = { api, subject: () => subject, generation: () => generation, bindAccount: (_scope: string, _subject: string) => true, day: '2026-10-18', now: '2026-10-18T12:00:00Z',
    save: (health: any[], activities: any[]) => { saved.push({ health, activities }); return { saved: health.length + activities.length, skipped: 0, errors: [] } },
    saveView: (list: unknown[]) => { views.push(list) }, report: (r: GarminSyncReport) => { reports.push(structuredClone(r)) }, progress: (_message: string) => {} }
  return { host, saved, views, reports, switchSubject: () => { subject = 'other' }, switchAccount: () => { generation++ }, calls: () => calls }
}
test('Garmin mapping preserves decimal units, valid zero and stable source ID', () => {
  const a = garminActivity(activity, 'cn:synthetic')!
  assert.equal(a.durationSec, 1234.5); assert.equal(a.distanceM, 5000.25); assert.equal(a.calories, 0)
  assert.equal(a.startIso, '2026-10-17T01:02:03.000Z')
  assert.equal(garminActivity({ ...activity, duration: 1300 }, 'cn:synthetic')!.sourceIdentity, a.sourceIdentity)
  assert.notEqual(garminActivity(activity, 'com:synthetic')!.sourceIdentity, a.sourceIdentity)
  assert.equal(garminActivity({ ...activity, startTimeGMT: 'bad' }, 'cn:synthetic'), null)
})
test('successful synthetic sync reports actual coverage, 6.5h sleep and zero observations', async () => {
  const f = fixture(), r = await runGarminSyncJob(f.host)
  assert.equal(r.status, 'ok'); assert.equal(r.coverageDays.length, 14); assert.equal(r.healthDaysRequested, 14)
  assert.equal(r.completeHistory, false); assert.equal(r.activityRows, 1); assert.equal(f.reports.length, 1)
  assert.equal(f.saved[0].health.find((r: any) => r.metric === 'SLEEP').value, 6.5)
  assert.equal(f.saved[0].health.find((r: any) => r.metric === 'BODY_BATTERY').value, 0)
})
test('duplicate activity ID is one record, different IDs with same measurements stay separate', async () => {
  const f = fixture(), base = f.host.api
  f.host.api = p => p.includes('activities/search') ? Promise.resolve({ status: 200, body: [activity, activity, { ...activity, activityId: 124 }] }) : base(p)
  const r = await runGarminSyncJob(f.host); assert.equal(r.activityRows, 2); assert.equal(f.saved[0].activities.length, 2)
})
test('divergent duplicate activity IDs block writes rather than select a value', async () => {
  const f = fixture(), base = f.host.api
  f.host.api = p => p.includes('activities/search') ? Promise.resolve({ status: 200, body: [activity, { ...activity, duration: 5 }] }) : base(p)
  const r = await runGarminSyncJob(f.host); assert.equal(r.status, 'fail'); assert.equal(f.saved.length, 0); assert.equal(f.reports.length, 1)
})
test('partial health endpoint failure stays partial while preserving valid data', async () => {
  const f = fixture(), base = f.host.api
  f.host.api = p => p.includes('hrv-service') ? Promise.resolve({ status: 429, body: {} }) : base(p)
  const r = await runGarminSyncJob(f.host); assert.equal(r.status, 'partial'); assert.equal(r.errors.length, 14)
})
test('all failed endpoints never report successful sync', async () => {
  const f = fixture(); f.host.api = async p => p === 'status' ? status() : { status: 500, body: {} }
  const r = await runGarminSyncJob(f.host); assert.equal(r.status, 'fail'); assert.equal(r.saved, 0)
})
test('HTTP200 with no available fields is empty, not successful record coverage', async () => {
  const f = fixture(); f.host.api = async p => p === 'status' ? status() : p.includes('activities/search') ? { status: 200, body: [] } :
    { status: 200, body: { calendarDate: p.match(/\d{4}-\d{2}-\d{2}/)![0] } }
  const r = await runGarminSyncJob(f.host); assert.equal(r.status, 'empty'); assert.deepEqual(r.coverageDays, [])
})
test('login expiry produces an attempt report without writing any new data', async () => {
  const f = fixture(), base = f.host.api
  f.host.api = p => p.includes('hrv-service') ? Promise.resolve({ status: 401, body: {} }) : base(p)
  const r = await runGarminSyncJob(f.host); assert.equal(r.status, 'auth'); assert.equal(f.saved.length, 0); assert.equal(f.reports.length, 1)
})
test('subject switch during sync discards rows and does not write old report into new user', async () => {
  const f = fixture(), base = f.host.api
  f.host.api = p => { if (p.includes('activities/search')) f.switchSubject(); return base(p) }
  const r = await runGarminSyncJob(f.host); assert.equal(r.status, 'stale'); assert.equal(f.saved.length, 0); assert.equal(f.reports.length, 0)
})
test('logout generation change prevents late response writes', async () => {
  const f = fixture(), base = f.host.api
  f.host.api = p => { if (p.includes('dailySleepData')) f.switchAccount(); return base(p) }
  const r = await runGarminSyncJob(f.host); assert.equal(r.status, 'stale'); assert.equal(f.views.length, 0)
})
test('account changes in another tab detected by final status fence', async () => {
  const f = fixture(), base = f.host.api; let statuses = 0
  f.host.api = p => p === 'status' ? Promise.resolve(status(++statuses === 1 ? 'synthetic-user' : 'another')) : base(p)
  const r = await runGarminSyncJob(f.host); assert.equal(r.status, 'stale'); assert.equal(f.saved.length, 0)
})
test('a known account cannot be imported into another athlete', async () => {
  const f = fixture(); f.host.bindAccount = () => false
  assert.equal((await runGarminSyncJob(f.host)).status, 'fail'); assert.equal(f.saved.length, 0)
})
test('transport and report storage failures are explicit', async () => {
  const f = fixture(); f.host.api = async () => { throw Error('offline') }
  assert.equal((await runGarminSyncJob(f.host)).status, 'fail'); assert.equal(f.reports.length, 1)
  const g = fixture(); g.host.report = () => { throw Error('quota') }
  const r = await runGarminSyncJob(g.host); assert.equal(r.status, 'fail'); assert.ok(r.errors.some(e => e.includes('报告保存失败')))
})
test('real local import service deduplicates stable source ID, keeps corrections, and unifies raw view identity', () => {
  const data = new Map<string, string>(), store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, keys: () => [...data.keys()] }
  setStoreBackend(store); setEventContext({ athleteId: 'synthetic' }); const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })
  try {
    assert.equal(bindGarminAccount('cn:synthetic', 'synthetic'), true)
    assert.equal(bindGarminAccount('cn:synthetic', 'other'), false)
    const a = garminActivity(activity, 'cn:synthetic')!
    assert.match(activityDraftId(a), /^[\w-]{1,55}$/)
    assert.equal(saveDeviceRows([], [a]).saved, 1); assert.equal(saveDeviceRows([], [a]).skipped, 1)
    assert.equal(loadConfirmedTrainingImports().length, 1)
    assert.equal(saveDeviceRows([], [{ ...a, durationSec: 999 }]).errors.length, 1)
    assert.equal(loadConfirmedTrainingImports()[0].durationSeconds.value, 1234.5)
    store.setItem(garminScopeKey(), 'synthetic-scope')
    store.setItem(garminViewKey('fk-garmin-acts-v1'), JSON.stringify({ 123: { id: 123, start: a.startIso, dist: a.distanceM, dur: a.durationSec, type: 'running', sourceIdentity: a.sourceIdentity } }))
    assert.equal(loadTrainingActivities().length, 1)
    setEventContext({ athleteId: 'other' }); assert.equal(loadTrainingActivities().length, 0)
  } finally { setStoreBackend(null); setEventContext({ athleteId: 'local' }); if (old) Object.defineProperty(globalThis, 'localStorage', old); else Reflect.deleteProperty(globalThis, 'localStorage') }
})

test('R1 SYNC-04: network failure on status is reported as fail (not auth) and still produces a report', async () => {
  for (const status of [0, 503]) {
    const f = fixture(), base = f.host.api
    f.host.api = p => p === 'status' ? Promise.resolve({ status, body: {} }) : base(p)
    const r = await runGarminSyncJob(f.host); assert.equal(r.status, 'fail'); assert.equal(f.saved.length, 0); assert.equal(f.reports.length, 1); assert.match(r.errors[0], status ? /HTTP 503/ : /网络中断/)
  }
})
test('v78 health history backfills 14 older days per sync until 90 days, only after a clean save', async () => {
  const f = fixture(); let upTo = 14; const asked: string[] = []
  const api = f.host.api; const host = { ...f.host, api: async (p: string) => { const d = p.match(/\d{4}-\d{2}-\d{2}/)?.[0]; if (d) asked.push(d); return api(p) }, backfill: { get: () => upTo, set: (_s: string, n: number) => { upTo = n } } }
  const r = await runGarminSyncJob(host)
  assert.equal(r.healthDaysRequested, 28); assert.equal(upTo, 28)
  assert.ok(asked.includes('2026-10-04') && asked.includes('2026-09-21') && !asked.includes('2026-09-20'))
  for (let i = 0; i < 6; i++) await runGarminSyncJob(host)
  assert.equal(upTo, 90)
  const last = await runGarminSyncJob(host); assert.equal(last.healthDaysRequested, 14)
})

// ---- v89.10.1 增量同步 / 首次一次补齐 ----
function counting(opts: { list?: (start: number, limit: number) => any[]; throttleAfter?: number } = {}) {
  const f = fixture(), paths: string[] = []; let daily = 0
  const base = f.host.api
  f.host.api = async (p: string) => { paths.push(p)
    if (p.includes('activities/search')) { const m = /start=(\d+)&limit=(\d+)/.exec(p)!; return { status: 200, body: opts.list ? opts.list(+m[1], +m[2]) : [activity] } }
    if (p.includes('usersummary')) { daily++; if (opts.throttleAfter != null && daily > opts.throttleAfter) return { status: 429, body: {} } }
    return base(p) }
  const store: Record<string, string> = {}; let cursor = 14
  const host = { ...f.host, sleep: async () => {}, intraday: { complete: () => false, save: (d: unknown[]) => d.length },
    backfill: { get: () => cursor, set: (_: string, n: number) => { cursor = n } },
    fullReview: { get: (s: string) => store[s] ?? null, set: (s: string, at: string) => { store[s] = at } } }
  return { f, host, paths, store, cursor: () => cursor, setCursor: (n: number) => { cursor = n } }
}
test('first sync collects 90 days daily + 28 days intraday in one go, then marks full review', async () => {
  const c = counting(), r = await runGarminSyncJob({ ...c.host, reason: 'AUTO' })
  assert.equal(r.mode, 'INITIAL'); assert.equal(r.healthDaysRequested, 90); assert.equal(c.cursor(), 90); assert.ok(c.store['cn:synthetic-user'])
  assert.equal(c.paths.filter(p => p.includes('dailyHeartRate')).length, 28)
  console.log('INITIAL requests', r.requests)
})
test('auto sync same local day after full review = RECENT: 3 days, 20-item list, far fewer requests', async () => {
  const c = counting(); c.setCursor(90); c.store['cn:synthetic-user'] = c.host.now
  const done = new Set<number>(); const host = { ...c.host, intraday: { complete: (d: string) => d < '2026-10-16', save: (d: unknown[]) => d.length } }
  const full = await runGarminSyncJob({ ...host, reason: 'MANUAL' }), recent = await runGarminSyncJob({ ...host, reason: 'AUTO' }); void done
  assert.equal(full.mode, 'FULL'); assert.equal(recent.mode, 'RECENT'); assert.equal(recent.healthDaysRequested, 3); assert.equal(recent.activityLimit, 20)
  assert.ok(c.paths.some(p => p.includes('start=0&limit=20'))); assert.ok(recent.requests! < full.requests! / 2)
  console.log('FULL requests', full.requests, 'RECENT requests', recent.requests)
})
test('new local day or no full review → FULL even for auto', async () => {
  const c = counting(); c.setCursor(90); c.store['cn:synthetic-user'] = '2026-10-17T12:00:00Z'
  assert.equal((await runGarminSyncJob({ ...c.host, reason: 'AUTO' })).mode, 'FULL')
})
test('RECENT pages further only while every item is new/changed (cap 200)', async () => {
  const c = counting({ list: (start, limit) => Array.from({ length: limit }, (_, i) => ({ ...activity, activityId: 1000 + start + i })) }); c.setCursor(90); c.store['cn:synthetic-user'] = c.host.now
  const r = await runGarminSyncJob({ ...c.host, reason: 'AUTO', activitySeen: (_s: string, o: any) => o.activityId >= 1045 })
  assert.equal(c.paths.filter(p => p.includes('activities/search')).length, 3); assert.equal(r.activityRows, 60)
  const all = counting({ list: (start, limit) => Array.from({ length: limit }, (_, i) => ({ ...activity, activityId: 5000 + start + i })) }); all.setCursor(90); all.store['cn:synthetic-user'] = all.host.now
  await runGarminSyncJob({ ...all.host, reason: 'AUTO', activitySeen: () => false }); assert.equal(all.paths.filter(p => p.includes('activities/search')).length, 10)
})
test('first sync throttled (429) saves partial, cursor resumes, no full-review mark', async () => {
  const c = counting({ throttleAfter: 30 }), r = await runGarminSyncJob({ ...c.host, reason: 'AUTO' })
  assert.equal(r.mode, 'INITIAL'); assert.equal(r.healthDaysRequested, 30); assert.equal(c.cursor(), 30); assert.equal(c.store['cn:synthetic-user'], undefined); assert.ok(r.errors.some(e => e.includes('429')))
  const c2 = counting(); c2.setCursor(30); const r2 = await runGarminSyncJob({ ...c2.host, reason: 'AUTO' })
  assert.equal(r2.mode, 'INITIAL'); assert.equal(r2.healthDaysRequested, 14 + 60); assert.equal(c2.cursor(), 90)
})
