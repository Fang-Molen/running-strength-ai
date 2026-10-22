import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend } from '../lib/core/storage'
import { setEventContext } from '../lib/core/events'
import { localDay, shiftDay } from '../lib/health/observation'
import { writeGarminDailyProgress } from '../lib/health/garmin-progress-store'
import { readGarminSyncStatus } from '../lib/health/garmin-sync-status'

async function fixture(mode: 'cache' | 'throw-report' | 'drop-report') {
  const original = new Map(['localStorage', 'window', 'navigator'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const oldFetch = globalThis.fetch, data = new Map<string, string>(), paths: string[] = []
  let fail = false
  const subject = `synthetic-report-${mode}`, scope = 'cn:synthetic-report'
  const key = (name: string) => `${name}:${subject}`
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (fail && (mode === 'cache' ? /^fk-garmin-last-(sync|full-ok|attempt):/.test(k) : k.startsWith('fk-garmin-sync-report:'))) {
        if (mode === 'drop-report') return
        throw Error('synthetic persistence failure')
      }
      data.set(k, v)
    }, removeItem: (k: string) => { data.delete(k) }, keys: () => [...data.keys()],
  }
  setStoreBackend(store); setEventContext({ athleteId: subject })
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true })
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
  const day = localDay(), now = new Date().toISOString()
  store.setItem(`fk-garmin-health-backfill:${scope}`, '90')
  for (const name of ['fk-garmin-last-attempt', 'fk-garmin-last-sync', 'fk-garmin-last-full-ok']) store.setItem(key(name), '2026-01-01T00:00:00Z')
  writeGarminDailyProgress(scope, subject, { checkedDays: [day], pendingDays: [], lastSyncAt: now, intradayCheckedDays: Array.from({ length: 28 }, (_, i) => shiftDay(day, -i)) }, store)
  globalThis.fetch = async input => {
    const p = String(input); paths.push(p)
    if (p.endsWith('/status')) return Response.json({ loggedIn: true, region: 'cn', profile: { displayName: 'synthetic-report' } })
    if (p.includes('activities/search')) return Response.json([{ activityId: 1, startTimeGMT: '2026-01-01 01:00:00', duration: 60.1, distance: 200.25, activityType: { typeKey: 'running' } }])
    return new Response(null, { status: 204 })
  }
  const api = await import('./garmin-sync')
  fail = true
  return { ...api, paths, store, subject, key, data, cleanup: () => {
    globalThis.fetch = oldFetch; setStoreBackend(null); setEventContext({ athleteId: 'local' })
    for (const [k, descriptor] of original) if (descriptor) Object.defineProperty(globalThis, k, descriptor); else Reflect.deleteProperty(globalThis, k)
  } }
}

test('saved reports remain successful when derived timestamp writes fail and still suppress an immediate automatic reread', async () => {
  const f = await fixture('cache')
  try {
    const result = await f.runGarminSync(() => {})
    assert.equal(result, 'ok')
    const report = JSON.parse(f.store.getItem(f.key('fk-garmin-sync-report'))!)
    assert.equal(report.status, 'ok'); assert.equal(report.requests, 16)
    const visible = readGarminSyncStatus(f.subject, f.store)
    assert.equal(visible.lastUsefulSyncAt, report.at); assert.equal(visible.lastFullSuccessAt, report.at); assert.equal(visible.lastAttemptAt, report.at)
    const requests = f.paths.length
    await f.maybeAutoGarminSync()
    assert.equal(f.paths.length, requests, 'fresh verified report must prevent a new automatic request even with an old time cache')
  } finally { f.cleanup() }
})

test('throwing or silently dropped primary report writes remain explicit failures', async () => {
  for (const mode of ['throw-report', 'drop-report'] as const) {
    const f = await fixture(mode)
    try {
      assert.equal(await f.runGarminSync(() => {}), 'fail', mode)
      assert.equal(f.store.getItem(f.key('fk-garmin-sync-report')), null, mode)
      assert.equal(f.store.getItem(f.key('fk-garmin-last-full-ok')), '2026-01-01T00:00:00Z', mode)
    } finally { f.cleanup() }
  }
})
